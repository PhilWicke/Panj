// The service worker (Task 19). The app shell and the content live in one cache named after the
// version (`slovelingo-<version>`, the version app/version.js exports: the content and the shell,
// so a code-only deploy is a new version too), the recorded clips in `slovelingo-audio`, which no
// update empties. install precaches the files app/precache.json
// lists (tools/build-content.js writes it with the version) and never skips waiting: the new
// version waits until the learner taps Reload (Ruling 58). activate drops every other
// slovelingo-* cache but the audio, claims the pages and tells them `{ type: 'updated' }`. fetch
// follows js/sw-policy.js: network-first for the shell and the content with the cache behind it
// (also when the host answers 5xx; a navigation falls back to index.html), cache-first for fonts,
// icons and clips; a clip fetched is kept in the audio cache under a 60 MB limit through a ledger
// entry, the oldest going first (Ruling 57), and a media element's Range request is answered with
// the 206 it asked for. Messages: `skip-waiting` from the Reload tap, and `cache-unit-audio` from
// the unit page's "Keep offline", which fetches the clips of a unit's texts
// (js/util/audio-texts.js) that the audio manifest lists, three at a time, and answers
// `unit-audio-cached` with the count, and with the reason when a clip could not be fetched, after
// which it stores nothing more. A module worker, registered by js/sw-client.js with updateViaCache
// none under a URL that carries the version (`sw.js?v=...`), so every version installs as a fresh
// worker.

import { SLOVELINGO_VERSION } from './version.js';
import { byteRange, fallsBackToCache, isAudio, policyFor, trimPlan } from './js/sw-policy.js';
import { audioTexts } from './js/util/audio-texts.js';
import { audioId } from './js/util/audio-id.js';

/** @typedef {import('./js/sw-policy.js').ClipEntry} ClipEntry */

const sw = /** @type {ServiceWorkerGlobalScope & typeof globalThis} */ (/** @type {unknown} */ (self));
const VERSION = String(SLOVELINGO_VERSION);
const CACHE_PREFIX = 'slovelingo-';
const CACHE = CACHE_PREFIX + VERSION;
const AUDIO_CACHE = 'slovelingo-audio';
const AUDIO_LIMIT = 60 * 1024 * 1024;
const SCOPE = new URL(sw.registration.scope);
/** The audio cache's ledger: a JSON list of ClipEntry under a URL no file has. */
const LEDGER = new URL('__audio-ledger__', SCOPE);
/** Clips fetched at once by cache-unit-audio. */
const UNIT_AUDIO_CONCURRENCY = 3;

/** The absolute URL of a path relative to the scope. @param {string} path */
const inScope = (path) => new URL(path, SCOPE).href;
/** Whether a response is worth keeping: a complete same-origin 200. @param {Response} response */
const keepable = (response) => response.status === 200 && response.type === 'basic';

// Install and activate

sw.addEventListener('install', (event) => {
  event.waitUntil(precache());
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(activate());
});

/**
 * Fills this version's cache with the shell precache.json lists, fetched past the HTTP cache. A
 * list from another version means a deploy still propagating; the install fails and the browser
 * tries again on a later visit.
 */
async function precache() {
  const response = await fetch(inScope('precache.json'), { cache: 'no-store' });
  if (!response.ok) throw new Error(`precache.json answered ${response.status}`);
  /** @type {{ version: string, files: string[] }} */
  const list = await response.json();
  if (list.version !== VERSION) throw new Error(`precache.json is for version ${list.version}, this worker is ${VERSION}`);
  const cache = await caches.open(CACHE);
  await cache.addAll(list.files.map((file) => new Request(inScope(file), { cache: 'reload' })));
}

/** Drops the caches of other versions, takes the open pages and tells them a version activated. */
async function activate() {
  const names = await caches.keys();
  await Promise.all(names
    .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE && name !== AUDIO_CACHE)
    .map((name) => caches.delete(name)));
  await sw.clients.claim();
  const clients = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) client.postMessage({ type: 'updated', version: VERSION });
}

// Fetch

sw.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  // A DevTools quirk: this combination makes fetch(request) throw, and the browser handles it itself.
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;
  const url = new URL(request.url);
  const policy = policyFor(url, SCOPE);
  if (policy === 'network-only') return;
  if (policy === 'cache-first') event.respondWith(isAudio(url, SCOPE) ? clipFirst(event, url) : cacheFirst(event, request));
  else event.respondWith(networkFirst(event, request));
});

/**
 * The network, with the cache behind it: a fresh response replaces the cached copy; when the
 * network fails, or the host answers with a server error (fallsBackToCache), the cached copy
 * answers, and a navigation gets index.html when its own URL is not cached. A server error with
 * nothing cached goes through as it is.
 * @param {FetchEvent} event
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function networkFirst(event, request) {
  const cache = await caches.open(CACHE);
  /** @returns {Promise<Response|undefined>} */
  const cachedCopy = async () => (await cache.match(request)) ?? (request.mode === 'navigate' ? await cache.match(inScope('index.html')) : undefined);
  let response;
  try {
    response = await fetch(request);
  } catch (error) {
    const cached = await cachedCopy();
    if (cached) return cached;
    throw error;
  }
  if (fallsBackToCache(response.status)) return (await cachedCopy()) ?? response;
  if (keepable(response)) event.waitUntil(cache.put(request, response.clone()));
  return response;
}

/**
 * The cache, with the network behind it, for files that never change under one name: a miss is
 * fetched and kept in this version's cache.
 * @param {FetchEvent} event
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function cacheFirst(event, request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (keepable(response)) event.waitUntil(cache.put(request, response.clone()));
  return response;
}

/**
 * A clip: the audio cache, with the network behind it. The whole clip is fetched and kept with
 * its ledger entry even when the element asked for a range, and the answer carries the range it
 * asked for: a media element on iOS plays only from a 206.
 * @param {FetchEvent} event
 * @param {URL} url
 * @returns {Promise<Response>}
 */
async function clipFirst(event, url) {
  const cache = await caches.open(AUDIO_CACHE);
  let full = await cache.match(url.href);
  if (!full) {
    full = await fetch(url.href);
    if (!keepable(full)) return full;
    event.waitUntil(storeClip(cache, url.href, full.clone()));
  }
  return withRange(full, event.request.headers.get('range'));
}

/**
 * `full` as the answer to a request: as it is without a Range header, else the slice asked for as
 * a 206, or a 416 for a range the body does not have.
 * @param {Response} full a complete 200 response
 * @param {string|null} range the request's Range header
 * @returns {Promise<Response>}
 */
async function withRange(full, range) {
  if (range === null) return full;
  const body = await full.arrayBuffer();
  const part = byteRange(range, body.byteLength);
  if (!part) {
    return new Response(null, { status: 416, statusText: 'Range Not Satisfiable', headers: { 'Content-Range': `bytes */${body.byteLength}` } });
  }
  const headers = new Headers(full.headers);
  headers.set('Content-Range', `bytes ${part.start}-${part.end}/${body.byteLength}`);
  headers.set('Content-Length', String(part.end - part.start + 1));
  headers.set('Accept-Ranges', 'bytes');
  return new Response(body.slice(part.start, part.end + 1), { status: 206, statusText: 'Partial Content', headers });
}

// The audio cache and its ledger

/** Ledger changes run one after another, so clips stored at the same time never lose an entry. @type {Promise<void>} */
let ledgerTurn = Promise.resolve();

/**
 * Keeps a clip in the audio cache with its ledger entry, then evicts the oldest clips while the
 * cache is over its limit.
 * @param {Cache} cache the audio cache
 * @param {string} href the clip's URL
 * @param {Response} response a complete 200 response, consumed here
 * @returns {Promise<void>}
 */
function storeClip(cache, href, response) {
  const stored = ledgerTurn.then(async () => {
    const body = await response.arrayBuffer();
    await cache.put(href, new Response(body, { status: 200, headers: response.headers }));
    const entries = (await readLedger(cache)).filter((entry) => entry.url !== href);
    entries.push({ url: href, bytes: body.byteLength, at: Date.now() });
    const evicted = new Set(trimPlan(entries, AUDIO_LIMIT));
    await Promise.all([...evicted].map((url) => cache.delete(url)));
    await writeLedger(cache, entries.filter((entry) => !evicted.has(entry.url)));
  });
  ledgerTurn = stored.catch(() => {});
  return stored;
}

/** @param {Cache} cache @returns {Promise<ClipEntry[]>} */
async function readLedger(cache) {
  const response = await cache.match(LEDGER.href);
  if (!response) return [];
  try {
    const entries = await response.json();
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

/** @param {Cache} cache @param {ClipEntry[]} entries */
function writeLedger(cache, entries) {
  return cache.put(LEDGER.href, new Response(JSON.stringify(entries), { headers: { 'Content-Type': 'application/json' } }));
}

// Messages from the pages

sw.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;
  if (data.type === 'skip-waiting') {
    event.waitUntil(sw.skipWaiting());
  } else if (data.type === 'cache-unit-audio' && event.source instanceof Client) {
    event.waitUntil(cacheUnitAudio(event.source, String(data.unitId), String(data.voice)));
  }
});

/**
 * Fetches the clips of a unit that the manifest lists and the cache lacks, UNIT_AUDIO_CONCURRENCY
 * at a time, and tells `client` how many of the unit's clips the phone now holds. A failure
 * answers at once with what was kept and `error`, the reason; the fetches still running then
 * store nothing more, so the count the page shows stays true.
 * @param {Client} client the page that asked
 * @param {string} unitId `uNN`
 * @param {string} voice the recordings' voice, as the manifest names it
 */
async function cacheUnitAudio(client, unitId, voice) {
  let count = 0;
  let total = 0;
  let replied = false;
  /** @param {{ error?: string }} [fields] */
  const reply = (fields = {}) => {
    replied = true;
    client.postMessage({ type: 'unit-audio-cached', unitId, count, total, ...fields });
  };
  try {
    const [unit, manifest] = await Promise.all([
      fetchJson(inScope(`content/dist/units/${encodeURIComponent(unitId)}.json`)),
      fetchJson(inScope('assets/audio/manifest.json')),
    ]);
    const ids = await Promise.all(audioTexts(unit).map((text) => audioId(text, voice)));
    const hrefs = ids.filter((id) => Object.hasOwn(manifest, id)).map((id) => inScope(`assets/audio/${id}.mp3`));
    total = hrefs.length;
    const cache = await caches.open(AUDIO_CACHE);
    /** @type {string[]} */
    const missing = [];
    for (const href of hrefs) {
      if (await cache.match(href)) count += 1;
      else missing.push(href);
    }
    let next = 0;
    const fetchClips = async () => {
      while (!replied && next < missing.length) {
        const href = missing[next];
        next += 1;
        const response = await fetch(href);
        if (replied) return;
        if (!keepable(response)) throw new Error(`${href} answered ${response.status}`);
        await storeClip(cache, href, response);
        count += 1;
      }
    };
    await Promise.all(Array.from({ length: Math.min(UNIT_AUDIO_CONCURRENCY, missing.length) }, fetchClips));
    reply();
  } catch (error) {
    if (!replied) reply({ error: error instanceof Error ? error.message : String(error) });
  }
}

/** @param {string} href @returns {Promise<any>} */
async function fetchJson(href) {
  const response = await fetch(href);
  if (!response.ok) throw new Error(`${href} answered ${response.status}`);
  return response.json();
}
