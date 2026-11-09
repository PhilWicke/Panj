// Onboarding (spec 6): four short steps on one screen, each with a Next: the welcome and the
// learner's name, when they will practise (the clause that completes "I practise …", Ruling 52),
// the theme (applied at once), and the add-to-home-screen card with the two ways in, from the
// first hello (Today) or through a ten-minute placement check. The settings are saved once, at
// the end, with `onboarded` set, so leaving the placement midway lands on Today; while they save,
// the step's buttons wait, and a refused save says so and offers them again. The step count is
// plain text ("2 of 4"), no numbered markers. The settings it saves are built by a pure function,
// exported for the tests.

import { h, mount } from '../../util/dom.js';
import { navigate } from '../../router.js';
import { saveSettings } from '../../store/state.js';
import { applyTheme } from '../theme.js';

/** @typedef {import('../../app-types.js').App} App */
/** @typedef {import('../../store/state.js').AppSettings} AppSettings */
/** @typedef {import('../theme.js').Theme} Theme */
/** @typedef {{ name: string, intention: string, theme: Theme }} Draft what the steps collect */

/** The example that prefills the intention field. */
export const DEFAULT_INTENTION = 'on the train after the first stop';
const NAME_MAX = 40;
const STEPS = 4;
/** @type {readonly [Theme, string][]} */
const THEMES = [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']];

/**
 * The settings onboarding saves: the current ones with the name (trimmed, at most NAME_MAX
 * characters), the intention clause (trimmed; Today puts the sentence around it) and the theme,
 * and `onboarded` set.
 * @param {AppSettings} settings
 * @param {Draft} draft
 * @returns {AppSettings}
 */
export function onboardingSettings(settings, draft) {
  return { ...settings, name: draft.name.trim().slice(0, NAME_MAX), intention: draft.intention.trim(), theme: draft.theme, onboarded: true };
}

/**
 * @param {HTMLElement} container
 * @param {App} app
 */
export function renderOnboarding(container, app) {
  /** @type {Draft} */
  const draft = { name: app.state.settings.name, intention: app.state.settings.intention || DEFAULT_INTENTION, theme: app.state.settings.theme };
  const stage = h('div', { class: 'onboarding' });
  let saving = false;
  mount(container, h('section', { class: 'screen screen-onboarding' }, stage));

  /**
   * Saves the choices and goes on to `path`. The two ways in wait while the save runs; a refused
   * save keeps the learner on the step with the notice, which takes the focus, and the buttons
   * offered again, and the app's settings stay what the store holds.
   * @param {string} path
   * @param {{ buttons: HTMLButtonElement[], notice: HTMLElement }} step the last step's buttons and notice
   */
  const finish = async (path, { buttons, notice }) => {
    if (saving) return;
    saving = true;
    for (const button of buttons) button.disabled = true;
    notice.hidden = true;
    const settings = onboardingSettings(app.state.settings, draft);
    try {
      await saveSettings(app.adapter, settings);
    } catch (error) {
      console.error(error);
      saving = false;
      for (const button of buttons) button.disabled = false;
      notice.hidden = false;
      notice.focus();
      return;
    }
    app.state.settings = settings;
    navigate(path, { replace: true });
  };

  /**
   * A step's frame: the count, the heading, the body, and the actions row with Back on every
   * step but the first.
   * @param {number} k 1-based
   * @param {HTMLElement} title
   * @param {import('../../util/dom.js').Child[]} body
   * @param {HTMLElement|null} next the step's primary action, or null when the body carries its own
   * @returns {HTMLElement}
   */
  const frame = (k, title, body, next) => h('form', {
    class: 'onboarding-step',
    onsubmit: (/** @type {SubmitEvent} */ event) => { event.preventDefault(); if (k < STEPS) show(k + 1); },
  },
  h('p', { class: 'eyebrow' }, `${k} of ${STEPS}`),
  title,
  ...body,
  h('div', { class: 'actions actions-stack' },
    next,
    k > 1 && h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => show(k - 1) }, 'Back')));

  const nextButton = () => h('button', { type: 'submit', class: 'btn btn-primary btn-large' }, 'Next');

  /** @returns {HTMLElement} */
  const welcome = () => frame(1,
    h('h1', { class: 'greeting', lang: 'sl', tabindex: '-1' }, 'Dobrodošli'),
    [
      h('p', { class: 'en-text' }, 'Welcome. Slovelingo teaches Slovenian a few minutes a day, starting with your first hello.'),
      h('div', { class: 'field' },
        h('label', { class: 'field-label', for: 'onboarding-name' }, 'What should we call you?'),
        h('input', {
          id: 'onboarding-name', type: 'text', class: 'text-input', maxlength: String(NAME_MAX), autocomplete: 'given-name', value: draft.name,
          oninput: (/** @type {Event} */ event) => { draft.name = /** @type {HTMLInputElement} */ (event.target).value; },
        }),
        h('p', { class: 'quiet' }, 'Optional. The name stays on this phone.')),
    ],
    nextButton());

  /** @returns {HTMLElement} */
  const intention = () => frame(2,
    h('h1', { class: 'screen-title', tabindex: '-1' }, 'When will you practise?'),
    [
      h('p', { class: 'en-text' }, 'A fixed moment in the day makes it a habit. Finish the sentence with yours.'),
      h('div', { class: 'field' },
        h('label', { class: 'field-label', for: 'onboarding-intention' }, 'I practise …'),
        h('input', {
          id: 'onboarding-intention', type: 'text', class: 'text-input', maxlength: '120', autocomplete: 'off', value: draft.intention,
          oninput: (/** @type {Event} */ event) => { draft.intention = /** @type {HTMLInputElement} */ (event.target).value; },
        })),
    ],
    nextButton());

  /** @returns {HTMLElement} */
  const theme = () => frame(3,
    h('h1', { class: 'screen-title', tabindex: '-1' }, 'Theme'),
    [
      h('p', { class: 'en-text' }, 'Light or dark, or follow the phone. You can change it later in Settings.'),
      h('fieldset', { class: 'choice-list' },
        h('legend', { class: 'visually-hidden' }, 'Theme'),
        THEMES.map(([value, label]) => h('label', { class: 'choice' },
          h('input', {
            type: 'radio', name: 'theme', value, checked: draft.theme === value,
            onchange: () => { draft.theme = value; applyTheme(value); },
          }),
          h('span', null, label)))),
    ],
    nextButton());

  /** @returns {HTMLElement} */
  const homeScreen = () => {
    const notice = h('p', { class: 'notice', role: 'status', tabindex: '-1', hidden: true }, 'Your choices could not be saved. Try again.');
    const start = /** @type {HTMLButtonElement} */ (h('button', {
      type: 'button', class: 'btn btn-primary btn-large', onclick: () => { void finish('/today', step); },
    }, 'Start from the first hello'));
    const placement = /** @type {HTMLButtonElement} */ (h('button', {
      type: 'button', class: 'btn btn-secondary', onclick: () => { void finish('/checkpoint?placement=1', step); },
    }, 'Take a ten-minute placement check'));
    const step = { buttons: [start, placement], notice };
    return frame(4,
      h('h1', { class: 'screen-title', tabindex: '-1' }, 'Add to home screen'),
      [
        h('p', { class: 'en-text' }, 'Open the browser menu and choose Add to Home screen. Slovelingo then opens like an app.'),
        h('div', { class: 'actions actions-stack' }, start),
        notice,
        h('div', { class: 'card' },
          h('h2', { class: 'section-title' }, 'Already know some Slovenian?'),
          h('p', { class: 'en-text' }, 'A placement check finds where to start. Pass a unit and it is sealed in your hive.'),
          placement),
      ],
      null);
  };

  const steps = [welcome, intention, theme, homeScreen];

  /**
   * @param {number} k 1-based
   */
  const show = (k) => {
    mount(stage, steps[k - 1]());
    if (k > 1) /** @type {HTMLElement|null} */ (stage.querySelector('[tabindex="-1"]'))?.focus();
  };
  show(1);
}
