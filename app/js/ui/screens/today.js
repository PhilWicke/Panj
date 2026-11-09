// The Today screen (spec 6): the greeting in Slovenian by the hour with the learner's name, a tap
// plays it; the week calendar; the primary action, worded from the session buildSession would
// start now, from the same inputs the session screen uses; the current lesson; the intention line
// until the habit holds (the week target met four weeks in a row); the hive as the lower part of
// the screen, a tap on a board opens its unit; and one quiet line when the store is not
// persistent. The pure parts are exported for the tests.

import { h, mount, svg } from '../../util/dom.js';
import { onlyKnown } from '../../content/loader.js';
import { navigate } from '../../router.js';
import { buildSession } from '../../engine/session.js';
import { hiveFill, weekSummary } from '../../engine/progress.js';
import { currentLesson, todayTotals } from '../../engine/course.js';
import { localDateKey } from '../../util/time.js';
import { honeyInWeek, renderCalendar } from '../components/calendar.js';
import { renderHive, sealedUnits } from '../components/hive.js';

/** @typedef {import('../../app-types.js').App} App */
/** @typedef {import('../../engine/session.js').Session} Session */
/** @typedef {import('../../engine/progress.js').SessionRecord} SessionRecord */

const WEEK_MS = 7 * 86_400_000;
/** Active days per week, the target the calendar shows. */
const WEEK_TARGET = 5;
/** Weeks in a row the target must have been met before the intention line retires. */
const HABIT_WEEKS = 4;

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

/**
 * Whether the habit holds: the week target was met (the grace day counted) in each of the
 * HABIT_WEEKS weeks before the current one. The intention line shows until it does.
 * @param {SessionRecord[]} sessions
 * @param {number} now epoch ms
 * @param {string} [tz] IANA zone, for tests; the phone's zone when omitted
 * @returns {boolean}
 */
export function habitHolds(sessions, now, tz) {
  for (let k = 1; k <= HABIT_WEEKS; k += 1) {
    if (!weekSummary(sessions, now, WEEK_TARGET, tz, now - k * WEEK_MS).met) return false;
  }
  return true;
}

/**
 * The intention as a sentence: "I practise" and the clause from onboarding, with a full stop.
 * @param {string} intention "on the train after the first stop"
 * @returns {string}
 */
function intentionLine(intention) {
  const clause = intention.trim().replace(/[.\s]+$/, '');
  return `I practise ${clause}.`;
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
  const unit = lesson ? app.index.units.find((candidate) => candidate.id === lesson.unit) : undefined;
  const week = weekSummary(app.state.sessions, now, WEEK_TARGET);
  const greeting = greetingFor(new Date(now).getHours());
  const fills = app.units.map((content) => hiveFill(states, content, now, settings.desiredRetention, { allowPending: app.allowPending }));

  mount(container, h('section', { class: 'screen screen-today' },
    h('h1', { class: 'greeting' },
      h('button', { type: 'button', class: 'greeting-play', onclick: () => { void app.player.play(greeting); } },
        h('span', { lang: 'sl' }, greeting),
        settings.name ? h('span', { class: 'greeting-name' }, `, ${settings.name}`) : null,
        speakerIcon(),
        h('span', { class: 'visually-hidden' }, ', listen'))),
    renderCalendar(week, { todayDate: localDateKey(now), honey: honeyInWeek(app.state.sessions, week) }),
    h('div', { class: 'actions actions-stack' },
      h('button', {
        type: 'button', class: 'btn btn-primary btn-large btn-session', 'aria-disabled': action.enabled ? null : 'true',
        onclick: () => { if (action.enabled) navigate('/session'); },
      }, actionLabel(action.text)),
      canContinue && h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => navigate('/session?mode=continue') }, 'Continue lesson')),
    !action.enabled && h('p', { class: 'quiet' }, 'Come back later today or tomorrow.'),
    !app.persistent && h('p', { class: 'notice' }, 'Progress is not being saved in this browser.'),
    lesson && h('div', { class: 'lesson-card' },
      h('p', { class: 'eyebrow' }, unit ? `Unit ${unit.order}, lesson ${lesson.order}` : `Lesson ${lesson.order}`),
      h('p', { class: 'sl-title', lang: 'sl' }, lesson.title_sl),
      h('p', { class: 'en-text' }, lesson.title_en)),
    settings.intention && !habitHolds(app.state.sessions, now) && h('p', { class: 'intention' }, intentionLine(settings.intention)),
    h('section', { class: 'hive-section', 'aria-labelledby': 'today-hive' },
      h('h2', { class: 'section-title', id: 'today-hive' }, 'Your hive'),
      renderHive(fills, app.index.units, { onUnit: (id) => navigate(`/unit?id=${id}`), sealed: sealedUnits(app.state.meta) }))));
}
