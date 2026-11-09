// Removes the recordings the course no longer uses. tools/gen-audio.js only ever adds clips, so a
// text that a correction changed or a voice that was dropped leaves its old clip behind. pruneKeep
// lists what the bundle still needs (every text of the bundle and every perception drill word, in
// every voice), and pruneAudio deletes the other clips of a folder with their manifest entries.
// Nothing here calls Gemini.
//
// Library: keepVoices, pruneKeep, pruneAudio.
// CLI: node tools/prune-audio.js [--voice <name> ...] prunes app/assets/audio/ against
// app/content/dist/ (run a content build first), keeping DEFAULT_VOICES and any voice named, and
// prints removed=<n> kept=<n>. Exit 1 when the bundle is missing or the prune failed, 2 on a bad
// argument.
import { readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { audioId } from '../app/js/util/audio-id.js';
import { drillTexts } from '../app/js/util/audio-texts.js';
import { DEFAULT_VOICES, bundleTexts } from './gen-audio.js';

/** @typedef {{ text: string, voice: string }} Clip */

const DEFAULT_OUT_DIR = fileURLToPath(new URL('../app/assets/audio/', import.meta.url));
const DEFAULT_DIST_DIR = fileURLToPath(new URL('../app/content/dist/', import.meta.url));
const MANIFEST = 'manifest.json';
// The name gen-audio gives a clip. Any other file in the folder is not this tool's to delete.
const CLIP_FILE = /^([0-9a-f]{16})\.mp3$/;
const USAGE = 'Usage: node tools/prune-audio.js [--voice <name> ...]';

/** @param {unknown} err */
const errorMessage = (err) => (err instanceof Error ? err.message : String(err));

/**
 * The voices a prune keeps: the course's voices and any named. Naming a voice can only add to what
 * stays, so pruning after re-recording one voice never deletes the other's clips; a voice the
 * course has dropped is in neither list and is still pruned.
 * @param {string[]} [named]
 * @returns {string[]}
 */
export const keepVoices = (named = []) => [...new Set([...DEFAULT_VOICES, ...named])];

/**
 * Every clip a bundle needs: each text of bundleTexts and of drillTexts, each once, in every voice.
 * @param {{ distDir: string, voices: string[] }} options
 * @returns {Promise<Clip[]>}
 */
export async function pruneKeep({ distDir, voices }) {
  const texts = new Set([...(await bundleTexts(distDir)), ...drillTexts()]);
  return [...texts].flatMap((text) => voices.map((voice) => ({ text, voice })));
}

/**
 * @param {string} file
 * @returns {Promise<Record<string, unknown>>}
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
    throw new Error(`${file} is not valid JSON; repair or remove it before pruning`);
  }
}

/**
 * Deletes every clip of outDir that is not the recording of a keep entry and drops every manifest
 * entry it does not keep. The manifest is read first, so a damaged one stops the run with nothing
 * deleted, and written (through a temporary file, sorted as gen-audio writes it) before the clips
 * go, so it never names a deleted clip. A run cut short is finished by running it again.
 * @param {{ outDir: string, keep: Clip[] }} options
 * @returns {Promise<{ removed: string[], kept: number }>} `removed` lists the ids taken out of the
 * folder, as a clip, a manifest entry or both; `kept` counts the clips left on disk
 */
export async function pruneAudio({ outDir, keep }) {
  const manifestFile = path.join(outDir, MANIFEST);
  const manifest = await readManifest(manifestFile);
  const keepIds = new Set(await Promise.all(keep.map(({ text, voice }) => audioId(text, voice))));
  const clipIds = (await readdir(outDir)).flatMap((name) => CLIP_FILE.exec(name)?.[1] ?? []);
  const staleClips = clipIds.filter((id) => !keepIds.has(id));
  const staleEntries = Object.keys(manifest).filter((id) => !keepIds.has(id));

  const remaining = Object.keys(manifest).filter((id) => keepIds.has(id)).sort();
  await writeFile(`${manifestFile}.tmp`, JSON.stringify(Object.fromEntries(remaining.map((id) => [id, manifest[id]])), null, 2) + '\n');
  await rename(`${manifestFile}.tmp`, manifestFile);
  await Promise.all(staleClips.map((id) => rm(path.join(outDir, `${id}.mp3`), { force: true })));
  return { removed: [...new Set([...staleClips, ...staleEntries])], kept: clipIds.length - staleClips.length };
}

/** @param {string[]} argv @returns {Promise<number>} the exit code */
async function main(argv) {
  let values;
  try {
    ({ values } = parseArgs({ args: argv, options: { voice: { type: 'string', multiple: true } } }));
  } catch (err) {
    console.error(`${errorMessage(err)}\n${USAGE}`);
    return 2;
  }
  const voices = keepVoices(values.voice);

  let keep;
  try {
    keep = await pruneKeep({ distDir: DEFAULT_DIST_DIR, voices });
  } catch (err) {
    const missing = /** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT';
    console.error(missing ? 'ERROR no content bundle in app/content/dist; run npm run build:content first' : `ERROR ${errorMessage(err)}`);
    return 1;
  }
  try {
    const { removed, kept } = await pruneAudio({ outDir: DEFAULT_OUT_DIR, keep });
    console.log(`removed=${removed.length} kept=${kept}`);
    return 0;
  } catch (err) {
    console.error(`ERROR ${errorMessage(err)}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
