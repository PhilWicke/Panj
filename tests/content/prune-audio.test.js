// tests/content/prune-audio.test.js
// Every test prunes a temporary folder; none touches app/assets/audio.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { audioId } from '../../app/js/util/audio-id.js';
import { drillTexts } from '../../app/js/util/audio-texts.js';
import { buildContent } from '../../tools/build-content.js';
import { DEFAULT_VOICES } from '../../tools/gen-audio.js';
import { keepVoices, pruneAudio, pruneKeep } from '../../tools/prune-audio.js';
import { copyFixture, removeCopies } from './helpers.js';

/** @type {string[]} */
const tempDirs = [];
after(async () => {
  await removeCopies();
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

const manifestOf = async (outDir) => JSON.parse(await readFile(join(outDir, 'manifest.json'), 'utf8'));

/**
 * A temporary audio folder with a one-byte clip and a manifest entry for each text and voice.
 * @param {{ text: string, voice: string }[]} clips
 */
async function audioFolder(clips) {
  const outDir = await mkdtemp(join(tmpdir(), 'slovelingo-prune-'));
  tempDirs.push(outDir);
  const manifest = {};
  for (const { text, voice } of clips) {
    const id = await audioId(text, voice);
    await writeFile(join(outDir, `${id}.mp3`), Buffer.from([0]));
    manifest[id] = { text, voice, model: 'gemini-3.1-flash-tts-preview', bytes: 1 };
  }
  await writeFile(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return outDir;
}

test('pruneAudio keeps every kept text in each voice and removes the rest with their manifest entries', async () => {
  const outDir = await audioFolder([
    { text: 'Dober dan.', voice: 'Kore' },
    { text: 'Dober dan.', voice: 'Puck' },
    { text: 'bil', voice: 'Kore' },
    { text: 'Stari stavek.', voice: 'Kore' },
    { text: 'Dober dan.', voice: 'Aoede' },
  ]);
  const r = await pruneAudio({ outDir, keep: [{ text: 'Dober dan.', voice: 'Kore' }, { text: 'Dober dan.', voice: 'Puck' }, { text: 'bil', voice: 'Kore' }] });
  assert.deepEqual([...r.removed].sort(), [await audioId('Stari stavek.', 'Kore'), await audioId('Dober dan.', 'Aoede')].sort());
  assert.equal(r.kept, 3);
  const keptIds = [await audioId('Dober dan.', 'Kore'), await audioId('Dober dan.', 'Puck'), await audioId('bil', 'Kore')].sort();
  assert.deepEqual((await readdir(outDir)).sort(), [...keptIds.map((id) => `${id}.mp3`), 'manifest.json'].sort());
  assert.deepEqual(Object.keys(await manifestOf(outDir)), keptIds);
});

test('pruneKeep holds the bundle texts and the drill words in each voice', async () => {
  const contentDir = await copyFixture('content-valid');
  const distDir = join(dirname(contentDir), 'dist');
  await buildContent({ contentDir, outDir: distDir });
  const keep = await pruneKeep({ distDir, voices: ['Kore', 'Puck'] });
  for (const word of drillTexts()) for (const voice of ['Kore', 'Puck']) assert.ok(keep.some((k) => k.text === word && k.voice === voice), `${word} ${voice}`);
  assert.ok(keep.some((k) => k.text === 'Živjo.' && k.voice === 'Puck'));
  assert.ok(keep.some((k) => k.text === 'Živjo, kako si?' && k.voice === 'Kore'));
});

test('pruneAudio counts only clips on disk as kept and drops a stale entry that has no clip', async () => {
  const outDir = await audioFolder([{ text: 'Dober dan.', voice: 'Kore' }, { text: 'Stari stavek.', voice: 'Kore' }]);
  const stale = await audioId('Stari stavek.', 'Kore');
  await rm(join(outDir, `${stale}.mp3`));
  const r = await pruneAudio({ outDir, keep: [{ text: 'Dober dan.', voice: 'Kore' }, { text: 'Še ni posneto.', voice: 'Kore' }] });
  assert.deepEqual(r, { removed: [stale], kept: 1 });
  assert.deepEqual(Object.keys(await manifestOf(outDir)), [await audioId('Dober dan.', 'Kore')]);
});

test('pruneAudio leaves files that are not clips alone', async () => {
  const outDir = await audioFolder([]);
  await writeFile(join(outDir, 'notes.mp3'), 'x');
  await writeFile(join(outDir, '.gitkeep'), '');
  assert.deepEqual(await pruneAudio({ outDir, keep: [] }), { removed: [], kept: 0 });
  assert.deepEqual((await readdir(outDir)).sort(), ['.gitkeep', 'manifest.json', 'notes.mp3']);
});

test('a damaged manifest stops pruneAudio before any clip is deleted', async () => {
  const outDir = await audioFolder([{ text: 'Stari stavek.', voice: 'Kore' }]);
  await writeFile(join(outDir, 'manifest.json'), '{ not json');
  await assert.rejects(pruneAudio({ outDir, keep: [] }), /manifest\.json is not valid JSON/);
  assert.ok((await readdir(outDir)).includes(`${await audioId('Stari stavek.', 'Kore')}.mp3`));
});

test('keepVoices: naming a voice only adds to the default voices, so pruning for one voice never drops the other', () => {
  assert.deepEqual(keepVoices(undefined), DEFAULT_VOICES);
  assert.deepEqual(keepVoices(['Kore']), DEFAULT_VOICES);
  assert.deepEqual(keepVoices(['Puck', 'Aoede']), [...DEFAULT_VOICES, 'Aoede']);
});

test('CLI refuses an unknown option before it reads or changes anything', async () => {
  const tool = fileURLToPath(new URL('../../tools/prune-audio.js', import.meta.url));
  const failure = await promisify(execFile)(process.execPath, [tool, '--nope']).then(() => null, (err) => err);
  assert.equal(failure?.code, 2);
  assert.match(failure.stderr, /Unknown option '--nope'/);
  assert.match(failure.stderr, /Usage: node tools\/prune-audio\.js/);
});
