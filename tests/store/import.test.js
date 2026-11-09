// tests/store/import.test.js
// The Settings screen's import path over the raw stores, driven through the screen itself: the
// Settings screen is rendered under tests/helpers/fake-dom.js over a populated memory store, a file
// is chosen in its file input, and every store is compared before and after. A file that will not
// do (another app's export, a different schema version, text that is not JSON, items that are not
// an object, sessions that are not a list, a file that cannot be read) shows its reason in the
// notice, opens no confirmation card and leaves every record where it was; tests/store/state.test.js
// checks validateImport's reasons on their own. A valid file opens the confirmation card with its
// counts and writes nothing until Replace (choosing it, Cancel, or a bad file chosen after it write
// nothing); Replace writes exactly the records the file was exported from and puts the imported
// settings to work. importSummary counts what a file holds, and importState round-trips an export.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../helpers/fake-dom.js';
import { createState } from '../../app/js/engine/scheduler.js';
import { STORE_NAMES, createMemoryStore } from '../../app/js/store/memory.js';
import {
  DEFAULT_APP_SETTINGS, addFlag, appendSession, exportState, importState, loadState, saveItemState, saveMeta, saveSettings, validateImport,
} from '../../app/js/store/state.js';
import { importSummary, renderSettings } from '../../app/js/ui/screens/settings.js';

/** @type {ReturnType<typeof installFakeDom>} */
let document;

before(() => {
  document = installFakeDom();
});

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

/** Every element under `root`, depth first. @param {any} root @returns {any[]} */
function elements(root) {
  /** @type {any[]} */
  const found = [];
  /** @param {any} node */
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (!child.tagName) continue;
      found.push(child);
      walk(child);
    }
  };
  walk(root);
  return found;
}

/** Lets the screen's handlers, and the store promises they wait on, finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

/**
 * The Settings screen over `adapter`, rendered as main.js mounts it, with a player that records
 * what Settings asks of it, and handles on the import controls. The handles found at render time
 * belong to that render; the notice is looked up again each time, since Replace redraws the screen.
 * @param {import('../../app/js/store/memory.js').StoreAdapter} adapter
 */
async function settingsOver(adapter) {
  /** @type {[string, unknown][]} */
  const calls = [];
  const player = { setMute: (/** @type {boolean} */ mute) => calls.push(['mute', mute]), setVoice: (/** @type {string} */ voice) => calls.push(['voice', voice]) };
  const app = /** @type {any} */ ({ adapter, state: await loadState(adapter), player });
  const container = /** @type {any} */ (document.createElement('main'));
  renderSettings(container, app);
  const all = elements(container);
  const fileInput = all.find((el) => el.tagName === 'INPUT' && el.getAttribute('type') === 'file');
  const card = all.find((el) => el.getAttribute('aria-labelledby') === 'settings-import-question');
  const question = all.find((el) => el.getAttribute('id') === 'settings-import-question');
  assert.ok(fileInput && card && question, 'the screen has the file input and the confirmation card');
  assert.equal(card.hidden, true, 'the confirmation card starts hidden');
  return {
    app, calls, card, question,
    /** @returns {any} the data section's notice in the screen as it now stands */
    notice: () => container.querySelector('.settings-notice'),
    /**
     * Chooses a file in the hidden file input, as the file picker does, and waits for the screen.
     * @param {string|null} text the file's text, or null for a file that cannot be read
     */
    async choose(text) {
      fileInput.files = [{ name: 'backup.json', text: () => (text === null ? Promise.reject(new Error('unreadable')) : Promise.resolve(text)) }];
      fileInput.dispatch('change');
      await settle();
    },
    /** Presses a button of the confirmation card and waits for the screen. @param {string} label */
    async press(label) {
      const button = elements(card).find((el) => el.tagName === 'BUTTON' && el.textContent === label);
      assert.ok(button, `the card has ${label}`);
      button.dispatch('click');
      await settle();
    },
  };
}

test('Settings refuses a foreign or malformed file with its reason, opens no confirmation and every store keeps its records', async () => {
  const adapter = await populated();
  const before = await snapshot(adapter);
  assert.ok(STORE_NAMES.every((store) => before[store].length > 0), 'every store holds something to lose');
  const valid = JSON.parse(await exportState(adapter, T0 + 2 * DAY));
  /** @param {Record<string, unknown>} changes */
  const variant = (changes) => JSON.stringify({ ...valid, ...changes });
  /** @type {[string, string|null, string][]} what the file is, its text, the reason the notice gives */
  const cases = [
    ['another app\'s export', variant({ app: 'anki' }), 'The file is not a Slovelingo export.'],
    ['a newer schema version', variant({ schemaVersion: 2 }), 'The file has schema version 2, this app reads version 1.'],
    ['text that is not JSON', variant({}).slice(0, -20), 'The file is not valid JSON.'],
    ['items that are not an object', variant({ items: Object.values(valid.items) }), "The file's items are not an object."],
    ['sessions that are not a list', variant({ sessions: { 's-1': valid.sessions[0] } }), "The file's sessions are not a list."],
    ['a file that cannot be read', null, 'The file could not be read.'],
  ];
  for (const [what, text, reason] of cases) {
    const screen = await settingsOver(adapter);
    await screen.choose(text);
    assert.equal(screen.notice().textContent, `Nothing was imported. ${reason}`, what);
    assert.equal(screen.notice().hidden, false, `${what}: the notice shows`);
    assert.equal(screen.card.hidden, true, `${what}: no confirmation card`);
    assert.deepEqual(await snapshot(adapter), before, `${what}: the stores are untouched`);
    assert.deepEqual(screen.calls, [], `${what}: the player keeps its settings`);
  }
});

test('Settings asks before a valid file replaces anything, and Replace writes exactly the file', async () => {
  const adapter = await populated();
  const before = await snapshot(adapter);
  // the file: another phone's progress, different in every store
  const other = createMemoryStore();
  await saveItemState(other, createState('u02-l01-i01', T0));
  await appendSession(other, session('s-9', T0 + 5 * DAY));
  await saveSettings(other, { ...DEFAULT_APP_SETTINGS, name: 'Eva', theme: 'light', voice: 'device', mute: true, onboarded: true });
  await saveMeta(other, { schemaVersion: 1, createdAt: T0 - 10 * DAY });
  const file = await exportState(other, T0 + 6 * DAY);

  const screen = await settingsOver(adapter);
  await screen.choose(file);
  assert.equal(screen.card.hidden, false, 'the confirmation card opens');
  assert.equal(screen.question.textContent, 'Replace your progress with this file? It holds 1 item and 1 session.');
  assert.equal(screen.notice().hidden, true, 'no notice beside the card');
  assert.deepEqual(await snapshot(adapter), before, 'choosing the file writes nothing');

  await screen.press('Cancel');
  assert.equal(screen.card.hidden, true, 'Cancel closes the card');
  assert.deepEqual(await snapshot(adapter), before, 'Cancel writes nothing');

  await screen.choose(file);
  await screen.choose('{"app": "slovelingo"');
  assert.equal(screen.card.hidden, true, 'a bad file chosen next closes the card of the good one');
  assert.equal(screen.notice().textContent, 'Nothing was imported. The file is not valid JSON.');
  assert.deepEqual(await snapshot(adapter), before, 'the bad file writes nothing either');
  assert.deepEqual(screen.calls, [], 'nothing reached the player before Replace');

  await screen.choose(file);
  assert.deepEqual(await snapshot(adapter), before, 'still nothing written while the card waits');
  await screen.press('Replace');
  assert.deepEqual(await snapshot(adapter), await snapshot(other), 'Replace writes exactly the records the file came from');
  assert.equal(screen.notice().textContent, 'Progress imported.');
  assert.equal(screen.notice().hidden, false);
  assert.equal(screen.app.state.settings.name, 'Eva', 'the app state is the imported one');
  assert.deepEqual(screen.calls, [['mute', true], ['voice', 'device']], 'the imported mute and voice reach the player');
  assert.equal(document.documentElement.dataset.theme, 'light', 'the imported theme is applied');
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
