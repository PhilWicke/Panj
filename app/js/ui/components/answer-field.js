// The typed answer and its feedback, shared by every exercise that asks for typed Slovenian: the
// typed recall, the slot production and the dialogue's learner lines (spec 4.5). answerField
// builds the form: an input set up for Slovenian (no autocapitalise, autocomplete, autocorrect or
// spellcheck), Enter or "Check" to submit, "I don't know" to submit nothing; it locks once
// answered. mountFeedback puts the feedback panel in its slot and moves the focus to the action
// the panel marks (Continue, or "Type it again" after a miss).

import { h } from '../../util/dom.js';
import { renderFeedback } from './feedback.js';

/**
 * A typed answer field. `onAnswer` is called once, with the answer as typed (an empty answer for
 * "I don't know"; Enter or "Check" on a blank field does nothing); the field then locks.
 * @param {{ id: string, label: string, onAnswer(answer: string): void }} opts
 * @returns {{ form: HTMLElement, input: HTMLInputElement }}
 */
export function answerField({ id, label, onAnswer }) {
  let answered = false;
  const input = /** @type {HTMLInputElement} */ (h('input', {
    id, type: 'text', class: 'answer-input', lang: 'sl', autocapitalize: 'off', autocomplete: 'off',
    autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'done',
  }));
  /** @param {string} answer */
  const submit = (answer) => {
    if (answered) return;
    answered = true;
    input.readOnly = true;
    buttons.hidden = true;
    onAnswer(answer);
  };
  const buttons = h('div', { class: 'actions' },
    h('button', { type: 'submit', class: 'btn btn-primary' }, 'Check'),
    h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => submit('') }, "I don't know"));
  const form = h('form', {
    class: 'answer-form',
    onsubmit: (/** @type {SubmitEvent} */ event) => {
      event.preventDefault();
      if (input.value.trim()) submit(input.value);
    },
  },
  h('label', { class: 'visually-hidden', for: id }, label),
  input,
  buttons);
  return { form, input };
}

/**
 * Shows the feedback panel for an answer in `slot` and focuses the action it marks.
 * @param {HTMLElement} slot the element the panel goes in, after the answer field
 * @param {Parameters<typeof renderFeedback>[0]} opts as renderFeedback takes them
 * @returns {HTMLElement} the panel
 */
export function mountFeedback(slot, opts) {
  const panel = renderFeedback(opts);
  slot.append(panel);
  /** @type {HTMLElement|null} */ (panel.querySelector('[data-autofocus]'))?.focus();
  return panel;
}
