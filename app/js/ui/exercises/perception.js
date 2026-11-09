// The perception drill (spec 4.2): one of two or three similar words plays, and the learner picks
// the one that was said from the words written out (labels, not pictures). The sets are the
// small built-in list in content/perception-sets.js (Ruling 46: shared with the audio texts, so
// every word has a recording). The entry carries no item: the set and the word to play are drawn
// with ctx.rng. The outcome is `aux` only. When nothing can play the word, the drill says so and
// resolves with no outcome, unless the learner has picked already.

import { h, mount } from '../../util/dom.js';
import { PERCEPTION_SETS } from '../../content/perception-sets.js';
import { audioExercise } from '../components/no-audio.js';
import { optionGroup } from '../components/option-group.js';

/** @typedef {import('./registry.js').ExerciseRender} ExerciseRender */
/** @typedef {import('./registry.js').ExerciseOutcome} ExerciseOutcome */

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
    const { finish, listen, answered } = audioExercise({ container, play: ctx.play, text: target, resolve });
    const question = h('h2', { class: 'prompt-en', tabindex: '-1' }, 'Which did you hear?');
    const { group, result, actions } = optionGroup({
      options: words, answer: target, label: 'Words', lang: 'sl', large: true,
      onPick: (choice, correct) => {
        answered();
        return !correct && h('p', null, 'It was ', h('span', { lang: 'sl', class: 'quick-check-answer' }, target), '.');
      },
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
