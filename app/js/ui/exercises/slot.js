// Slot production: a known chunk with a new filler, typed (spec 4.2, point 4). The English
// instruction, the base chunk with its slot labels marked (left out when the chunk is itself the
// answer, so the exercise never shows what it asks for), and a typed input set up as the typed
// recall's is. The answer is graded against the exercise's answer and accepted variants, the
// feedback panel shows the result, and the outcome is a recall of the exercise's item; the
// session screen records it and plays a missed slot as planned (Ruling 22). The answer field is
// shared with the dialogue's learner lines.

import { h, mount } from '../../util/dom.js';
import { grade } from '../../engine/grading.js';
import { renderFeedback } from '../components/feedback.js';

/** @typedef {import('./registry.js').ExerciseRender} ExerciseRender */
/** @typedef {import('./registry.js').ExerciseOutcome} ExerciseOutcome */
/** @typedef {import('../../engine/scheduler.js').RecallResult} RecallResult */
/** @typedef {import('../../content/types.js').Item} Item */
/** @typedef {import('../../content/types.js').ProductionExercise} ProductionExercise */

/**
 * The base chunk to show and the labels of its slots, or null when the chunk would be accepted as
 * the answer (as written, an accepted variant, or the same but for diacritics): then showing it
 * would give the answer away.
 * @param {Item} item the chunk the exercise practises
 * @param {ProductionExercise} exercise
 * @returns {{ chunk: string, labels: string[] }|null}
 */
export function slotBase(item, exercise) {
  if (grade(item.sl, exercise.answer, exercise.accept ?? []).result !== 'wrong') return null;
  return { chunk: item.sl, labels: (item.slots ?? []).map((slot) => slot.label) };
}

/**
 * What a slot answer reports: a recall of the exercise's item, as graded.
 * @param {ProductionExercise} exercise
 * @param {RecallResult} result
 * @returns {ExerciseOutcome}
 */
export function slotOutcome(exercise, result) {
  return { itemId: exercise.item, recall: result };
}

/**
 * A typed answer field as the typed recall has it: an input set up for Slovenian (no
 * autocapitalise, autocomplete, autocorrect or spellcheck), Enter or "Check" to submit, "I don't
 * know" to submit nothing. `onAnswer` is called once; the field then locks.
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

/** @type {ExerciseRender} */
export function render(container, entry, ctx) {
  const exercise = ctx.lesson?.production.find((each) => each.id === entry.exerciseId);
  const item = ctx.item;
  if (!exercise || !item) return Promise.resolve({});
  return new Promise((resolve) => {
    const base = slotBase(item, exercise);
    const feedbackSlot = h('div', { class: 'feedback-slot' });
    const { form, input } = answerField({
      id: `answer-${exercise.id}`,
      label: 'Your answer in Slovenian',
      onAnswer: (answer) => {
        const graded = grade(answer, exercise.answer, exercise.accept ?? []);
        const panel = renderFeedback({
          answer, graded, effective: ctx.effective(exercise.item, graded.result), target: exercise.answer, rule: ctx.rule,
          onDone: () => resolve(slotOutcome(exercise, graded.result)),
        });
        feedbackSlot.append(panel);
        /** @type {HTMLElement|null} */ (panel.querySelector('[data-autofocus]'))?.focus();
      },
    });

    mount(container, h('article', { class: 'exercise exercise-slot' },
      h('p', { class: 'eyebrow' }, base ? 'Change the phrase' : 'Write in Slovenian'),
      h('h2', { class: 'prompt-en' }, exercise.en),
      base && h('div', { class: 'lesson-card' },
        h('p', { class: 'feedback-label' }, 'Start from'),
        h('p', { class: 'sl-title', lang: 'sl' }, base.chunk),
        base.labels.length > 0 && h('p', { class: 'eyebrow' }, base.labels.length === 1 ? 'Slot' : 'Slots',
          base.labels.map((label) => h('span', { class: 'tag' }, label)))),
      form,
      feedbackSlot));
    input.focus();
  });
}
