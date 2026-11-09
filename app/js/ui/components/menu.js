// The closing menu (spec 4.4): the options closingMenu (engine/session.js) allows, in its order,
// each a full-width button, the first the primary action. onPick gets the option picked; the
// session screen maps it to a route.

import { h } from '../../util/dom.js';

/** @typedef {ReturnType<typeof import('../../engine/session.js').closingMenu>[number]} MenuOption */

/** @type {Readonly<Record<MenuOption, string>>} */
const MENU_LABELS = Object.freeze({
  stop: 'Stop here',
  more3: 'Three more minutes',
  speaking: 'A speaking round',
  continue: 'Continue the lesson',
});

/**
 * @param {MenuOption[]} options in display order
 * @param {(option: MenuOption) => void} onPick
 * @returns {HTMLElement}
 */
export function renderMenu(options, onPick) {
  return h('div', { class: 'actions actions-stack closing-menu' }, options.map((option, i) =>
    h('button', { type: 'button', class: i === 0 ? 'btn btn-primary' : 'btn btn-secondary', onclick: () => onPick(option) }, MENU_LABELS[option])));
}
