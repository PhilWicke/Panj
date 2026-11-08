import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../../tools/serve.js';

test('serves app files with correct content types', async (t) => {
  const srv = await startServer({ root: fileURLToPath(new URL('../../app/', import.meta.url)), port: 0 });
  t.after(() => srv.close());
  const res = await fetch(`http://localhost:${srv.port}/manifest.webmanifest`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/manifest+json');
  const js = await fetch(`http://localhost:${srv.port}/js/main.js`);
  assert.equal(js.headers.get('content-type'), 'text/javascript; charset=utf-8');
});

/** @type {string} */
let tmp;
/** @type {{ port: number, close(): Promise<void> }} */
let srv;
/** @param {string} p */
const get = (p) => fetch(`http://localhost:${srv.port}${p}`);

before(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'slovelingo-serve-'));
  const root = path.join(tmp, 'root');
  const files = {
    'index.html': '<!doctype html><title>home</title>',
    'sub/index.html': '<!doctype html><title>sub</title>',
    'content/dist/units/u01.json': '{"unit":"u01"}',
    'assets/audio/x.mp3': 'mp3',
    'assets/fonts/f.woff2': 'woff2',
    'assets/icon.svg': '<svg/>',
    'assets/icons/i.png': 'png',
    'css/base.css': 'body{}',
    'data.bin': 'bin',
  };
  for (const [name, body] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), body);
  }
  await writeFile(path.join(tmp, 'secret.txt'), 'outside the root');
  await mkdir(path.join(tmp, 'root-sibling'));
  await writeFile(path.join(tmp, 'root-sibling', 'secret.txt'), 'outside the root');
  srv = await startServer({ root, port: 0 });
});

after(async () => {
  await srv?.close();
  await rm(tmp, { recursive: true, force: true });
});

test('serves nested paths with the MIME map and no-store caching', async () => {
  const expected = {
    '/content/dist/units/u01.json': 'application/json; charset=utf-8',
    '/assets/audio/x.mp3': 'audio/mpeg',
    '/assets/fonts/f.woff2': 'font/woff2',
    '/assets/icon.svg': 'image/svg+xml',
    '/assets/icons/i.png': 'image/png',
    '/css/base.css': 'text/css; charset=utf-8',
    '/index.html': 'text/html; charset=utf-8',
    '/data.bin': 'application/octet-stream',
  };
  for (const [url, type] of Object.entries(expected)) {
    const res = await get(url);
    assert.equal(res.status, 200, url);
    assert.equal(res.headers.get('content-type'), type, url);
    assert.equal(res.headers.get('cache-control'), 'no-store', url);
    await res.arrayBuffer();
  }
  assert.equal(await (await get('/content/dist/units/u01.json')).text(), '{"unit":"u01"}');
});

test('serves index.html for directory requests', async () => {
  const home = await get('/');
  assert.equal(home.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(await home.text(), '<!doctype html><title>home</title>');
  const sub = await get('/sub/');
  assert.equal(await sub.text(), '<!doctype html><title>sub</title>');
});

test('rejects path traversal with 403', async () => {
  for (const url of ['/..%2fsecret.txt', '/..%2froot-sibling%2fsecret.txt']) {
    const res = await get(url);
    assert.equal(res.status, 403, url);
    assert.equal(res.headers.get('cache-control'), 'no-store', url);
    assert.doesNotMatch(await res.text(), /outside the root/);
  }
});

test('answers 404 for missing files and empty directories', async () => {
  const missing = await get('/nope.js');
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get('cache-control'), 'no-store');
  await missing.arrayBuffer();
  const noIndex = await get('/assets/');
  assert.equal(noIndex.status, 404);
  await noIndex.arrayBuffer();
});
