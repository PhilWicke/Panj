// Slot production: a known chunk with a new filler, typed (spec 4.2, point 4). The English
// instruction, the base chunk with the labels of its slots named under it (a label is English and
// cannot be found inside the chunk), and the shared typed answer field. The chunk is left out
// when it would itself be accepted as the answer, so the exercise never shows what it asks for;
// the exercise is then a typed recall from the instruction. The answer is graded against the
// exercise's answer and accepted variants, the feedback panel shows the result, and the outcome
// is a recall of the exercise's item; the session screen records it and plays a missed slot as
// planned (Ruling 22).

import { h, mount } from '../../util/dom.js';
import { grade } from '../../engine/grading.js';
import { answerField, feedbackSlot, mountFeedback } from '../components/answer-field.js';

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

/** @type {ExerciseRender} */
export function render(container, entry, ctx) {
  const exercise = ctx.lesson?.production.find((each) => each.id === entry.exerciseId);
  const item = ctx.item;
  if (!exercise || !item) return Promise.resolve({});
  return new Promise((resolve) => {
    const base = slotBase(item, exercise);
    const feedback = feedbackSlot();
    const { form, input } = answerField({
      id: `answer-${exercise.id}`,
      label: 'Your answer in Slovenian',
      onAnswer: (answer) => {
        const graded = grade(answer, exercise.answer, exercise.accept ?? []);
        mountFeedback(feedback, {
          answer, graded, effective: ctx.effective(exercise.item, graded.result), target: exercise.answer, rule: ctx.rule,
          onDone: () => resolve(slotOutcome(exercise, graded.result)),
        });
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
      feedback));
    input.focus();
  });
}
