// tests/tools/build-content.test.js
// The precache list (Task 19): with an app folder given, the build writes <app>/precache.json
// naming the shell files the service worker installs, relative to the app folder: the start
// URL, index.html, the web manifest, version.js, every file under css/ and js/ (never sw.js),
// the fonts, the icons, the app icon, the audio manifest, and the content index and unit files
// it just wrote; precache.json itself is not listed. The test builds into a temporary copy of
// the real app folder so the list is checked against the real shell. With an app folder the
// version covers that shell as well as the content (fix round 1), so a deploy that changes only
// code installs a new worker; the tests at the end pin which files are in it.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, cp, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
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

/** @param {string} file */
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
/** The exact text of version.js for a version. @param {string} version */
const versionModule = (version) => `export const SLOVELINGO_VERSION = "${version}";\nglobalThis.SLOVELINGO_VERSION = SLOVELINGO_VERSION;\n`;

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

test('a shell file the list needs or the version covers but the app folder lacks fails the build by name', async () => {
  const appDir = await copyApp();
  await rm(path.join(appDir, 'assets', 'audio', 'manifest.json'));
  await assert.rejects(buildInto(appDir), (err) => err instanceof Error && err.message.includes('assets/audio/manifest.json'));
  const noWorker = await copyApp();
  await rm(path.join(noWorker, 'sw.js'));
  await assert.rejects(buildInto(noWorker), (err) => err instanceof Error && err.message.includes('sw.js'));
});

// The version with an app folder (fix round 1). A code-only deploy used to keep the content's
// version, so no new worker installed and the old shell stayed precached for offline use; now
// the shell is in the hash. What is in it: every file precache.json lists but the start URL
// (index.html again), version.js (it carries the result) and the content files (the content
// hash covers them, and index.json carries the build time), plus the worker, which the browser
// fetches under its own URL. What is not: precache.json, the build outputs, and files under app/
// that no page loads, such as the maskable icon's source drawing.

test('the version covers the shell: a rebuild keeps it, the content alone gives another, and a style, a script, the worker, the audio manifest or the page changes it in index.json, version.js and precache.json alike', async () => {
  const appDir = await copyApp();
  const first = await buildInto(appDir);
  assert.match(first.result.version, /^[0-9a-f]{12}$/);
  const again = await buildInto(appDir);
  assert.equal(again.result.version, first.result.version, 'the same files build to the same version: version.js, precache.json and the build time stay out of it');
  const dir = await mkdtemp(path.join(tmpdir(), 'slovelingo-precache-test-'));
  tempDirs.push(dir);
  const contentOnly = await buildContent({ contentDir: FIXTURE, outDir: path.join(dir, 'dist'), allowPending: true });
  assert.notEqual(first.result.version, contentOnly.version, 'the shell is in the version');

  let previous = first.result.version;
  for (const file of ['css/tokens.css', 'js/main.js', 'sw.js', 'assets/audio/manifest.json', 'index.html']) {
    await appendFile(path.join(appDir, file), '\n');
    const { result, precache } = await buildInto(appDir);
    assert.notEqual(result.version, previous, `${file} is in the version`);
    assert.match(result.version, /^[0-9a-f]{12}$/);
    assert.equal(precache.version, result.version, `precache.json carries the version after ${file} changed`);
    assert.equal((await readJson(path.join(appDir, 'content', 'dist', 'index.json'))).version, result.version, `index.json carries the version after ${file} changed`);
    assert.equal(await readFile(path.join(appDir, 'version.js'), 'utf8'), versionModule(result.version), `version.js carries the version after ${file} changed`);
    previous = result.version;
  }
});

test('a font or an icon changes the version, a file under app/ that the shell does not list leaves it alone', async () => {
  const appDir = await copyApp();
  const first = await buildInto(appDir);
  await appendFile(path.join(appDir, 'assets', 'icons', 'icon-192.png'), Buffer.from([0]));
  const icon = await buildInto(appDir);
  assert.notEqual(icon.result.version, first.result.version, 'an icon is in the version');
  await appendFile(path.join(appDir, 'assets', 'fonts', 'bricolage-latin.woff2'), Buffer.from([0]));
  const font = await buildInto(appDir);
  assert.notEqual(font.result.version, icon.result.version, 'a font is in the version');
  await appendFile(path.join(appDir, 'assets', 'icon-maskable.svg'), '\n');
  const drawing = await buildInto(appDir);
  assert.equal(drawing.result.version, font.result.version, 'the maskable source drawing is not part of the shell');
  assert.equal((await readJson(path.join(appDir, 'precache.json'))).version, drawing.result.version);
});
