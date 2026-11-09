// tests/ui/settings.test.js
// The Settings screen's pure parts and its switch: clampSetting keeps the daily goal, the new
// items per day and the target recall inside their ranges (spec 4.2), backupFilename names the
// export by the local date, importQuestion words the confirmation card, the speaking checks'
// description is the Global Constraints' text verbatim, and renderSwitch is a button with role
// switch that flips aria-checked and reports the new value. The DOM parts run through
// tests/helpers/fake-dom.js; the screen itself runs in the browser check.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../helpers/fake-dom.js';
import { DEFAULT_APP_SETTINGS } from '../../app/js/store/state.js';
import { SPEECH_DESCRIPTION, backupFilename, clampSetting, importQuestion, renderSwitch } from '../../app/js/ui/screens/settings.js';

before(() => {
  installFakeDom();
});

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
