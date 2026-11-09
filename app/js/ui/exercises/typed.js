// Typed recall, English to Slovenian: the core exercise (spec 4.5). The English prompt, a text
// input set up for Slovenian (no autocapitalise, autocomplete, autocorrect or spellcheck), Enter or
// "Check" to submit, "I don't know" to see the answer. The answer is graded against the item's
// form and accepted variants, the feedback panel shows the result, and the outcome carries the
// recall as graded; the session screen records it. A fluency entry runs through here once per item.

import { h, mount } from '../../util/dom.js';
import { grade } from '../../engine/grading.js';
import { renderFeedback } from '../components/feedback.js';

/** @typedef {import('./registry.js').ExerciseRender} ExerciseRender */

/** @type {ExerciseRender} */
export function render(container, entry, ctx) {
  const item = ctx.item;
  if (!item) return Promise.resolve({});
  return new Promise((resolve) => {
    let answered = false;
    const inputId = `answer-${item.id}`;
    const input = /** @type {HTMLInputElement} */ (h('input', {
      id: inputId, type: 'text', class: 'answer-input', lang: 'sl', autocapitalize: 'off', autocomplete: 'off',
      autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'done',
    }));
    const buttons = h('div', { class: 'actions' },
      h('button', { type: 'submit', class: 'btn btn-primary' }, 'Check'),
      h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => submit('') }, "I don't know"));
    const feedbackSlot = h('div', { class: 'feedback-slot' });

    /** @param {string} answer */
    const submit = (answer) => {
      if (answered) return;
      answered = true;
      input.readOnly = true;
      buttons.hidden = true;
      const graded = grade(answer, item.sl, item.accept ?? []);
      const panel = renderFeedback({
        answer, graded, effective: ctx.effective(item.id, graded.result), target: item.sl, rule: ctx.rule,
        onDone: () => resolve({ itemId: item.id, recall: graded.result }),
      });
      feedbackSlot.append(panel);
      /** @type {HTMLElement|null} */ (panel.querySelector('[data-autofocus]'))?.focus();
    };

    const form = h('form', {
      class: 'answer-form',
      onsubmit: (/** @type {SubmitEvent} */ event) => {
        event.preventDefault();
        if (input.value.trim()) submit(input.value);
      },
    },
    h('label', { class: 'visually-hidden', for: inputId }, 'Your answer in Slovenian'),
    input,
    buttons);

    mount(container, h('article', { class: 'exercise exercise-typed' },
      h('p', { class: 'eyebrow' }, entry.kind === 'fluency' ? 'Quick round: write in Slovenian' : 'Write in Slovenian'),
      h('h2', { class: 'prompt-en' }, item.en),
      form,
      feedbackSlot));
    input.focus();
  });
}
