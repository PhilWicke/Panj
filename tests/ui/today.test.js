// tests/ui/today.test.js
// The Today screen's pure parts and the two components it is built from: the greeting by the hour,
// the primary action's text from the planned session, the four-weeks rule that retires the
// intention line, the week calendar (Ruling 25: active days in honey, grace as text, a fresh start
// instead of a loss message, honey as a quiet line) and the closing menu. Through
// tests/helpers/fake-dom.js, the screen on a course without lessons says the first lessons are
// still being checked and shows no primary action and no strip, a course with lessons and nothing
// due keeps the disabled action, and the current unit's strip sits under the primary action with
// the current lesson's cell marked, linking to the Hive. The rest of the screen runs in the
// browser check.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom } from '../helpers/fake-dom.js';
import { createState, skipAheadState } from '../../app/js/engine/scheduler.js';
import { weekSummary } from '../../app/js/engine/progress.js';
import { DEFAULT_APP_SETTINGS } from '../../app/js/store/state.js';
import { greetingFor, primaryAction, habitHolds, renderToday } from '../../app/js/ui/screens/today.js';
import { calendarLine, honeyInWeek, renderCalendar } from '../../app/js/ui/components/calendar.js';
import { renderMenu } from '../../app/js/ui/components/menu.js';

const TZ = 'Europe/Berlin';
const MINUTE = 60_000;
const HOUR = 3_600_000;
/** An instant of January 2026 in Berlin (UTC+1), as epoch ms; days past 31 run into February. */
const berlin = (day, hour, minute = 0) => Date.UTC(2026, 0, day, hour, minute) - HOUR;
/** A session record of `minutes` minutes started at `startedAt`, with `honey` correct recalls. */
const session = (startedAt, minutes = 10, honey = 5) => ({
  id: `s-${startedAt}`, startedAt, endedAt: startedAt + minutes * MINUTE, minutes, recalls: 8, correct: honey, newItems: 0, honey, kinds: { typed_en_sl: 8 },
});
/** The sessions of the week that starts on `monday` (a January day number), one per weekday index in `days`. */
const weekOf = (monday, days) => days.map((d) => session(berlin(monday + d, 8)));

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

/** @param {any} root @param {string} className */
const withClass = (root, className) => elements(root).filter((e) => e.classList.contains(className));

test('greetingFor: Dobro jutro before 10, Dober dan until 18, Dober večer after', () => {
  for (const hour of [0, 5, 9]) assert.equal(greetingFor(hour), 'Dobro jutro', `hour ${hour}`);
  for (const hour of [10, 13, 17]) assert.equal(greetingFor(hour), 'Dober dan', `hour ${hour}`);
  for (const hour of [18, 21, 23]) assert.equal(greetingFor(hour), 'Dober večer', `hour ${hour}`);
});

test('primaryAction names the reviews, new items and minutes of the planned session, or says nothing is due', () => {
  const entry = { kind: 'typed_en_sl', itemId: 'u01-l01-i01' };
  assert.deepEqual(primaryAction({ queue: [entry], reviewCount: 12, newCount: 7, estimatedMinutes: 8.4 }),
    { text: "Start today's session: 12 reviews, 7 new, about 8 min", enabled: true });
  assert.equal(primaryAction({ queue: [entry], reviewCount: 1, newCount: 0, estimatedMinutes: 0.25 }).text,
    "Start today's session: 1 review, 0 new, about 1 min", 'one review is singular and the estimate is at least a minute');
  assert.equal(primaryAction({ queue: [entry], reviewCount: 0, newCount: 7, estimatedMinutes: 5.5 }).text,
    "Start today's session: 0 reviews, 7 new, about 6 min");
  assert.deepEqual(primaryAction({ queue: [], reviewCount: 0, newCount: 0, estimatedMinutes: 0 }), { text: 'Nothing due right now', enabled: false });
});

test('habitHolds once the week target was met in each of the four past weeks', () => {
  // the weeks of 5, 12, 19 and 26 January 2026, seen from Monday 2 February
  const four = [...weekOf(5, [0, 1, 2, 3, 4]), ...weekOf(12, [0, 1, 2, 3, 4, 5]), ...weekOf(19, [0, 2, 3, 4, 5]), ...weekOf(26, [0, 1, 2, 3, 4])];
  const february2 = berlin(33, 10);
  assert.equal(habitHolds(four, february2, TZ), true);
  assert.equal(habitHolds(four.slice(5), february2, TZ), false, 'the week of 5 January is empty');
  assert.equal(habitHolds([], february2, TZ), false);
  const grace = [...weekOf(5, [0, 1, 2, 3]), ...four.slice(5)];
  assert.equal(habitHolds(grace, february2, TZ), true, 'a week met by the grace day counts as met');
  const thin = [...weekOf(5, [0, 1, 2]), ...four.slice(5)];
  assert.equal(habitHolds(thin, february2, TZ), false, 'three days do not meet it');
  assert.equal(habitHolds([...four, ...weekOf(33, [0])], february2, TZ), true, 'the current week is not counted yet');
  assert.equal(habitHolds(four, berlin(40, 10), TZ), false, 'a week later, the empty week of 2 February counts and the week of 5 January has dropped out');
});

test('habitHolds steps back by calendar weeks, so the October clock change never counts one week twice', () => {
  /** An instant of autumn 2026 in Berlin: summer time (UTC+2) until 03:00 on Sunday 25 October, winter time (UTC+1) after. */
  const autumn = (/** @type {number} */ month, /** @type {number} */ day, /** @type {number} */ hour, minute = 0) => {
    const summer = month < 10 || (month === 10 && (day < 25 || (day === 25 && hour < 3)));
    return Date.UTC(2026, month - 1, day, hour, minute) - (summer ? 2 : 1) * HOUR;
  };
  /** Five sessions, Monday to Friday, of the week from the Monday `month`/`day`. */
  const fullWeek = (/** @type {number} */ month, /** @type {number} */ day) => [0, 1, 2, 3, 4].map((d) => session(autumn(month, day + d, 8)));
  // Sunday 1 November at 23:30, winter time: the four weeks before this one start on 19, 12 and 5 October and 28 September.
  // Four times 168 hours back cross the change and land an hour later on the wall clock, Monday 00:30 from the second
  // week on, so counting by hours would look at the week of 19 October twice and never at the week of 28 September.
  const sunday = autumn(11, 1, 23, 30);
  const october = [...fullWeek(10, 19), ...fullWeek(10, 12), ...fullWeek(10, 5)];
  assert.equal(habitHolds(october, sunday, TZ), false, 'the week of 28 September is empty');
  assert.equal(habitHolds([...october, ...fullWeek(9, 28)], sunday, TZ), true, 'with it met, all four weeks are');
  assert.equal(habitHolds([...fullWeek(10, 19), ...fullWeek(10, 5), ...fullWeek(9, 28)], sunday, TZ), false, 'the week of 12 October is empty');
});

test('calendarLine: the week status, never a loss message', () => {
  const sessions = [5, 6, 8, 10].map((d) => session(berlin(d, 8)));   // Mon Tue Thu Sat
  assert.equal(calendarLine(weekSummary(sessions, berlin(10, 20), 5, TZ)), '4 of 5 days this week', 'Saturday evening with Sunday to come');
  assert.equal(calendarLine(weekSummary([...sessions, session(berlin(11, 9))], berlin(11, 20), 5, TZ)), '5 of 5 days this week');
  assert.equal(calendarLine(weekSummary(sessions, berlin(12, 12), 5, TZ, berlin(7, 12))), '4 of 5 days, with the grace day', 'the week is over with four days');
  assert.equal(calendarLine(weekSummary(sessions.slice(0, 2), berlin(11, 20), 5, TZ)), 'Fresh start on Monday', 'two days on Sunday evening cannot reach four');
  assert.equal(calendarLine(weekSummary(sessions.slice(0, 2), berlin(10, 20), 5, TZ)), '2 of 5 days this week', 'two days with the weekend left can still reach four');
  assert.equal(calendarLine(weekSummary([], berlin(7, 12), 5, TZ)), '0 of 5 days this week');
  assert.equal(calendarLine(weekSummary([5, 6, 7, 8, 9, 10, 11].map((d) => session(berlin(d, 8))), berlin(11, 20), 5, TZ)), '5 of 5 days this week, and 2 more');
  assert.equal(calendarLine(weekSummary([5, 6, 7, 8, 9, 10].map((d) => session(berlin(d, 8))), berlin(11, 20), 5, TZ)), '5 of 5 days this week, and 1 more');
});

test('honeyInWeek sums the honey of the sessions that started in the week', () => {
  const week = weekSummary([], berlin(7, 12), 5, TZ);
  const sessions = [session(berlin(4, 23, 30), 10, 3), session(berlin(5, 8), 10, 4), session(berlin(8, 22), 10, 6), session(berlin(12, 0, 30), 10, 9)];
  assert.equal(honeyInWeek(sessions, week, TZ), 10, 'Sunday night before and Monday night after the week are left out');
  assert.equal(honeyInWeek([], week, TZ), 0);
});

test('renderCalendar draws seven day squares, active days in honey, today marked, with the status line and the honey line', () => {
  const sessions = [5, 6, 8].map((d) => session(berlin(d, 8), 10, 4));
  const summary = weekSummary(sessions, berlin(9, 12), 5, TZ);   // Friday noon
  const el = renderCalendar(summary, { todayDate: '2026-01-09', honey: 12 });
  const days = elements(el).filter((e) => e.classList.contains('calendar-day'));
  assert.equal(days.length, 7);
  /** The short weekday, hidden from assistive technology. @param {any} day */
  const shown = (day) => elements(day).find((e) => e.classList.contains('calendar-weekday'));
  /** The full label, visually hidden. @param {any} day */
  const label = (day) => elements(day).find((e) => e.classList.contains('visually-hidden')).textContent;
  assert.deepEqual(days.map((d) => shown(d).textContent), ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']);
  assert.ok(days.every((d) => shown(d).getAttribute('aria-hidden') === 'true'), 'the short weekday is decoration; the hidden label speaks');
  assert.deepEqual(days.map((d) => d.classList.contains('is-active')), [true, true, false, true, false, false, false]);
  assert.deepEqual(days.map((d) => d.classList.contains('is-today')), [false, false, false, false, true, false, false]);
  assert.deepEqual(days.map((d) => d.classList.contains('is-future')), [false, false, false, false, false, true, true]);
  assert.equal(label(days[0]), 'Monday, practised');
  assert.equal(label(days[2]), 'Wednesday');
  assert.equal(label(days[4]), 'Friday, today');
  const lines = elements(el).filter((e) => e.tagName === 'P').map((e) => e.textContent);
  assert.deepEqual(lines, ['3 of 5 days this week', '12 honey this week']);
  const quiet = renderCalendar(summary);
  assert.deepEqual(elements(quiet).filter((e) => e.tagName === 'P').map((e) => e.textContent), ['3 of 5 days this week'], 'no honey line without honey, no day marked today');
  assert.ok(elements(quiet).filter((e) => e.classList.contains('calendar-day')).every((d) => !d.classList.contains('is-today')));
  const activeToday = renderCalendar(weekSummary([...sessions, session(berlin(9, 8))], berlin(9, 12), 5, TZ), { todayDate: '2026-01-09', honey: 1 });
  assert.equal(label(elements(activeToday).filter((e) => e.classList.contains('calendar-day'))[4]), 'Friday, today, practised');
  assert.deepEqual(elements(activeToday).filter((e) => e.tagName === 'P').map((e) => e.textContent), ['4 of 5 days this week', '1 honey this week']);
});

const FIXTURE = new URL('../../tools/fixtures/content-valid/', import.meta.url);
/** @param {string} path */
const fixture = (path) => JSON.parse(readFileSync(new URL(path, FIXTURE), 'utf8'));

/**
 * The app the Today screen is drawn from: the bundle given, every item known, a dev build.
 * @param {{ index: any, units: any[], states: Record<string, any> }} parts
 */
function todayApp({ index, units, states }) {
  return /** @type {any} */ ({
    persistent: true, allowPending: true, index, units, known: new Set(Object.keys(states)),
    state: { settings: { ...DEFAULT_APP_SETTINGS, onboarded: true }, items: states, sessions: [], flags: [], meta: { schemaVersion: 1, createdAt: Date.now() } },
    player: { play: async () => 'none' },
  });
}

test('Today on a course without lessons says the first lessons are still being checked and shows no primary action', () => {
  const index = { version: 't', mode: 'strict', generated: '', units: [], rules: [], lessonIndex: [], counts: { scheduledItems: 0, lemmasMet: 0 } };
  const container = /** @type {any} */ (document.createElement('main'));
  renderToday(container, todayApp({ index, units: [], states: {} }));
  const all = elements(container);
  const heading = all.find((el) => el.tagName === 'H2' && el.textContent === 'Nothing to practise yet');
  assert.ok(heading, 'the heading says nothing can be practised yet');
  assert.ok(all.some((el) => el.tagName === 'P' && el.textContent === 'The first lessons are still being checked. Come back when they are released.'), 'the line under it');
  assert.equal(all.some((el) => el.classList.contains('btn-session')), false, 'no primary action');
  assert.equal(all.some((el) => el.textContent === 'Come back later today or tomorrow.'), false, 'not the nothing-due line');
  assert.ok(all.some((el) => el.tagName === 'H1'), 'the greeting is still there');
  assert.equal(all.some((el) => el.classList.contains('today-strip')), false, 'no strip without lessons');
});

test('Today with lessons and nothing due keeps the disabled primary action and its line', () => {
  const [unit] = fixture('units.json');
  const lesson = fixture('lessons/u01-l01.json');
  const index = {
    version: 't', mode: 'dev', generated: '', units: [unit], rules: [],
    lessonIndex: [{ id: lesson.id, unit: unit.id, order: lesson.order, title_sl: lesson.title_sl, title_en: lesson.title_en, itemCount: lesson.items.length }],
    counts: { scheduledItems: lesson.items.length, lemmasMet: 0 },
  };
  // every item met and in review, none due: nothing to start
  const states = Object.fromEntries(lesson.items.map((/** @type {any} */ item) => [item.id, skipAheadState(item.id, Date.now())]));
  const container = /** @type {any} */ (document.createElement('main'));
  renderToday(container, todayApp({ index, units: [{ unit, lessons: [lesson] }], states }));
  const all = elements(container);
  const action = all.find((el) => el.classList.contains('btn-session'));
  assert.ok(action, 'the primary action is shown');
  assert.equal(action.textContent, 'Nothing due right now');
  assert.equal(action.getAttribute('aria-disabled'), 'true');
  assert.ok(all.some((el) => el.textContent === 'Come back later today or tomorrow.'));
  assert.equal(all.some((el) => el.textContent === 'Nothing to practise yet'), false);
});

/** @param {string} id @param {string} sl @param {string} en */
const stripItem = (id, sl, en) => ({
  id, type: 'chunk', sl, en, register: 'neutral', examples: [],
  verification: { review1: 'accepted', review2: 'accepted', native: null, status: 'accepted' },
});
const STRIP_UNIT = { id: 'u01', order: 1, title_sl: 'Prvi stik', title_en: 'First contact', motif: 'flower', lessonCount: 5, lessons: ['u01-l01'] };
const STRIP_LESSON = {
  id: 'u01-l01', unit: 'u01', order: 1, title_sl: 'Prvi pozdrav', title_en: 'First hello', rules: [], structured: [], production: [],
  items: [stripItem('u01-l01-i01', 'Dober dan.', 'Good day.'), stripItem('u01-l01-i02', 'Hvala.', 'Thank you.')],
};

test("Today draws the current unit's strip under the primary action, the current cell marked, linking to the hive", () => {
  const index = {
    version: 't', mode: 'dev', generated: '', units: [STRIP_UNIT], rules: [], counts: { scheduledItems: 2, lemmasMet: 3 },
    lessonIndex: [{ id: STRIP_LESSON.id, unit: 'u01', order: 1, title_sl: STRIP_LESSON.title_sl, title_en: STRIP_LESSON.title_en, itemCount: 2 }],
  };
  // both items new: the lesson is the current one and the session would meet them
  const states = Object.fromEntries(STRIP_LESSON.items.map((entry) => [entry.id, createState(entry.id, Date.now())]));
  const container = /** @type {any} */ (document.createElement('main'));
  renderToday(container, todayApp({ index, units: [{ unit: STRIP_UNIT, lessons: [STRIP_LESSON] }], states }));
  const all = elements(container);
  const link = all.find((el) => el.tagName === 'A' && el.classList.contains('today-strip'));
  assert.ok(link);
  assert.equal(link.getAttribute('href'), '#/hive');
  assert.equal(link.getAttribute('aria-label'), 'Unit 1, Prvi stik. Open the hive');
  assert.ok(all.indexOf(link) > all.indexOf(all.find((el) => el.classList.contains('actions-stack'))), 'under the primary action');
  assert.equal(withClass(link, 'hive-cell').length, 5);
  assert.equal(withClass(link, 'is-current').length, 1);
  assert.equal(all.some((el) => el.textContent === 'Your hive'), false, 'the full hive has left Today');
});

test('renderMenu offers the closing options in order with their labels, the first as the primary action, and reports the pick', () => {
  /** @type {string[]} */
  const picks = [];
  const menu = renderMenu(['stop', 'more3', 'speaking', 'continue'], (option) => { picks.push(option); });
  const buttons = elements(menu).filter((e) => e.tagName === 'BUTTON');
  assert.deepEqual(buttons.map((b) => b.textContent), ['Stop here', 'Three more minutes', 'A speaking round', 'Continue the lesson']);
  assert.deepEqual(buttons.map((b) => b.className), ['btn btn-primary', 'btn btn-secondary', 'btn btn-secondary', 'btn btn-secondary']);
  assert.ok(buttons.every((b) => b.getAttribute('type') === 'button'));
  buttons[2].dispatch('click');
  buttons[0].dispatch('click');
  assert.deepEqual(picks, ['speaking', 'stop']);
  assert.deepEqual(elements(renderMenu(['stop'], () => {})).map((b) => b.textContent), ['Stop here']);
});
