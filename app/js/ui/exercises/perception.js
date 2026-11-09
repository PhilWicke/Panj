// The perception drill (spec 4.2): one of two or three similar words plays, and the learner picks
// the one that was said from the words written out (labels, not pictures). The sets are a small
// built-in list for the sounds that trip German and English speakers: a final l (bil, bila), s
// against š (vas, vaš), s, z and ž (kosa, koza, koža), an s before t (peti, pesti) and v before a
// consonant (v šoli, šoli). The entry carries no item: the set and the word to play are drawn with
// ctx.rng. The outcome is `aux` only. When nothing can play the word, the drill says so and
// resolves with no outcome.

import { h, mount } from '../../util/dom.js';
import { audioExercise } from '../components/no-audio.js';
import { optionGroup } from '../components/option-group.js';

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
    const { finish, listen } = audioExercise({ container, play: ctx.play, text: target, resolve });
    const question = h('h2', { class: 'prompt-en', tabindex: '-1' }, 'Which did you hear?');
    const { group, result, actions } = optionGroup({
      options: words, answer: target, label: 'Words', lang: 'sl', large: true,
      onPick: (choice, correct) => !correct && h('p', null, 'It was ', h('span', { lang: 'sl', class: 'quick-check-answer' }, target), '.'),
      onContinue: (choice, correct) => finish({ aux: { kind: 'perception', correct } }),
    });
    mount(container, h('article', { class: 'exercise exercise-perception' },
      h('p', { class: 'eyebrow' }, 'Listen closely'),
      question,
      h('div', { class: 'tools' },
        h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => listen() }, 'Play again')),
      group,
      result,
      actions));
    question.focus();
    listen();
  });
}
