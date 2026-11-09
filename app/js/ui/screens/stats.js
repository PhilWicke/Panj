// The Stats screen (spec 6), reached from Settings: six sections, each a heading and one quiet line
// that says what it counts. Recall accuracy per week over the last twelve local weeks (Monday to
// Sunday, the weeks weekSummary counts), the hours practised against the hours an A1 course takes,
// the items in each phase, the weekly checks' predictions against their results, this week's
// honey, and the exercises done per kind (SessionRecord.kinds, Ruling 43). Counts, not scores.
// The pure parts and the hours meter are exported for the tests.

import { h, mount } from '../../util/dom.js';
import { onlyKnown } from '../../content/loader.js';
import { a1Hours, hoursPracticed, weekSummary } from '../../engine/progress.js';
import { daysBetween, localDateKey } from '../../util/time.js';
import { isRuleId } from '../../util/ids.js';
import { honeyInWeek } from '../components/calendar.js';

/** @typedef {import('../../app-types.js').App} App */
/** @typedef {import('../../engine/progress.js').SessionRecord} SessionRecord */
/** @typedef {import('../../engine/scheduler.js').ItemState} ItemState */
/** @typedef {import('../../store/state.js').Meta} Meta */
/** @typedef {{ start: string, recalls: number, correct: number, pct: number|null }} WeekAccuracy start is the Monday, `YYYY-MM-DD`; pct is the rounded percent, null without recalls */
/** @typedef {{ learning: number, review: number, lapsed: number, mastered: number }} PhaseCounts */
/** @typedef {{ kind: string, label: string, count: number }} KindCount */

const WEEKS = 12;
const DAYS_PER_WEEK = 7;
const DAY_MS = 86_400_000;
/** Active days per week, the target Today's calendar shows. */
const WEEK_TARGET = 5;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** The kinds a SessionRecord counts, in the order Stats lists them, with their plain names. */
const KINDS = /** @type {const} */ ([
  ['meet', 'Met'],
  ['typed_en_sl', 'Typed recall'],
  ['typed_sl_en', 'Meaning recall'],
  ['structured', 'Choose the form'],
  ['slot', 'Change the phrase'],
  ['dialogue', 'Dialogues'],
  ['listening', 'Listening'],
  ['speaking', 'Speaking'],
  ['perception', 'Hearing drills'],
  ['rule', 'Rule cards'],
  ['fluency', 'Quick rounds'],
  ['checkpoint', 'Checkpoints'],
  ['weekly', 'Weekly checks'],
]);

/**
 * A date key as day and short month, "3 Nov".
 * @param {string} key `YYYY-MM-DD`
 * @returns {string}
 */
export function shortDate(key) {
  const [, month, day] = key.split('-').map(Number);
  return `${day} ${MONTHS[month - 1]}`;
}

/**
 * Recall accuracy per week for the last twelve weeks, oldest first, this week last. The weeks are
 * the learner's local weeks from Monday, the ones weekSummary counts: this week's Monday comes from
 * weekSummary, the earlier Mondays are whole weeks before it on the calendar (date keys, so a clock
 * change never moves a week), and a session counts for the week of the local day it started on.
 * @param {SessionRecord[]} sessions
 * @param {number} now epoch ms
 * @param {string} [tz] IANA zone, for tests; the phone's zone when omitted
 * @returns {WeekAccuracy[]}
 */
export function weeklyAccuracy(sessions, now, tz) {
  const monday = Date.parse(`${weekSummary([], now, WEEK_TARGET, tz).weekStart}T00:00:00Z`);
  /** @type {WeekAccuracy[]} */
  const weeks = Array.from({ length: WEEKS }, (_, i) => ({
    start: new Date(monday - (WEEKS - 1 - i) * DAYS_PER_WEEK * DAY_MS).toISOString().slice(0, 10),
    recalls: 0,
    correct: 0,
    pct: null,
  }));
  for (const session of sessions) {
    const days = daysBetween(weeks[0].start, localDateKey(session.startedAt, tz));
    if (days < 0 || days >= WEEKS * DAYS_PER_WEEK) continue;
    const week = weeks[Math.floor(days / DAYS_PER_WEEK)];
    week.recalls += session.recalls;
    week.correct += session.correct;
  }
  for (const week of weeks) week.pct = week.recalls === 0 ? null : Math.round((100 * week.correct) / week.recalls);
  return weeks;
}

/**
 * The items past `new` by phase. A mastered item counts once, under mastered, whatever its phase;
 * rule cards share the states and are left out.
 * @param {Record<string, ItemState>} states by id
 * @returns {PhaseCounts}
 */
export function phaseCounts(states) {
  /** @type {PhaseCounts} */
  const counts = { learning: 0, review: 0, lapsed: 0, mastered: 0 };
  for (const [id, state] of Object.entries(states)) {
    if (isRuleId(id) || state.phase === 'new') continue;
    counts[state.mastered ? 'mastered' : state.phase] += 1;
  }
  return counts;
}

/**
 * The weekly checks, newest first: "3 Nov: predicted 14, got 16 of 18".
 * @param {Meta['weeklyChecks']} checks in the order they were taken
 * @returns {string[]}
 */
export function calibrationLines(checks) {
  return (checks ?? []).map((check) => `${shortDate(check.at)}: predicted ${check.predicted}, got ${check.correct} of ${check.total}`).reverse();
}

/**
 * The exercises done per kind over all sessions, in the order of KINDS; kinds never done are left out.
 * @param {SessionRecord[]} sessions
 * @returns {KindCount[]}
 */
export function practiceByKind(sessions) {
  /** @type {Map<string, number>} */
  const totals = new Map();
  for (const session of sessions) {
    for (const [kind, count] of Object.entries(session.kinds ?? {})) totals.set(kind, (totals.get(kind) ?? 0) + count);
  }
  return KINDS.map(([kind, label]) => ({ kind, label, count: totals.get(kind) ?? 0 })).filter((entry) => entry.count > 0);
}

/**
 * One section: its heading, the quiet line that says what it counts, and its body.
 * @param {string} id
 * @param {string} title
 * @param {string} line
 * @param {...import('../../util/dom.js').Child} body
 * @returns {HTMLElement}
 */
function section(id, title, line, ...body) {
  return h('section', { class: 'stats-section', 'aria-labelledby': id },
    h('h2', { class: 'section-title', id }, title),
    h('p', { class: 'quiet' }, line),
    ...body);
}

/**
 * @param {WeekAccuracy[]} weeks
 * @returns {HTMLElement}
 */
function accuracyBars(weeks) {
  return h('ol', { class: 'bar-list' }, weeks.map((week) => h('li', { class: 'bar-row' },
    h('span', { class: 'bar-label' }, h('span', { class: 'visually-hidden' }, 'Week of '), shortDate(week.start)),
    h('span', { class: 'bar', 'aria-hidden': 'true' }, h('span', { class: 'bar-fill', style: { width: `${week.pct ?? 0}%` } })),
    h('span', { class: 'bar-value' }, week.pct === null ? 'no practice' : `${week.pct}% of ${week.recalls}`))));
}

/**
 * The hours practised on a meter whose end is the longest A1 course, with the shortest marked;
 * assistive technology gets the hours to one decimal, as the line under it shows them.
 * @param {number} hours
 * @returns {HTMLElement}
 */
export function hoursMeter(hours) {
  const percent = Math.min(100, (hours / a1Hours.max) * 100);
  const now = Math.round(Math.min(hours, a1Hours.max) * 10) / 10;
  return h('div', {
    class: 'meter hours-meter', role: 'meter', 'aria-label': 'Hours practised',
    'aria-valuemin': '0', 'aria-valuemax': String(a1Hours.max), 'aria-valuenow': String(now),
    'aria-valuetext': `${hours.toFixed(1)} hours`,
  },
  h('div', { class: 'meter-fill', style: { width: `${percent}%` } }),
  h('span', { class: 'meter-mark', style: { left: `${(a1Hours.min / a1Hours.max) * 100}%` } }));
}

/**
 * @param {HTMLElement} container
 * @param {App} app
 */
export function renderStats(container, app) {
  const now = Date.now();
  const sessions = app.state.sessions;
  const hours = hoursPracticed(sessions);
  const phases = phaseCounts(onlyKnown(app.state.items, app.known));
  const checks = calibrationLines(app.state.meta.weeklyChecks);
  const honey = honeyInWeek(sessions, weekSummary(sessions, now, WEEK_TARGET));
  const kinds = practiceByKind(sessions);

  mount(container, h('section', { class: 'screen screen-stats' },
    h('p', { class: 'back' }, h('a', { class: 'back-link', href: '#/settings' }, 'Back to settings')),
    h('h1', { class: 'screen-title' }, 'Your statistics'),
    section('stats-accuracy', 'Recall accuracy', 'Right answers out of all recalls, week by week, for the last twelve weeks.',
      accuracyBars(weeklyAccuracy(sessions, now))),
    section('stats-hours', 'Hours practised', 'Time spent in sessions, against the length of an A1 course.',
      hoursMeter(hours),
      h('p', { class: 'stats-line' }, `${hours.toFixed(1)} of the ${a1Hours.min} to ${a1Hours.max} hours a typical A1 course takes`)),
    section('stats-phases', 'Items by phase', 'The items you have met, by where they stand. A mastered item counts once.',
      h('dl', { class: 'glance' },
        [['Learning', phases.learning], ['Review', phases.review], ['Lapsed', phases.lapsed], ['Mastered', phases.mastered]].map(([term, count]) =>
          h('div', { class: 'glance-item' }, h('dt', { class: 'glance-term' }, term), h('dd', { class: 'glance-value' }, count))))),
    section('stats-calibration', 'Calibration', 'Your prediction before each weekly check, against the result.',
      checks.length === 0
        ? h('p', { class: 'en-text' }, 'Your first weekly check shows here.')
        : h('ul', { class: 'stats-list' }, checks.map((line) => h('li', null, line)))),
    section('stats-honey', 'Honey this week', 'One honey for each correct recall. It counts, it buys nothing.',
      h('p', { class: 'stats-value' }, `${honey} honey`)),
    section('stats-kinds', 'Practice by kind', 'The exercises you have done, by kind, over all your sessions.',
      kinds.length === 0
        ? h('p', { class: 'en-text' }, 'Your exercises show here after your first session.')
        : h('dl', { class: 'stats-kinds' }, kinds.map(({ label, count }) =>
          h('div', { class: 'stats-kind' }, h('dt', null, label), h('dd', null, count)))))));
}
