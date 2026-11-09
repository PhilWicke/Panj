// The Words screen (Besede, spec 6): every lesson item met so far (its state past `new`), in course
// order, each with its English, its helper line and first example when it has them, its register,
// its phase or "mastered", a play button (not in mute mode) and "Report this", which keeps a
// one-line note as a flag; flags travel with the export and feed the ask-a-native list. The top
// line counts the rows below it, "n items met" (Ruling 61; the hive's "Words met" is the lemma
// count). A search box filters on the Slovenian and the English, ignoring case and diacritics. The
// pure parts are exported for the tests.

import { h, mount, svg } from '../../util/dom.js';
import { stripDiacritics } from '../../engine/grading.js';
import { addFlag } from '../../store/state.js';

/** @typedef {import('../../app-types.js').App} App */
/** @typedef {import('../../content/types.js').Item} Item */
/** @typedef {import('../../content/types.js').Register} Register */
/** @typedef {'learning'|'review'|'lapsed'|'mastered'} WordStatus */
/** @typedef {{ item: Item, status: WordStatus }} WordRow */

/** The longest note a flag keeps. */
const NOTE_MAX = 200;
/** @type {Record<Register, string>} */
const REGISTER = { neutral: 'Neutral', colloquial: 'Colloquial', formal: 'Formal', recognition: 'To recognise' };
/** @type {Record<WordStatus, string>} */
const STATUS = { learning: 'Learning', review: 'Review', lapsed: 'Lapsed', mastered: 'Mastered' };

/** @param {string} text @returns {string} lowercase and without diacritics */
const fold = (text) => stripDiacritics(text).toLowerCase();

/**
 * Whether an item matches the search: every word of the query occurs in its Slovenian or its
 * English, ignoring case and diacritics, as the Rules search does. An empty query matches every item.
 * @param {Item} item
 * @param {string} query
 * @returns {boolean}
 */
export function matchesWord(item, query) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const text = fold(`${item.sl} ${item.en}`);
  return words.every((word) => text.includes(word));
}

/**
 * The rows of the list: the lesson items whose state is past `new` and that match the query, in
 * course order (the index's lessons in order, then the items of each lesson in order). Rule cards
 * share the states but are not lesson items, so they never appear. A mastered item says
 * "mastered", whatever its phase.
 * @param {Pick<App, 'index' | 'lessons' | 'state'>} app
 * @param {string} query
 * @returns {WordRow[]}
 */
export function wordRows(app, query) {
  /** @type {WordRow[]} */
  const rows = [];
  for (const entry of app.index.lessonIndex) {
    const lesson = app.lessons.get(entry.id);
    if (!lesson) continue;
    for (const item of lesson.items) {
      const state = app.state.items[item.id];
      if (!state || state.phase === 'new' || !matchesWord(item, query)) continue;
      rows.push({ item, status: state.mastered ? 'mastered' : state.phase });
    }
  }
  return rows;
}

/**
 * What a row shows under the word: the item's helper line when it is a non-empty string, and its
 * first example when it has one; null for either it lacks.
 * @param {Item} item
 * @returns {{ helper: string|null, example: { sl: string, en: string }|null }}
 */
export function wordDetails(item) {
  const helper = typeof item.helper === 'string' && item.helper !== '' ? item.helper : null;
  return { helper, example: item.examples[0] ?? null };
}

/**
 * The top line: how many items the list holds.
 * @param {number} count the rows
 * @returns {string} "1 item met", "12 items met"
 */
export function metLine(count) {
  return `${count} ${count === 1 ? 'item' : 'items'} met`;
}

/** @returns {SVGElement} a small speaker */
function speakerIcon() {
  return svg('svg', { class: 'word-play-icon', viewBox: '0 0 24 24', 'aria-hidden': 'true' },
    svg('path', { d: 'M4 9.5v5h3.5l5 4v-13l-5 4z' }),
    svg('path', { d: 'M15.5 8.5a5 5 0 0 1 0 7', fill: 'none', 'stroke-width': 2, 'stroke-linecap': 'round' }));
}

/**
 * "Report this" and the note field it opens. Saving adds the flag to the store and to the app's
 * state, then says where the flag goes; the line takes the focus, since the field it was in goes.
 * @param {Item} item
 * @param {App} app
 * @returns {HTMLElement}
 */
function renderReport(item, app) {
  const fieldId = `word-note-${item.id}`;
  const formId = `word-report-${item.id}`;
  const done = h('p', { class: 'quiet word-report-done', role: 'status', tabindex: '-1' });
  const note = /** @type {HTMLInputElement} */ (h('input', {
    id: fieldId, type: 'text', class: 'text-input', maxlength: String(NOTE_MAX), autocomplete: 'off', enterkeyhint: 'done',
  }));
  let saving = false;
  const form = h('form', {
    class: 'word-report', id: formId, hidden: true,
    onsubmit: async (/** @type {SubmitEvent} */ event) => {
      event.preventDefault();
      if (saving) return;
      saving = true;
      const flag = { itemId: item.id, note: note.value.trim().slice(0, NOTE_MAX), at: Date.now() };
      try {
        await addFlag(app.adapter, flag);
        app.state.flags.push(flag);
        done.textContent = 'Noted. Flags travel with your export.';
        form.hidden = true;
        open.hidden = true;
        done.focus();
      } catch {
        saving = false;
        done.textContent = 'The note could not be saved. Try again.';
      }
    },
  },
  h('label', { class: 'field-label', for: fieldId }, 'What looks wrong?'),
  h('div', { class: 'word-report-row' }, note, h('button', { type: 'submit', class: 'btn btn-secondary' }, 'Save note')));
  const open = h('button', {
    type: 'button', class: 'btn btn-quiet word-report-open', 'aria-expanded': 'false', 'aria-controls': formId,
    onclick: () => {
      const opening = form.hidden;
      form.hidden = !opening;
      open.setAttribute('aria-expanded', String(opening));
      if (opening) note.focus();
    },
  }, 'Report this');
  return h('div', { class: 'word-report-wrap' }, open, form, done);
}

/**
 * One entry of the list.
 * @param {WordRow} row
 * @param {App} app
 * @returns {HTMLElement}
 */
function renderEntry({ item, status }, app) {
  const { helper, example } = wordDetails(item);
  const play = !app.state.settings.mute && h('button', {
    type: 'button', class: 'btn btn-quiet word-play', 'aria-label': `Play ${item.sl}`,
    onclick: () => { void app.player.play(item.sl); },
  }, speakerIcon());
  return h('li', { class: 'word-entry' },
    h('div', { class: 'word-head' },
      h('div', { class: 'word-text' },
        h('p', { class: 'sl-title', lang: 'sl' }, item.sl),
        h('p', { class: 'en-text' }, item.en)),
      play),
    helper && h('p', { class: 'helper word-helper' }, helper),
    example && h('p', { class: 'word-example' },
      h('span', { class: 'sl-text', lang: 'sl' }, example.sl),
      h('span', { class: 'en-text' }, example.en)),
    h('p', { class: 'word-meta' },
      h('span', { class: 'tag' }, REGISTER[item.register] ?? item.register),
      h('span', { class: `word-status word-status-${status}` }, STATUS[status])),
    renderReport(item, app));
}

/**
 * @param {HTMLElement} container
 * @param {App} app
 */
export function renderWords(container, app) {
  const title = h('h1', { class: 'screen-title' }, 'Words');
  const rows = wordRows(app, '');
  if (rows.length === 0) {
    mount(container, h('section', { class: 'screen screen-words' }, title,
      h('p', { class: 'en-text' }, 'Words appear here as you meet them.')));
    return;
  }

  const entries = rows.map((row) => ({ row, entry: renderEntry(row, app) }));
  const none = h('p', { class: 'en-text', hidden: true }, 'No word matches your search.');
  const search = /** @type {HTMLInputElement} */ (h('input', {
    id: 'words-search', type: 'search', class: 'search-input', placeholder: 'Search words',
    autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'search',
    oninput: () => {
      for (const { row, entry } of entries) entry.hidden = !matchesWord(row.item, search.value);
      none.hidden = entries.some(({ entry }) => !entry.hidden);
    },
  }));

  mount(container, h('section', { class: 'screen screen-words' },
    title,
    h('p', { class: 'quiet word-count' }, metLine(rows.length)),
    h('div', { class: 'search' }, h('label', { class: 'visually-hidden', for: 'words-search' }, 'Search words'), search),
    h('ul', { class: 'word-list' }, entries.map(({ entry }) => entry)),
    none));
}
