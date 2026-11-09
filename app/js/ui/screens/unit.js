// The unit page (spec 6, concept sections 3 and 5), reached from a strip of the hive. Under the
// unit's titles comes its strip drawn large (renderStrip) with the lesson titles under the cells:
// a bundled lesson's title is a button, and it or the lesson's cell opens the lesson's sheet
// (`#/unit?id=uNN&lesson=uNN-lNN`); a lesson the bundle does not carry yet is a quiet label. A
// line under the titles says how many of the unit's reviews are due (unitDue), so a sealed unit
// that has drained keeps its paint and says what is due. The sheet shows the lesson's title, its
// state (sheetStateLine), its items with Listen (not in mute mode) and its rule cards, and nothing
// in it starts practice: practice runs through Today, in course order. Then whether the unit's
// checkpoint sealed it and when, how much of it can be recalled now, the link to the unit's
// checkpoint (`#/checkpoint?unit=uNN`, once the unit has an item to check), and "Keep offline",
// which asks the service worker to cache the unit's clips in the learner's voice (Task 19): it
// needs a recorded voice (the device voice downloads nothing) and a worker controlling the page
// (which the first load lacks until one reload). The page stops waiting for the worker's reply
// when the learner leaves it (renderUnit returns the function main.js calls then) or after a
// minute.

import { h, mount } from '../../util/dom.js';
import { formatDateEn } from '../../util/time.js';
import { onlyKnown } from '../../content/loader.js';
import { navigate } from '../../router.js';
import { cellState, hiveFill, lessonFill, unitDue } from '../../engine/progress.js';
import { practisable } from '../../engine/course.js';
import { voiceFor } from '../../audio/player.js';
import { renderStrip, stripCells } from '../components/hive.js';

/** @typedef {import('../../app-types.js').App} App */
/** @typedef {import('../../content/types.js').Unit} Unit */
/** @typedef {import('../../content/types.js').Lesson} Lesson */
/** @typedef {import('../../engine/scheduler.js').ItemState} ItemState */
/** @typedef {import('../../engine/progress.js').CellState} CellState */
/** @typedef {import('../../engine/progress.js').HiveFill} HiveFill */
/** @typedef {import('../../engine/progress.js').FillOptions} FillOptions */

/** How long "Keep offline" waits for the worker's reply before it offers the button again. */
const KEEP_OFFLINE_WAIT_MS = 60_000;

/**
 * The sheet's line for the lesson's state, the recall share worded for a lesson in progress.
 * @param {CellState} state the lesson's cellState
 * @param {number} fill the lesson's lessonFill, 0 to 1
 * @returns {string}
 */
export function sheetStateLine(state, fill) {
  if (state === 'learned') return 'Learned';
  if (state === 'in-progress') return `In progress, ${Math.round(fill * 100)} percent recalled now`;
  return 'Not started';
}

/**
 * The line under the strip's titles.
 * @param {number} n the unit's items due for review (unitDue)
 * @returns {string}
 */
export function dueLine(n) {
  if (n === 0) return 'Nothing due in this unit';
  return n === 1 ? '1 item due for review' : `${n} items due for review`;
}

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
 * The "Keep offline" button and its quiet line. With a recorded voice and a controlling worker
 * the button posts `cache-unit-audio` and reads "Keeping offline…" until the worker's
 * `unit-audio-cached` reply, then "Kept offline" with how many of the unit's clips the phone
 * holds; a reply with `error` offers the button again, and so does a wait of a minute without a
 * reply, with a quiet line. `stop` ends the wait without a word, for a learner leaving the page.
 * With the device voice, or without a controller, the button looks disabled and the line says why.
 * @param {App} app
 * @param {string} unitId
 * @returns {{ button: HTMLElement, line: HTMLElement, stop: () => void }}
 */
function keepOffline(app, unitId) {
  const voice = voiceFor(app.state.settings.voice);
  const controller = navigator.serviceWorker?.controller ?? null;
  const button = h('button', { type: 'button', class: 'btn btn-secondary' }, 'Keep offline');
  const line = h('p', { class: 'quiet', hidden: true });
  /** The wait for a reply in progress, ended by `stop`. @type {(() => void)|null} */
  let waiting = null;
  const stop = () => {
    waiting?.();
    waiting = null;
  };
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
      /** Back to the button as it was, for another try. */
      const offerAgain = () => {
        button.removeAttribute('aria-busy');
        button.textContent = 'Keep offline';
      };
      /** @param {MessageEvent} event */
      const onReply = (event) => {
        const data = event.data;
        if (!data || data.type !== 'unit-audio-cached' || data.unitId !== unitId) return;
        stop();
        const kept = `${data.count} of ${data.total} ${data.total === 1 ? 'clip' : 'clips'} kept on this phone.`;
        if (data.error) {
          offerAgain();
          say(`${kept} The rest could not be fetched; try again later.`);
        } else {
          button.removeAttribute('aria-busy');
          button.textContent = 'Kept offline';
          say(kept);
        }
      };
      const timer = setTimeout(() => {
        stop();
        offerAgain();
        say('That took too long. Try again.');
      }, KEEP_OFFLINE_WAIT_MS);
      waiting = () => {
        clearTimeout(timer);
        navigator.serviceWorker.removeEventListener('message', onReply);
      };
      navigator.serviceWorker.addEventListener('message', onReply);
      controller.postMessage({ type: 'cache-unit-audio', unitId, voice });
    });
  }
  return { button, line, stop };
}

/**
 * The lesson titles under the strip, one per cell in a grid of as many columns: a bundled lesson's
 * Slovenian title is a button that opens its sheet, a lesson the bundle does not carry yet is a
 * quiet label with its position.
 * @param {Unit} unit
 * @param {HiveFill} fill
 * @param {Lesson[]} lessons the unit's bundled lessons
 * @param {(lessonId: string) => void} open
 * @returns {HTMLElement}
 */
function stripTitles(unit, fill, lessons, open) {
  const byId = new Map(lessons.map((lesson) => [lesson.id, lesson]));
  const cells = stripCells(unit, fill);
  return h('ol', { class: 'strip-titles', style: { '--cells': cells.length } }, cells.map((cell) => {
    const lesson = cell.lessonId === null ? undefined : byId.get(cell.lessonId);
    return h('li', null, lesson
      ? h('button', {
        type: 'button', class: 'strip-title', 'aria-label': `Lesson ${lesson.order}, ${lesson.title_sl}, ${lesson.title_en}`,
        onclick: () => open(lesson.id),
      }, h('span', { lang: 'sl' }, lesson.title_sl))
      : h('span', { class: 'quiet' }, `Lesson ${cell.position}`));
  }));
}

/**
 * A lesson's sheet: its title, which takes the focus, its state, its practisable items with Listen
 * (none in mute mode), the rule cards it introduces that the bundle carries, and Close. It offers
 * no practice.
 * @param {App} app
 * @param {Unit} unit
 * @param {Lesson} lesson
 * @param {{ states: Record<string, ItemState>, now: number, retention: number, options: FillOptions }} inputs the states, time, target and options the unit's meter uses
 * @returns {{ sheet: HTMLElement, heading: HTMLElement }}
 */
function lessonSheet(app, unit, lesson, { states, now, retention, options }) {
  const headingId = `lesson-sheet-${lesson.id}`;
  const heading = h('h2', { class: 'sl-title', id: headingId, lang: 'sl', tabindex: '-1' }, lesson.title_sl);
  const state = cellState(states, lesson, now, retention, options);
  const items = lesson.items.filter((item) => practisable(item, app.allowPending));
  const rules = lesson.rules.flatMap((id) => app.rules.get(id) ?? []);
  const listen = !app.state.settings.mute;
  const sheet = h('section', { class: 'lesson-sheet', 'aria-labelledby': headingId },
    h('p', { class: 'eyebrow' }, `Lesson ${lesson.order}`),
    heading,
    h('p', { class: 'en-text' }, lesson.title_en),
    h('p', { class: 'sheet-state' }, sheetStateLine(state, lessonFill(states, lesson, now, retention, options))),
    h('h3', { class: 'section-title' }, 'Words and phrases'),
    h('ul', { class: 'sheet-items' }, items.map((item) => h('li', { class: 'sheet-item' },
      h('div', null,
        h('p', { class: 'sl-text', lang: 'sl' }, item.sl),
        h('p', { class: 'en-text' }, item.en)),
      listen && h('button', {
        type: 'button', class: 'btn btn-secondary', 'aria-label': `Listen to ${item.sl}`,
        onclick: () => { void app.player.play(item.sl); },
      }, 'Listen')))),
    rules.length > 0 && [
      h('h3', { class: 'section-title' }, 'Rule cards'),
      h('ul', { class: 'sheet-rules' }, rules.map((rule) => h('li', { class: 'rule-card rule-card-compact' },
        h('h4', { class: 'rule-title' }, rule.title_en),
        h('p', { class: 'rule-text' }, rule.card_en),
        h('div', { class: 'rule-example' },
          h('p', { class: 'rule-example-sl', lang: 'sl' }, rule.example.sl),
          h('p', { class: 'en-text' }, rule.example.en))))),
    ],
    h('p', { class: 'quiet' }, 'Practice runs through Today, in course order.'),
    h('div', { class: 'actions' }, h('a', { class: 'btn btn-secondary', href: `#/unit?id=${unit.id}` }, 'Close')));
  return { sheet, heading };
}

/**
 * @param {HTMLElement} container
 * @param {App} app
 * @param {Record<string, string>} [params] `id` is the unit, `u01`; `lesson`, a lesson of the unit, `u01-l02`, opens its sheet
 * @returns {() => void} ends a "Keep offline" wait when the learner leaves the page
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
    return () => {};
  }
  const now = Date.now();
  const retention = app.state.settings.desiredRetention;
  const options = { allowPending: app.allowPending };
  const states = onlyKnown(app.state.items, app.known);
  const content = app.units.find((candidate) => candidate.unit.id === id);
  const lessons = content?.lessons ?? [];
  const fill = content && lessons.length > 0 ? hiveFill(states, content, now, retention, options) : null;
  const sealedOn = app.state.meta.sealed?.[id];
  const checkable = lessons.some((lesson) => lesson.items.some((item) => practisable(item, app.allowPending)));
  const offline = keepOffline(app, unit.id);
  /** @param {string} lessonId */
  const open = (lessonId) => navigate(`/unit?id=${unit.id}&lesson=${lessonId}`);
  const asked = lessons.find((lesson) => lesson.id === params.lesson);
  const shown = asked ? lessonSheet(app, unit, asked, { states, now, retention, options }) : null;

  mount(container, h('section', { class: 'screen screen-unit' },
    back,
    h('header', { class: 'unit-head' },
      h('p', { class: 'eyebrow' }, `Unit ${unit.order}`, sealedOn ? h('span', { class: 'tag' }, 'Sealed') : null),
      h('h1', { class: 'sl-display', lang: 'sl' }, unit.title_sl),
      h('p', { class: 'en-text' }, unit.title_en)),
    fill && content
      ? [
        h('div', { class: 'unit-strip' },
          renderStrip(fill, unit, { sealed: Boolean(sealedOn), onCell: open }),
          stripTitles(unit, fill, lessons, open),
          h('p', { class: 'unit-due' }, dueLine(unitDue(states, content, now, options)))),
        shown?.sheet,
      ]
      : h('p', { class: 'en-text' }, "This unit's lessons are not in the course yet."),
    sealedOn ? h('p', { class: 'quiet' }, `Checkpoint passed on ${formatDateEn(sealedOn)}.`) : null,
    fill ? meter('unit-recall', fill.fill) : null,
    h('div', { class: 'actions actions-stack' },
      checkable
        ? h('a', { class: 'btn btn-primary', href: `#/checkpoint?unit=${unit.id}` }, 'Take the checkpoint')
        : h('button', { type: 'button', class: 'btn btn-primary', 'aria-disabled': 'true' }, 'Take the checkpoint'),
      offline.button),
    offline.line));
  shown?.heading.focus();
  return offline.stop;
}
