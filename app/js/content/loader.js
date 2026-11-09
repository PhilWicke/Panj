// The bundle loader. tools/build-content.js writes app/content/dist/index.json and one file per
// unit; the app fetches them relative to this module, so the site works under any base path
// (GitHub Pages serves it from a subfolder), and keeps each one once fetched. A failed fetch is not
// kept, so the next call tries again. knownIds and onlyKnown keep stored item states to the ids
// the loaded bundle carries before any engine call (Ruling 23): a state whose content has left the
// bundle never reaches the session builder or the counters.

/** @typedef {import('./types.js').Index} Index */
/** @typedef {import('./types.js').UnitContent} UnitContent */

const DIST = new URL('../../content/dist/', import.meta.url);

/** @type {Promise<Index>|null} */
let indexRequest = null;
/** @type {Map<string, Promise<UnitContent>>} */
const unitRequests = new Map();

/**
 * @param {URL} url
 * @returns {Promise<any>}
 */
async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url.pathname} (${response.status})`);
  return response.json();
}

/**
 * The bundle's index, fetched once.
 * @returns {Promise<Index>}
 */
export function loadIndex() {
  if (!indexRequest) {
    const request = fetchJson(new URL('index.json', DIST));
    indexRequest = request;
    request.catch(() => {
      if (indexRequest === request) indexRequest = null;
    });
  }
  return indexRequest;
}

/**
 * One unit file, `units/<unitId>.json`, fetched once per unit.
 * @param {string} unitId `uNN`
 * @returns {Promise<UnitContent>}
 */
export function loadUnit(unitId) {
  let request = unitRequests.get(unitId);
  if (!request) {
    const fresh = fetchJson(new URL(`units/${encodeURIComponent(unitId)}.json`, DIST));
    request = fresh;
    unitRequests.set(unitId, fresh);
    fresh.catch(() => {
      if (unitRequests.get(unitId) === fresh) unitRequests.delete(unitId);
    });
  }
  return request;
}

/**
 * The ids the loaded bundle carries: every item of the loaded units' lessons and every rule of the
 * index (a rule's quick check is scheduled under the rule id).
 * @param {Index} index
 * @param {UnitContent[]} units
 * @returns {Set<string>}
 */
export function knownIds(index, units) {
  /** @type {Set<string>} */
  const ids = new Set();
  for (const unit of units) {
    for (const lesson of unit.lessons) for (const item of lesson.items) ids.add(item.id);
  }
  for (const rule of index.rules) ids.add(rule.id);
  return ids;
}

/**
 * The states whose id is known, as a new object over the same state objects.
 * @template T
 * @param {Record<string, T>} states by id
 * @param {Set<string>} ids
 * @returns {Record<string, T>}
 */
export function onlyKnown(states, ids) {
  /** @type {Record<string, T>} */
  const kept = {};
  for (const [id, state] of Object.entries(states)) if (ids.has(id)) kept[id] = state;
  return kept;
}
