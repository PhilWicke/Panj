// Meet: the first sight of a new item (spec 4.3). The Slovenian form large, the English under it,
// the colloquial form and the helper line when the item has them, a Listen button (not in mute
// mode) and "Show breakdown", which splits the chunk into its words and shows the examples. "I'm
// ready" goes on to the first typed recall. A meet records nothing.

import { h, mount } from '../../util/dom.js';

/** @typedef {import('./registry.js').ExerciseRender} ExerciseRender */

/** @type {Record<string, string>} */
const EYEBROW = { chunk: 'New phrase', word: 'New word', form: 'New form' };
/** @type {Record<string, string>} */
const REGISTER = { colloquial: 'Colloquial', formal: 'Formal', recognition: 'To recognise' };

/**
 * The words of a chunk, without the punctuation around them: "Dober dan." gives Dober, dan.
 * @param {string} text
 * @returns {string[]}
 */
function wordsOf(text) {
  return text.split(/\s+/).map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter(Boolean);
}

/** @type {ExerciseRender} */
export function render(container, entry, ctx) {
  const item = ctx.item;
  if (!item) return Promise.resolve({});
  return new Promise((resolve) => {
    const breakdownId = `breakdown-${item.id}`;
    const breakdown = h('div', { class: 'breakdown reveal', id: breakdownId, hidden: true },
      h('ul', { class: 'chips', lang: 'sl', 'aria-label': 'Words' }, wordsOf(item.sl).map((word) => h('li', { class: 'chip' }, word))),
      item.examples.length > 0 && h('ul', { class: 'examples', 'aria-label': 'Examples' }, item.examples.map((example) =>
        h('li', null, h('p', { class: 'sl-text', lang: 'sl' }, example.sl), h('p', { class: 'en-text' }, example.en)))));

    const toggle = h('button', {
      type: 'button', class: 'btn btn-secondary', 'aria-expanded': 'false', 'aria-controls': breakdownId,
      onclick: () => {
        const open = breakdown.hidden;
        breakdown.hidden = !open;
        toggle.setAttribute('aria-expanded', String(open));
        toggle.textContent = open ? 'Hide breakdown' : 'Show breakdown';
      },
    }, 'Show breakdown');

    const voiceNote = h('p', { class: 'quiet', hidden: true }, 'Slovenian audio is not available on this device yet.');
    const listen = !ctx.mode.mute && h('button', {
      type: 'button', class: 'btn btn-secondary',
      onclick: async () => {
        const how = await ctx.play(item.sl);
        if (how === 'none' && listen) {
          listen.setAttribute('disabled', '');
          voiceNote.hidden = false;
        }
      },
    }, 'Listen');

    const ready = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => resolve({ itemId: item.id }) }, "I'm ready");

    mount(container, h('article', { class: 'exercise exercise-meet' },
      h('p', { class: 'eyebrow' }, EYEBROW[item.type] ?? 'New item',
        REGISTER[item.register] && h('span', { class: 'tag' }, REGISTER[item.register])),
      h('h2', { class: 'sl-display', lang: 'sl' }, item.sl),
      item.sl_colloquial && h('p', { class: 'quiet' }, 'Often heard as ', h('span', { lang: 'sl' }, item.sl_colloquial)),
      h('p', { class: 'en-text' }, item.en),
      item.helper && h('p', { class: 'helper' }, item.helper),
      h('div', { class: 'tools' }, listen, toggle),
      voiceNote,
      breakdown,
      h('div', { class: 'actions' }, ready)));
    ready.focus();
  });
}
