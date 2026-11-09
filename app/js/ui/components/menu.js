// The closing menu (spec 4.4): the options closingMenu (engine/session.js) allows, in its order,
// each a full-width button, the first the primary action. onPick gets the option picked; the
// session screen maps it to a route. Given `onCantTalk`, a quiet "Can't talk right now" follows
// "A speaking round", for a learner who can't talk right now; the session screen leaves it out
// once that choice holds.

import { h } from '../../util/dom.js';
import { QUIET_LABELS } from '../quiet.js';

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
 * @param {{ onCantTalk?: () => void }} [opts] `onCantTalk` adds "Can't talk right now" after the speaking round, when it is offered
 * @returns {HTMLElement}
 */
export function renderMenu(options, onPick, { onCantTalk } = {}) {
  return h('div', { class: 'actions actions-stack closing-menu' }, options.map((option, i) => [
    h('button', { type: 'button', class: i === 0 ? 'btn btn-primary' : 'btn btn-secondary', onclick: () => onPick(option) }, MENU_LABELS[option]),
    option === 'speaking' && onCantTalk && h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => onCantTalk() }, QUIET_LABELS.talk),
  ]));
}
