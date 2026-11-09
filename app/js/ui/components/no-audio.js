// What an audio exercise shows when nothing can play its sound (no recording and no Slovenian
// device voice): one line that says so and a Continue button, which goes on without an outcome.

import { h, mount } from '../../util/dom.js';

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
