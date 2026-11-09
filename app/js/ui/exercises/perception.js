// The perception drill (spec 4.2): one of two or three similar words plays, and the learner picks
// the one that was said from the words written out (labels, not pictures). The sets are a small
// built-in list for the sounds that trip German and English speakers: a final l (bil, bila), s
// against š (vas, vaš), s, z and ž (kosa, koza, koža), an s before t (peti, pesti) and v before a
// consonant (v šoli, šoli). The entry carries no item: the set and the word to play are drawn with
// ctx.rng. The outcome is `aux` only. When nothing can play the word, the drill says so and
// resolves with no outcome.

import { h, mount } from '../../util/dom.js';
import { showNoAudio } from '../components/no-audio.js';

/** @typedef {import('./registry.js').ExerciseRender} ExerciseRender */
/** @typedef {import('./registry.js').ExerciseOutcome} ExerciseOutcome */

/** The drill's sets of similar words, each shown in this order. */
export const PERCEPTION_SETS = Object.freeze([
  Object.freeze(['bil', 'bila']),
  Object.freeze(['vas', 'vaš']),
  Object.freeze(['kosa', 'koza', 'koža']),
  Object.freeze(['peti', 'pesti']),
  Object.freeze(['v šoli', 'šoli']),
]);

/**
 * A set and the word of it to play, drawn with `rng`.
 * @param {() => number} rng a generator in [0, 1)
 * @returns {{ words: readonly string[], target: string }}
 */
export function pickPerception(rng) {
  const words = PERCEPTION_SETS[Math.floor(rng() * PERCEPTION_SETS.length)];
  return { words, target: words[Math.floor(rng() * words.length)] };
}

/** @type {ExerciseRender} */
export function render(container, entry, ctx) {
  const { words, target } = pickPerception(ctx.rng);
  return new Promise((resolve) => {
    let done = false;
    /** @param {ExerciseOutcome} outcome */
    const finish = (outcome) => {
      if (done) return;
      done = true;
      resolve(outcome);
    };
    const listen = async () => {
      const how = await ctx.play(target);
      if (how === 'none' && !done) showNoAudio(container, () => finish({}));
    };
    const question = h('h2', { class: 'prompt-en', tabindex: '-1' }, 'Which did you hear?');
    const result = h('div', { 'aria-live': 'polite' });
    const actions = h('div', { class: 'actions' });
    let answered = false;

    /** @param {string} choice */
    const pick = (choice) => {
      if (answered) return;
      answered = true;
      const correct = choice === target;
      words.forEach((word, i) => {
        buttons[i].disabled = true;
        if (word === target) buttons[i].classList.add('option-right');
        else if (word === choice) buttons[i].classList.add('option-wrong');
      });
      result.replaceChildren(h('section', { class: `feedback feedback-${correct ? 'correct' : 'wrong'}` },
        h('p', { class: 'feedback-headline' }, correct ? 'Correct.' : 'Not quite.'),
        !correct && h('p', null, 'It was ', h('span', { lang: 'sl', class: 'quick-check-answer' }, target), '.')));
      const next = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => finish({ aux: { kind: 'perception', correct } }) }, 'Continue');
      actions.append(next);
      next.focus();
    };

    /** @type {HTMLButtonElement[]} */
    const buttons = words.map((word) => /** @type {HTMLButtonElement} */ (h('button', {
      type: 'button', class: 'btn btn-secondary option option-sl', lang: 'sl', onclick: () => pick(word),
    }, word)));

    mount(container, h('article', { class: 'exercise exercise-perception' },
      h('p', { class: 'eyebrow' }, 'Listen closely'),
      question,
      h('div', { class: 'tools' },
        h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => { void listen(); } }, 'Play again')),
      h('div', { class: 'options', role: 'group', 'aria-label': 'Words' }, buttons),
      result,
      actions));
    question.focus();
    void listen();
  });
}
