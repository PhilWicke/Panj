// The learner's position in the course, pure over the bundle, the item states and the session
// records: which lesson is current, how many items it still has to introduce, and what today's
// sessions have done so far. The session screen builds today's queue from these and the Today
// screen words its primary action from the same inputs, so both agree. practisable is the one
// place that says which items may be practised; every screen and engine module asks it. The
// course's shape is read from the content, never fixed here: the level groups, a lesson's role,
// the units of the placement check and the unit in focus.

import { localDateKey } from '../util/time.js';

/** @typedef {import('./scheduler.js').ItemState} ItemState */
/** @typedef {import('./progress.js').SessionRecord} SessionRecord */
/** @typedef {import('../content/types.js').Index} Index */
/** @typedef {import('../content/types.js').Unit} Unit */
/** @typedef {import('../content/types.js').UnitContent} UnitContent */
/** @typedef {import('../content/types.js').Lesson} Lesson */
/** @typedef {import('../content/types.js').Item} Item */

/** How many units the placement check runs through at most, while passing (Ruling 103). */
export const PLACEMENT_LENGTH = 3;

/**
 * Whether an item may be practised: an accepted one always, any other only in a dev build
 * (allowPending, index.mode `dev`). Pending content never reaches practice in a strict build.
 * @param {Item} item
 * @param {boolean} allowPending
 * @returns {boolean}
 */
export function practisable(item, allowPending) {
  return allowPending || item.verification.status === 'accepted';
}

/**
 * The items met and the minutes practised in the sessions that started on today's local date,
 * buildSession's `newToday` and `minutesToday`.
 * @param {SessionRecord[]} sessions
 * @param {number} now epoch ms
 * @param {string} [tz] IANA zone, for tests; the phone's zone when omitted
 * @returns {{ newToday: number, minutesToday: number }}
 */
export function todayTotals(sessions, now, tz) {
  const today = localDateKey(now, tz);
  let newToday = 0;
  let minutesToday = 0;
  for (const session of sessions) {
    if (localDateKey(session.startedAt, tz) !== today) continue;
    newToday += session.newItems;
    minutesToday += session.minutes;
  }
  return { newToday, minutesToday };
}

/**
 * The lesson's practisable items the learner has not met yet: accepted ones, or every one in a dev
 * build.
 * @param {Lesson} lesson
 * @param {Record<string, ItemState>} states
 * @param {boolean} allowPending
 * @returns {number}
 */
export function unmetItems(lesson, states, allowPending) {
  return lesson.items.filter((item) => practisable(item, allowPending) && (states[item.id]?.phase ?? 'new') === 'new').length;
}

/**
 * The current lesson: the first in course order with a practisable item not met yet, with the
 * lessons of its unit and how many items it has left. No lesson once every item is met.
 * @param {Index} index
 * @param {UnitContent[]} units
 * @param {Record<string, ItemState>} states
 * @param {boolean} allowPending
 * @returns {{ lesson: Lesson|null, unitLessons: Lesson[], remaining: number }}
 */
export function currentLesson(index, units, states, allowPending) {
  /** @type {Map<string, Lesson>} */
  const lessons = new Map();
  /** @type {Map<string, Lesson[]>} */
  const byUnit = new Map();
  for (const unit of units) {
    byUnit.set(unit.unit.id, unit.lessons);
    for (const lesson of unit.lessons) lessons.set(lesson.id, lesson);
  }
  for (const entry of index.lessonIndex) {
    const lesson = lessons.get(entry.id);
    if (!lesson) continue;
    const remaining = unmetItems(lesson, states, allowPending);
    if (remaining > 0) return { lesson, unitLessons: byUnit.get(lesson.unit) ?? [lesson], remaining };
  }
  return { lesson: null, unitLessons: [], remaining: 0 };
}

/**
 * What a lesson does in its unit: `consolidation` when the lesson says so, a theme lesson for a
 * missing or any other role.
 * @param {Lesson} lesson
 * @returns {'theme'|'consolidation'}
 */
export function lessonRole(lesson) {
  return lesson.role === 'consolidation' ? 'consolidation' : 'theme';
}

/**
 * The units in runs of one level, in the order given: a group starts wherever the level changes.
 * Units without a level share the level null, so a course without levels is one group.
 * @param {Unit[]} units
 * @returns {{ level: string|null, units: Unit[] }[]}
 */
export function levelGroups(units) {
  /** @type {{ level: string|null, units: Unit[] }[]} */
  const groups = [];
  for (const unit of units) {
    const level = unit.level ?? null;
    const last = groups[groups.length - 1];
    if (last && last.level === level) last.units.push(unit);
    else groups.push({ level, units: [unit] });
  }
  return groups;
}

/**
 * The ids of the units the placement check runs through while passing: the first
 * PLACEMENT_LENGTH units, in the order given, of the first unit's level. None for an empty course.
 * @param {Unit[]} units
 * @returns {string[]}
 */
export function placementUnits(units) {
  if (units.length === 0) return [];
  const level = units[0].level ?? null;
  return units.filter((unit) => (unit.level ?? null) === level).slice(0, PLACEMENT_LENGTH).map((unit) => unit.id);
}

/**
 * The unit in focus: the current lesson's unit, else, once every lesson is met, the last unit
 * whose lessons the bundle carries, else null (a course without a bundled lesson).
 * @param {Pick<Index, 'units'>} index
 * @param {Pick<Lesson, 'unit'>|null} lesson the current lesson, null when there is none
 * @returns {string|null}
 */
export function focusUnitId(index, lesson) {
  if (lesson) return lesson.unit;
  for (let i = index.units.length - 1; i >= 0; i -= 1) {
    if (index.units[i].lessons.length > 0) return index.units[i].id;
  }
  return null;
}
