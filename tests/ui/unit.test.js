// tests/ui/unit.test.js
// The unit page through tests/helpers/fake-dom.js, with a stand-in service worker: the header is
// the unit's strip drawn large with the lesson titles under its cells, a button per bundled lesson
// and a label per missing one, both opening the lesson's sheet; the due line counts the unit's
// reviews that are due, so a sealed unit that drained keeps its paint and says what is due; the
// sheet shows the lesson's title, state, items with Listen (none when muted) and rule cards, and
// nothing in it starts practice; a lesson id the unit lacks opens no sheet, and a unit without
// bundled lessons keeps its line. The date a checkpoint sealed the unit reads in English; "Keep
// offline" posts its message and listens for the reply, which it stops doing when the learner
// leaves the page (renderUnit's leave function, called by main.js) or after 60 seconds, when a
// still-busy button becomes "Keep offline" again with a quiet line; a reply in time ends the wait.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom } from '../helpers/fake-dom.js';
import { elements, withClass } from '../helpers/dom-query.js';
import { acceptedChunk } from '../helpers/items.js';
import { DEFAULT_APP_SETTINGS } from '../../app/js/store/state.js';
import { skipAheadState } from '../../app/js/engine/scheduler.js';
import { renderUnit, sheetStateLine, dueLine } from '../../app/js/ui/screens/unit.js';

/** @typedef {import('../../app/js/content/types.js').Lesson} Lesson */

/** @type {Lesson} */
const lesson = JSON.parse(readFileSync(new URL('../../content/lessons/u01-l01.json', import.meta.url), 'utf8'));
const UNIT = { id: 'u01', order: 1, title_sl: 'Prvi stik', title_en: 'First contact', motif: 'flower', lessons: ['u01-l01'] };

/** A service worker container that records what the page posts and which reply listeners it holds. */
function worker() {
  /** @type {unknown[]} */
  const posted = [];
  /** @type {Set<Function>} */
  const listeners = new Set();
  const container = {
    controller: { postMessage: (/** @type {unknown} */ message) => posted.push(message) },
    addEventListener: (/** @type {string} */ type, /** @type {Function} */ listener) => { if (type === 'message') listeners.add(listener); },
    removeEventListener: (/** @type {string} */ type, /** @type {Function} */ listener) => { if (type === 'message') listeners.delete(listener); },
  };
  /** Sends a message to every listener, as the worker's postMessage does. @param {unknown} data */
  const reply = (data) => { for (const listener of [...listeners]) listener({ data }); };
  return { container, posted, listeners, reply };
}

/** @param {Record<string, string>} [sealed] */
const appWith = (sealed) => /** @type {any} */ ({
  index: { units: [UNIT] },
  units: [{ unit: UNIT, lessons: [lesson] }],
  known: new Set(lesson.items.map((item) => item.id)),
  allowPending: false,
  state: { items: {}, settings: { ...DEFAULT_APP_SETTINGS, voice: 'female' }, meta: { schemaVersion: 1, createdAt: 0, ...(sealed ? { sealed } : {}) } },
});

/** @param {any} root */
const keepButton = (root) => elements(root).find((el) => el.tagName === 'BUTTON' && el.classList.contains('btn-secondary'));
/** The quiet line under the buttons. @param {any} root */
const offlineLine = (root) => elements(root).filter((el) => el.tagName === 'P' && el.classList.contains('quiet')).at(-1);

const DAY = 86_400_000;

// The unit page's own fixture, inline: unit 5 of five cells, of which the bundle carries lesson 1
// with two accepted words and one rule card.
/** A word whose two reviews accepted it. @param {string} id @param {string} sl @param {string} en */
const it = (id, sl, en) => ({ ...acceptedChunk(id, sl, en), type: 'word' });
const L1 = { id: 'u05-l01', unit: 'u05', order: 1, title_sl: 'Moj dan', title_en: 'My day', items: [it('u05-l01-i01', 'zjutraj', 'in the morning'), it('u05-l01-i02', 'zvečer', 'in the evening')], rules: ['r-test'], structured: [], production: [] };
const U5 = { id: 'u05', order: 5, title_sl: 'Dan in čas', title_en: 'Day and time', motif: 'sun', level: 'A1', lessonCount: 5, lessons: ['u05-l01'] };
const RULE = { id: 'r-test', unit: 'u05', title_en: 'Times of day', card_en: 'Zjutraj and zvečer need no preposition.', example: { sl: 'Zjutraj pijem kavo.', en: 'In the morning I drink coffee.' }, quick_check: { prompt_sl: '_ pijem kavo.', options: ['Zjutraj', 'Zvečer'], answer: 'Zjutraj', explain_en: 'Morning.' } };
/** @param {{ mute?: boolean }} [opts] */
const appU5 = ({ mute = false } = {}) => /** @type {any} */ ({
  index: { units: [U5] }, units: [{ unit: U5, lessons: [L1] }], known: new Set(['u05-l01-i01', 'u05-l01-i02', 'r-test']),
  rules: new Map([['r-test', RULE]]), allowPending: false, player: { play: async (/** @type {string} */ t) => { played.push(t); return 'none'; } },
  state: { items: {}, settings: { ...DEFAULT_APP_SETTINGS, voice: 'female', mute }, meta: { schemaVersion: 1, createdAt: 0 } },
});

/** @type {ReturnType<typeof worker>} */
let sw;
/** The texts the stand-in player was asked to play. @type {string[]} */
const played = [];
/** @type {any} */
let container;

before(() => {
  installFakeDom();
});

beforeEach(() => {
  sw = worker();
  Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: sw.container }, configurable: true, writable: true });
  globalThis.location = /** @type {any} */ ({ hash: '', replace() {} });
  played.length = 0;
  container = document.createElement('main');
});

test('the unit header is the strip drawn large with a button per bundled lesson and a label per missing one', () => {
  renderUnit(container, appU5(), { id: 'u05' });
  const strip = elements(container).find((e) => e.tagName === 'svg' && e.getAttribute('class') === 'hive hive-strip-large');
  assert.equal(withClass(strip, 'hive-cell').length, 5);
  const items = elements(container.querySelector('.strip-titles')).filter((e) => e.tagName === 'LI');
  assert.deepEqual(items.map((li) => li.textContent), ['Moj dan', 'Lesson 2', 'Lesson 3', 'Lesson 4', 'Lesson 5']);
  const open = elements(items[0]).find((e) => e.tagName === 'BUTTON');
  assert.equal(open.getAttribute('aria-label'), 'Lesson 1, Moj dan, My day');
  assert.equal(items.slice(1).every((li) => !elements(li).some((e) => e.tagName === 'BUTTON')), true);
  open.dispatch('click');
  assert.equal(globalThis.location.hash, '#/unit?id=u05&lesson=u05-l01');
  assert.equal(container.querySelector('.lesson-sheet'), null, 'no sheet until a lesson is asked for');
});

test('the lesson sheet shows the title, the items with Listen, the rule cards and the state, and nothing to practise', () => {
  renderUnit(container, appU5(), { id: 'u05', lesson: 'u05-l01' });
  const sheet = container.querySelector('.lesson-sheet');
  const all = elements(sheet);
  assert.equal(all.find((e) => e.tagName === 'H2').textContent, 'Moj dan');
  assert.equal(sheet.querySelector('.sheet-state').textContent, 'Not started');
  assert.deepEqual(all.filter((e) => e.tagName === 'H3').map((e) => e.textContent), ['Words and phrases', 'Rule cards']);
  assert.ok(all.some((e) => e.textContent === 'Times of day') && all.some((e) => e.textContent === 'Zjutraj and zvečer need no preposition.'));
  const buttons = all.filter((e) => e.tagName === 'BUTTON');
  assert.deepEqual(buttons.map((b) => b.getAttribute('aria-label')), ['Listen to zjutraj', 'Listen to zvečer'], 'Listen is the only control');
  buttons[1].dispatch('click');
  assert.deepEqual(played, ['zvečer']);
  assert.ok(all.some((e) => e.textContent === 'Practice runs through Today, in course order.'));
  const close = all.find((e) => e.tagName === 'A' && e.textContent === 'Close');
  assert.equal(close.getAttribute('href'), '#/unit?id=u05');
  const muted = document.createElement('main');
  renderUnit(muted, appU5({ mute: true }), { id: 'u05', lesson: 'u05-l01' });
  assert.equal(elements(muted.querySelector('.lesson-sheet')).filter((e) => e.tagName === 'BUTTON').length, 0, 'no Listen when muted');
});

test('the lesson sheet is labelled by its heading, which takes the focus', () => {
  renderUnit(container, appU5(), { id: 'u05', lesson: 'u05-l01' });
  const sheet = container.querySelector('.lesson-sheet');
  const heading = elements(sheet).find((e) => e.tagName === 'H2');
  assert.equal(sheet.tagName, 'SECTION');
  assert.ok(heading.getAttribute('id'));
  assert.equal(sheet.getAttribute('aria-labelledby'), heading.getAttribute('id'));
  assert.equal(heading.getAttribute('tabindex'), '-1');
  assert.equal(document.activeElement, heading);
});

test('sheetStateLine words the three states', () => {
  assert.equal(sheetStateLine('not-started', 0), 'Not started');
  assert.equal(sheetStateLine('in-progress', 0.4), 'In progress, 40 percent recalled now');
  assert.equal(sheetStateLine('learned', 1), 'Learned');
});

test('a lesson id the unit does not have opens no sheet, and a unit without bundled lessons keeps its line', () => {
  renderUnit(container, appU5(), { id: 'u05', lesson: 'u09-l01' });
  assert.equal(container.querySelector('.lesson-sheet'), null);
  const empty = document.createElement('main');
  const app = appU5();
  app.units = [{ unit: { ...U5, lessons: [] }, lessons: [] }];
  renderUnit(empty, app, { id: 'u05' });
  assert.ok(elements(empty).some((e) => e.textContent === "This unit's lessons are not in the course yet."));
  assert.equal(empty.querySelector('.strip-titles'), null);
});

test('a sealed unit with due items keeps its seal and says how many are due', () => {
  assert.deepEqual([0, 1, 2].map(dueLine), ['Nothing due in this unit', '1 item due for review', '2 items due for review']);
  const app = appU5();
  app.state.meta.sealed = { u05: '2026-11-02' };
  // reviewed thirty days ago with a seven-day stability: due long since, and drained below the target
  const old = Date.now() - 30 * DAY;
  app.state.items = { 'u05-l01-i01': skipAheadState('u05-l01-i01', old), 'u05-l01-i02': skipAheadState('u05-l01-i02', old) };
  renderUnit(container, app, { id: 'u05' });
  const strip = elements(container).find((e) => e.tagName === 'svg' && e.getAttribute('class') === 'hive hive-strip-large');
  assert.equal(withClass(strip, 'hive-seal').length, 2, 'the paint stays, the board and the motifs');
  assert.equal(withClass(strip, 'hive-fill').length, 1, 'the honey shows on the board');
  assert.equal(container.querySelector('.unit-due').textContent, '2 items due for review');
  const fresh = document.createElement('main');
  renderUnit(fresh, appU5(), { id: 'u05' });
  assert.equal(fresh.querySelector('.unit-due').textContent, 'Nothing due in this unit');
});

test('the sealed date reads in English, day, month name and year', () => {
  renderUnit(container, appWith({ u01: '2026-11-02' }), { id: 'u01' });
  assert.ok(elements(container).some((el) => el.textContent === 'Checkpoint passed on 2 November 2026.'));
});

test('Keep offline stops listening for the reply when the learner leaves the page', () => {
  const leave = renderUnit(container, appWith(), { id: 'u01' });
  assert.equal(typeof leave, 'function', 'renderUnit returns its leave function');
  const button = keepButton(container);
  assert.equal(button.textContent, 'Keep offline');
  button.dispatch('click');
  assert.deepEqual(sw.posted, [{ type: 'cache-unit-audio', unitId: 'u01', voice: 'Kore' }]);
  assert.equal(button.getAttribute('aria-busy'), 'true');
  assert.equal(sw.listeners.size, 1);
  leave();
  assert.equal(sw.listeners.size, 0, 'the reply listener goes with the page');
  leave();
  assert.equal(sw.listeners.size, 0, 'leaving twice is nothing');
});

test('Keep offline gives up after 60 seconds: the button is offered again with a quiet line, and a late reply changes nothing', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const leave = renderUnit(container, appWith(), { id: 'u01' });
  const button = keepButton(container);
  button.dispatch('click');
  t.mock.timers.tick(59_999);
  assert.equal(button.textContent, 'Keeping offline…', 'still waiting just before the minute');
  t.mock.timers.tick(1);
  assert.equal(button.textContent, 'Keep offline');
  assert.equal(button.getAttribute('aria-busy'), null);
  assert.equal(offlineLine(container).textContent, 'That took too long. Try again.');
  assert.equal(offlineLine(container).hidden, false);
  assert.equal(sw.listeners.size, 0, 'nothing listens any more');
  sw.reply({ type: 'unit-audio-cached', unitId: 'u01', count: 3, total: 3 });
  assert.equal(button.textContent, 'Keep offline', 'a reply after the timeout is ignored');

  button.dispatch('click');
  assert.equal(sw.posted.length, 2, 'the learner can try again');
  assert.equal(button.textContent, 'Keeping offline…');
  leave();
});

test('Keep offline: a reply in time ends the wait, so the minute passing changes nothing', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  renderUnit(container, appWith(), { id: 'u01' });
  const button = keepButton(container);
  button.dispatch('click');
  sw.reply({ type: 'unit-audio-cached', unitId: 'u02', count: 0, total: 0 });
  assert.equal(button.textContent, 'Keeping offline…', 'another unit\'s reply is not this one');
  sw.reply({ type: 'unit-audio-cached', unitId: 'u01', count: 2, total: 3, error: 'assets/audio/x.mp3 answered 500' });
  assert.equal(button.textContent, 'Keep offline');
  assert.equal(offlineLine(container).textContent, '2 of 3 clips kept on this phone. The rest could not be fetched; try again later.');
  assert.equal(sw.listeners.size, 0);
  t.mock.timers.tick(60_000);
  assert.equal(offlineLine(container).textContent, '2 of 3 clips kept on this phone. The rest could not be fetched; try again later.');

  button.dispatch('click');
  sw.reply({ type: 'unit-audio-cached', unitId: 'u01', count: 3, total: 3 });
  assert.equal(button.textContent, 'Kept offline');
  assert.equal(offlineLine(container).textContent, '3 of 3 clips kept on this phone.');
});
