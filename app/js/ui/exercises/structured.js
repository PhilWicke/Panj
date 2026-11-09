// Structured input: choose the form or ending in context (spec 4.2, point 3). The Slovenian
// sentence with its blank as a visible gap, the English under it, and the options as buttons in a
// shuffled order. A pick fills the gap with the answer and marks the right option; a wrong pick is
// struck through and the rule's one-line card explains it. "Continue" resolves with `aux` only:
// structured input keeps its own counter and never changes recall state.

import { h, mount } from '../../util/dom.js';
import { shuffle } from '../../util/shuffle.js';
import { optionGroup } from '../components/option-group.js';

/** @typedef {import('./registry.js').ExerciseRender} ExerciseRender */
/** @typedef {import('./registry.js').ExerciseOutcome} ExerciseOutcome */
/** @typedef {import('../../content/types.js').StructuredExercise} StructuredExercise */

/** The blank in a prompt: the first run of underscores (Ruling 10). */
const BLANK = /_+/;

/**
 * The prompt's text before and after its blank. A prompt without a blank is all `before`.
 * @param {string} prompt `prompt_sl`, as "Jaz ___ tukaj." or "Pijem kav_"
 * @returns {{ before: string, after: string }}
 */
export function blankify(prompt) {
  const match = BLANK.exec(prompt);
  if (!match) return { before: prompt, after: '' };
  return { before: prompt.slice(0, match.index), after: prompt.slice(match.index + match[0].length) };
}

/**
 * The Slovenian prompt with its blank as a gap that screen readers announce as "blank".
 * @param {string} prompt
 * @returns {{ prompt: HTMLElement, blank: HTMLElement }} the blank, to fill once the learner has picked
 */
export function promptWithBlank(prompt) {
  const { before, after } = blankify(prompt);
  const blank = h('span', { class: 'blank' }, h('span', { class: 'visually-hidden' }, 'blank'));
  return { prompt: h('p', { class: 'quick-check-prompt', lang: 'sl' }, before || null, blank, after || null), blank };
}

/**
 * What a pick reports: whether it was the answer, as `aux` only.
 * @param {StructuredExercise} exercise
 * @param {string} choice
 * @returns {ExerciseOutcome}
 */
export function structuredOutcome(exercise, choice) {
  return { aux: { kind: 'structured', correct: choice === exercise.answer } };
}

/** @type {ExerciseRender} */
export function render(container, entry, ctx) {
  const exercise = ctx.lesson?.structured.find((each) => each.id === entry.exerciseId);
  if (!exercise) return Promise.resolve({});
  const rule = ctx.rules.find((each) => each.id === exercise.rule) ?? ctx.rule;
  return new Promise((resolve) => {
    const { prompt, blank } = promptWithBlank(exercise.prompt_sl);
    const { group, result, actions } = optionGroup({
      options: shuffle(exercise.options, ctx.rng), answer: exercise.answer, label: 'Options', lang: 'sl',
      onPick: (choice, correct) => {
        blank.replaceChildren(exercise.answer);
        blank.classList.add('blank-filled');
        return [
          !correct && h('p', null, 'The answer is ', h('span', { lang: 'sl', class: 'quick-check-answer' }, exercise.answer), '.'),
          !correct && rule && h('div', { class: 'rule-line' },
            h('p', { class: 'rule-line-title' }, rule.title_en),
            h('p', null, rule.card_en)),
        ];
      },
      onContinue: (choice) => resolve(structuredOutcome(exercise, choice)),
    });

    mount(container, h('article', { class: 'exercise exercise-structured' },
      h('p', { class: 'eyebrow' }, 'Choose the form'),
      prompt,
      h('p', { class: 'en-text' }, exercise.en),
      group,
      result,
      actions));
    // The sentence takes the focus, so a screen reader reads it before the options.
    prompt.setAttribute('tabindex', '-1');
    prompt.focus();
  });
}
