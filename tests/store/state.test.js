// tests/store/state.test.js
// The store behind the app: the memory adapter, the IndexedDB adapter's open path (Node has no
// IndexedDB, so a fake factory stands in for the upgrade and the failure paths; the real one runs
// in the end-to-end test), and the app state over an adapter: load, save, export, validate, import.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, createState, recordRecall } from '../../app/js/engine/scheduler.js';
import { STORE_NAMES, createMemoryStore } from '../../app/js/store/memory.js';
import { DB_NAME, DB_VERSION, openIndexedDb, openStore } from '../../app/js/store/db.js';
import {
  APP_ID, SCHEMA_VERSION, DEFAULT_APP_SETTINGS,
  loadState, saveItemState, appendSession, saveSettings, addFlag, exportState, validateImport, importState,
} from '../../app/js/store/state.js';

const TZ = 'Europe/Berlin';
const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5, 9, 0);   // Monday 5 January 2026, 10:00 in Berlin
const T1 = T0 + 3 * DAY;
const S = DEFAULT_SETTINGS;

// The controller's default settings, spelled out so the test does not trust the module's own constant.
const DEFAULTS = {
  desiredRetention: 0.9, newPerDay: 7, dailyMinutes: 10,
  name: '', intention: '', mute: false, speech: false, theme: 'system', voice: 'female', onboarded: false,
};

const recall = (state, result, now) => recordRecall(state, result, now, S, TZ);

/** Three correct recalls: the item graduates and carries an FSRS card, so nested numbers and nulls round-trip. */
function graduated(id, now = T0) {
  let s = createState(id, now);
  s = recall(s, 'correct', now);
  s = recall(s, 'correct', s.due);
  return recall(s, 'correct', s.due);
}

/** A session record of `minutes` minutes started at `startedAt`. */
const session = (id, startedAt, minutes = 10) => ({
  id, startedAt, endedAt: startedAt + minutes * MINUTE, minutes, recalls: 20, correct: 18, newItems: 3, honey: 18, kinds: { typed_en_sl: 20 },
});
const flag = (itemId, note, at) => ({ itemId, note, at });

/** A store holding one of everything, with the state it should load as. The first load stamps meta at T0. */
async function populated() {
  const adapter = createMemoryStore();
  await loadState(adapter, T0);
  const items = {
    'u01-l01-i01': graduated('u01-l01-i01'),
    'u01-l01-i02': recall(createState('u01-l01-i02', T0), 'wrong', T0),
    'r-biti-present': createState('r-biti-present', T0),
  };
  for (const state of Object.values(items)) await saveItemState(adapter, state);
  // ids whose key order ('s-a' before 's-b') and insertion order (late first) both differ from the order of startedAt
  const late = session('s-a', T0 + 2 * DAY, 7);
  const early = session('s-b', T0);
  await appendSession(adapter, late);
  await appendSession(adapter, early);
  const settings = { ...DEFAULTS, name: 'Ana', intention: 'on the train after the first stop', newPerDay: 12, theme: 'dark', voice: 'male', mute: true, onboarded: true };
  await saveSettings(adapter, settings);
  const flags = [flag('u01-l01-i01', 'Audio sounds off', T0 + 20 * MINUTE), flag('u01-l01-i02', 'Is this register right?', T0 + HOUR)];
  await addFlag(adapter, flags[1]);
  await addFlag(adapter, flags[0]);
  return { adapter, state: { items, sessions: [early, late], settings, flags, meta: { schemaVersion: 1, createdAt: T0 } } };
}

// The brief's tests, by name.

test('round trips item states, sessions, settings and flags', async () => {
  const adapter = createMemoryStore();
  // an empty store loads as the defaults, and the first load stamps the meta record once
  assert.deepEqual(await loadState(adapter, T0), { items: {}, sessions: [], settings: DEFAULTS, flags: [], meta: { schemaVersion: 1, createdAt: T0 } });
  assert.deepEqual((await loadState(adapter, T0 + DAY)).meta, { schemaVersion: 1, createdAt: T0 }, 'createdAt is the first load');
  assert.deepEqual(await adapter.get('meta', 'meta'), { id: 'meta', schemaVersion: 1, createdAt: T0 }, 'the meta record is written, under id meta');
  assert.deepEqual(DEFAULT_APP_SETTINGS, DEFAULTS);
  assert.ok(Object.isFrozen(DEFAULT_APP_SETTINGS));
  assert.equal(await adapter.get('settings', 'settings'), undefined, 'defaults are not written until the learner changes something');

  const { adapter: full, state } = await populated();
  const loaded = await loadState(full, T1);
  assert.deepEqual(loaded.items, state.items, 'item states as saved, without the store key, rule ids included');
  assert.deepEqual(loaded.sessions, state.sessions, 'sessions in order of startedAt, whatever the insertion or key order');
  assert.deepEqual(loaded.settings, state.settings);
  assert.deepEqual(loaded.flags, state.flags, 'flags in order of at');
  assert.deepEqual(loaded.meta, state.meta, 'meta keeps its first stamp');
  assert.deepEqual(loaded, state);
  // the records are keyed by id: an item under its itemId, the settings and meta under fixed ids
  assert.deepEqual(await full.get('items', 'u01-l01-i02'), { id: 'u01-l01-i02', ...state.items['u01-l01-i02'] });
  assert.deepEqual(await full.get('settings', 'settings'), { id: 'settings', ...state.settings });
  assert.equal((await full.getAll('flags')).length, 2);

  // saving an item again replaces its record, so the store holds one state per item
  const next = recall(state.items['u01-l01-i01'], 'correct', state.items['u01-l01-i01'].due);
  await saveItemState(full, next);
  const again = await loadState(full);
  assert.deepEqual(Object.keys(again.items).sort(), ['r-biti-present', 'u01-l01-i01', 'u01-l01-i02']);
  assert.deepEqual(again.items['u01-l01-i01'], next);
  // the same flag added twice is one flag; a second note on the same item at another time is another
  await addFlag(full, state.flags[0]);
  assert.equal((await loadState(full)).flags.length, 2);
  await addFlag(full, flag('u01-l01-i01', 'Second thought', T0 + 2 * HOUR));
  assert.equal((await loadState(full)).flags.length, 3);
  // a settings record from an older version lacks the newer fields: they read as defaults
  await full.put('settings', { id: 'settings', name: 'Bor', newPerDay: 3 });
  assert.deepEqual((await loadState(full)).settings, { ...DEFAULTS, name: 'Bor', newPerDay: 3 });
  // what loadState returns is the caller's own: changing it does not change the store, nor does changing a saved object
  again.items['u01-l01-i02'].phase = 'review';
  again.sessions[0].minutes = 99;
  assert.equal((await loadState(full)).items['u01-l01-i02'].phase, 'learning');
  assert.equal((await loadState(full)).sessions[0].minutes, 10);
  const saved = createState('u02-l01-i01', T0);
  await saveItemState(full, saved);
  saved.phase = 'learning';
  assert.equal((await loadState(full)).items['u02-l01-i01'].phase, 'new');
});

test('export contains app marker and schema version; import restores the same state', async () => {
  const { adapter, state } = await populated();
  const json = await exportState(adapter, T1);
  const file = JSON.parse(json);
  assert.equal(file.app, 'slovelingo');
  assert.equal(file.schemaVersion, 1);
  assert.equal(file.exportedAt, T1);
  assert.deepEqual(file, { app: 'slovelingo', schemaVersion: 1, exportedAt: T1, ...state }, 'the marker and the version first, then the state');
  assert.equal(json, JSON.stringify(file, null, 2), 'pretty-printed, since people read the flags in it');
  assert.equal(APP_ID, 'slovelingo');
  assert.equal(SCHEMA_VERSION, 1);
  assert.deepEqual(await loadState(adapter), state, 'exporting changes nothing');

  // import into a store that holds other progress: the file replaces all of it, meta included
  const target = createMemoryStore();
  await loadState(target, T0 - 30 * DAY);
  await saveItemState(target, createState('u09-l01-i01', T0));
  await appendSession(target, session('s-old', T0 - DAY));
  await saveSettings(target, { ...DEFAULTS, name: 'Old' });
  await addFlag(target, flag('u09-l01-i01', 'old flag', T0));
  const checked = validateImport(json);
  assert.equal(checked.ok, true);
  assert.deepEqual(checked.data, file, 'the data is the parsed file');
  await importState(target, checked.data, T1);
  assert.deepEqual(await loadState(target), state);
  assert.equal(await target.get('items', 'u09-l01-i01'), undefined);
  assert.equal(await target.get('sessions', 's-old'), undefined);
  assert.equal((await target.getAll('flags')).length, 2);
  for (const store of STORE_NAMES) assert.equal((await target.getAll(store)).length, (await adapter.getAll(store)).length, store);
  assert.equal(await exportState(target, T1), json, 'a second export is the same file');

  // a minimal file imports as the defaults, stamped now
  const minimal = validateImport(JSON.stringify({ app: 'slovelingo', schemaVersion: 1, items: {}, sessions: [] }));
  assert.equal(minimal.ok, true);
  await importState(target, minimal.data, T1 + DAY);
  assert.deepEqual(await loadState(target), { items: {}, sessions: [], settings: DEFAULTS, flags: [], meta: { schemaVersion: 1, createdAt: T1 + DAY } });

  // an older export's settings lack newer fields and its meta keeps its createdAt
  const older = validateImport(JSON.stringify({
    app: 'slovelingo', schemaVersion: 1, exportedAt: T0, items: {}, sessions: [], settings: { name: 'Eva', dailyMinutes: 15 }, flags: [], meta: { schemaVersion: 1, createdAt: T0 - 90 * DAY },
  }));
  await importState(target, older.data, T1);
  const restored = await loadState(target);
  assert.deepEqual(restored.settings, { ...DEFAULTS, name: 'Eva', dailyMinutes: 15 });
  assert.deepEqual(restored.meta, { schemaVersion: 1, createdAt: T0 - 90 * DAY });

  // the items in the file are written under their own itemId, whatever key the file used
  const renamed = validateImport(JSON.stringify({ app: 'slovelingo', schemaVersion: 1, items: { whatever: state.items['u01-l01-i02'] }, sessions: [] }));
  await importState(target, renamed.data, T1);
  assert.deepEqual((await loadState(target)).items, { 'u01-l01-i02': state.items['u01-l01-i02'] });
});

test('validateImport rejects foreign or malformed JSON with a reason and does not touch the store', async () => {
  const { adapter, state } = await populated();
  const before = await exportState(adapter, T1);
  const valid = { app: 'slovelingo', schemaVersion: 1, exportedAt: T1, ...state };
  const variant = (changes) => JSON.stringify({ ...valid, ...changes });
  // kind of failure, file, the reason it should give
  const cases = [
    ['json', '{not json', /not valid JSON/],
    ['json', '', /not valid JSON/],
    ['marker', 'null', /not a Slovelingo export/],
    ['marker', '42', /not a Slovelingo export/],
    ['marker', '[]', /not a Slovelingo export/],
    ['marker', '"slovelingo"', /not a Slovelingo export/],
    ['marker', '{}', /not a Slovelingo export/],
    ['marker', variant({ app: 'anki' }), /not a Slovelingo export/],
    ['marker', variant({ app: undefined }), /not a Slovelingo export/],
    ['version', variant({ schemaVersion: 2 }), /schema version 2, this app reads version 1/],
    ['version', variant({ schemaVersion: '1' }), /schema version "1"/],
    ['version', variant({ schemaVersion: undefined }), /no schema version/],
    ['items', variant({ items: [] }), /items are not an object/],
    ['items', variant({ items: null }), /items are not an object/],
    ['items', variant({ items: undefined }), /items are not an object/],
    ['item', variant({ items: { 'u01-l01-i01': 'learning' } }), /item u01-l01-i01 is not an item state/],
    ['item', variant({ items: { 'u01-l01-i01': { phase: 'new' } } }), /item u01-l01-i01 is not an item state/],
    ['sessions', variant({ sessions: {} }), /sessions are not a list/],
    ['sessions', variant({ sessions: undefined }), /sessions are not a list/],
    ['session', variant({ sessions: [{ startedAt: T0 }] }), /sessions are not session records/],
    ['settings', variant({ settings: 'dark' }), /settings are not an object/],
    ['flags', variant({ flags: {} }), /flags are not a list of flags/],
    ['flags', variant({ flags: [{ note: 'no item' }] }), /flags are not a list of flags/],
    ['meta', variant({ meta: [] }), /meta is not an object/],
  ];
  /** @type {Map<string, Set<string>>} the reasons seen per kind */
  const byKind = new Map();
  for (const [kind, json, pattern] of cases) {
    const result = validateImport(json);
    assert.equal(result.ok, false, json.slice(0, 60));
    assert.equal(typeof result.reason, 'string');
    assert.match(result.reason, pattern);
    assert.equal('data' in result, false, 'a rejection carries no data');
    // a reason is a sentence the import screen can show: sentence case, a full stop, no exclamation mark, no em dash
    assert.match(result.reason, /^[A-Z].*\.$/);
    assert.doesNotMatch(result.reason, /[!\u2014]/);
    if (!byKind.has(kind)) byKind.set(kind, new Set());
    byKind.get(kind).add(result.reason);
  }
  // every kind of failure has its own reason: no reason is shared between kinds
  assert.equal(byKind.size, 10);
  const kinds = [...byKind.entries()];
  for (const [kind, reasons] of kinds) {
    for (const [other, theirs] of kinds) {
      if (other !== kind) for (const reason of reasons) assert.equal(theirs.has(reason), false, `${kind} and ${other} share a reason`);
    }
  }
  // a valid file is accepted; extra fields in it do no harm
  assert.equal(validateImport(variant({ note: 'made on the old phone' })).ok, true);
  assert.equal(validateImport(variant({ settings: undefined, flags: undefined, meta: undefined })).ok, true, 'settings, flags and meta are optional');
  // nothing was imported: the store is as it was
  assert.deepEqual(await loadState(adapter), state);
  assert.equal(await exportState(adapter, T1), before);
});

test('openStore falls back to memory when indexedDB is undefined', async (t) => {
  assert.equal(globalThis.indexedDB, undefined, 'Node has no IndexedDB');
  await assert.rejects(openIndexedDb(), /IndexedDB/);
  const { adapter, persistent } = await openStore();
  assert.equal(persistent, false);
  await saveItemState(adapter, createState('u01-l01-i01', T0));
  assert.deepEqual(Object.keys((await loadState(adapter, T0)).items), ['u01-l01-i01'], 'the memory store runs the app');

  // IndexedDB present but refusing: open throws (a sandboxed or private context) or the request errors (blocked storage)
  t.after(() => { delete globalThis.indexedDB; });
  globalThis.indexedDB = { open() { throw new Error('Storage is blocked'); } };
  await assert.rejects(openIndexedDb(), /blocked/);
  assert.equal((await openStore()).persistent, false);
  globalThis.indexedDB = {
    open() {
      const request = { error: new Error('Quota exceeded') };
      queueMicrotask(() => request.onerror());
      return request;
    },
  };
  await assert.rejects(openIndexedDb(), /Quota exceeded/);
  assert.equal((await openStore()).persistent, false);

  // IndexedDB that opens: the first open creates the five stores keyed by id, a later one creates nothing
  const created = [];
  const db = {
    objectStoreNames: { contains: (name) => created.some((store) => store.name === name) },
    createObjectStore(name, options) { created.push({ name, ...options }); },
    close() {},
  };
  let openedWith = null;
  let upgrade = true;
  globalThis.indexedDB = {
    open(name, version) {
      openedWith = { name, version };
      const request = { result: db };
      queueMicrotask(() => {
        if (upgrade) request.onupgradeneeded();
        request.onsuccess();
      });
      return request;
    },
  };
  const opened = await openStore();
  assert.equal(opened.persistent, true);
  assert.deepEqual(openedWith, { name: 'slovelingo', version: 1 });
  assert.deepEqual([DB_NAME, DB_VERSION], ['slovelingo', 1]);
  assert.deepEqual(created, STORE_NAMES.map((name) => ({ name, keyPath: 'id' })));
  assert.deepEqual(Object.keys(opened.adapter).sort(), ['clear', 'del', 'get', 'getAll', 'put']);
  await openIndexedDb();
  assert.equal(created.length, 5, 'an upgrade over existing stores adds none');
  upgrade = false;
  await openIndexedDb('other', 3);
  assert.deepEqual(openedWith, { name: 'other', version: 3 });
  assert.equal(created.length, 5);
});

// Beyond the brief: the memory adapter's contract, which the IndexedDB adapter shares.

test('the memory store keeps one record per id, copies in and out, and rejects unknown stores', async () => {
  assert.deepEqual([...STORE_NAMES], ['items', 'sessions', 'settings', 'flags', 'meta']);
  assert.ok(Object.isFrozen(STORE_NAMES));
  const store = createMemoryStore();
  assert.equal(await store.get('items', 'x'), undefined);
  assert.deepEqual(await store.getAll('items'), []);
  const value = { id: 'x', nested: { n: 1 } };
  await store.put('items', value);
  value.nested.n = 2;
  assert.deepEqual(await store.get('items', 'x'), { id: 'x', nested: { n: 1 } }, 'put copies, as IndexedDB does');
  const got = await store.get('items', 'x');
  got.nested.n = 3;
  assert.deepEqual(await store.get('items', 'x'), { id: 'x', nested: { n: 1 } }, 'get copies too');
  await store.put('items', { id: 'x', nested: { n: 9 } });
  assert.deepEqual(await store.getAll('items'), [{ id: 'x', nested: { n: 9 } }], 'put replaces by id');
  await store.put('items', { id: 'a' });
  assert.deepEqual((await store.getAll('items')).map((record) => record.id), ['a', 'x'], 'getAll in key order, as IndexedDB returns it');
  assert.equal(await store.get('sessions', 'a'), undefined, 'the stores are separate');
  await store.del('items', 'x');
  await store.del('items', 'missing');
  assert.deepEqual(await store.getAll('items'), [{ id: 'a' }]);
  await store.clear('items');
  assert.deepEqual(await store.getAll('items'), []);
  assert.deepEqual(await store.getAll('sessions'), []);
  await assert.rejects(store.get('bogus', 'a'), RangeError);
  await assert.rejects(store.getAll('bogus'), RangeError);
  await assert.rejects(store.put('items', { nope: 1 }), TypeError, 'a record needs a string id, as IndexedDB needs a key');
  await assert.rejects(store.put('items', { id: 7 }), TypeError);
  await assert.rejects(store.put('items', { id: 'f', fn() {} }), 'a value IndexedDB could not clone is refused here too');
  for (const name of STORE_NAMES) {
    await store.put(name, { id: 'shared' });
    assert.deepEqual(await store.getAll(name), [{ id: 'shared' }]);
  }
});
