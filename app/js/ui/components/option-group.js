// The pick-one options that structured input, the listening meaning pick, the perception drill,
// the checkpoint's rule items and the rule card's quick check share (spec 4.2): a group of
// buttons, one per option in the order given, a result slot (a live region from the start) and
// an actions row. The first pick locks the group: every button is disabled, the answer is marked
// right and a wrong pick is marked wrong (struck through). The result slot then shows the
// headline ("Correct." or "Not quite.") above the exercise's own lines, and a Continue button,
// which takes the focus, hands the pick back to the exercise to resolve with; without onContinue
// there is no Continue (the rule card, whose exercise adds its own).

import { h } from '../../util/dom.js';

/** @typedef {import('../../util/dom.js').Child} Child */

/**
 * @typedef {object} OptionGroupOptions
 * @property {readonly string[]} options in the order they are shown
 * @property {string} answer the right option
 * @property {string} label the group's accessible name
 * @property {string} [lang] the options' language when it is not the page's: `sl` for Slovenian options
 * @property {boolean} [large] Slovenian options under an English question, set larger than it (`option-sl`)
 * @property {boolean} [stacked] one option per row, for long options such as English meanings
 * @property {(choice: string, correct: boolean) => Child} onPick called once, at the first pick
 *   and after the options lock; returns the exercise's own lines for the feedback under the headline
 * @property {(choice: string, correct: boolean) => void} [onContinue] called when Continue is
 *   tapped; without it the group adds no Continue
 */

/**
 * The options as a group of buttons, with the slot their feedback goes in and the row their
 * Continue goes in; the exercise places all three.
 * @param {OptionGroupOptions} opts
 * @returns {{ group: HTMLElement, buttons: HTMLButtonElement[], result: HTMLElement, actions: HTMLElement }}
 */
export function optionGroup({ options, answer, label, lang, large = false, stacked = false, onPick, onContinue }) {
  const result = h('div', { class: 'pick-result', 'aria-live': 'polite' });
  const actions = h('div', { class: 'actions' });
  let answered = false;

  /** @param {string} choice */
  const pick = (choice) => {
    if (answered) return;
    answered = true;
    const correct = choice === answer;
    options.forEach((option, i) => {
      buttons[i].disabled = true;
      if (option === answer) buttons[i].classList.add('option-right');
      else if (option === choice) buttons[i].classList.add('option-wrong');
    });
    const details = onPick(choice, correct);
    result.replaceChildren(h('section', { class: `feedback feedback-${correct ? 'correct' : 'wrong'}` },
      h('p', { class: 'feedback-headline' }, correct ? 'Correct.' : 'Not quite.'),
      details));
    if (!onContinue) return;
    const next = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => onContinue(choice, correct) }, 'Continue');
    actions.append(next);
    next.focus();
  };

  /** @type {HTMLButtonElement[]} */
  const buttons = options.map((option) => /** @type {HTMLButtonElement} */ (h('button', {
    type: 'button', class: `btn btn-secondary option${large ? ' option-sl' : ''}`, lang, onclick: () => pick(option),
  }, option)));
  const group = h('div', { class: `options${stacked ? ' actions-stack' : ''}`, role: 'group', 'aria-label': label }, buttons);
  return { group, buttons, result, actions };
}
