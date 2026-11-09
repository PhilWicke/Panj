// What an audio exercise shows when nothing can play its sound (no recording and no Slovenian
// device voice): one line that says so and a Continue button, which goes on without an outcome.
// audioExercise gives the listening and perception exercises the ends they share: `finish`, which
// resolves the exercise once, `listen`, which plays the sound and turns to the no-audio line when
// nothing could play it, and `answered`, which the exercise calls once the learner has answered,
// so a late `none` leaves the answer and its feedback in place.

import { h, mount } from '../../util/dom.js';

/** @typedef {import('../exercises/registry.js').ExerciseOutcome} ExerciseOutcome */

/**
 * Replaces the exercise in `container` with the no-audio line and focuses its Continue.
 * @param {HTMLElement} container
 * @param {() => void} onContinue
 */
export function showNoAudio(container, onContinue) {
  const next = h('button', { type: 'button', class: 'btn btn-primary', onclick: onContinue }, 'Continue');
  mount(container, h('article', { class: 'exercise exercise-no-audio' },
    h('p', { class: 'en-text' }, 'No audio on this device.'),
    h('div', { class: 'actions' }, next)));
  next.focus();
}

/**
 * The ends of an exercise that plays `text`. `finish` resolves the exercise's promise, once.
 * `listen` plays the text; when the player resolves `none`, the exercise in `container` turns into
 * the no-audio line, whose Continue finishes with no outcome. A `none` that arrives once the
 * learner has answered (`answered`) or after the exercise has finished changes nothing, so it
 * cannot draw over the answer's feedback or over the next exercise in the stage.
 * @param {{ container: HTMLElement, play: (text: string) => Promise<'file'|'device'|'none'>, text: string, resolve: (outcome: ExerciseOutcome) => void }} opts
 * @returns {{ finish: (outcome: ExerciseOutcome) => void, listen: () => void, answered: () => void }}
 */
export function audioExercise({ container, play, text, resolve }) {
  let done = false;
  let answeredYet = false;
  /** @param {ExerciseOutcome} outcome */
  const finish = (outcome) => {
    if (done) return;
    done = true;
    resolve(outcome);
  };
  const listen = () => {
    void play(text).then((how) => {
      if (how === 'none' && !done && !answeredYet) showNoAudio(container, () => finish({}));
    });
  };
  const answered = () => {
    answeredYet = true;
  };
  return { finish, listen, answered };
}
