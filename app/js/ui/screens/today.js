// The Today screen, minimal until Task 15 adds the calendar, the hive and the session preview:
// the greeting with the learner's name, the current lesson, one primary action, "Continue lesson"
// once the day's new items are done and the lesson still has some, and one quiet line when the
// store is not persistent.

import { h, mount } from '../../util/dom.js';
import { onlyKnown } from '../../content/loader.js';
import { navigate } from '../../router.js';
import { currentLesson, todayTotals } from './session.js';

/** @typedef {import('../../main.js').App} App */

/**
 * @param {HTMLElement} container
 * @param {App} app
 */
export function renderToday(container, app) {
  const settings = app.state.settings;
  const { lesson, remaining } = currentLesson(app.index, app.units, onlyKnown(app.state.items, app.known), app.allowPending);
  const { newToday } = todayTotals(app.state.sessions, Date.now());
  const canContinue = lesson !== null && remaining > 0 && newToday >= settings.newPerDay;
  const unit = lesson ? app.index.units.find((candidate) => candidate.id === lesson.unit) : undefined;

  const start = h('button', { type: 'button', class: 'btn btn-primary btn-large', onclick: () => navigate('/session') }, "Start today's session");
  mount(container, h('section', { class: 'screen screen-today' },
    h('h1', { class: 'greeting' }, h('span', { lang: 'sl' }, 'Živjo'), settings.name ? `, ${settings.name}` : null),
    lesson && h('div', { class: 'lesson-card' },
      h('p', { class: 'eyebrow' }, unit ? `Unit ${unit.order}, lesson ${lesson.order}` : `Lesson ${lesson.order}`),
      h('p', { class: 'sl-title', lang: 'sl' }, lesson.title_sl),
      h('p', { class: 'en-text' }, lesson.title_en)),
    h('div', { class: 'actions actions-stack' },
      start,
      canContinue && h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => navigate('/session?mode=continue') }, 'Continue lesson')),
    !app.persistent && h('p', { class: 'notice' }, 'Progress is not being saved in this browser.')));
}
