// tests/content/loader.test.js
// The bundle loader: the app fetches index.json and the unit files once each, relative to the
// module, and filters the stored item states to the ids the loaded bundle carries before any
// engine call (Ruling 23), so a state left behind by removed content never reaches the builder.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../../app/js/engine/scheduler.js';
import { knownIds, onlyKnown, loadIndex, loadUnit } from '../../app/js/content/loader.js';

const realFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = realFetch;
});

const item = (id) => ({ id });
const index = { rules: [{ id: 'r-biti-present' }, { id: 'r-ti-vi' }] };
const units = [
  { unit: { id: 'u01' }, lessons: [{ id: 'u01-l01', items: [item('u01-l01-i01'), item('u01-l01-i02')] }, { id: 'u01-l02', items: [item('u01-l02-i01')] }] },
  { unit: { id: 'u02' }, lessons: [] },
];

test('knownIds holds the item ids of every loaded lesson and the rule ids of the index', () => {
  const ids = knownIds(/** @type {any} */ (index), /** @type {any} */ (units));
  assert.ok(ids instanceof Set);
  assert.deepEqual([...ids].sort(), ['r-biti-present', 'r-ti-vi', 'u01-l01-i01', 'u01-l01-i02', 'u01-l02-i01']);
});

test('onlyKnown keeps the states whose id is known and leaves its input as it is', () => {
  const states = {
    'u01-l01-i01': createState('u01-l01-i01', 0),
    'r-ti-vi': createState('r-ti-vi', 0),
    'u09-l04-i07': createState('u09-l04-i07', 0),   // content removed since it was practised
    'r-gone': createState('r-gone', 0),
  };
  const kept = onlyKnown(states, knownIds(/** @type {any} */ (index), /** @type {any} */ (units)));
  assert.deepEqual(Object.keys(kept).sort(), ['r-ti-vi', 'u01-l01-i01']);
  assert.equal(kept['u01-l01-i01'], states['u01-l01-i01'], 'the states themselves are not copied');
  assert.equal(Object.keys(states).length, 4, 'the input keeps every state');
});

test('loadIndex and loadUnit fetch content/dist relative to the module, once each, and retry after a failure', async () => {
  /** @type {string[]} */
  const calls = [];
  let fail = true;
  globalThis.fetch = /** @type {any} */ (async (url) => {
    calls.push(String(url));
    if (fail) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ url: String(url) }) };
  });

  await assert.rejects(loadIndex(), /404/);
  fail = false;
  const first = await loadIndex();
  const second = await loadIndex();
  assert.equal(first, second, 'memoised: the same object');
  assert.equal(calls.length, 2, 'the failed fetch is not kept, the good one is');
  assert.match(calls[1], /\/app\/content\/dist\/index\.json$/);

  const unit = await loadUnit('u01');
  await loadUnit('u01');
  await loadUnit('u02');
  assert.equal(calls.length, 4, 'one fetch per unit');
  assert.match(calls[2], /\/app\/content\/dist\/units\/u01\.json$/);
  assert.match(calls[3], /\/app\/content\/dist\/units\/u02\.json$/);
  assert.equal(/** @type {any} */ (unit).url, calls[2]);
});
