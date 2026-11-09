// tests/store/import.test.js
// The Settings screen's import path over the raw stores. A file that will not do (another app's
// export, a different schema version, text that is not JSON, items that are not an object,
// sessions that are not a list) is refused with its reason before anything is written, so every
// store holds exactly the records it held before; tests/store/state.test.js checks each reason on
// its own, this file checks every store around them. A valid file names its counts for the
// confirmation card (importSummary) and, once replaced, writes back exactly the records it was
// exported from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../../app/js/engine/scheduler.js';
import { STORE_NAMES, createMemoryStore } from '../../app/js/store/memory.js';
import {
  DEFAULT_APP_SETTINGS, addFlag, appendSession, exportState, importState, saveItemState, saveMeta, saveSettings, validateImport,
} from '../../app/js/store/state.js';
import { importSummary } from '../../app/js/ui/screens/settings.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 2, 9, 0);   // Monday 2 November 2026, 10:00 in Berlin

/** A session record started at `startedAt`. @param {string} id @param {number} startedAt */
const session = (id, startedAt) => ({
  id, startedAt, endedAt: startedAt + 10 * 60_000, minutes: 10, recalls: 8, correct: 6, newItems: 2, honey: 6, kinds: { meet: 2, typed_en_sl: 8 },
});

/** A store with something in each of the five stores: three item states (a rule's among them), two sessions, settings, a flag and meta with a weekly check. */
async function populated() {
  const adapter = createMemoryStore();
  await saveItemState(adapter, createState('u01-l01-i01', T0));
  await saveItemState(adapter, createState('u01-l01-i02', T0));
  await saveItemState(adapter, createState('r-ti-vi', T0));
  await appendSession(adapter, session('s-1', T0));
  await appendSession(adapter, session('s-2', T0 + DAY));
  await saveSettings(adapter, { ...DEFAULT_APP_SETTINGS, name: 'Ana', theme: 'dark', voice: 'male', onboarded: true });
  await addFlag(adapter, { itemId: 'u01-l01-i02', note: 'Sounds too formal', at: T0 + 60_000 });
  await saveMeta(adapter, { schemaVersion: 1, createdAt: T0 - DAY, weeklyChecks: [{ at: '2026-11-02', total: 8, correct: 6, predicted: 5 }] });
  return adapter;
}

/**
 * Every record of every store, as the adapter holds them, store keys included.
 * @param {import('../../app/js/store/memory.js').StoreAdapter} adapter
 */
async function snapshot(adapter) {
  return Object.fromEntries(await Promise.all(STORE_NAMES.map(async (store) => [store, await adapter.getAll(store)])));
}

test('a foreign or malformed file is refused with its reason and every store keeps its records', async () => {
  const adapter = await populated();
  const before = await snapshot(adapter);
  assert.ok(STORE_NAMES.every((store) => before[store].length > 0), 'every store holds something to lose');
  const valid = JSON.parse(await exportState(adapter, T0 + 2 * DAY));
  /** @param {Record<string, unknown>} changes */
  const variant = (changes) => JSON.stringify({ ...valid, ...changes });
  /** @type {[string, string, RegExp][]} what the file is, its text, the reason it gets */
  const cases = [
    ['another app\'s export', variant({ app: 'anki' }), /^The file is not a Slovelingo export\.$/],
    ['a newer schema version', variant({ schemaVersion: 2 }), /^The file has schema version 2, this app reads version 1\.$/],
    ['text that is not JSON', variant({}).slice(0, -20), /^The file is not valid JSON\.$/],
    ['items that are not an object', variant({ items: Object.values(valid.items) }), /^The file's items are not an object\.$/],
    ['sessions that are not a list', variant({ sessions: { 's-1': valid.sessions[0] } }), /^The file's sessions are not a list\.$/],
  ];
  for (const [what, json, reason] of cases) {
    const result = validateImport(json);
    assert.equal(result.ok, false, what);
    if (result.ok) continue;
    assert.match(result.reason, reason, what);
    assert.deepEqual(await snapshot(adapter), before, `${what}: the stores are untouched`);
  }
});

test('importSummary counts the item states and sessions a file holds, and the file round-trips', async () => {
  const adapter = await populated();
  const result = validateImport(await exportState(adapter, T0 + 2 * DAY));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(importSummary(result.data), { items: 3, sessions: 2 });
  assert.deepEqual(importSummary({ items: {}, sessions: [] }), { items: 0, sessions: 0 });

  // replacing a fresh store's progress with the file writes exactly the records it came from
  const fresh = createMemoryStore();
  await saveItemState(fresh, createState('u02-l01-i01', T0));
  await importState(fresh, result.data, T0 + 3 * DAY);
  assert.deepEqual(await snapshot(fresh), await snapshot(adapter));
});
