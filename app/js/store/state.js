// The app's state over a StoreAdapter: item states, session records, settings, flags and meta,
// each in its own store, every record keyed by `id`. loadState reads the five stores into one
// AppState and the save functions write one record each, so an answer in a session is one small
// put. exportState and importState move the whole state through one JSON file, the backup;
// validateImport checks a file before importState clears anything and names the reason when the
// file will not do. Times are epoch ms, as everywhere in the app.

import { DEFAULT_SETTINGS } from '../engine/scheduler.js';
import { STORE_NAMES } from './memory.js';

/** @typedef {import('../engine/scheduler.js').ItemState} ItemState */
/** @typedef {import('../engine/scheduler.js').Settings} Settings */
/** @typedef {import('../engine/progress.js').SessionRecord} SessionRecord */
/** @typedef {import('./memory.js').StoreAdapter} StoreAdapter */

/**
 * What the app keeps beyond the scheduler's Settings.
 * @typedef {object} Preferences
 * @property {string} name shown in the greeting; stays on the device
 * @property {string} intention the implementation intention from onboarding, "on the train after the first stop"
 * @property {boolean} mute no sound: silent forms of every exercise
 * @property {boolean} speech speech recognition opt-in, off by default
 * @property {'system'|'light'|'dark'} theme
 * @property {'female'|'male'|'device'} voice
 * @property {boolean} onboarded
 */

/** @typedef {Settings & Preferences} AppSettings */

/**
 * A "report this" on an item. Flags travel with the export and feed the ask-a-native list.
 * @typedef {object} Flag
 * @property {string} itemId
 * @property {string} note
 * @property {number} at epoch ms
 */

/**
 * @typedef {object} Meta
 * @property {1} schemaVersion the shape of the records in the store
 * @property {number} createdAt epoch ms of the first load, when the learner started
 * @property {Record<string, string>} [sealed] unit id to the ISO date (`YYYY-MM-DD`) its checkpoint passed; the checkpoint screen writes it, the hive reads it (Ruling 38)
 */

/**
 * @typedef {object} AppState
 * @property {Record<string, ItemState>} items by item id, rule ids included
 * @property {SessionRecord[]} sessions in order of startedAt
 * @property {AppSettings} settings
 * @property {Flag[]} flags in order of at
 * @property {Meta} meta
 */

/**
 * What a validated backup file holds. Settings, flags and meta are optional: a file that lacks
 * them imports with the defaults, so an export from an older version still restores.
 * @typedef {object} ImportData
 * @property {Record<string, ItemState>} items
 * @property {SessionRecord[]} sessions
 * @property {Partial<AppSettings>} [settings]
 * @property {Flag[]} [flags]
 * @property {Partial<Meta>} [meta]
 */

/** The marker that tells a Slovelingo backup from any other JSON file. */
export const APP_ID = 'slovelingo';
export const SCHEMA_VERSION = 1;
const SETTINGS_ID = 'settings';
const META_ID = 'meta';

/** @type {Readonly<AppSettings>} */
export const DEFAULT_APP_SETTINGS = Object.freeze({
  ...DEFAULT_SETTINGS,
  name: '',
  intention: '',
  mute: false,
  speech: false,
  theme: 'system',
  voice: 'female',
  onboarded: false,
});

/**
 * @param {Record<string, any>} record a stored record
 * @returns {any} the record without its store key
 */
function withoutId(record) {
  const { id, ...rest } = record;
  return rest;
}

/** @param {unknown} value @returns {boolean} a plain object, not null and not an array */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {StoreAdapter} adapter
 * @param {ItemState} state
 */
export async function saveItemState(adapter, state) {
  await adapter.put('items', { ...state, id: state.itemId });
}

/**
 * @param {StoreAdapter} adapter
 * @param {SessionRecord} record
 */
export async function appendSession(adapter, record) {
  await adapter.put('sessions', record);
}

/**
 * @param {StoreAdapter} adapter
 * @param {AppSettings} settings
 */
export async function saveSettings(adapter, settings) {
  await adapter.put('settings', { ...settings, id: SETTINGS_ID });
}

/**
 * Adds a flag. The same flag (item and time) added twice is one flag.
 * @param {StoreAdapter} adapter
 * @param {Flag} flag
 */
export async function addFlag(adapter, flag) {
  await adapter.put('flags', { ...flag, id: `${flag.at}:${flag.itemId}` });
}

/**
 * Writes the meta record, the one record of the meta store, under its fixed id: the first load
 * stamps it through here and an import writes the file's through here.
 * @param {StoreAdapter} adapter
 * @param {Meta} meta
 */
export async function saveMeta(adapter, meta) {
  await adapter.put('meta', { ...meta, id: META_ID });
}

/**
 * Reads the whole state. Settings fields the stored record lacks take their defaults, so a field
 * added in a later version reads as its default on an older record. The first load writes the
 * meta record, which stamps when the learner started. Sessions come back in order of startedAt
 * and flags in order of at, whichever adapter holds them.
 * @param {StoreAdapter} adapter
 * @param {number} [now] epoch ms for the meta record created on first load; the clock when omitted
 * @returns {Promise<AppState>}
 */
export async function loadState(adapter, now = Date.now()) {
  const [itemRecords, sessions, settingsRecord, flagRecords, metaRecord] = await Promise.all([
    adapter.getAll('items'),
    adapter.getAll('sessions'),
    adapter.get('settings', SETTINGS_ID),
    adapter.getAll('flags'),
    adapter.get('meta', META_ID),
  ]);
  /** @type {Record<string, ItemState>} */
  const items = {};
  for (const record of itemRecords) {
    const state = withoutId(record);
    items[state.itemId] = state;
  }
  let meta = metaRecord ? withoutId(metaRecord) : null;
  if (!meta) {
    meta = { schemaVersion: SCHEMA_VERSION, createdAt: now };
    await saveMeta(adapter, meta);
  }
  return {
    items,
    sessions: sessions.sort((a, b) => a.startedAt - b.startedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    settings: { ...DEFAULT_APP_SETTINGS, ...(settingsRecord ? withoutId(settingsRecord) : {}) },
    flags: flagRecords.map(withoutId).sort((a, b) => a.at - b.at),
    meta,
  };
}

/**
 * The whole state as one JSON text, the backup file: the app marker and the schema version first,
 * so validateImport can tell the file from any other JSON, then the AppState. Pretty-printed,
 * since the flags in it are read by people.
 * @param {StoreAdapter} adapter
 * @param {number} [now] epoch ms for exportedAt; the clock when omitted
 * @returns {Promise<string>}
 */
export async function exportState(adapter, now = Date.now()) {
  const state = await loadState(adapter, now);
  return JSON.stringify({ app: APP_ID, schemaVersion: SCHEMA_VERSION, exportedAt: now, ...state }, null, 2);
}

const NOT_FLAGS = "The file's flags are not a list of flags.";

/** @param {string} reason @returns {{ ok: false, reason: string }} */
function fail(reason) {
  return { ok: false, reason };
}

/**
 * Checks a file before anything is imported, touching no store. The file must parse as JSON,
 * carry the app marker and this schema version, and hold an items object and a sessions list
 * whose entries importState can write: an item state has its itemId, a session its id, a flag its
 * itemId and at. Settings, flags and meta are optional. Every failure has its own reason, a
 * sentence the import screen can show.
 * @param {string} json
 * @returns {{ ok: true, data: ImportData } | { ok: false, reason: string }}
 */
export function validateImport(json) {
  let data;
  try {
    data = JSON.parse(json);
  } catch {
    return fail('The file is not valid JSON.');
  }
  if (!isRecord(data) || data.app !== APP_ID) return fail('The file is not a Slovelingo export.');
  if (data.schemaVersion === undefined) return fail('The file has no schema version.');
  if (data.schemaVersion !== SCHEMA_VERSION) {
    return fail(`The file has schema version ${JSON.stringify(data.schemaVersion)}, this app reads version ${SCHEMA_VERSION}.`);
  }
  if (!isRecord(data.items)) return fail("The file's items are not an object.");
  for (const [key, state] of Object.entries(data.items)) {
    if (!isRecord(state) || typeof state.itemId !== 'string') return fail(`The file's item ${key} is not an item state.`);
  }
  if (!Array.isArray(data.sessions)) return fail("The file's sessions are not a list.");
  for (const record of data.sessions) {
    if (!isRecord(record) || typeof record.id !== 'string') return fail("The file's sessions are not session records.");
  }
  if (data.settings !== undefined && !isRecord(data.settings)) return fail("The file's settings are not an object.");
  if (data.flags !== undefined) {
    if (!Array.isArray(data.flags)) return fail(NOT_FLAGS);
    for (const flag of data.flags) {
      if (!isRecord(flag) || typeof flag.itemId !== 'string' || typeof flag.at !== 'number') return fail(NOT_FLAGS);
    }
  }
  if (data.meta !== undefined && !isRecord(data.meta)) return fail("The file's meta is not an object.");
  return { ok: true, data };
}

/**
 * Replaces the whole state with a validated file's: every store is cleared, then the file's items
 * (each under its own itemId), sessions, settings over the defaults, flags and meta are written.
 * Only ever called with the data validateImport returned; a file that fails validation never
 * reaches it.
 * @param {StoreAdapter} adapter
 * @param {ImportData} data
 * @param {number} [now] epoch ms for a meta record without createdAt; the clock when omitted
 */
export async function importState(adapter, data, now = Date.now()) {
  for (const store of STORE_NAMES) await adapter.clear(store);
  for (const state of Object.values(data.items)) await saveItemState(adapter, state);
  for (const record of data.sessions) await appendSession(adapter, record);
  await saveSettings(adapter, { ...DEFAULT_APP_SETTINGS, ...data.settings });
  for (const flag of data.flags ?? []) await addFlag(adapter, flag);
  const createdAt = typeof data.meta?.createdAt === 'number' ? data.meta.createdAt : now;
  await saveMeta(adapter, { ...data.meta, schemaVersion: SCHEMA_VERSION, createdAt });
}
