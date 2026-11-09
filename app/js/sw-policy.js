// The service worker's policy: pure functions with no worker API in them, so the tests run them
// under Node and app/sw.js only applies them. policyFor sorts a request's URL against the
// registration scope. Anything on another origin or outside the scope folder is left to the
// network (`network-only`: the worker does not answer it). The fonts, the icons, the app icon
// and the recorded clips are `cache-first`, since they never change under one name. Everything
// else under the scope is `network-first`, fresh when online and from the cache offline: the
// page, the scripts, the styles, the web manifest, version.js, the content, and the audio
// manifest, read fresh so new recordings play before the learner reloads into the version that
// lists them (the one network-first file under assets/audio/). isAudio names the clips, which
// live in their own cache that no update empties; trimPlan says which clips to evict when that
// cache grows past its limit, the oldest first (Ruling 57); byteRange reads the Range header a
// media element sends, so a cached clip can answer the 206 that iOS insists on; fallsBackToCache
// says when a network-first answer gives way to the cached copy.

/** @typedef {'network-first'|'cache-first'|'network-only'} Policy */
/** @typedef {{ url: string, bytes: number, at: number }} ClipEntry a clip in the audio cache: its URL, its size and when it was stored, epoch ms */

/** Folders under the scope whose files are served cache-first. */
const CACHE_FIRST_FOLDERS = ['assets/fonts/', 'assets/icons/', 'assets/audio/'];
/** Single files under the scope served cache-first. */
const CACHE_FIRST_FILES = new Set(['assets/icon.svg']);
/** The lookup table of the clips: under a cache-first folder, yet network-first (see the header). */
const AUDIO_MANIFEST = 'assets/audio/manifest.json';
const AUDIO_FOLDER = 'assets/audio/';
const CLIP = /\.mp3$/i;

/**
 * The path of `url` relative to the scope folder, or null when the URL is on another origin or
 * outside the folder.
 * @param {URL} url
 * @param {URL} scope the registration scope, a folder URL
 * @returns {string|null}
 */
function pathInScope(url, scope) {
  if (url.origin !== scope.origin) return null;
  const folder = scope.pathname.endsWith('/') ? scope.pathname : `${scope.pathname}/`;
  return url.pathname.startsWith(folder) ? url.pathname.slice(folder.length) : null;
}

/**
 * How the worker answers a GET for `url`.
 * @param {URL} url the request's URL
 * @param {URL} scope the registration scope
 * @returns {Policy}
 */
export function policyFor(url, scope) {
  const path = pathInScope(url, scope);
  if (path === null) return 'network-only';
  if (path === AUDIO_MANIFEST) return 'network-first';
  if (CACHE_FIRST_FILES.has(path) || CACHE_FIRST_FOLDERS.some((folder) => path.startsWith(folder))) return 'cache-first';
  return 'network-first';
}

/**
 * Whether `url` is a recorded clip: an mp3 under assets/audio/ in the scope.
 * @param {URL} url
 * @param {URL} scope
 * @returns {boolean}
 */
export function isAudio(url, scope) {
  const path = pathInScope(url, scope);
  return path !== null && path.startsWith(AUDIO_FOLDER) && CLIP.test(path);
}

/**
 * The clips to evict so that the ones left fit the limit: the oldest first, as many as it takes,
 * none while everything fits. The entries are left as they are.
 * @param {ClipEntry[]} entries
 * @param {number} limit bytes the cache may hold
 * @returns {string[]} the URLs to evict, oldest first
 */
export function trimPlan(entries, limit) {
  let total = 0;
  for (const entry of entries) total += entry.bytes;
  /** @type {string[]} */
  const evict = [];
  for (const entry of [...entries].sort((a, b) => a.at - b.at)) {
    if (total <= limit) break;
    evict.push(entry.url);
    total -= entry.bytes;
  }
  return evict;
}

/**
 * Whether a network-first request takes its cached copy (when there is one) over the network's
 * answer: on a server error, a 5xx, which says nothing about the file, while a 404 or any other
 * answer is the host's real one and stands.
 * @param {number} status the network answer's status
 * @returns {boolean}
 */
export function fallsBackToCache(status) {
  return status >= 500 && status <= 599;
}

/**
 * The bytes a Range header asks for, within a body of `size` bytes: a single range of the form
 * `bytes=start-end`, `bytes=start-` or `bytes=-suffix`, with the end inclusive and clipped to the
 * body. Null when there is no header, when it is not one such range, or when it lies beyond the
 * body (the caller answers 416).
 * @param {string|null} header the request's Range header
 * @param {number} size the body's bytes
 * @returns {{ start: number, end: number }|null}
 */
export function byteRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec((header ?? '').trim());
  if (!match || size <= 0) return null;
  const [, from, to] = match;
  if (from === '' && to === '') return null;
  if (from === '') {
    const suffix = Number(to);
    return suffix === 0 ? null : { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(from);
  const end = to === '' ? size - 1 : Math.min(Number(to), size - 1);
  return start >= size || start > end ? null : { start, end };
}
