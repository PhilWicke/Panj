// tests/engine/sw-policy.test.js
// The service worker's pure policy (Task 19): policyFor sorts a request by its URL against the
// registration scope, with a GitHub Pages style scope and a localhost one; isAudio names the
// clips; trimPlan evicts the oldest clips until the audio cache fits its limit (Ruling 57);
// byteRange reads the Range header a media element sends, so a cached clip can answer with 206.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byteRange, isAudio, policyFor, trimPlan } from '../../app/js/sw-policy.js';

const PAGES = new URL('https://example.github.io/Slovelingo/');
const LOCAL = new URL('http://localhost:4173/');

/** @param {URL} scope @param {string} path */
const under = (scope, path) => new URL(path, scope);

for (const [name, scope] of /** @type {const} */ ([['GitHub Pages', PAGES], ['localhost', LOCAL]])) {
  test(`policyFor (${name}): the shell, the content and the audio manifest are network-first`, () => {
    for (const path of ['./', 'index.html', 'manifest.webmanifest', 'version.js', 'js/main.js', 'js/ui/screens/today.js', 'css/tokens.css',
      'content/dist/index.json', 'content/dist/units/u01.json', 'assets/icon-maskable.svg', 'assets/audio/manifest.json', 'precache.json']) {
      assert.equal(policyFor(under(scope, path), scope), 'network-first', path);
    }
    assert.equal(policyFor(under(scope, 'index.html?v=2'), scope), 'network-first', 'a query string changes nothing');
    assert.equal(policyFor(under(scope, './#/today'), scope), 'network-first', 'a hash changes nothing');
  });

  test(`policyFor (${name}): fonts, icons, the clips and the app icon are cache-first`, () => {
    for (const path of ['assets/fonts/bricolage-latin.woff2', 'assets/fonts/bricolage-latin-ext.woff2', 'assets/icons/icon-192.png',
      'assets/icons/maskable-512.png', 'assets/audio/0123456789abcdef.mp3', 'assets/icon.svg']) {
      assert.equal(policyFor(under(scope, path), scope), 'cache-first', path);
    }
  });

  test(`policyFor (${name}): another origin is network-only, whatever the path`, () => {
    assert.equal(policyFor(new URL('https://fonts.googleapis.com/css2?family=Bricolage'), scope), 'network-only');
    assert.equal(policyFor(new URL('https://generativelanguage.googleapis.com/v1beta/models'), scope), 'network-only');
    assert.equal(policyFor(new URL(`https://cdn.example.com${scope.pathname}js/main.js`), scope), 'network-only', 'the scope path on another host');
    assert.equal(policyFor(new URL(`https://cdn.example.com${scope.pathname}assets/audio/x.mp3`), scope), 'network-only');
  });
}

test('policyFor: the scope path matters, so the same path on another origin or outside the scope folder is network-only', () => {
  assert.equal(policyFor(new URL('http://127.0.0.1:4173/js/main.js'), LOCAL), 'network-only', '127.0.0.1 is another origin than localhost');
  assert.equal(policyFor(new URL('http://localhost:4174/js/main.js'), LOCAL), 'network-only', 'another port is another origin');
  assert.equal(policyFor(new URL('https://example.github.io/js/main.js'), PAGES), 'network-only', 'above the Pages scope folder');
  assert.equal(policyFor(new URL('https://example.github.io/elsewhere/js/main.js'), PAGES), 'network-only', 'beside the Pages scope folder');
  assert.equal(policyFor(new URL('https://example.github.io/elsewhere/assets/audio/x.mp3'), PAGES), 'network-only');
  assert.equal(policyFor(new URL('https://example.github.io/Slovelingo'), PAGES), 'network-only', 'the folder without its slash is outside the scope');
  assert.equal(policyFor(new URL('https://example.github.io/Slovelingo-old/index.html'), PAGES), 'network-only', 'a sibling folder with the same prefix');
  assert.equal(policyFor(new URL('http://example.github.io/Slovelingo/index.html'), PAGES), 'network-only', 'http against an https scope');
});

test('isAudio: an mp3 under assets/audio/ in the scope, nothing else', () => {
  for (const scope of [PAGES, LOCAL]) {
    assert.equal(isAudio(under(scope, 'assets/audio/0123456789abcdef.mp3'), scope), true);
    assert.equal(isAudio(under(scope, 'assets/audio/manifest.json'), scope), false, 'the manifest is not a clip');
    assert.equal(isAudio(under(scope, 'assets/fonts/x.mp3'), scope), false, 'another folder');
    assert.equal(isAudio(under(scope, 'assets/audio/x.MP3'), scope), true, 'the extension in any case');
    assert.equal(isAudio(under(scope, 'assets/audio/'), scope), false);
  }
  assert.equal(isAudio(new URL('https://cdn.example.com/Slovelingo/assets/audio/x.mp3'), PAGES), false, 'another origin');
  assert.equal(isAudio(new URL('https://example.github.io/elsewhere/assets/audio/x.mp3'), PAGES), false, 'outside the scope');
});

/** @param {string} url @param {number} bytes @param {number} at */
const entry = (url, bytes, at) => ({ url, bytes, at });

test('trimPlan evicts nothing while the clips fit, the oldest first once they do not, until the rest fit', () => {
  const entries = [entry('c', 30, 3), entry('a', 50, 1), entry('b', 40, 2), entry('d', 20, 4)];
  assert.deepEqual(trimPlan(entries, 140), [], 'exactly at the limit');
  assert.deepEqual(trimPlan(entries, 1000), []);
  assert.deepEqual(trimPlan(entries, 139), ['a'], 'one byte over: the oldest goes');
  assert.deepEqual(trimPlan(entries, 90), ['a'], '90 left after a');
  assert.deepEqual(trimPlan(entries, 89), ['a', 'b']);
  assert.deepEqual(trimPlan(entries, 50), ['a', 'b'], '50 left after a and b');
  assert.deepEqual(trimPlan(entries, 20), ['a', 'b', 'c']);
  assert.deepEqual(trimPlan(entries, 0), ['a', 'b', 'c', 'd'], 'no room: everything goes');
  assert.deepEqual(entries.map((e) => e.url), ['c', 'a', 'b', 'd'], 'the input is left as it was');
  assert.deepEqual(trimPlan([], 10), []);
});

test('trimPlan keeps the input order between clips stored at the same time', () => {
  const entries = [entry('x', 10, 5), entry('y', 10, 5), entry('z', 10, 6)];
  assert.deepEqual(trimPlan(entries, 25), ['x']);
  assert.deepEqual(trimPlan(entries, 15), ['x', 'y']);
});

test('byteRange reads a single range against the body size, with the end inclusive and clipped', () => {
  assert.deepEqual(byteRange('bytes=0-', 1000), { start: 0, end: 999 });
  assert.deepEqual(byteRange('bytes=100-199', 1000), { start: 100, end: 199 });
  assert.deepEqual(byteRange('bytes=900-5000', 1000), { start: 900, end: 999 }, 'the end is clipped to the body');
  assert.deepEqual(byteRange('bytes=-200', 1000), { start: 800, end: 999 }, 'a suffix range');
  assert.deepEqual(byteRange('bytes=-5000', 1000), { start: 0, end: 999 }, 'a suffix longer than the body is the whole body');
  assert.deepEqual(byteRange('bytes=0-0', 1000), { start: 0, end: 0 });
  assert.deepEqual(byteRange(' bytes=0-1 ', 1000), { start: 0, end: 1 }, 'surrounding spaces');
});

test('byteRange is null without a header, for a malformed one, and for a range beyond the body', () => {
  assert.equal(byteRange(null, 1000), null);
  assert.equal(byteRange('', 1000), null);
  assert.equal(byteRange('bytes=', 1000), null);
  assert.equal(byteRange('bytes=-', 1000), null);
  assert.equal(byteRange('items=0-1', 1000), null);
  assert.equal(byteRange('bytes=0-1,5-6', 1000), null, 'several ranges are not read');
  assert.equal(byteRange('bytes=1000-', 1000), null, 'starts past the end');
  assert.equal(byteRange('bytes=200-100', 1000), null, 'ends before it starts');
  assert.equal(byteRange('bytes=-0', 1000), null, 'an empty suffix');
  assert.equal(byteRange('bytes=0-', 0), null, 'an empty body has no range');
});
