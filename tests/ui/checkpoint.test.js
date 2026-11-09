// tests/ui/checkpoint.test.js
// The pure parts of the checkpoint and onboarding screens: the intro and end-card wording (the
// count and minutes line, the result line with its rounded percent, the verdict, the calibration
// line of the weekly check, the default prediction and how the prediction field is read, the error
// card's line before and during the save, and once an earlier unit of the placement chain was
// saved), the settings onboarding saves (the name capped, onboarded set), and the feedback panel
// without its retry, which the checkpoint asks for. Through tests/helpers/fake-dom.js, onboarding
// counts three steps and never asks when the learner will practise, and its last step holds its
// buttons while it saves and, when the save is refused, says so and offers them again. The
// placement check takes its chain of units from the content, and an empty chain reaches the
// not-found card. A unit checkpoint run to its end card: a pass paints the unit's strip sealed,
// one motif per cell of the unit and filled from the states the check left, and a miss draws no
// strip. The rest of the checkpoint flow runs in the browser check.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../helpers/fake-dom.js';
import { elements, withClass } from '../helpers/dom-query.js';
import { grade } from '../../app/js/engine/grading.js';
import { createMemoryStore } from '../../app/js/store/memory.js';
import { DEFAULT_APP_SETTINGS } from '../../app/js/store/state.js';
import { renderFeedback } from '../../app/js/ui/components/feedback.js';
import {
  aboutLine, calibrationLine, countLine, defaultPrediction, failureLine, predictionFrom, renderCheckpoint, resultLine, verdictLine,
} from '../../app/js/ui/screens/checkpoint.js';
import { onboardingSettings, renderOnboarding } from '../../app/js/ui/screens/onboarding.js';

before(() => {
  installFakeDom();
});

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

test('failureLine: before the end nothing was recorded; a failure while saving says some results may be missing; after a saved unit, that it was saved', () => {
  assert.equal(failureLine(false), 'The check stopped and nothing was recorded.');
  assert.equal(failureLine(false, false), 'The check stopped and nothing was recorded.');
  assert.equal(failureLine(true), 'Some results may not have been saved. Check your progress on Today.');
  assert.equal(failureLine(true, true), 'Some results may not have been saved. Check your progress on Today.', 'a save in progress is the message that matters');
  assert.equal(failureLine(false, true), 'The check stopped. The units checked before it were saved.', 'the placement chain: a later unit stopped, the earlier ones are kept');
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

test('onboardingSettings keeps the other settings, trims and caps the name, sets the theme and marks the learner onboarded', () => {
  assert.deepEqual(onboardingSettings(DEFAULT_APP_SETTINGS, { name: '  Ana ', theme: 'dark' }), { ...DEFAULT_APP_SETTINGS, name: 'Ana', theme: 'dark', onboarded: true });
  assert.deepEqual(onboardingSettings({ ...DEFAULT_APP_SETTINGS, dailyMinutes: 15, mute: true }, { name: '', theme: 'system' }),
    { ...DEFAULT_APP_SETTINGS, dailyMinutes: 15, mute: true, name: '', theme: 'system', onboarded: true });
  assert.equal(onboardingSettings(DEFAULT_APP_SETTINGS, { name: 'a'.repeat(50), theme: 'light' }).name.length, 40);
});

test('onboarding has three steps and never asks when you will practise', () => {
  const container = /** @type {any} */ (document.createElement('main'));
  renderOnboarding(container, /** @type {any} */ ({ adapter: {}, state: { settings: { ...DEFAULT_APP_SETTINGS } } }));
  /** @type {string[]} */
  const seen = [];
  for (let step = 1; step <= 3; step += 1) {
    seen.push(container.querySelector('.eyebrow').textContent);
    assert.equal(elements(container).some((el) => el.textContent === 'When will you practise?' || el.textContent === 'I practise …'), false, `step ${step}`);
    if (step < 3) container.querySelector('.onboarding-step').dispatch('submit');
  }
  assert.deepEqual(seen, ['1 of 3', '2 of 3', '3 of 3']);
  assert.ok(elements(container).some((el) => el.tagName === 'H1' && el.textContent === 'Add to home screen'));
});

test('onboarding: a refused save says so, offers the buttons again and keeps the learner where they are; a second try goes on', async (t) => {
  /** @type {string[]} */
  const visited = [];
  Object.defineProperty(globalThis, 'location', {
    value: { hash: '', replace: (/** @type {string} */ hash) => { visited.push(hash); } }, configurable: true, writable: true,
  });
  t.after(() => { delete (/** @type {Record<string, unknown>} */ (globalThis)).location; });
  const errors = t.mock.method(console, 'error', () => {});
  /** @type {{ resolve: () => void, reject: (error: Error) => void }[]} */
  const writes = [];
  const adapter = { put: () => new Promise((resolve, reject) => { writes.push({ resolve: () => resolve(undefined), reject }); }) };
  const app = /** @type {any} */ ({ adapter, state: { settings: { ...DEFAULT_APP_SETTINGS } } });
  const container = /** @type {any} */ (document.createElement('main'));
  renderOnboarding(container, app);
  for (let step = 1; step < 3; step += 1) container.querySelector('.onboarding-step').dispatch('submit');
  assert.equal(container.querySelector('.eyebrow').textContent, '3 of 3');
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
  assert.equal(errors.mock.callCount(), 1, 'the refused save is logged, so a device test can see why');

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

test('the placement check takes its units from the content', () => {
  const unit = { id: 'u05', order: 5, title_sl: 'Dan in čas', title_en: 'Day and time', motif: 'sun', lessons: ['u05-l01'] };
  const lesson = { id: 'u05-l01', unit: 'u05', order: 1, title_sl: 'Moj dan', title_en: 'My day', rules: [], structured: [], production: [],
    items: [{ id: 'u05-l01-i01', type: 'word', sl: 'zjutraj', en: 'in the morning', register: 'neutral', examples: [],
      verification: { review1: 'accepted', review2: 'accepted', native: null, status: 'accepted' } }] };
  /** Renders the placement check over a course whose index lists `units`. @param {any[]} units */
  const placement = (units) => {
    const container = /** @type {any} */ (document.createElement('main'));
    renderCheckpoint(container, /** @type {any} */ ({
      index: { units, rules: [] }, units: [{ unit, lessons: [lesson] }], known: new Set(['u05-l01-i01']), allowPending: false,
      state: { items: {}, sessions: [], settings: { ...DEFAULT_APP_SETTINGS }, meta: { schemaVersion: 1, createdAt: 0 } },
    }), { placement: '1' });
    return container;
  };
  const placed = placement([unit]);
  assert.ok(placed.querySelector('.checkpoint-intro'), 'the first unit of the content starts the chain, whatever its id');
  assert.equal(elements(placed).some((e) => e.textContent === 'Checkpoint not found'), false);
  const empty = placement([]);
  assert.equal(empty.querySelector('.checkpoint-intro'), null);
  assert.ok(elements(empty).some((e) => e.tagName === 'H1' && e.textContent === 'Checkpoint not found'), 'an empty chain reaches the not-found card');
});

const SUN = { id: 'u05', order: 5, title_sl: 'Dan in čas', title_en: 'Day and time', motif: 'sun', level: 'A1', lessonCount: 5, lessons: ['u05-l01'] };
const MORNING = { id: 'u05-l01', unit: 'u05', order: 1, title_sl: 'Moj dan', title_en: 'My day', rules: [], structured: [], production: [],
  items: [{ id: 'u05-l01-i01', type: 'word', sl: 'zjutraj', en: 'in the morning', register: 'neutral', examples: [],
    verification: { review1: 'accepted', review2: 'accepted', native: null, status: 'accepted' } }] };
/** Runs the u05 checkpoint, one item answered with `answer`, to its end card. @param {string} answer */
async function unitCheckEnd(answer) {
  const app = /** @type {any} */ ({
    adapter: createMemoryStore(), index: { units: [SUN], rules: [] }, units: [{ unit: SUN, lessons: [MORNING] }],
    known: new Set(['u05-l01-i01']), allowPending: false,
    state: { items: {}, sessions: [], settings: { ...DEFAULT_APP_SETTINGS }, meta: { schemaVersion: 1, createdAt: 0 } },
  });
  const container = /** @type {any} */ (document.createElement('main'));
  renderCheckpoint(container, app, { unit: 'u05' });
  container.querySelector('.checkpoint-intro').dispatch('submit');
  container.querySelector('input').value = answer;
  container.querySelector('.answer-form').dispatch('submit');
  elements(container).find((e) => e.tagName === 'BUTTON' && e.textContent === 'Continue').dispatch('click');
  await new Promise((resolve) => setTimeout(resolve, 5));
  return container;
}

test("a passed unit checkpoint's end card paints the unit's strip with its motif, a failed one draws no strip", async () => {
  const passed = await unitCheckEnd('zjutraj');
  assert.ok(elements(passed).some((e) => e.textContent === 'Passed. The unit is sealed in your hive.'));
  const strip = elements(passed.querySelector('.checkpoint-seal')).find((e) => e.tagName === 'svg');
  assert.equal(strip.getAttribute('class'), 'hive hive-strip-large');
  assert.equal(withClass(strip, 'hive-seal').length, 2, 'the board under the cells and the motifs over them');
  assert.equal(elements(strip).filter((e) => e.tagName === 'use' && e.getAttribute('class') === 'hive-motif motif-sun').length, 5, 'one motif per cell of the unit');
  const failed = await unitCheckEnd('zvečer');
  assert.ok(elements(failed).some((e) => e.textContent === 'Not yet. Keep practising and take it again when you are ready.'));
  assert.equal(failed.querySelector('.checkpoint-seal'), null);
});

test("the pass card's strip is filled from the states the check left", async () => {
  const passed = await unitCheckEnd('zjutraj');
  const [cell] = withClass(passed.querySelector('.checkpoint-seal'), 'hive-cell');
  assert.equal(cell.getAttribute('class'), 'hive-cell is-learned', 'the item the check passed is recallable now, so its lesson is learned');
});
