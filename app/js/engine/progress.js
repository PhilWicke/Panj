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
import { practisable } from './course.js';
import { localDateKey, daysBetween } from '../util/time.js';
import { wordTokens } from '../util/tokens.js';
import { isRuleId } from '../util/ids.js';

/** @typedef {import('./scheduler.js').ItemState} ItemState */
/** @typedef {import('../content/types.js').Lesson} Lesson */
/** @typedef {import('../content/types.js').UnitContent} UnitContent */

/**
 * One session, written by the session screen after each settled entry (a provisional record, so a
 * session the browser or the learner abandons still counts for what was done, Ruling 78) and
 * finalised under the same id when the run ends. Times are epoch ms. `recalls` and `correct`
 * count the typed and the recognition-judged spoken recalls and the successful ones among them
 * (correct or slip), the only answers that change recall state; `kinds` counts the exercises done
 * per ExerciseKind (session.js).
 * @typedef {object} SessionRecord
 * @property {string} id
 * @property {number} startedAt epoch ms; the local day this instant falls on is the day the session counts for
 * @property {number} endedAt epoch ms
 * @property {number} minutes credited time in minutes: the gaps between the start, each settled entry and the end, each capped at MAX_GAP_MS (creditedMinutes, Ruling 79)
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
 * The status of a week, as weekSummary reads it from `now`: what is done, what is still possible
 * and whether the target is met or still within reach. Never a loss message.
 * @typedef {object} WeekSummary
 * @property {string} weekStart the Monday, `YYYY-MM-DD`
 * @property {WeekDay[]} days Monday to Sunday; active days only, the grace day is never marked here
 * @property {number} activeDays
 * @property {number} target active days per week
 * @property {number} remainingDays days of the week after today: 6 on its Monday, 0 on its Sunday and once the week is over, 7 for a week still to come
 * @property {boolean} todayActive a session started today, today being a day of this week
 * @property {number} possibleDays the active days plus the days the week can still add, today included while it has no session yet
 * @property {boolean} met the target is reached, or can no longer be reached and the active days fall short of it by no more than the grace day
 * @property {boolean} graceUsed met by the grace day alone: the week is over with target minus one active days
 * @property {boolean} reachable the target can still be met, the grace day counted: possibleDays is at least target minus the grace day
 */

/** @typedef {'not-started'|'in-progress'|'learned'} CellState */
/** @typedef {{ lessonId: string, order: number, fill: number, state: CellState }} HiveCell */
/** @typedef {{ unitId: string, cells: HiveCell[], fill: number }} HiveFill */
/** @typedef {{ allowPending?: boolean }} FillOptions allowPending: every item of a lesson counts, as a dev build practises them all; accepted items only when omitted */

/** The hours A1 courses budget, shown next to hoursPracticed. */
export const a1Hours = Object.freeze({ min: 120, max: 180 });

const DAY_MS = 86_400_000;
const DAYS_PER_WEEK = 7;
const MINUTE_MS = 60_000;
/** The most time credited between two marks of a session: a phone left locked mid-session does not count as practice. */
export const MAX_GAP_MS = 2 * 60 * 1000;

/**
 * The minutes a session is credited with (Ruling 79): the gaps between consecutive marks, each
 * capped at `capMs`, summed. No gap, no credit: an empty or single mark gives 0.
 * @param {number[]} marks epoch ms in order: the start, each settled entry, the end
 * @param {number} [capMs] the most one gap counts, MAX_GAP_MS by default
 * @returns {number} minutes, fractional
 */
export function creditedMinutes(marks, capMs = MAX_GAP_MS) {
  let credited = 0;
  for (let i = 1; i < marks.length; i += 1) credited += Math.min(Math.max(0, marks[i] - marks[i - 1]), capMs);
  return credited / MINUTE_MS;
}

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
    if (!isRuleId(id) && recallable(state, now, retention)) count += 1;
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
 * The items of a lesson that count (the accepted ones, or every item with `allowPending`), how
 * many of them the learner has met (a state whose phase is not `new`) and how many are
 * recallable now.
 * @param {Record<string, ItemState>} states
 * @param {Lesson} lesson
 * @param {number} now
 * @param {number} retention
 * @param {boolean} allowPending
 * @returns {{ counted: number, met: number, recalled: number }}
 */
function tally(states, lesson, now, retention, allowPending) {
  let counted = 0;
  let met = 0;
  let recalled = 0;
  for (const item of lesson.items) {
    if (!practisable(item, allowPending)) continue;
    counted += 1;
    const state = states[item.id];
    if ((state?.phase ?? 'new') !== 'new') met += 1;
    if (recallable(state, now, retention)) recalled += 1;
  }
  return { counted, met, recalled };
}

/** @param {{ counted: number, recalled: number }} t @returns {number} 0 to 1, and 0 when nothing counts */
const share = (t) => (t.counted === 0 ? 0 : t.recalled / t.counted);

/** @param {{ counted: number, met: number, recalled: number }} t @returns {CellState} */
const stateOf = (t) => (t.counted > 0 && t.recalled === t.counted ? 'learned' : t.met > 0 ? 'in-progress' : 'not-started');

/**
 * The share of the lesson's items the learner can recall now, 0 to 1: what a hive cell shows,
 * retention rather than completion. The accepted items count, or every item with
 * `options.allowPending` (a dev build); a lesson without counted items is 0.
 * @param {Record<string, ItemState>} states by item id
 * @param {Lesson} lesson
 * @param {number} now epoch ms
 * @param {number} retention the desired retention, 0 to 1
 * @param {FillOptions} [options]
 * @returns {number}
 */
export function lessonFill(states, lesson, now, retention, options = {}) {
  return share(tally(states, lesson, now, retention, options.allowPending === true));
}

/**
 * The state of a lesson's hive cell, over the items lessonFill counts (the accepted ones, or every
 * item with `options.allowPending`): `learned` when at least one counts and every counted item is
 * recallable now, `in-progress` when a counted item has been met (its phase is not `new`), so a
 * lapse or an item below the target keeps a met lesson in progress, and `not-started` otherwise.
 * @param {Record<string, ItemState>} states by item id
 * @param {Lesson} lesson
 * @param {number} now epoch ms
 * @param {number} retention the desired retention, 0 to 1
 * @param {FillOptions} [options]
 * @returns {CellState}
 */
export function cellState(states, lesson, now, retention, options = {}) {
  return stateOf(tally(states, lesson, now, retention, options.allowPending === true));
}

/**
 * The fill of a unit's panel: one cell per lesson the bundle carries, in order, with that lesson's
 * order, its fill (lessonFill) and its state (cellState), and the unit's own fill as the share of
 * all its counted items that are recallable now (weighted by items, so a lesson of ten items
 * counts for more than one of three). The accepted items count, or every item with
 * `options.allowPending` (a dev build).
 * @param {Record<string, ItemState>} states by item id
 * @param {UnitContent} unitContent
 * @param {number} now epoch ms
 * @param {number} retention the desired retention, 0 to 1
 * @param {FillOptions} [options]
 * @returns {HiveFill}
 */
export function hiveFill(states, unitContent, now, retention, options = {}) {
  const allowPending = options.allowPending === true;
  const total = { counted: 0, recalled: 0 };
  const cells = unitContent.lessons.map((lesson) => {
    const t = tally(states, lesson, now, retention, allowPending);
    total.counted += t.counted;
    total.recalled += t.recalled;
    return { lessonId: lesson.id, order: lesson.order, fill: share(t), state: stateOf(t) };
  });
  return { unitId: unitContent.unit.id, cells, fill: share(total) };
}

/**
 * The week that contains `weekOf` (today's week when omitted), Monday to Sunday in the learner's
 * local days, read from `now`. A day is active when a session started on it (a session that runs
 * past midnight counts for the day it started). The summary is a status of the week, never a loss
 * message: how many days are active, how many the week can still have (`possibleDays`: the active
 * days, the days after today, and today while it has no session yet), whether the target is met
 * and whether it is still within reach. A target of two or more carries one grace day, a target of
 * one none; the grace day counts only once the week can no longer reach the target on its own, and
 * `graceUsed` says so, so the week view shows it as text while the calendar marks active days only.
 * @param {SessionRecord[]} sessions
 * @param {number} now epoch ms; today is its local date
 * @param {number} [target] active days per week, 5 by default
 * @param {string} [tz] IANA zone, for tests; the phone's zone when omitted
 * @param {number} [weekOf] epoch ms of any instant in the week to summarise; `now` when omitted
 * @returns {WeekSummary}
 */
export function weekSummary(sessions, now, target = 5, tz, weekOf = now) {
  const weekOfUtc = Date.parse(`${localDateKey(weekOf, tz)}T00:00:00Z`);
  const weekday = (new Date(weekOfUtc).getUTCDay() + 6) % DAYS_PER_WEEK;   // Monday 0 to Sunday 6
  const mondayUtc = weekOfUtc - weekday * DAY_MS;
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
  const todayIndex = daysBetween(days[0].date, localDateKey(now, tz));   // 0 to 6 inside the week, negative before it, 7 and more after it
  const todayInWeek = todayIndex >= 0 && todayIndex < DAYS_PER_WEEK;
  const remainingDays = Math.max(0, Math.min(DAYS_PER_WEEK, DAYS_PER_WEEK - 1 - todayIndex));
  const todayActive = todayInWeek && days[todayIndex].active;
  const possibleDays = activeDays + remainingDays + (todayInWeek && !todayActive ? 1 : 0);
  const graceDays = target >= 2 ? 1 : 0;
  const met = activeDays >= target || (possibleDays < target && activeDays >= target - graceDays);
  return {
    weekStart: days[0].date,
    days,
    activeDays,
    target,
    remainingDays,
    todayActive,
    possibleDays,
    met,
    graceUsed: met && activeDays < target,
    reachable: possibleDays >= target - graceDays,
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
