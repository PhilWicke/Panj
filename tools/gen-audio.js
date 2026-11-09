// Gemini text-to-speech for the course recordings. Build-time only, run on
// the maintainer's machine: each text is sent to Gemini TTS once per voice, the 16-bit
// 24 kHz mono PCM that comes back is piped straight into ffmpeg (no PCM file is
// written) and stored as outDir/<audioId>.mp3, and outDir/manifest.json maps
// each id to { text, voice, model, bytes }. Ids already in the manifest with
// their file on disk are skipped, so a run can be repeated after a failure.
//
// The key is read only from the file named by GEMINI_API_KEY_FILE, by default
// ~/.config/google/aistudio.key. The GEMINI_API_KEY variable is stale and is
// never read. The key is never printed, logged or put into an error message.
//
// Library: readKey, synthesize, pcmToMp3, generateAll, bundleTexts, textsFromFile.
// CLI: node tools/gen-audio.js (--from-bundle | --texts <file>) [--voice <name> ...]
//   [--model <model>] [--limit <n>] [--out <dir>]
// --from-bundle reads app/content/dist (run a content build first) and appends
// the perception drill's words (Ruling 46), --texts reads one text per line,
// --limit keeps the first n texts (each in every voice), --out replaces
// app/assets/audio/. Exit 1 when a text failed or the run could not start, 2 on
// a bad argument.
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { audioId } from '../app/js/util/audio-id.js';
import { audioTexts, drillTexts } from '../app/js/util/audio-texts.js';

/** @typedef {import('../app/js/content/types.js').Index} Index */
/** @typedef {import('../app/js/content/types.js').UnitContent} UnitContent */
/** @typedef {{ text: string, voice: string, model: string, bytes: number }} ManifestEntry */
/** @typedef {{ generated: number, skipped: number, failed: { text: string, error: string }[] }} GenerateResult */

// The model the voice check ran on, so bulk clips match the approved voices.
// gemini-3.8-flash-tts is not usable with this prompt: it answers audio/wav and
// reads the "Say clearly in Slovenian" prefix aloud. Preview models can be
// retired; a replacement needs a new voice check before any bulk run.
export const DEFAULT_MODEL = 'gemini-3.1-flash-tts-preview';
/** Kore is a female voice, Puck a male one. */
export const DEFAULT_VOICES = ['Kore', 'Puck'];
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const PROMPT = 'Say clearly in Slovenian, at a natural pace: ';
const RETRY_DELAYS_MS = [2000, 4000, 8000];
const SAMPLE_RATE = 24000;
const DEFAULT_KEY_FILE = path.join(homedir(), '.config', 'google', 'aistudio.key');
const DEFAULT_OUT_DIR = fileURLToPath(new URL('../app/assets/audio/', import.meta.url));
const DEFAULT_DIST_DIR = fileURLToPath(new URL('../app/content/dist/', import.meta.url));
const MANIFEST = 'manifest.json';
const USAGE =
  'Usage: node tools/gen-audio.js (--from-bundle | --texts <file>) [--voice <name> ...] [--model <model>] [--limit <n>] [--out <dir>]';

/** @param {unknown} err */
const errorMessage = (err) => (err instanceof Error ? err.message : String(err));
/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** A path relative to the working directory when it lies inside it, absolute otherwise. @param {string} p */
const rel = (p) => {
  const relative = path.relative(process.cwd(), p);
  return relative.startsWith('..') ? p : relative || '.';
};

/**
 * Removes every occurrence of the key from a message, in case an upstream error echoes it.
 * @param {string} message @param {string} key
 */
const redact = (message, key) => (key ? message.split(key).join('[key]') : message);

/**
 * Reads the Gemini key from GEMINI_API_KEY_FILE or ~/.config/google/aistudio.key and trims it.
 * Errors name the file, never its contents.
 * @returns {Promise<string>}
 */
export async function readKey() {
  const file = process.env.GEMINI_API_KEY_FILE ?? DEFAULT_KEY_FILE;
  let raw;
  try {
    raw = await readFile(file, 'utf8');
  } catch (err) {
    const code = /** @type {NodeJS.ErrnoException} */ (err).code;
    if (code === 'ENOENT') throw new Error(`no Gemini key file at ${file}; save the key there or set GEMINI_API_KEY_FILE to its path`);
    throw new Error(`could not read the Gemini key file at ${file} (${code ?? 'unknown error'})`);
  }
  const key = raw.trim();
  if (key === '') throw new Error(`the Gemini key file at ${file} is empty`);
  return key;
}

/**
 * The API's own error message, shortened, or nothing.
 * @param {Response} res
 */
async function errorDetail(res) {
  let text = '';
  try {
    text = await res.text();
    text = JSON.parse(text)?.error?.message ?? text;
  } catch {
    // not JSON: keep the raw text
  }
  const message = String(text).replace(/\s+/g, ' ').trim().slice(0, 200);
  return message ? `: ${message}` : '';
}

/**
 * The PCM bytes of a generateContent answer.
 * @param {any} json @param {string} model
 * @returns {Buffer}
 */
function decodeAudio(json, model) {
  const candidate = json?.candidates?.[0];
  /** @type {any[]} */
  const parts = candidate?.content?.parts ?? [];
  const inline = parts.find((part) => typeof part?.inlineData?.data === 'string')?.inlineData;
  if (!inline) {
    const reason = candidate?.finishReason ?? json?.promptFeedback?.blockReason;
    throw new Error(`${model} returned no audio${reason ? ` (${reason})` : ''}`);
  }
  // Raw L16 at 24 kHz mono only ("audio/L16;codec=pcm;rate=24000", "audio/l16; rate=24000; channels=1"):
  // anything else would play at the wrong speed or with a header click once ffmpeg reads it as s16le.
  const mime = String(inline.mimeType ?? '');
  const channels = /channels=(\d+)/i.exec(mime)?.[1] ?? '1';
  if (!/^audio\/L16;/i.test(mime) || !mime.includes(`rate=${SAMPLE_RATE}`) || channels !== '1') {
    throw new Error(`${model} returned ${mime || 'audio of no stated type'}, expected mono 16-bit PCM at ${SAMPLE_RATE} Hz`);
  }
  return Buffer.from(inline.data, 'base64');
}

/**
 * Speaks one text in one voice and returns the raw PCM (16-bit little-endian, 24 kHz, mono).
 * Retries a 429 or 5xx answer three times, after 2, 4 and 8 seconds.
 * @param {{ text: string, voice: string, model: string, key: string }} options
 * @returns {Promise<Buffer>}
 */
export async function synthesize({ text, voice, model, key }) {
  const url = `${API_BASE}/${model}:generateContent`;
  const body = JSON.stringify({
    contents: [{ parts: [{ text: PROMPT + text }] }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
  });
  for (let attempt = 0; ; attempt += 1) {
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body });
    } catch (err) {
      throw new Error(redact(`request to ${model} failed: ${errorMessage(err)}`, key));
    }
    if (res.ok) return decodeAudio(await res.json(), model);
    if ((res.status === 429 || res.status >= 500) && attempt < RETRY_DELAYS_MS.length) {
      await res.body?.cancel();
      await sleep(RETRY_DELAYS_MS[attempt]);
      continue;
    }
    throw new Error(redact(`${model} answered ${res.status}${await errorDetail(res)}`, key));
  }
}

/**
 * Converts raw PCM to a 48 kbps mono MP3 through ffmpeg's stdin. A failed conversion leaves no file.
 * @param {Buffer} pcm 16-bit little-endian, 24 kHz, mono
 * @param {string} outPath
 * @returns {Promise<void>}
 */
export function pcmToMp3(pcm, outPath) {
  return new Promise((resolve, reject) => {
    const args = ['-y', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', 'pipe:0', '-codec:a', 'libmp3lame', '-b:a', '48k', '-ac', '1', outPath];
    const ffmpeg = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    ffmpeg.stderr.setEncoding('utf8');
    ffmpeg.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-2000);
    });
    // An early exit makes the write fail with EPIPE; the exit code reports the cause.
    ffmpeg.stdin.on('error', () => {});
    ffmpeg.on('error', (err) => reject(new Error(`could not run ffmpeg: ${err.message}`)));
    ffmpeg.on('close', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const last = stderr.trim().split('\n').pop() ?? '';
      const failure = new Error(`ffmpeg failed (${signal ?? `exit ${code}`}): ${last}`);
      rm(outPath, { force: true }).catch(() => {}).then(() => reject(failure));
    });
    ffmpeg.stdin.end(pcm);
  });
}

/**
 * @param {string} file
 * @returns {Promise<Record<string, ManifestEntry>>}
 */
async function readManifest(file) {
  let raw;
  try {
    raw = await readFile(file, 'utf8');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return {};
    throw err;
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${file} is not valid JSON; repair or remove it before generating`);
  }
}

/**
 * Writes the manifest with sorted keys, through a temporary file so an interrupted run keeps the old one.
 * @param {string} file @param {Record<string, ManifestEntry>} manifest
 */
async function writeManifest(file, manifest) {
  const sorted = Object.fromEntries(Object.keys(manifest).sort().map((id) => [id, manifest[id]]));
  await writeFile(`${file}.tmp`, JSON.stringify(sorted, null, 2) + '\n');
  await rename(`${file}.tmp`, file);
}

/** @param {string} file */
const exists = (file) => stat(file).then(() => true, () => false);

/**
 * Generates outDir/<id>.mp3 for every { text, voice } whose id is not yet in the manifest with
 * its file, `concurrency` requests at a time, and records each file in outDir/manifest.json as
 * soon as it is written. The key is read only when something needs generating.
 * @param {{ texts: { text: string, voice: string }[], outDir: string, model: string, concurrency?: number }} options
 * @returns {Promise<GenerateResult>}
 */
export async function generateAll({ texts, outDir, model, concurrency = 2 }) {
  await mkdir(outDir, { recursive: true });
  const manifestFile = path.join(outDir, MANIFEST);
  const manifest = await readManifest(manifestFile);

  /** @type {Map<string, { id: string, text: string, voice: string }>} */
  const jobs = new Map();
  for (const { text, voice } of texts) {
    const id = await audioId(text, voice);
    if (!jobs.has(id)) jobs.set(id, { id, text, voice });
  }
  /** @type {GenerateResult} */
  const result = { generated: 0, skipped: 0, failed: [] };
  const todo = [];
  for (const job of jobs.values()) {
    if (manifest[job.id] && (await exists(path.join(outDir, `${job.id}.mp3`)))) result.skipped += 1;
    else todo.push(job);
  }
  if (todo.length === 0) return result;

  const key = await readKey();
  /** @type {Promise<void>} */
  let saving = Promise.resolve();
  const save = () => (saving = saving.catch(() => {}).then(() => writeManifest(manifestFile, manifest)));
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const job = todo[next];
      next += 1;
      const file = path.join(outDir, `${job.id}.mp3`);
      try {
        const pcm = await synthesize({ text: job.text, voice: job.voice, model, key });
        await pcmToMp3(pcm, file);
        manifest[job.id] = { text: job.text, voice: job.voice, model, bytes: (await stat(file)).size };
        await save();
        result.generated += 1;
      } catch (err) {
        result.failed.push({ text: job.text, error: `${job.voice}: ${redact(errorMessage(err), key)}` });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, todo.length)) }, worker));
  return result;
}

/**
 * The texts a bundle records: audioTexts of every unit file (the `sl` of every accepted item and
 * of its examples, and every dialogue line of a lesson with at least one accepted item, the
 * lessons a strict build keeps), in course order. Duplicates are dropped, first occurrence first.
 * @param {string} distDir a folder written by tools/build-content.js
 * @returns {Promise<string[]>}
 */
export async function bundleTexts(distDir) {
  /** @type {Index} */
  const index = JSON.parse(await readFile(path.join(distDir, 'index.json'), 'utf8'));
  /** @type {Set<string>} */
  const texts = new Set();
  for (const { id } of index.units) {
    /** @type {UnitContent} */
    const unit = JSON.parse(await readFile(path.join(distDir, 'units', `${id}.json`), 'utf8'));
    for (const text of audioTexts(unit)) texts.add(text);
  }
  return [...texts];
}

/**
 * One text per non-blank line, trimmed, duplicates dropped.
 * @param {string} file
 * @returns {Promise<string[]>}
 */
export async function textsFromFile(file) {
  const raw = (await readFile(file, 'utf8')).replace(/^﻿/, '');
  return [...new Set(raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== ''))];
}

/** @param {string[]} argv @returns {Promise<number>} the exit code */
async function main(argv) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        'from-bundle': { type: 'boolean' },
        texts: { type: 'string' },
        voice: { type: 'string', multiple: true },
        model: { type: 'string' },
        limit: { type: 'string' },
        out: { type: 'string' },
      },
    }));
  } catch (err) {
    console.error(`${errorMessage(err)}\n${USAGE}`);
    return 2;
  }
  const fromBundle = values['from-bundle'] === true;
  if (fromBundle === (values.texts !== undefined)) {
    console.error(`Give either --from-bundle or --texts <file>\n${USAGE}`);
    return 2;
  }
  const limit = values.limit === undefined ? Infinity : Number(values.limit);
  if (limit !== Infinity && !(Number.isInteger(limit) && limit > 0)) {
    console.error(`--limit needs a positive whole number\n${USAGE}`);
    return 2;
  }
  const voices = values.voice ?? DEFAULT_VOICES;
  const model = values.model ?? DEFAULT_MODEL;
  const outDir = values.out ? path.resolve(values.out) : DEFAULT_OUT_DIR;

  let texts;
  try {
    texts = fromBundle ? await bundleTexts(DEFAULT_DIST_DIR) : await textsFromFile(/** @type {string} */ (values.texts));
  } catch (err) {
    const missing = /** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT';
    if (fromBundle && missing) console.error(`ERROR no content bundle in ${rel(DEFAULT_DIST_DIR)}; run npm run build:content first`);
    else console.error(`ERROR ${errorMessage(err)}`);
    return 1;
  }
  // A bundle run also records the perception drill's words (Ruling 46), after the bundle's texts.
  const bundleCount = texts.length;
  if (fromBundle) {
    const known = new Set(texts);
    for (const text of drillTexts()) {
      if (known.has(text)) continue;
      known.add(text);
      texts.push(text);
    }
  }
  texts = texts.slice(0, limit);
  const drill = fromBundle ? ` drill=${Math.max(0, texts.length - bundleCount)}` : '';

  let result;
  try {
    result = await generateAll({ texts: texts.flatMap((text) => voices.map((voice) => ({ text, voice }))), outDir, model });
  } catch (err) {
    console.error(`ERROR ${errorMessage(err)}`);
    return 1;
  }
  for (const { text, error } of result.failed) console.error(`FAILED ${JSON.stringify(text)} ${error}`);
  console.log(
    `texts=${texts.length}${drill} voices=${voices.join(',')} model=${model} generated=${result.generated} skipped=${result.skipped} failed=${result.failed.length}`,
  );
  console.log(`wrote ${rel(outDir)}`);
  return result.failed.length > 0 ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
