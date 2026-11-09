// Listening (spec 4.2): hear a phrase, then write it (dictation) or pick its meaning from four
// English options, the three others being meanings of other items of the lesson. ctx.rng() < 0.5
// picks dictation, and a lesson with fewer than three other meanings always gets it. The phrase
// plays at once and "Play again" repeats it; its text shows only once the learner has answered.
// Listening never changes recall state: the outcome is `aux` only, and a dictation counts as
// correct when grade calls it correct or a slip. When nothing can play the phrase, the exercise
// says so and resolves with no outcome.

import { h, mount } from '../../util/dom.js';
import { shuffle } from '../../util/shuffle.js';
import { grade } from '../../engine/grading.js';
import { answerField, mountFeedback } from '../components/answer-field.js';
import { showNoAudio } from '../components/no-audio.js';

/** @typedef {import('./registry.js').ExerciseRender} ExerciseRender */
/** @typedef {import('./registry.js').ExerciseOutcome} ExerciseOutcome */
/** @typedef {import('../../content/types.js').Item} Item */
/** @typedef {import('../../content/types.js').Lesson} Lesson */

const DISTRACTORS = 3;

/**
 * The meaning pick's four options: the item's English among three English meanings of other
 * items of the lesson (none equal to the item's own), all shuffled with `rng`; null when the
 * lesson has fewer than three such meanings.
 * @param {Item} item
 * @param {Lesson|null} lesson
 * @param {() => number} rng
 * @returns {string[]|null}
 */
export function meaningOptions(item, lesson, rng) {
  const others = [...new Set((lesson?.items ?? [])
    .filter((other) => other.id !== item.id && other.en !== item.en)
    .map((other) => other.en))];
  if (others.length < DISTRACTORS) return null;
  return shuffle([item.en, ...shuffle(others, rng).slice(0, DISTRACTORS)], rng);
}

/** @param {boolean} correct @returns {ExerciseOutcome} */
function listeningOutcome(correct) {
  return { aux: { kind: 'listening', correct } };
}

/** @type {ExerciseRender} */
export function render(container, entry, ctx) {
  const item = ctx.item;
  if (!item) return Promise.resolve({});
  return new Promise((resolve) => {
    let done = false;
    /** @param {ExerciseOutcome} outcome */
    const finish = (outcome) => {
      if (done) return;
      done = true;
      resolve(outcome);
    };
    const listen = async () => {
      const how = await ctx.play(item.sl);
      if (how === 'none' && !done) showNoAudio(container, () => finish({}));
    };
    const again = h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => { void listen(); } }, 'Play again');
    const options = ctx.rng() < 0.5 ? null : meaningOptions(item, ctx.lesson, ctx.rng);

    if (!options) {
      const feedbackSlot = h('div', { class: 'feedback-slot' });
      const { form, input } = answerField({
        id: `listening-${item.id}`,
        label: 'What you heard, in Slovenian',
        onAnswer: (answer) => {
          const graded = grade(answer, item.sl, item.accept ?? []);
          mountFeedback(feedbackSlot, {
            answer, graded, effective: graded.result, target: item.sl, rule: null,
            onDone: () => finish(listeningOutcome(graded.result !== 'wrong')),
          });
        },
      });
      mount(container, h('article', { class: 'exercise exercise-listening' },
        h('p', { class: 'eyebrow' }, 'Listening'),
        h('h2', { class: 'prompt-en' }, 'Write what you hear.'),
        h('div', { class: 'tools' }, again),
        form,
        feedbackSlot));
      input.focus();
    } else {
      const question = h('h2', { class: 'prompt-en', tabindex: '-1' }, 'What does it mean?');
      const result = h('div', { 'aria-live': 'polite' });
      const actions = h('div', { class: 'actions' });
      let answered = false;
      /** @param {string} choice */
      const pick = (choice) => {
        if (answered) return;
        answered = true;
        const correct = choice === item.en;
        options.forEach((option, i) => {
          buttons[i].disabled = true;
          if (option === item.en) buttons[i].classList.add('option-right');
          else if (option === choice) buttons[i].classList.add('option-wrong');
        });
        result.replaceChildren(h('section', { class: `feedback feedback-${correct ? 'correct' : 'wrong'}` },
          h('p', { class: 'feedback-headline' }, correct ? 'Correct.' : 'Not quite.'),
          h('div', { class: 'feedback-row' },
            h('span', { class: 'feedback-label' }, 'You heard'),
            h('span', { class: 'sl-display feedback-form', lang: 'sl' }, item.sl)),
          h('div', { class: 'feedback-row' },
            h('span', { class: 'feedback-label' }, 'It means'),
            h('span', { class: 'en-text' }, item.en))));
        const next = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => finish(listeningOutcome(correct)) }, 'Continue');
        actions.append(next);
        next.focus();
      };
      /** @type {HTMLButtonElement[]} */
      const buttons = options.map((option) => /** @type {HTMLButtonElement} */ (h('button', {
        type: 'button', class: 'btn btn-secondary option', onclick: () => pick(option),
      }, option)));
      mount(container, h('article', { class: 'exercise exercise-listening' },
        h('p', { class: 'eyebrow' }, 'Listening'),
        question,
        h('div', { class: 'tools' }, again),
        h('div', { class: 'options actions-stack', role: 'group', 'aria-label': 'Meanings' }, buttons),
        result,
        actions));
      question.focus();
    }
    void listen();
  });
}
