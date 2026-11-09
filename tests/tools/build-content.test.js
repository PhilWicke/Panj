// tests/tools/build-content.test.js
// The precache list (Task 19): with an app folder given, the build writes <app>/precache.json
// naming the shell files the service worker installs, relative to the app folder: the start
// URL, index.html, the web manifest, version.js, every file under css/ and js/ (never sw.js),
// the fonts, the icons, the app icon, the audio manifest, and the content index and unit files
// it just wrote; precache.json itself is not listed. The test builds into a temporary copy of
// the real app folder so the list is checked against the real shell.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildContent } from '../../tools/build-content.js';

const APP = fileURLToPath(new URL('../../app/', import.meta.url));
const FIXTURE = fileURLToPath(new URL('../../tools/fixtures/content-valid/', import.meta.url));
/** Entries of the real app folder that are build outputs, left out of the copy (app/js/content/ is source and stays). */
const NOT_COPIED = new Set(['content', 'version.js', 'precache.json']);

/** @type {string[]} */
const tempDirs = [];
after(() => Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true }))));

/** A temporary copy of app/ without its build outputs. */
async function copyApp() {
  const dir = await mkdtemp(path.join(tmpdir(), 'slovelingo-precache-test-'));
  tempDirs.push(dir);
  const appDir = path.join(dir, 'app');
  await cp(APP, appDir, {
    recursive: true,
    filter: (src) => !NOT_COPIED.has(path.relative(APP, src)) && path.basename(src) !== '.DS_Store',
  });
  return appDir;
}

/**
 * Every file under `dir`, recursively, as sorted paths relative to `dir` with forward slashes.
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function filesUnder(dir) {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
    .sort();
}

/** The build into a copy of the app, with the precache list it wrote. @param {string} appDir */
async function buildInto(appDir) {
  const result = await buildContent({
    contentDir: FIXTURE,
    outDir: path.join(appDir, 'content', 'dist'),
    allowPending: true,
    versionFile: path.join(appDir, 'version.js'),
    appDir,
  });
  const precache = JSON.parse(await readFile(path.join(appDir, 'precache.json'), 'utf8'));
  return { result, precache };
}

test('precache.json lists every file under app/js and app/css, never sw.js, and carries the build version', async () => {
  const appDir = await copyApp();
  const { result, precache } = await buildInto(appDir);
  assert.deepEqual(Object.keys(precache), ['version', 'files']);
  assert.equal(precache.version, result.version);
  assert.equal(precache.version, (await import(pathToFileURL(path.join(appDir, 'version.js')).href)).SLOVELINGO_VERSION, 'the same version as version.js');
  delete globalThis.SLOVELINGO_VERSION;
  /** @type {string[]} */
  const files = precache.files;
  assert.ok(Array.isArray(files) && files.length > 0);
  assert.equal(new Set(files).size, files.length, 'no file twice');

  for (const file of await filesUnder(path.join(APP, 'js'))) assert.ok(files.includes(`js/${file}`), `js/${file}`);
  for (const file of await filesUnder(path.join(APP, 'css'))) assert.ok(files.includes(`css/${file}`), `css/${file}`);
  assert.ok(!files.some((file) => file === 'sw.js' || file.endsWith('/sw.js')), 'the worker is not precached');
  assert.ok(!files.includes('precache.json'), 'the list does not list itself');
  assert.ok(files.includes('js/sw-policy.js'), 'the policy module the worker imports');
  assert.ok(files.includes('js/util/audio-texts.js'));
});

test('precache.json names the start URL, the shell files, the assets and the content files the build wrote, each present on disk', async () => {
  const appDir = await copyApp();
  const { precache } = await buildInto(appDir);
  /** @type {string[]} */
  const files = precache.files;
  assert.deepEqual(files.slice(0, 4), ['./', 'index.html', 'manifest.webmanifest', 'version.js']);
  for (const file of ['assets/fonts/bricolage-latin.woff2', 'assets/fonts/bricolage-latin-ext.woff2', 'assets/icons/icon-192.png',
    'assets/icons/icon-512.png', 'assets/icons/maskable-512.png', 'assets/icon.svg', 'assets/audio/manifest.json',
    'content/dist/index.json', 'content/dist/units/u01.json']) {
    assert.ok(files.includes(file), file);
  }
  assert.ok(!files.includes('assets/icon-maskable.svg'), 'the maskable source drawing is not part of the shell');
  assert.ok(!files.some((file) => file.startsWith('content/dist/units/') && file !== 'content/dist/units/u01.json'), 'only the units built');
  for (const file of files) {
    const target = path.join(appDir, file === './' ? 'index.html' : file);
    assert.ok((await stat(target)).isFile(), `${file} is on disk`);
  }
  for (const file of files) assert.ok(!file.startsWith('/') && !file.includes('..'), `${file} is relative to the app folder`);
});

test('precache.json follows the content: a second build with other content changes the version and the unit files', async () => {
  const appDir = await copyApp();
  const first = await buildInto(appDir);
  const other = await buildContent({
    contentDir: fileURLToPath(new URL('../../tools/fixtures/content-pending-mixed/', import.meta.url)),
    outDir: path.join(appDir, 'content', 'dist'),
    allowPending: true,
    versionFile: path.join(appDir, 'version.js'),
    appDir,
  });
  const second = JSON.parse(await readFile(path.join(appDir, 'precache.json'), 'utf8'));
  assert.notEqual(second.version, first.precache.version);
  assert.equal(second.version, other.version);
  assert.deepEqual(second.files.filter((/** @type {string} */ f) => !f.startsWith('content/')), first.precache.files.filter((/** @type {string} */ f) => !f.startsWith('content/')), 'the shell list is the same');
});

test('without an app folder the build writes no precache list', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slovelingo-precache-test-'));
  tempDirs.push(dir);
  await buildContent({ contentDir: FIXTURE, outDir: path.join(dir, 'dist'), allowPending: true });
  await assert.rejects(stat(path.join(dir, 'precache.json')), { code: 'ENOENT' });
  await assert.rejects(stat(path.join(dir, 'dist', 'precache.json')), { code: 'ENOENT' });
});

test('a shell file the list needs but the app folder lacks fails the build by name', async () => {
  const appDir = await copyApp();
  await rm(path.join(appDir, 'assets', 'audio', 'manifest.json'));
  await assert.rejects(buildInto(appDir), (err) => err instanceof Error && err.message.includes('assets/audio/manifest.json'));
});
