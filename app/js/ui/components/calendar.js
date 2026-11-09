// The week calendar (spec 4.7, Ruling 25): seven squares, Monday to Sunday, the active days in
// honey, today outlined, the days still to come faint. Under them the status line, which is a
// status of the week and never a loss message: the target met, met with the grace day, how many
// days so far, or a fresh start on Monday once the target is out of reach. Honey, when there is
// any this week, is one quiet informational line, never a headline. The grace day is text only; the
// squares mark active days (progress.js, WeekSummary).

import { h } from '../../util/dom.js';
import { localDateKey } from '../../util/time.js';

/** @typedef {import('../../engine/progress.js').WeekSummary} WeekSummary */
/** @typedef {import('../../engine/progress.js').SessionRecord} SessionRecord */

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const SHORT = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

/**
 * The status line of a week.
 * @param {WeekSummary} summary
 * @returns {string}
 */
export function calendarLine(summary) {
  const { activeDays, target, met, graceUsed, reachable } = summary;
  if (met && !graceUsed) {
    const extra = activeDays - target;
    return extra > 0 ? `${target} of ${target} days this week, and ${extra} more` : `${target} of ${target} days this week`;
  }
  if (graceUsed) return `${activeDays} of ${target} days, with the grace day`;
  if (!reachable) return 'Fresh start on Monday';
  return `${activeDays} of ${target} days this week`;
}

/**
 * The honey of the sessions that started in the summary's week.
 * @param {SessionRecord[]} sessions
 * @param {WeekSummary} summary
 * @param {string} [tz] IANA zone, for tests; the phone's zone when omitted
 * @returns {number}
 */
export function honeyInWeek(sessions, summary, tz) {
  const dates = new Set(summary.days.map((day) => day.date));
  let honey = 0;
  for (const session of sessions) if (dates.has(localDateKey(session.startedAt, tz))) honey += session.honey;
  return honey;
}

/**
 * @param {WeekSummary} summary
 * @param {{ todayDate?: string, honey?: number }} [options] `todayDate` is today's `YYYY-MM-DD`,
 *   so today is marked and the days after it faint; `honey` is this week's honey, shown when above zero
 * @returns {HTMLElement}
 */
export function renderCalendar(summary, options = {}) {
  const todayAt = options.todayDate === undefined ? -1 : summary.days.findIndex((day) => day.date === options.todayDate);
  return h('section', { class: 'calendar', 'aria-label': 'This week' },
    h('ol', { class: 'calendar-days' }, summary.days.map((day, i) => {
      const today = i === todayAt;
      const future = todayAt !== -1 && i > todayAt;
      const classes = ['calendar-day', day.active && 'is-active', today && 'is-today', future && 'is-future'].filter(Boolean).join(' ');
      const label = [WEEKDAYS[i], today ? 'today' : null, day.active ? 'practised' : null].filter(Boolean).join(', ');
      return h('li', { class: classes },
        h('span', { class: 'calendar-weekday', 'aria-hidden': 'true' }, SHORT[i]),
        h('span', { class: 'visually-hidden' }, label),
        h('span', { class: 'calendar-square' }));
    })),
    h('p', { class: 'calendar-line' }, calendarLine(summary)),
    options.honey ? h('p', { class: 'calendar-honey' }, `${options.honey} honey this week`) : null);
}
