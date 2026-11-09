// tests/ui/settings.test.js
// The Settings screen's pure parts and its switch: clampSetting keeps the daily goal, the new
// items per day and the target recall inside their ranges (spec 4.2), backupFilename names the
// export by the local date, importQuestion words the confirmation card, the speaking checks'
// description is the Global Constraints' text verbatim, and renderSwitch is a button with role
// switch that flips aria-checked and reports the new value. Through tests/helpers/fake-dom.js, a
// change the store refuses is taken back: in the app's settings, in the player and in the control,
// with "Not saved. Try again." The rest of the screen runs in the browser check.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../helpers/fake-dom.js';
import { elements } from '../helpers/dom-query.js';
import { DEFAULT_APP_SETTINGS } from '../../app/js/store/state.js';
import { SPEECH_DESCRIPTION, backupFilename, clampSetting, importQuestion, renderSettings, renderSwitch } from '../../app/js/ui/screens/settings.js';

/** @type {ReturnType<typeof installFakeDom>} */
let document;

before(() => {
  document = installFakeDom();
});

/** Lets the screen's handlers, and the store promises they wait on, finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

/** The element under `root` with the id. @param {any} root @param {string} id */
const byId = (root, id) => elements(root).find((el) => el.getAttribute('id') === id);

test('clampSetting keeps each number in its range, whole minutes and items, retention to the hundredth', () => {
  assert.equal(clampSetting('dailyMinutes', 10), 10);
  assert.equal(clampSetting('dailyMinutes', 2), 3);
  assert.equal(clampSetting('dailyMinutes', 0), 3);
  assert.equal(clampSetting('dailyMinutes', 61), 60);
  assert.equal(clampSetting('dailyMinutes', 12.6), 13);
  assert.equal(clampSetting('newPerDay', 0), 0);
  assert.equal(clampSetting('newPerDay', -1), 0);
  assert.equal(clampSetting('newPerDay', 21), 20);
  assert.equal(clampSetting('newPerDay', 7.4), 7);
  assert.equal(clampSetting('desiredRetention', 0.9), 0.9);
  assert.equal(clampSetting('desiredRetention', 0.8), 0.85);
  assert.equal(clampSetting('desiredRetention', 0.95), 0.92);
  assert.equal(clampSetting('desiredRetention', 87 / 100), 0.87);
  assert.equal(clampSetting('desiredRetention', 0.8849), 0.88);
  for (const key of /** @type {const} */ (['dailyMinutes', 'newPerDay', 'desiredRetention'])) {
    assert.equal(clampSetting(key, Number.NaN), DEFAULT_APP_SETTINGS[key], `${key}: not a number gives the default`);
    assert.equal(clampSetting(key, Number.POSITIVE_INFINITY), DEFAULT_APP_SETTINGS[key]);
  }
});

test('backupFilename names the backup by the local date', () => {
  const lateEvening = Date.UTC(2026, 10, 8, 23, 30);   // 9 November 00:30 in Berlin
  assert.equal(backupFilename(lateEvening, 'Europe/Berlin'), 'slovelingo-backup-2026-11-09.json');
  assert.equal(backupFilename(lateEvening, 'UTC'), 'slovelingo-backup-2026-11-08.json');
  assert.equal(backupFilename(Date.UTC(2027, 0, 5, 12), 'UTC'), 'slovelingo-backup-2027-01-05.json');
});

test('importQuestion names the items and sessions the file holds', () => {
  assert.equal(importQuestion({ items: 42, sessions: 17 }), 'Replace your progress with this file? It holds 42 items and 17 sessions.');
  assert.equal(importQuestion({ items: 1, sessions: 1 }), 'Replace your progress with this file? It holds 1 item and 1 session.');
  assert.equal(importQuestion({ items: 0, sessions: 0 }), 'Replace your progress with this file? It holds 0 items and 0 sessions.');
});

test('the speaking checks description is the Global Constraints text, word for word', () => {
  assert.equal(SPEECH_DESCRIPTION,
    "Speaking checks send your voice to Google's speech service while recognising. Off, your speaking is self-rated and nothing leaves the phone.");
});

test('a change the store refuses is taken back in the settings, the player and the control, with "Not saved. Try again."', async (t) => {
  t.mock.method(console, 'error', () => {});   // the refused write is logged for a device test; the output stays quiet here
  /** @type {[string, unknown][]} */
  const calls = [];
  const player = { setMute: (/** @type {boolean} */ mute) => calls.push(['mute', mute]), setVoice: (/** @type {string} */ voice) => calls.push(['voice', voice]) };
  const adapter = { put: async () => { throw new Error('QuotaExceededError'); } };
  const app = /** @type {any} */ ({ adapter, state: { settings: { ...DEFAULT_APP_SETTINGS, onboarded: true } }, player });
  const container = /** @type {any} */ (document.createElement('main'));
  renderSettings(container, app);
  const status = () => container.querySelector('.settings-saved').textContent;

  // the mute switch: flipped on, the player muted, then both taken back
  const mute = byId(container, 'settings-mute');
  mute.dispatch('click');
  assert.equal(mute.getAttribute('aria-checked'), 'true', 'the switch flips at once');
  assert.equal(app.state.settings.mute, true, 'the change is applied before the write');
  await settle();
  assert.equal(app.state.settings.mute, false, 'the settings from before are back');
  assert.deepEqual(calls, [['mute', true], ['mute', false]], 'the player was muted and unmuted again');
  assert.equal(mute.getAttribute('aria-checked'), 'false', 'the switch shows the kept value');
  assert.equal(status(), 'Not saved. Try again.');

  // a number field: the typed value goes back to the saved one
  const minutes = byId(container, 'settings-minutes');
  minutes.value = '20';
  minutes.valueAsNumber = 20;
  minutes.dispatch('change');
  assert.equal(app.state.settings.dailyMinutes, 20);
  await settle();
  assert.equal(app.state.settings.dailyMinutes, 10);
  assert.equal(minutes.value, '10', 'the field shows the kept value');

  // the theme radios: the page and the radio go back to the kept theme
  const themes = elements(container).filter((el) => el.tagName === 'INPUT' && el.getAttribute('name') === 'settings-theme');
  const dark = themes.find((el) => el.getAttribute('value') === 'dark');
  dark.dispatch('change');
  assert.equal(document.documentElement.dataset.theme, 'dark', 'the theme applies at once');
  await settle();
  assert.equal(app.state.settings.theme, 'system');
  assert.equal(document.documentElement.dataset.theme, undefined, 'the page is back on the system theme');
  assert.equal(themes.find((el) => el.getAttribute('value') === 'system').checked, true, 'the kept radio is checked again');
  assert.equal(dark.checked, false);

  // the voice radios: the player gets the kept voice back
  calls.length = 0;
  elements(container).find((el) => el.tagName === 'INPUT' && el.getAttribute('name') === 'settings-voice' && el.getAttribute('value') === 'male').dispatch('change');
  await settle();
  assert.deepEqual(calls, [['voice', 'male'], ['voice', 'female']]);
  assert.equal(app.state.settings.voice, 'female');

  // a text field
  const name = byId(container, 'settings-name');
  name.value = 'Eva';
  name.dispatch('change');
  await settle();
  assert.equal(app.state.settings.name, '');
  assert.equal(name.value, '');

  // a write that goes through says Saved
  adapter.put = async () => {};
  mute.dispatch('click');
  await settle();
  assert.equal(app.state.settings.mute, true);
  assert.equal(mute.getAttribute('aria-checked'), 'true');
  assert.equal(status(), 'Saved');
});

test('renderSwitch is a button with role switch that flips aria-checked and reports the new value', () => {
  /** @type {boolean[]} */
  const changes = [];
  const row = /** @type {any} */ (renderSwitch({ id: 'settings-mute', label: 'Mute', description: 'No sound.', checked: false, onChange: (on) => changes.push(on) }));
  const button = row.childNodes[0];
  const description = row.childNodes[1];
  assert.equal(button.tagName, 'BUTTON');
  assert.equal(button.getAttribute('type'), 'button');
  assert.equal(button.getAttribute('role'), 'switch');
  assert.equal(button.getAttribute('aria-checked'), 'false');
  assert.equal(button.textContent, 'Mute', 'the label is the accessible name');
  assert.equal(button.getAttribute('aria-describedby'), 'settings-mute-description');
  assert.equal(description.getAttribute('id'), 'settings-mute-description');
  assert.equal(description.textContent, 'No sound.');

  button.dispatch('click');
  assert.equal(button.getAttribute('aria-checked'), 'true');
  button.dispatch('click');
  assert.equal(button.getAttribute('aria-checked'), 'false');
  assert.deepEqual(changes, [true, false]);

  const on = /** @type {any} */ (renderSwitch({ id: 'settings-speech', label: 'Speaking checks', checked: true, onChange: () => {} }));
  assert.equal(on.childNodes[0].getAttribute('aria-checked'), 'true');
  assert.equal(on.childNodes[0].getAttribute('aria-describedby'), null, 'no description, nothing to point to');
  assert.equal(on.childNodes.length, 1);
});
