// tests/ui/checkpoint.test.js
// The pure parts of the checkpoint and onboarding screens: the intro and end-card wording (the
// count and minutes line, the result line with its rounded percent, the verdict, the calibration
// line of the weekly check, the default prediction and how the prediction field is read, the error
// card's line before and during the save), the settings onboarding saves (the clause trimmed, the
// name capped, onboarded set, Ruling 52), and the feedback panel without its retry, which the
// checkpoint asks for. Through tests/helpers/fake-dom.js, onboarding's last step holds its buttons
// while it saves and, when the save is refused, says so and offers them again. The checkpoint flow
// itself runs in the browser check.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../helpers/fake-dom.js';
import { grade } from '../../app/js/engine/grading.js';
import { DEFAULT_APP_SETTINGS } from '../../app/js/store/state.js';
import { renderFeedback } from '../../app/js/ui/components/feedback.js';
import {
  aboutLine, calibrationLine, countLine, defaultPrediction, failureLine, predictionFrom, resultLine, verdictLine,
} from '../../app/js/ui/screens/checkpoint.js';
import { DEFAULT_INTENTION, onboardingSettings, renderOnboarding } from '../../app/js/ui/screens/onboarding.js';

before(() => {
  installFakeDom();
});

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

test('countLine and defaultPrediction: the intro card counts items and minutes, and guesses 80 percent', () => {
  assert.equal(countLine(8), '8 items, about 3 min');
  assert.equal(countLine(1), '1 item, about 1 min');
  assert.equal(countLine(20), '20 items, about 7 min');
  assert.equal(defaultPrediction(8), 6);
  assert.equal(defaultPrediction(10), 8);
  assert.equal(defaultPrediction(7), 6, '5.6 rounds up');
  assert.equal(defaultPrediction(0), 0);
});

test('predictionFrom reads the prediction field: a number in range, rounded, and the default for an emptied or unreadable field', () => {
  assert.equal(predictionFrom('7', 10), 7);
  assert.equal(predictionFrom(' 7 ', 10), 7);
  assert.equal(predictionFrom('0', 10), 0, 'a typed zero is a prediction');
  assert.equal(predictionFrom('6.6', 10), 7, 'whole items');
  assert.equal(predictionFrom('12', 10), 10, 'at most the items');
  assert.equal(predictionFrom('-3', 10), 0, 'at least none');
  assert.equal(predictionFrom('', 10), defaultPrediction(10), 'an emptied field is the default, 8 of 10, not 0');
  assert.equal(predictionFrom('   ', 7), defaultPrediction(7));
  assert.equal(predictionFrom('abc', 10), 8, 'what a number field gives for text it cannot read');
  assert.equal(predictionFrom('1e400', 10), 8, 'not a finite number');
});

test('failureLine: before the end nothing was recorded; a failure while saving says some results may be missing', () => {
  assert.equal(failureLine(false), 'The check stopped and nothing was recorded.');
  assert.equal(failureLine(true), 'Some results may not have been saved. Check your progress on Today.');
});

test('aboutLine says what each check is', () => {
  assert.equal(aboutLine('unit'), 'Type each phrase in Slovenian. 80 percent passes and seals the unit.');
  assert.equal(aboutLine('weekly'), 'A quick look back at what you have learnt.');
  assert.equal(aboutLine('placement'), "Pass a unit's checkpoint to start after it.");
});

test('resultLine rounds the percent for display and verdictLine words the outcome', () => {
  assert.equal(resultLine({ total: 8, correct: 7, pct: 87.5, passed: true }), '7 of 8 right, 88 percent.');
  assert.equal(resultLine({ total: 8, correct: 3, pct: 37.5, passed: false }), '3 of 8 right, 38 percent.');
  assert.equal(resultLine({ total: 20, correct: 16, pct: 80, passed: true }), '16 of 20 right, 80 percent.');
  assert.equal(resultLine({ total: 8, correct: 8, pct: 100, passed: true }), '8 of 8 right, 100 percent.');
  assert.equal(verdictLine(true), 'Passed. The unit is sealed in your hive.');
  assert.equal(verdictLine(false), 'Not yet. Keep practising and take it again when you are ready.');
});

test('calibrationLine compares the prediction with the result', () => {
  assert.equal(calibrationLine(5, 7), 'You predicted 5 and got 7. 2 more than you thought.');
  assert.equal(calibrationLine(6, 7), 'You predicted 6 and got 7. 1 more than you thought.');
  assert.equal(calibrationLine(6, 6), 'You predicted 6 and got 6. Spot on.');
  assert.equal(calibrationLine(7, 5), 'You predicted 7 and got 5. 2 fewer than you thought.');
  assert.equal(calibrationLine(8, 7), 'You predicted 8 and got 7. 1 fewer than you thought.');
});

test('onboardingSettings keeps the other settings, trims the clause and the name, caps the name and marks the learner onboarded', () => {
  assert.equal(DEFAULT_INTENTION, 'on the train after the first stop');
  const saved = onboardingSettings(DEFAULT_APP_SETTINGS, { name: '  Ana ', intention: ` ${DEFAULT_INTENTION} `, theme: 'dark' });
  assert.deepEqual(saved, { ...DEFAULT_APP_SETTINGS, name: 'Ana', intention: DEFAULT_INTENTION, theme: 'dark', onboarded: true });
  const kept = onboardingSettings({ ...DEFAULT_APP_SETTINGS, dailyMinutes: 15, mute: true }, { name: '', intention: '', theme: 'system' });
  assert.deepEqual(kept, { ...DEFAULT_APP_SETTINGS, dailyMinutes: 15, mute: true, name: '', intention: '', theme: 'system', onboarded: true }, 'an empty name and clause are allowed');
  assert.equal(onboardingSettings(DEFAULT_APP_SETTINGS, { name: 'a'.repeat(50), intention: 'x', theme: 'light' }).name.length, 40);
  assert.equal(onboardingSettings(DEFAULT_APP_SETTINGS, { name: 'Ana', intention: 'after breakfast.', theme: 'light' }).intention, 'after breakfast.', 'the clause is stored as typed, trimmed; Today adds the sentence around it');
});

test('onboarding: a refused save says so, offers the buttons again and keeps the learner where they are; a second try goes on', async (t) => {
  /** @type {string[]} */
  const visited = [];
  Object.defineProperty(globalThis, 'location', {
    value: { hash: '', replace: (/** @type {string} */ hash) => { visited.push(hash); } }, configurable: true, writable: true,
  });
  t.after(() => { delete (/** @type {Record<string, unknown>} */ (globalThis)).location; });
  /** @type {{ resolve: () => void, reject: (error: Error) => void }[]} */
  const writes = [];
  const adapter = { put: () => new Promise((resolve, reject) => { writes.push({ resolve: () => resolve(undefined), reject }); }) };
  const app = /** @type {any} */ ({ adapter, state: { settings: { ...DEFAULT_APP_SETTINGS } } });
  const container = /** @type {any} */ (document.createElement('main'));
  renderOnboarding(container, app);
  for (let step = 1; step < 4; step += 1) container.querySelector('.onboarding-step').dispatch('submit');
  assert.equal(container.querySelector('.eyebrow').textContent, '4 of 4');
  /** @param {string} text */
  const pick = (text) => elements(container).find((el) => el.tagName === 'BUTTON' && el.textContent === text);
  const start = pick('Start from the first hello');
  const placement = pick('Take a ten-minute placement check');

  start.dispatch('click');
  assert.equal(writes.length, 1, 'the settings are saved once');
  assert.ok(start.disabled && placement.disabled, 'both ways in wait while the save runs');
  placement.dispatch('click');
  assert.equal(writes.length, 1, 'a second tap saves nothing more');
  writes[0].reject(new Error('QuotaExceededError'));
  await new Promise((resolve) => setTimeout(resolve, 5));
  const notice = container.querySelector('.notice');
  assert.ok(notice, 'a notice says what happened');
  assert.equal(notice.textContent, 'Your choices could not be saved. Try again.');
  assert.equal(notice.hidden, false);
  assert.ok(!start.disabled && !placement.disabled, 'the buttons are offered again');
  assert.equal(app.state.settings.onboarded, false, 'the app is not onboarded while the store is not');
  assert.deepEqual(visited, [], 'and stays on the step');

  placement.dispatch('click');
  assert.equal(writes.length, 2);
  writes[1].resolve();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(app.state.settings.onboarded, true);
  assert.deepEqual(visited, ['#/checkpoint?placement=1'], 'the second try goes on to the placement');
});

test('renderFeedback without a retry offers Continue only, as the primary action, after a miss', () => {
  const graded = grade('xyz', 'Živjo.');
  assert.equal(graded.result, 'wrong');
  const done = { count: 0 };
  const panel = renderFeedback({ answer: 'xyz', graded, effective: 'wrong', target: 'Živjo.', rule: null, retry: false, onDone: () => { done.count += 1; } });
  const buttons = elements(panel).filter((e) => e.tagName === 'BUTTON');
  assert.deepEqual(buttons.map((b) => b.textContent), ['Continue']);
  assert.equal(buttons[0].className, 'btn btn-primary');
  assert.equal(buttons[0].dataset.autofocus, '', 'Continue takes the focus');
  assert.equal(panel.className, 'feedback feedback-wrong', 'the panel still reads as a miss');
  buttons[0].dispatch('click');
  buttons[0].dispatch('click');
  assert.equal(done.count, 1, 'onDone once');
  const usual = renderFeedback({ answer: 'xyz', graded, effective: 'wrong', target: 'Živjo.', rule: null, onDone: () => {} });
  assert.deepEqual(elements(usual).filter((e) => e.tagName === 'BUTTON').map((b) => [b.textContent, b.className]),
    [['Type it again', 'btn btn-primary'], ['Continue', 'btn btn-secondary']], 'the retry is offered by default (Ruling 32)');
  const right = renderFeedback({ answer: 'Živjo', graded: grade('Živjo', 'Živjo.'), effective: 'correct', target: 'Živjo.', rule: null, retry: false, onDone: () => {} });
  assert.deepEqual(elements(right).filter((e) => e.tagName === 'BUTTON').map((b) => b.textContent), ['Continue']);
});
