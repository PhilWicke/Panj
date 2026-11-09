// tests/ui/checkpoint.test.js
// The pure parts of the checkpoint and onboarding screens: the intro and end-card wording (the
// count and minutes line, the result line with its rounded percent, the verdict, the calibration
// line of the weekly check, the default prediction), the settings onboarding saves (the clause
// trimmed, the name capped, onboarded set, Ruling 52), and the feedback panel without its retry,
// which the checkpoint asks for. The flows themselves run in the browser check.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../helpers/fake-dom.js';
import { grade } from '../../app/js/engine/grading.js';
import { DEFAULT_APP_SETTINGS } from '../../app/js/store/state.js';
import { renderFeedback } from '../../app/js/ui/components/feedback.js';
import { aboutLine, calibrationLine, countLine, defaultPrediction, resultLine, verdictLine } from '../../app/js/ui/screens/checkpoint.js';
import { DEFAULT_INTENTION, onboardingSettings } from '../../app/js/ui/screens/onboarding.js';

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
