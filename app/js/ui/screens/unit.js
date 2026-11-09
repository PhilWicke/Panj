// The unit page (spec 6), reached from a hive board: the unit's titles, whether its checkpoint
// sealed it and when, how much of it can be recalled now, its lessons each with a retention meter
// (lessonFill), the link to the unit's checkpoint (`#/checkpoint?unit=uNN`, once the unit has an
// item to check), and "Keep offline", which asks the service worker to cache the unit's clips in
// the learner's voice (Task 19): it needs a recorded voice (the device voice downloads nothing)
// and a worker controlling the page (which the first load lacks until one reload).

import { h, mount } from '../../util/dom.js';
import { onlyKnown } from '../../content/loader.js';
import { hiveFill, lessonFill } from '../../engine/progress.js';
import { voiceFor } from '../../audio/player.js';

/** @typedef {import('../../app-types.js').App} App */

/**
 * A retention meter: the share of items recallable now, as a percent.
 * @param {string} id the id of its label
 * @param {number} value 0 to 1
 * @returns {HTMLElement}
 */
function meter(id, value) {
  const percent = Math.round(value * 100);
  return h('div', { class: 'lesson-meter' },
    h('span', { class: 'rule-mastery-label', id }, 'Can recall now'),
    h('div', {
      class: 'meter', role: 'meter', 'aria-labelledby': id,
      'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(percent), 'aria-valuetext': `${percent} percent`,
    }, h('div', { class: 'meter-fill', style: { width: `${percent}%` } })),
    h('span', { class: 'rule-mastery-value' }, `${percent}%`));
}

/**
 * An ISO date as the phone's locale writes it, "2 November 2026".
 * @param {string} isoDate `YYYY-MM-DD`
 * @returns {string}
 */
function formatDate(isoDate) {
  const date = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * The "Keep offline" button and its quiet line. With a recorded voice and a controlling worker
 * the button posts `cache-unit-audio` and reads "Keeping offline…" until the worker's
 * `unit-audio-cached` reply, then "Kept offline" with how many of the unit's clips the phone
 * holds; a reply with `error` offers the button again. With the device voice, or without a
 * controller, the button looks disabled and the line says why.
 * @param {App} app
 * @param {string} unitId
 * @returns {{ button: HTMLElement, line: HTMLElement }}
 */
function keepOffline(app, unitId) {
  const voice = voiceFor(app.state.settings.voice);
  const controller = navigator.serviceWorker?.controller ?? null;
  const button = h('button', { type: 'button', class: 'btn btn-secondary' }, 'Keep offline');
  const line = h('p', { class: 'quiet', hidden: true });
  /** @param {string} text */
  const say = (text) => {
    line.textContent = text;
    line.hidden = false;
  };
  if (!voice) {
    button.setAttribute('aria-disabled', 'true');
    say('The device voice needs no download.');
  } else if (!controller) {
    button.setAttribute('aria-disabled', 'true');
    say('Offline audio needs one more reload.');
  } else {
    button.addEventListener('click', () => {
      if (button.getAttribute('aria-busy') === 'true') return;
      button.setAttribute('aria-busy', 'true');
      button.textContent = 'Keeping offline…';
      /** @param {MessageEvent} event */
      const onReply = (event) => {
        const data = event.data;
        if (!data || data.type !== 'unit-audio-cached' || data.unitId !== unitId) return;
        navigator.serviceWorker.removeEventListener('message', onReply);
        button.removeAttribute('aria-busy');
        const kept = `${data.count} of ${data.total} ${data.total === 1 ? 'clip' : 'clips'} kept on this phone.`;
        if (data.error) {
          button.textContent = 'Keep offline';
          say(`${kept} The rest could not be fetched; try again later.`);
        } else {
          button.textContent = 'Kept offline';
          say(kept);
        }
      };
      navigator.serviceWorker.addEventListener('message', onReply);
      controller.postMessage({ type: 'cache-unit-audio', unitId, voice });
    });
  }
  return { button, line };
}

/**
 * @param {HTMLElement} container
 * @param {App} app
 * @param {Record<string, string>} [params] `id` is the unit, `u01`
 */
export function renderUnit(container, app, params = {}) {
  const id = params.id ?? '';
  const unit = app.index.units.find((candidate) => candidate.id === id);
  const back = h('p', { class: 'back' }, h('a', { class: 'back-link', href: '#/hive' }, 'Back to the hive'));
  if (!unit) {
    mount(container, h('section', { class: 'screen screen-unit' },
      back,
      h('h1', { class: 'screen-title' }, 'Unit not found'),
      h('p', { class: 'en-text' }, 'This unit is not in the course.')));
    return;
  }
  const now = Date.now();
  const retention = app.state.settings.desiredRetention;
  const options = { allowPending: app.allowPending };
  const states = onlyKnown(app.state.items, app.known);
  const content = app.units.find((candidate) => candidate.unit.id === id);
  const lessons = content?.lessons ?? [];
  const fill = content && lessons.length > 0 ? hiveFill(states, content, now, retention, options) : null;
  const sealedOn = app.state.meta.sealed?.[id];
  /** @param {import('../../content/types.js').Lesson} lesson @returns {number} the items that count */
  const counted = (lesson) => lesson.items.filter((item) => app.allowPending || item.verification.status === 'accepted').length;
  const checkable = lessons.some((lesson) => counted(lesson) > 0);
  const offline = keepOffline(app, unit.id);

  mount(container, h('section', { class: 'screen screen-unit' },
    back,
    h('header', { class: 'unit-head' },
      h('p', { class: 'eyebrow' }, `Unit ${unit.order}`, sealedOn ? h('span', { class: 'tag' }, 'Sealed') : null),
      h('h1', { class: 'sl-display', lang: 'sl' }, unit.title_sl),
      h('p', { class: 'en-text' }, unit.title_en)),
    sealedOn ? h('p', { class: 'quiet' }, `Checkpoint passed on ${formatDate(sealedOn)}.`) : null,
    fill ? meter('unit-recall', fill.fill) : null,
    lessons.length === 0
      ? h('p', { class: 'en-text' }, "This unit's lessons are not in the course yet.")
      : h('ol', { class: 'lesson-list' }, lessons.map((lesson) => {
        const items = counted(lesson);
        return h('li', { class: 'lesson-entry' },
          h('p', { class: 'eyebrow' }, `Lesson ${lesson.order}`, h('span', { class: 'tag' }, `${items} ${items === 1 ? 'item' : 'items'}`)),
          h('p', { class: 'sl-title', lang: 'sl' }, lesson.title_sl),
          h('p', { class: 'en-text' }, lesson.title_en),
          meter(`lesson-recall-${lesson.id}`, lessonFill(states, lesson, now, retention, options)));
      })),
    h('div', { class: 'actions actions-stack' },
      checkable
        ? h('a', { class: 'btn btn-primary', href: `#/checkpoint?unit=${unit.id}` }, 'Take the checkpoint')
        : h('button', { type: 'button', class: 'btn btn-primary', 'aria-disabled': 'true' }, 'Take the checkpoint'),
      offline.button),
    offline.line));
}
