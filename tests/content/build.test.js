// tests/content/build.test.js
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp as makeTempDir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildContent, wordTokens } from '../../tools/build-content.js';
const fx = (n) => fileURLToPath(new URL(`../../tools/fixtures/${n}/`, import.meta.url));

// Every temporary folder a test makes is removed once the file has run.
/** @type {string[]} */
const tempDirs = [];
/** @param {string} prefix */
const mkdtemp = async (prefix) => {
  const dir = await makeTempDir(prefix);
  tempDirs.push(dir);
  return dir;
};
after(() => Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true }))));

test('builds index and unit files with a stable version', async () => {
  const out = await mkdtemp(join(tmpdir(), 'slv-'));
  const a = await buildContent({ contentDir: fx('content-valid'), outDir: out, allowPending: true });
  const b = await buildContent({ contentDir: fx('content-valid'), outDir: out, allowPending: true });
  assert.equal(a.version, b.version);
  assert.match(a.version, /^[0-9a-f]{12}$/);
  const index = JSON.parse(await readFile(join(out, 'index.json'), 'utf8'));
  assert.equal(index.units.length, 1);
  assert.equal(index.lessonIndex[0].id, 'u01-l01');
});
test('strict build strips exercises that practise pending items', async () => {
  const out = await mkdtemp(join(tmpdir(), 'slv-'));
  await buildContent({ contentDir: fx('content-pending-mixed'), outDir: out });
  const unit = JSON.parse(await readFile(join(out, 'units/u01.json'), 'utf8'));
  const lesson = unit.lessons[0];
  assert.ok(lesson.items.some(i => i.verification.status === 'pending'));
  assert.ok(lesson.production.every(p => lesson.items.find(i => i.id === p.item).verification.status === 'accepted'));
});
test('refuses to build when the linter reports errors', async () => {
  const out = await mkdtemp(join(tmpdir(), 'slv-'));
  await assert.rejects(buildContent({ contentDir: fx('content-invalid-letters'), outDir: out }), /lint/);
});

// Beyond the brief: the index shape, the strict rules at their edges, the
// version and the version module, the CLI contract and the tokeniser. A test
// that needs edited content builds a temporary copy of a fixture.

const tmp = () => mkdtemp(join(tmpdir(), 'slovelingo-build-test-'));

/**
 * Copies a fixture into a temporary folder and lets `mutate` edit it.
 * @param {string} name @param {(dir: string) => Promise<void>} [mutate]
 */
async function copyFixture(name, mutate) {
  const dir = join(await tmp(), 'content');
  await cp(fx(name), dir, { recursive: true });
  if (mutate) await mutate(dir);
  return dir;
}

/** Rewrites one JSON file of a content folder in place. @param {string} dir @param {string} file @param {(doc: any) => void} edit */
async function editJson(dir, file, edit) {
  const target = join(dir, file);
  const doc = JSON.parse(await readFile(target, 'utf8'));
  edit(doc);
  await writeFile(target, JSON.stringify(doc, null, 2) + '\n');
}

/** @param {string} file */
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
/** Rejects with ENOENT when the path does not exist. @param {string} file */
const missing = (file) => assert.rejects(stat(file), { code: 'ENOENT' });

test('index.json carries the mode, the build time, every unit and rule, and a unit without lessons still gets its file', async () => {
  const content = await copyFixture('content-valid', (dir) => editJson(dir, 'units.json', (units) => {
    units.push({ id: 'u02', order: 2, title_sl: 'Družina', title_en: 'Family', motif: 'heart', lessons: [] });
  }));
  const out = await tmp();
  const dev = await buildContent({ contentDir: content, outDir: out, allowPending: true });
  const index = await readJson(join(out, 'index.json'));
  assert.equal(index.mode, 'dev');
  assert.ok(!Number.isNaN(Date.parse(index.generated)), index.generated);
  assert.deepEqual(index.units.map((u) => u.id), ['u01', 'u02']);
  assert.deepEqual(index.rules.map((r) => r.id), ['r-biti-present']);
  assert.deepEqual(index.lessonIndex, [{ id: 'u01-l01', unit: 'u01', order: 1, title_sl: 'Prvi pozdrav', title_en: 'First hello', itemCount: 3 }]);
  // živjo dober dan brat kako si ste to je moj dobrodošli
  assert.deepEqual(index.counts, { scheduledItems: 3, lemmasMet: 11 });
  assert.deepEqual(await readJson(join(out, 'units/u02.json')), { unit: index.units[1], lessons: [] });
  assert.deepEqual({ ...dev, warnings: dev.warnings.map((w) => w.rule) }, {
    version: index.version, mode: 'dev', units: 2, lessons: 1, scheduledItems: 3, lemmasMet: 11, warnings: ['helper-missing'], stripped: [], omittedLessons: [],
  });
  const strict = await buildContent({ contentDir: content, outDir: out });
  assert.equal((await readJson(join(out, 'index.json'))).mode, 'strict');
  assert.equal(strict.version, dev.version);
});

test('strict build keeps pending items in items without their notes, drops them from production and new_items, and counts accordingly', async () => {
  const out = await tmp();
  const strict = await buildContent({ contentDir: fx('content-pending-mixed'), outDir: out });
  const { lessons: [lesson] } = await readJson(join(out, 'units/u01.json'));
  assert.deepEqual(lesson.items.map((i) => [i.id, i.verification.status]), [['u01-l01-i01', 'accepted'], ['u01-l01-i02', 'accepted'], ['u01-l01-i03', 'pending']]);
  assert.ok(lesson.items.every((i) => !('notes' in i.verification)), 'internal notes reached the bundle');
  assert.deepEqual(lesson.production.map((p) => p.id), ['u01-l01-p01', 'u01-l01-p02']);
  assert.deepEqual(lesson.dialogue.lines.map((l) => l.new_items ?? null), [null, ['u01-l01-i02'], [], null]);
  assert.deepEqual(lesson.structured.map((s) => s.id), ['u01-l01-s01']);
  const index = await readJson(join(out, 'index.json'));
  assert.equal(index.lessonIndex[0].itemCount, 2);
  assert.deepEqual(index.counts, { scheduledItems: 2, lemmasMet: 11 });
  assert.deepEqual(strict.stripped.map((s) => s.path), ['dialogue/lines/2/new_items/0', 'production/u01-l01-p03/item']);
  assert.deepEqual(strict.omittedLessons, []);

  const dev = await buildContent({ contentDir: fx('content-pending-mixed'), outDir: out, allowPending: true });
  const devLesson = (await readJson(join(out, 'units/u01.json'))).lessons[0];
  assert.deepEqual(devLesson.production.map((p) => p.id), ['u01-l01-p01', 'u01-l01-p02', 'u01-l01-p03']);
  assert.deepEqual(devLesson.dialogue.lines[2].new_items, ['u01-l01-i03']);
  assert.deepEqual([dev.scheduledItems, dev.lemmasMet, dev.stripped], [3, 11, []]);
});

test('strict build leaves a lesson without an accepted item out of the index, the unit and the unit file', async () => {
  const content = await copyFixture('content-pending-mixed', (dir) => editJson(dir, 'lessons/u01-l01.json', (doc) => {
    for (const item of doc.items) item.verification.status = 'pending';
  }));
  const out = await tmp();
  const strict = await buildContent({ contentDir: content, outDir: out });
  const index = await readJson(join(out, 'index.json'));
  assert.deepEqual(index.lessonIndex, []);
  assert.deepEqual(index.units[0].lessons, []);
  assert.deepEqual((await readJson(join(out, 'units/u01.json'))).lessons, []);
  assert.deepEqual(index.counts, { scheduledItems: 0, lemmasMet: 0 });
  assert.deepEqual([strict.lessons, strict.omittedLessons, strict.stripped.length], [0, ['u01-l01'], 5]);
  const dev = await buildContent({ contentDir: content, outDir: out, allowPending: true });
  assert.deepEqual([dev.lessons, dev.scheduledItems, dev.omittedLessons], [1, 3, []]);
});

test('the version follows the content files alone: same in both modes and from a copy, different after an edit', async () => {
  const out = await tmp();
  const dev = await buildContent({ contentDir: fx('content-pending-mixed'), outDir: out, allowPending: true });
  const strict = await buildContent({ contentDir: fx('content-pending-mixed'), outDir: out });
  assert.equal(dev.version, strict.version);
  const copy = await buildContent({ contentDir: await copyFixture('content-pending-mixed'), outDir: out });
  assert.equal(copy.version, strict.version);
  const edited = await copyFixture('content-pending-mixed', (dir) => editJson(dir, 'rules/r-biti-present.json', (doc) => {
    doc.helper_en = 'The pronoun is usually left out.';
  }));
  const changed = await buildContent({ contentDir: edited, outDir: out });
  assert.notEqual(changed.version, strict.version);
  assert.match(changed.version, /^[0-9a-f]{12}$/);
});

test('the version module is an ES module that exports the version and sets the global, written only when asked for', async () => {
  const out = await tmp();
  const versionFile = join(out, 'version.js');
  const r = await buildContent({ contentDir: fx('content-valid'), outDir: out, allowPending: true, versionFile });
  assert.equal(await readFile(versionFile, 'utf8'), `export const SLOVELINGO_VERSION = "${r.version}";\nglobalThis.SLOVELINGO_VERSION = SLOVELINGO_VERSION;\n`);
  const mod = await import(pathToFileURL(versionFile).href);
  assert.equal(mod.SLOVELINGO_VERSION, r.version);
  assert.equal(globalThis.SLOVELINGO_VERSION, r.version);
  delete globalThis.SLOVELINGO_VERSION;
  const other = await tmp();
  await buildContent({ contentDir: fx('content-valid'), outDir: other, allowPending: true });
  await missing(join(other, 'version.js'));
});

test('a dev build still refuses every other lint error, names it and writes nothing', async () => {
  const out = await tmp();
  await assert.rejects(
    buildContent({ contentDir: fx('content-invalid-letters'), outDir: out, allowPending: true }),
    (err) => err instanceof Error
      && err.message.startsWith('lint found 1 error in ')
      && err.message.includes('\n  lessons/u01-l01.json items/u01-l01-i02/sl alphabet: contains characters outside the Slovenian alphabet: "á" (U+00E1)'),
  );
  await missing(join(out, 'index.json'));
});

test('a stale unit file from an earlier build is removed', async () => {
  const out = await tmp();
  await mkdir(join(out, 'units'), { recursive: true });
  await writeFile(join(out, 'units/u99.json'), '{}');
  await buildContent({ contentDir: fx('content-valid'), outDir: out, allowPending: true });
  await missing(join(out, 'units/u99.json'));
  await stat(join(out, 'units/u01.json'));
});

test('wordTokens lowercases and splits on anything that is not a letter or digit', () => {
  assert.deepEqual(wordTokens('Živjo, kako si? Dober dan. 12:30 (DOBRODOŠLI)'), ['živjo', 'kako', 'si', 'dober', 'dan', '12', '30', 'dobrodošli']);
  assert.deepEqual(wordTokens(' ... '), []);
});

const run = promisify(execFile);
const CLI = fileURLToPath(new URL('../../tools/build-content.js', import.meta.url));
const VERSION_FILE = fileURLToPath(new URL('../../app/version.js', import.meta.url));

/** Runs the CLI and resolves with its exit code and output, whatever the code. @param {string[]} args */
async function cli(...args) {
  try {
    const { stdout, stderr } = await run(process.execPath, [CLI, ...args]);
    return { code: 0, stdout, stderr };
  } catch (err) {
    const failure = /** @type {{ code: number, stdout: string, stderr: string }} */ (err);
    return { code: failure.code, stdout: failure.stdout, stderr: failure.stderr };
  }
}

/** The current app/version.js, or null when there is none. */
const versionFileState = () => readFile(VERSION_FILE, 'utf8').catch(() => null);

test('CLI --check builds into a temporary folder, prints the summary line only and leaves app/version.js alone', async () => {
  const before = await versionFileState();
  const dev = await cli('--check', '--allow-pending', fx('content-valid'));
  assert.equal(dev.code, 0, dev.stderr);
  assert.match(dev.stdout, /^units=1 lessons=1 scheduledItems=3 lemmasMet=11 version=[0-9a-f]{12} mode=dev\n$/);
  assert.match(dev.stderr, /^WARNING lessons\/u01-l01\.json items\/u01-l01-i03\/helper helper-missing: /);
  assert.equal(await versionFileState(), before);

  const strict = await cli('--check', fx('content-pending-mixed'));
  assert.equal(strict.code, 0, strict.stderr);
  assert.match(strict.stdout, /^units=1 lessons=1 scheduledItems=2 lemmasMet=11 version=[0-9a-f]{12} mode=strict\n$/);
  const lines = strict.stderr.trim().split('\n');
  assert.ok(lines.includes('STRIPPED lessons/u01-l01.json production/u01-l01-p03/item: practises item "u01-l01-i03" whose verification status is "pending"'), strict.stderr);
  assert.ok(lines.includes('STRIPPED lessons/u01-l01.json dialogue/lines/2/new_items/0: practises item "u01-l01-i03" whose verification status is "pending"'), strict.stderr);

  const allPending = await copyFixture('content-pending-mixed', (dir) => editJson(dir, 'lessons/u01-l01.json', (doc) => {
    for (const item of doc.items) item.verification.status = 'pending';
  }));
  const omitted = await cli('--check', allPending);
  assert.equal(omitted.code, 0, omitted.stderr);
  assert.match(omitted.stdout, /^units=1 lessons=0 scheduledItems=0 lemmasMet=0 version=[0-9a-f]{12} mode=strict\n$/);
  assert.ok(omitted.stderr.trim().split('\n').includes('OMITTED lessons/u01-l01.json: no item is accepted, so the strict build leaves the lesson out'), omitted.stderr);
});

test('CLI exits 1 on lint errors or a missing directory without a stack trace, and 2 on an unknown argument', async () => {
  const bad = await cli('--check', fx('content-invalid-letters'));
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /^ERROR lint found 1 error in .*content-invalid-letters.*, nothing was built:\n  lessons\/u01-l01\.json items\/u01-l01-i02\/sl alphabet: /);
  assert.ok(!bad.stderr.includes('    at '), bad.stderr);
  assert.equal(bad.stdout, '');
  const notFound = await cli('--check', join(tmpdir(), 'slovelingo-no-such-dir'));
  assert.equal(notFound.code, 1);
  assert.match(notFound.stderr, /^ERROR Content directory not found: .*slovelingo-no-such-dir\n$/);
  const unknown = await cli('--nope');
  assert.equal(unknown.code, 2);
  assert.equal(unknown.stderr, 'Unexpected argument --nope\nUsage: node tools/build-content.js [--allow-pending] [--check] [contentDir]\n');
});
