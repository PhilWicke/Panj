// Progress counters: pure functions over the item states (scheduler.js), the compiled content
// (content/types.js) and the session records the session screen appends. They feed the Today
// screen, the hive, the weekly calendar and the Stats and Words screens. Nothing here reads the
// clock or writes to its inputs, and the days are the learner's local days (util/time.js).
//
// Two counters are shown against the bundle's totals and count the way the compiler does:
// recallNow against index.counts.scheduledItems (lesson items, so the rule quick-check items that
// share the states are left out, as in session.js) and wordsMet against index.counts.lemmasMet
// (the same tokeniser, util/tokens.js, over the same texts).

import { retrievability } from './scheduler.js';
import { localDateKey, daysBetween } from '../util/time.js';
import { wordTokens } from '../util/tokens.js';

/** @typedef {import('./scheduler.js').ItemState} ItemState */
/** @typedef {import('../content/types.js').Lesson} Lesson */
/** @typedef {import('../content/types.js').UnitContent} UnitContent */

/**
 * One finished session, appended by the session screen when the closing menu is reached. Times
 * are epoch ms. `recalls` and `correct` count the typed and the recognition-judged spoken recalls
 * and the successful ones among them (correct or slip), the only answers that change recall
 * state; `kinds` counts the exercises done per ExerciseKind (session.js).
 * @typedef {object} SessionRecord
 * @property {string} id
 * @property {number} startedAt epoch ms; the local day this instant falls on is the day the session counts for
 * @property {number} endedAt epoch ms
 * @property {number} minutes practised time, endedAt minus startedAt in minutes
 * @property {number} recalls
 * @property {number} correct
 * @property {number} newItems items met for the first time
 * @property {number} honey honeyFor(correct)
 * @property {Record<string, number>} kinds
 */

/**
 * @typedef {object} WeekDay
 * @property {string} date `YYYY-MM-DD`
 * @property {boolean} active at least one session started on this day
 * @property {number} minutes the minutes of those sessions
 */

/**
 * @typedef {object} WeekSummary
 * @property {string} weekStart the Monday, `YYYY-MM-DD`
 * @property {WeekDay[]} days Monday to Sunday
 * @property {number} activeDays
 * @property {number} target active days per week
 * @property {boolean} graceUsed the week counts as met only with its one grace day
 * @property {boolean} met
 * @property {number} remainingDays days of the week after today, 6 on a Monday and 0 on a Sunday
 */

/** @typedef {{ lessonId: string, fill: number }} HiveCell */
/** @typedef {{ unitId: string, cells: HiveCell[], fill: number }} HiveFill */

/** The hours A1 courses budget, shown next to hoursPracticed. */
export const a1Hours = Object.freeze({ min: 120, max: 180 });

const DAY_MS = 86_400_000;
const DAYS_PER_WEEK = 7;
const RULE_ID = /^r-[a-z0-9-]+$/;

/**
 * An item the learner can recall now: in review (mastered or not) with a predicted recall at or
 * above the retention target. A lapsed item is back in rotation and does not count, whatever its
 * prediction; items without a card (new, learning) are not counted either.
 * @param {ItemState|undefined} state
 * @param {number} now epoch ms
 * @param {number} retention 0 to 1
 * @returns {boolean}
 */
function recallable(state, now, retention) {
  return state !== undefined && state.phase === 'review' && retrievability(state, now) >= retention;
}

/**
 * How many items the learner can recall now, for "x of index.counts.scheduledItems". Rule ids
 * share the states (a rule's quick check is scheduled under the rule's id) but are not lesson
 * items, so they are left out.
 * @param {Record<string, ItemState>} states by item id
 * @param {number} now epoch ms
 * @param {number} retention the desired retention, 0 to 1
 * @returns {number}
 */
export function recallNow(states, now, retention) {
  let count = 0;
  for (const [id, state] of Object.entries(states)) {
    if (!RULE_ID.test(id) && recallable(state, now, retention)) count += 1;
  }
  return count;
}

/**
 * Distinct words met, for "y of index.counts.lemmasMet": the tokens of the `sl` of every item
 * whose phase is not `new`, of those items' examples, and of the dialogue lines of every lesson
 * with at least one such item, counted the way the compiler counts `lemmasMet`.
 * @param {Record<string, ItemState>} states by item id
 * @param {UnitContent[]} units the loaded unit files; the index carries the denominator, not the texts
 * @returns {number}
 */
export function wordsMet(states, units) {
  const words = new Set();
  /** @param {string} text */
  const add = (text) => { for (const token of wordTokens(text)) words.add(token); };
  for (const { lessons } of units) {
    for (const lesson of lessons) {
      let met = false;
      for (const item of lesson.items) {
        if ((states[item.id]?.phase ?? 'new') === 'new') continue;
        met = true;
        add(item.sl);
        for (const example of item.examples) add(example.sl);
      }
      if (met && lesson.dialogue) for (const line of lesson.dialogue.lines) add(line.sl);
    }
  }
  return words.size;
}

/**
 * The accepted items of a lesson and how many of them are recallable now.
 * @param {Record<string, ItemState>} states
 * @param {Lesson} lesson
 * @param {number} now
 * @param {number} retention
 * @returns {{ accepted: number, recalled: number }}
 */
function tally(states, lesson, now, retention) {
  let accepted = 0;
  let recalled = 0;
  for (const item of lesson.items) {
    if (item.verification.status !== 'accepted') continue;
    accepted += 1;
    if (recallable(states[item.id], now, retention)) recalled += 1;
  }
  return { accepted, recalled };
}

/** @param {{ accepted: number, recalled: number }} t @returns {number} 0 to 1, and 0 when nothing is accepted */
const share = (t) => (t.accepted === 0 ? 0 : t.recalled / t.accepted);

/**
 * The share of the lesson's accepted items the learner can recall now, 0 to 1: what a hive cell
 * shows, retention rather than completion. A lesson without accepted items is 0.
 * @param {Record<string, ItemState>} states by item id
 * @param {Lesson} lesson
 * @param {number} now epoch ms
 * @param {number} retention the desired retention, 0 to 1
 * @returns {number}
 */
export function lessonFill(states, lesson, now, retention) {
  return share(tally(states, lesson, now, retention));
}

/**
 * The fill of a unit's panel: one cell per lesson the bundle carries, in order, with that lesson's
 * fill, and the unit's own fill as the share of all its accepted items that are recallable now
 * (weighted by items, so a lesson of ten items counts for more than one of three).
 * @param {Record<string, ItemState>} states by item id
 * @param {UnitContent} unitContent
 * @param {number} now epoch ms
 * @param {number} retention the desired retention, 0 to 1
 * @returns {HiveFill}
 */
export function hiveFill(states, unitContent, now, retention) {
  const total = { accepted: 0, recalled: 0 };
  const cells = unitContent.lessons.map((lesson) => {
    const t = tally(states, lesson, now, retention);
    total.accepted += t.accepted;
    total.recalled += t.recalled;
    return { lessonId: lesson.id, fill: share(t) };
  });
  return { unitId: unitContent.unit.id, cells, fill: share(total) };
}

/**
 * The week that contains `now`, Monday to Sunday in the learner's local days. A day is active when
 * a session started on it (a session that runs past midnight counts for the day it started). The
 * target is met at `target` active days, or at `target - 1` with the week's one grace day, which
 * `graceUsed` then reports; it is a status of the week so far, never a loss message.
 * @param {SessionRecord[]} sessions
 * @param {number} now epoch ms
 * @param {number} [target] active days per week, 5 by default
 * @param {string} [tz] IANA zone, for tests; the phone's zone when omitted
 * @returns {WeekSummary}
 */
export function weekSummary(sessions, now, target = 5, tz) {
  const todayUtc = Date.parse(`${localDateKey(now, tz)}T00:00:00Z`);
  const weekday = (new Date(todayUtc).getUTCDay() + 6) % DAYS_PER_WEEK;   // Monday 0 to Sunday 6
  const mondayUtc = todayUtc - weekday * DAY_MS;
  /** @type {WeekDay[]} */
  const days = Array.from({ length: DAYS_PER_WEEK }, (_, i) => ({
    date: new Date(mondayUtc + i * DAY_MS).toISOString().slice(0, 10),
    active: false,
    minutes: 0,
  }));
  for (const session of sessions) {
    const index = daysBetween(days[0].date, localDateKey(session.startedAt, tz));
    if (index < 0 || index >= DAYS_PER_WEEK) continue;
    days[index].active = true;
    days[index].minutes += session.minutes;
  }
  const activeDays = days.filter((day) => day.active).length;
  const graceUsed = activeDays === target - 1;
  return {
    weekStart: days[0].date,
    days,
    activeDays,
    target,
    graceUsed,
    met: activeDays >= target || graceUsed,
    remainingDays: DAYS_PER_WEEK - 1 - weekday,
  };
}

/**
 * Honey is informational: one per correct recall, never spendable.
 * @param {number} correctRecalls
 * @returns {number}
 */
export function honeyFor(correctRecalls) {
  return correctRecalls;
}

/**
 * The hours practised over the sessions, to one decimal, for "h hours practised; A1 courses
 * budget 120 to 180".
 * @param {SessionRecord[]} sessions
 * @returns {number}
 */
export function hoursPracticed(sessions) {
  let minutes = 0;
  for (const session of sessions) minutes += session.minutes;
  return Math.round(minutes / 6) / 10;
}
