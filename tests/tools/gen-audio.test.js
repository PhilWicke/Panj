// tests/tools/gen-audio.test.js
// The Gemini TTS tool without the network: ids, key handling, the request and
// its retries against a stubbed fetch, the ffmpeg conversion, the manifest, the
// re-takes of a voice with a pitch ceiling and the texts collected from a bundle.
// ffmpeg tests skip when ffmpeg is missing.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { audioId } from '../../app/js/util/audio-id.js';
import { DEFAULT_MODEL, MAX_TAKES, bundleTexts, generateAll, highLine, pcmToMp3, readKey, synthesize } from '../../tools/gen-audio.js';
import { medianPitch } from '../../tools/pitch.js';

const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
const API = 'https://generativelanguage.googleapis.com/v1beta/models';

/** @type {string[]} */
const tempDirs = [];
const tmp = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slovelingo-audio-test-'));
  tempDirs.push(dir);
  return dir;
};
after(() => Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true }))));

/**
 * Sets environment variables for one test and restores them afterwards.
 * @param {import('node:test').TestContext} t @param {Record<string, string>} vars
 */
function withEnv(t, vars) {
  const saved = Object.fromEntries(Object.keys(vars).map((name) => [name, process.env[name]]));
  Object.assign(process.env, vars);
  t.after(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
}

/** @param {Buffer} pcm */
const audioResponse = (pcm) =>
  Response.json({
    candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: pcm.toString('base64') } }] } }],
  });

const SENTENCE = 'Danes je lep dan.';

/**
 * One second of a sine tone as 16-bit 24 kHz mono PCM.
 * @param {number} hz
 */
function tone(hz) {
  const pcm = Buffer.alloc(48000);
  for (let i = 0; i < 24000; i += 1) pcm.writeInt16LE(Math.round(12000 * Math.sin((2 * Math.PI * hz * i) / 24000)), i * 2);
  return pcm;
}

/** @param {number | null | undefined} actual @param {number} expected */
function assertNearHz(actual, expected) {
  assert.ok(typeof actual === 'number' && Math.abs(actual - expected) <= 3, `measured ${actual} Hz, expected about ${expected} Hz`);
}

/**
 * The pitch of an mp3 file, decoded back through ffmpeg.
 * @param {string} file
 */
function clipPitch(file) {
  const args = ['-v', 'error', '-i', file, '-f', 's16le', '-ar', '24000', '-ac', '1', 'pipe:1'];
  return medianPitch(spawnSync('ffmpeg', args, { maxBuffer: 1 << 24 }).stdout);
}

/**
 * Runs generateAll for one text in one voice against a stubbed fetch that answers the takes in
 * turn. A take is a tone's frequency or a function that makes the answer.
 * @param {import('node:test').TestContext} t @param {string} voice
 * @param {(number | (() => Response))[]} takes
 */
async function generateTakes(t, voice, takes) {
  const dir = await tmp();
  const keyFile = join(dir, 'test.key');
  await writeFile(keyFile, 'fake-key\n');
  withEnv(t, { GEMINI_API_KEY_FILE: keyFile });
  let call = 0;
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
    const take = takes[call];
    call += 1;
    return typeof take === 'number' ? audioResponse(tone(take)) : take();
  });
  const outDir = join(dir, 'audio');
  const run = () => generateAll({ texts: [{ text: SENTENCE, voice }], outDir, model: 'tts-model' });
  const result = await run();
  const id = await audioId(SENTENCE, voice);
  const manifest = JSON.parse(await readFile(join(outDir, 'manifest.json'), 'utf8').catch(() => '{}'));
  return { result, run, requests: () => fetchMock.mock.callCount(), entry: manifest[id], file: join(outDir, `${id}.mp3`) };
}

const clientError = () => Response.json({ error: { message: 'not this time' } }, { status: 400 });

test('audioId is stable and voice-specific', async () => {
  assert.equal(await audioId('Dober dan.', 'Kore'), await audioId('Dober dan.', 'Kore'));
  assert.notEqual(await audioId('Dober dan.', 'Kore'), await audioId('Dober dan.', 'Puck'));
  assert.match(await audioId('x', 'y'), /^[0-9a-f]{16}$/);
  const expected = createHash('sha256').update('Kore\nČaj, češnje in žganci.', 'utf8').digest('hex').slice(0, 16);
  assert.equal(await audioId('Čaj, češnje in žganci.', 'Kore'), expected);
});

test('readKey reports the path when the file is missing and never includes contents in errors', async (t) => {
  const dir = await tmp();
  const missing = join(dir, 'missing.key');
  withEnv(t, { GEMINI_API_KEY_FILE: missing, GEMINI_API_KEY: 'stale-env-value' });
  await assert.rejects(readKey(), (err) => {
    assert.ok(err instanceof Error);
    assert.ok(err.message.includes(missing), err.message);
    assert.ok(!err.message.includes('stale-env-value'));
    return true;
  });

  const blank = join(dir, 'blank.key');
  await writeFile(blank, '  \n');
  process.env.GEMINI_API_KEY_FILE = blank;
  await assert.rejects(readKey(), (err) => err instanceof Error && err.message.includes(blank));

  const good = join(dir, 'good.key');
  await writeFile(good, '  fake-key-123\n');
  process.env.GEMINI_API_KEY_FILE = good;
  assert.equal(await readKey(), 'fake-key-123');
});

test('synthesize posts the prompt and voice, retries a 429 and returns the PCM bytes', async (t) => {
  const pcm = Buffer.from([1, 2, 3, 4, 5, 6]);
  /** @type {{ url: string, init: RequestInit }[]} */
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (/** @type {string} */ url, /** @type {RequestInit} */ init) => {
    calls.push({ url, init });
    return calls.length === 1 ? new Response('busy', { status: 429 }) : audioResponse(pcm);
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let settled = false;
  const pending = synthesize({ text: 'Dober dan.', voice: 'Kore', model: 'tts-model', key: 'fake-key' });
  pending.then(() => (settled = true), () => (settled = true));
  while (!settled) {
    await new Promise((resolve) => setImmediate(resolve));
    t.mock.timers.tick(8000);
  }
  assert.deepEqual(await pending, pcm);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, `${API}/tts-model:generateContent`);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(/** @type {Record<string, string>} */ (calls[0].init.headers)['x-goog-api-key'], 'fake-key');
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    contents: [{ parts: [{ text: 'Say clearly in Slovenian, at a natural pace: Dober dan.' }] }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } } },
  });
});

test('synthesize does not retry a client error and keeps the key out of the message', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ error: { message: 'API key not valid: fake-key' } }, { status: 400 }),
  );
  await assert.rejects(synthesize({ text: 'Ja.', voice: 'Puck', model: 'tts-model', key: 'fake-key' }), (err) => {
    assert.ok(err instanceof Error);
    assert.match(err.message, /400/);
    assert.ok(!err.message.includes('fake-key'), err.message);
    return true;
  });
  assert.equal(fetchMock.mock.callCount(), 1);
});

test('synthesize refuses audio that is not raw 24 kHz mono PCM', async (t) => {
  /** @param {string} mimeType */
  const answer = (mimeType) => Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType, data: 'AAAA' } }] } }] });
  const mimes = ['audio/l16; rate=24000; channels=1', 'audio/wav', 'audio/L16;codec=pcm;rate=16000', 'audio/l16; rate=24000; channels=2'];
  let call = 0;
  t.mock.method(globalThis, 'fetch', async () => answer(mimes[call++]));
  const run = () => synthesize({ text: 'Ja.', voice: 'Kore', model: 'tts-model', key: 'fake-key' });
  assert.deepEqual(await run(), Buffer.from([0, 0, 0]));
  for (const mime of mimes.slice(1)) {
    await assert.rejects(run(), (err) => err instanceof Error && err.message.includes(`returned ${mime},`));
  }
});

// gemini-3.8-flash-tts answers audio/wav and reads the prompt prefix aloud, so the
// voice check ran on 3.1-preview; bulk generation must use the model the voice check approved.
test('the default model is the voice-check model and its answer passes the PCM guard', async (t) => {
  assert.equal(DEFAULT_MODEL, 'gemini-3.1-flash-tts-preview');
  const pcm = Buffer.from([1, 0, 2, 0]);
  /** @type {string[]} */
  const urls = [];
  t.mock.method(globalThis, 'fetch', async (/** @type {string} */ url) => {
    urls.push(url);
    // the answer shape recorded from gemini-3.1-flash-tts-preview during the voice check
    return Response.json({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/l16; rate=24000; channels=1', data: pcm.toString('base64') } }] } }],
    });
  });
  assert.deepEqual(await synthesize({ text: 'Dober dan.', voice: 'Kore', model: DEFAULT_MODEL, key: 'fake-key' }), pcm);
  assert.deepEqual(urls, [`${API}/gemini-3.1-flash-tts-preview:generateContent`]);
});

test('pcmToMp3 converts one second of silence to a small mp3', { skip: !hasFfmpeg && 'ffmpeg not found' }, async () => {
  const out = join(await tmp(), 'silence.mp3');
  await pcmToMp3(Buffer.alloc(24000 * 2), out);
  const bytes = await readFile(out);
  assert.ok(bytes.length > 0 && bytes.length < 10_000, `${bytes.length} bytes`);
  const id3 = bytes.subarray(0, 3).toString('latin1') === 'ID3';
  const frameSync = bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
  assert.ok(id3 || frameSync, 'starts with an ID3 tag or an MP3 frame');
});

test('generateAll writes one mp3 per id, records it in the manifest and skips it next time', { skip: !hasFfmpeg && 'ffmpeg not found' }, async (t) => {
  const dir = await tmp();
  const keyFile = join(dir, 'test.key');
  await writeFile(keyFile, 'fake-key\n');
  withEnv(t, { GEMINI_API_KEY_FILE: keyFile });
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => audioResponse(Buffer.alloc(4800)));
  const outDir = join(dir, 'audio');
  const texts = [
    { text: 'Dober dan.', voice: 'Kore' },
    { text: 'Dober dan.', voice: 'Puck' },
    { text: 'Dober dan.', voice: 'Kore' },
  ];

  const first = await generateAll({ texts, outDir, model: 'tts-model' });
  assert.deepEqual(first, { generated: 2, skipped: 0, failed: [], high: [] });
  const manifest = JSON.parse(await readFile(join(outDir, 'manifest.json'), 'utf8'));
  for (const voice of ['Kore', 'Puck']) {
    const id = await audioId('Dober dan.', voice);
    const { size } = await stat(join(outDir, `${id}.mp3`));
    // silence cannot be measured, so Puck's take is kept at once with a null pitch
    const measured = voice === 'Puck' ? { pitchHz: null } : {};
    assert.deepEqual(manifest[id], { text: 'Dober dan.', voice, model: 'tts-model', bytes: size, ...measured });
  }
  assert.equal(Object.keys(manifest).length, 2);

  const second = await generateAll({ texts, outDir, model: 'tts-model' });
  assert.deepEqual(second, { generated: 0, skipped: 2, failed: [], high: [] });
  assert.equal(fetchMock.mock.callCount(), 2);
});

const needsFfmpeg = { skip: !hasFfmpeg && 'ffmpeg not found' };

test('a Puck job takes again until a take is under the ceiling and writes that take', needsFfmpeg, async (t) => {
  const { result, requests, entry, file } = await generateTakes(t, 'Puck', [260, 240, 140]);
  assert.equal(requests(), 3);
  assert.deepEqual(result, { generated: 1, skipped: 0, failed: [], high: [] });
  assertNearHz(entry.pitchHz, 140);
  assert.ok(Number.isInteger(entry.pitchHz), String(entry.pitchHz));
  assertNearHz(clipPitch(file), 140);
});

test('a Puck job always too high makes MAX_TAKES requests, is listed in high and a skip adds nothing', needsFfmpeg, async (t) => {
  const { result, run, requests, entry, file } = await generateTakes(t, 'Puck', Array(MAX_TAKES).fill(260));
  assert.equal(requests(), MAX_TAKES);
  assert.equal(result.generated, 1);
  assert.deepEqual(result.failed, []);
  assert.deepEqual(result.high, [{ text: SENTENCE, voice: 'Puck', hz: entry.pitchHz }]);
  assertNearHz(entry.pitchHz, 260);
  assertNearHz(clipPitch(file), 260);

  assert.deepEqual(await run(), { generated: 0, skipped: 1, failed: [], high: [] });
  assert.equal(requests(), MAX_TAKES);
});

test('a Puck job always too high keeps the lowest of its takes', needsFfmpeg, async (t) => {
  const { result, requests, entry, file } = await generateTakes(t, 'Puck', [300, 230, 280, 250, 270]);
  assert.equal(requests(), MAX_TAKES);
  assert.deepEqual(result.high, [{ text: SENTENCE, voice: 'Puck', hz: entry.pitchHz }]);
  assertNearHz(entry.pitchHz, 230);
  assertNearHz(clipPitch(file), 230);
});

test('a Kore job at 260 Hz makes one request and is not measured', needsFfmpeg, async (t) => {
  const { result, requests, entry } = await generateTakes(t, 'Kore', [260]);
  assert.equal(requests(), 1);
  assert.deepEqual(result, { generated: 1, skipped: 0, failed: [], high: [] });
  assert.ok(entry && !('pitchHz' in entry), JSON.stringify(entry));
});

test('a Puck job whose second take fails keeps the first, is not in failed and says why in high', needsFfmpeg, async (t) => {
  const { result, requests, entry, file } = await generateTakes(t, 'Puck', [260, clientError]);
  assert.equal(requests(), 2);
  assert.equal(result.generated, 1);
  assert.deepEqual(result.failed, []);
  assert.deepEqual(result.high, [
    { text: SENTENCE, voice: 'Puck', hz: entry.pitchHz, error: `take 2 of ${MAX_TAKES} failed: tts-model answered 400: not this time` },
  ]);
  assertNearHz(entry.pitchHz, 260);
  assertNearHz(clipPitch(file), 260);
});

test('a Puck job cut short by a later take keeps the lowest so far and names the take that failed', needsFfmpeg, async (t) => {
  const { result, requests, entry } = await generateTakes(t, 'Puck', [300, 230, 280, clientError]);
  assert.equal(requests(), 4);
  assert.deepEqual(result.high, [
    { text: SENTENCE, voice: 'Puck', hz: entry.pitchHz, error: `take 4 of ${MAX_TAKES} failed: tts-model answered 400: not this time` },
  ]);
  assertNearHz(entry.pitchHz, 230);
});

test('the reason a job was cut short never carries the key', needsFfmpeg, async (t) => {
  const echoesKey = () => Response.json({ error: { message: 'refused fake-key' } }, { status: 403 });
  const { result } = await generateTakes(t, 'Puck', [260, echoesKey]);
  assert.match(String(result.high[0]?.error), /refused \[key\]/);
  assert.ok(!JSON.stringify(result).includes('fake-key'), JSON.stringify(result));
});

test('highLine is the HIGH line of a clip, with the reason only when its takes were cut short', () => {
  assert.equal(highLine({ text: SENTENCE, voice: 'Puck', hz: 260 }), `HIGH 260 Puck ${SENTENCE}`);
  assert.equal(
    highLine({ text: SENTENCE, voice: 'Puck', hz: 260, error: 'take 2 of 5 failed: quota' }),
    `HIGH 260 Puck ${SENTENCE} (take 2 of 5 failed: quota)`,
  );
});

test('a Puck job with no successful take goes to failed', async (t) => {
  const { result, requests, entry } = await generateTakes(t, 'Puck', [clientError]);
  assert.equal(requests(), 1);
  assert.equal(result.generated, 0);
  assert.equal(result.failed.length, 1);
  assert.deepEqual(result.high, []);
  assert.equal(entry, undefined);
});

test('a take that cannot be measured after a measured one is passed over, so the measured clip stays', needsFfmpeg, async (t) => {
  const silence = () => audioResponse(Buffer.alloc(48000));
  const { result, requests, entry } = await generateTakes(t, 'Puck', [260, silence, 140]);
  assert.equal(requests(), 3);
  assertNearHz(entry.pitchHz, 140);
  assert.deepEqual(result.high, []);
});

test('takes that cannot be measured after a high one leave the high one, listed', needsFfmpeg, async (t) => {
  const silence = () => audioResponse(Buffer.alloc(48000));
  const { result, requests, entry } = await generateTakes(t, 'Puck', [260, silence, silence, silence, silence]);
  assert.equal(requests(), MAX_TAKES);
  assertNearHz(entry.pitchHz, 260);
  assert.equal(result.high.length, 1);
});

test('bundleTexts collects the accepted items, their examples and the dialogue lines of lessons with an accepted item', async () => {
  const dist = await tmp();
  await mkdir(join(dist, 'units'));
  await writeFile(join(dist, 'index.json'), JSON.stringify({ units: [{ id: 'u01' }] }));
  /** @param {string} id @param {string} sl @param {string} status @param {string[]} examples */
  const item = (id, sl, status, examples) => ({ id, sl, examples: examples.map((ex) => ({ sl: ex, en: '-' })), verification: { status } });
  const lessons = [
    {
      id: 'u01-l01',
      items: [
        item('u01-l01-i01', 'Živjo.', 'accepted', ['Živjo, kako si?']),
        item('u01-l01-i02', 'brat', 'pending', ['Imam brata.']),
        item('u01-l01-i03', 'Dober dan.', 'accepted', ['Dober dan, kako ste?']),
      ],
      dialogue: { lines: [{ sl: 'Dober dan.' }, { sl: 'Kar naprej.' }] },
    },
    {
      id: 'u01-l02',
      items: [item('u01-l02-i01', 'sestra', 'pending', ['To je sestra.'])],
      dialogue: { lines: [{ sl: 'To je moja sestra.' }] },
    },
  ];
  await writeFile(join(dist, 'units', 'u01.json'), JSON.stringify({ unit: { id: 'u01' }, lessons }));
  assert.deepEqual(await bundleTexts(dist), ['Živjo.', 'Živjo, kako si?', 'Dober dan.', 'Dober dan, kako ste?', 'Kar naprej.']);
});
