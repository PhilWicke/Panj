// The Today screen (spec 6, concept section 3): the greeting in Slovenian by the hour with the
// learner's name, a tap plays it; the week calendar; the primary action, worded from the session
// buildSession would start now, from the same inputs the session screen uses, with the weekly
// check under it when one is due (every seventh active day, engine/checkpoint.js), and right
// after them, when nothing is due, the line that explains the disabled action; under them the
// strip of the unit in focus (focusUnitId: the current lesson's unit, else the last unit with
// lessons) drawn large, the current lesson's cell rimmed, a tap opens the Hive; the current
// lesson; and one quiet line when the store is not persistent. A course without lessons yet (a
// strict build before any content is accepted) says so in place of the primary action and draws
// no strip. The pure parts are exported for the tests.

import { h, mount, svg } from '../../util/dom.js';
import { onlyKnown } from '../../content/loader.js';
import { navigate } from '../../router.js';
import { buildSession } from '../../engine/session.js';
import { hiveFill, weekSummary } from '../../engine/progress.js';
import { currentLesson, focusUnitId, todayTotals } from '../../engine/course.js';
import { WEEKLY_MIN_ITEMS, buildWeeklyCheck, dueWeeklyCheck } from '../../engine/checkpoint.js';
import { localDateKey } from '../../util/time.js';
import { honeyInWeek, renderCalendar } from '../components/calendar.js';
import { renderStrip, sealedUnits } from '../components/hive.js';
import { countLine } from './checkpoint.js';

/** @typedef {import('../../app-types.js').App} App */
/** @typedef {import('../../engine/session.js').Session} Session */

/** Active days per week, the target the calendar shows. */
const WEEK_TARGET = 5;

/**
 * The greeting for the hour of the learner's day.
 * @param {number} hourLocal 0 to 23
 * @returns {string}
 */
export function greetingFor(hourLocal) {
  if (hourLocal < 10) return 'Dobro jutro';
  if (hourLocal < 18) return 'Dober dan';
  return 'Dober večer';
}

/**
 * The primary action's label from the session that would start now: its due reviews, its new
 * items and its minutes, at least one; or that nothing is due when the queue is empty.
 * @param {Session} session
 * @returns {{ text: string, enabled: boolean }}
 */
export function primaryAction(session) {
  if (session.queue.length === 0) return { text: 'Nothing due right now', enabled: false };
  const minutes = Math.max(1, Math.round(session.estimatedMinutes));
  const reviews = `${session.reviewCount} ${session.reviewCount === 1 ? 'review' : 'reviews'}`;
  return { text: `Start today's session: ${reviews}, ${session.newCount} new, about ${minutes} min`, enabled: true };
}

/** @returns {SVGElement} a small speaker, the hint that the greeting plays */
function speakerIcon() {
  return svg('svg', { class: 'greeting-icon', viewBox: '0 0 24 24', 'aria-hidden': 'true' },
    svg('path', { d: 'M4 9.5v5h3.5l5 4v-13l-5 4z' }),
    svg('path', { d: 'M15.5 8.5a5 5 0 0 1 0 7', fill: 'none', 'stroke-width': 2, 'stroke-linecap': 'round' }));
}

/**
 * The primary action's text as a title line and a detail line: the colon ends the first line,
 * the counts follow on the second; read together they are the text itself.
 * @param {string} text
 * @returns {(HTMLElement|string)[]}
 */
function actionLabel(text) {
  const split = text.indexOf(': ');
  if (split === -1) return [text];
  return [h('span', { class: 'btn-session-title' }, text.slice(0, split + 1)), h('span', { class: 'btn-session-detail' }, text.slice(split + 1))];
}

/**
 * @param {HTMLElement} container
 * @param {App} app
 */
export function renderToday(container, app) {
  const now = Date.now();
  const settings = app.state.settings;
  const states = onlyKnown(app.state.items, app.known);
  const { lesson, unitLessons, remaining } = currentLesson(app.index, app.units, states, app.allowPending);
  const { newToday, minutesToday } = todayTotals(app.state.sessions, now);
  const planned = buildSession({
    now, states, lesson, unitLessons, rules: app.index.rules, settings,
    mode: { mute: settings.mute, speech: settings.speech }, newToday, minutesToday, allowPending: app.allowPending,
  });
  const action = primaryAction(planned);
  const canContinue = lesson !== null && remaining > 0 && newToday >= settings.newPerDay;
  const unitId = focusUnitId(app.index, lesson);
  const unit = unitId === null ? undefined : app.index.units.find((candidate) => candidate.id === unitId);
  const unitContent = unit && app.units.find((content) => content.unit.id === unit.id);
  const fill = unitContent && hiveFill(states, unitContent, now, settings.desiredRetention, { allowPending: app.allowPending });
  /** The unit in focus drawn large, the day's work visible as the cell it fills; a tap opens the Hive. */
  const strip = unit && h('a', { class: 'today-strip', href: '#/hive', 'aria-label': `Unit ${unit.order}, ${unit.title_sl}. Open the hive` },
    renderStrip(fill, unit, { sealed: sealedUnits(app.state.meta)[unit.id] === true, currentLessonId: lesson?.id ?? null, caption: true }));
  const week = weekSummary(app.state.sessions, now, WEEK_TARGET);
  const greeting = greetingFor(new Date(now).getHours());
  const weekly = dueWeeklyCheck(app.state.sessions, app.state.meta, now) ? buildWeeklyCheck(app.index, app.units, states, Math.random) : null;
  const weeklyItems = weekly ? weekly.blocks.reduce((sum, block) => sum + block.items.length, 0) : 0;
  /** The bundle carries no lesson yet: nothing can be practised until content is released. */
  const noLessons = app.index.lessonIndex.length === 0;

  mount(container, h('section', { class: 'screen screen-today' },
    h('h1', { class: 'greeting' },
      h('button', { type: 'button', class: 'greeting-play', onclick: () => { void app.player.play(`${greeting}.`); } },
        h('span', { lang: 'sl' }, greeting),
        settings.name ? h('span', { class: 'greeting-name' }, `, ${settings.name}`) : null,
        speakerIcon(),
        h('span', { class: 'visually-hidden' }, ', listen'))),
    renderCalendar(week, { todayDate: localDateKey(now), honey: honeyInWeek(app.state.sessions, week) }),
    noLessons
      ? [h('h2', { class: 'section-title' }, 'Nothing to practise yet'),
        h('p', { class: 'quiet' }, 'The first lessons are still being checked. Come back when they are released.')]
      : h('div', { class: 'actions actions-stack' },
        h('button', {
          type: 'button', class: 'btn btn-primary btn-large btn-session', 'aria-disabled': action.enabled ? null : 'true',
          onclick: () => { if (action.enabled) navigate('/session'); },
        }, actionLabel(action.text)),
        canContinue && h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => navigate('/session?mode=continue') }, 'Continue lesson'),
        weeklyItems >= WEEKLY_MIN_ITEMS && h('a', { class: 'btn btn-secondary', href: '#/checkpoint?weekly=1' }, `Weekly check: ${countLine(weeklyItems)}`)),
    // The line that explains a disabled action comes right after the actions, before the strip.
    !noLessons && !action.enabled && h('p', { class: 'quiet' }, 'Come back later today or tomorrow.'),
    strip,
    !app.persistent && h('p', { class: 'notice' }, 'Progress is not being saved in this browser.'),
    lesson && h('div', { class: 'lesson-card' },
      h('p', { class: 'eyebrow' }, unit ? `Unit ${unit.order}, lesson ${lesson.order}` : `Lesson ${lesson.order}`),
      h('p', { class: 'sl-title', lang: 'sl' }, lesson.title_sl),
      h('p', { class: 'en-text' }, lesson.title_en))));
}
