// The Settings screen (spec 6): one form of sections, every change saved at once (no Save button),
// with a quiet "Saved" for assistive technology; a change the store refuses is taken back, in the
// app's settings, in the player and in the control, with "Not saved. Try again." The learner's
// name; the daily goal, the new items per day and the target recall, each kept in its range
// (store/setting-ranges.js, shared with the import); the theme, applied at once; the voice of the
// recordings and mute, passed to the player (Ruling 48); the speaking checks switch, off by
// default, with the Global Constraints' description. Then the learner's data: export (shared as a
// file where the phone can, else downloaded), import (validated, confirmed with its counts, then
// replacing everything) and reset (only after typing the word); whether an import or a reset
// finishes or fails half-way, the state is read back from the store and the screen drawn from it,
// so it never shows what the store no longer holds. A link leads to the statistics. The pure parts
// are exported for the tests.

import { h, mount } from '../../util/dom.js';
import { navigate } from '../../router.js';
import { localDateKey } from '../../util/time.js';
import { STORE_NAMES } from '../../store/memory.js';
import {
  DEFAULT_APP_SETTINGS, exportState, importState, loadState, saveSettings, validateImport,
} from '../../store/state.js';
import { SETTING_RANGES, clampToRange } from '../../store/setting-ranges.js';
import { applyTheme } from '../theme.js';

/** @typedef {import('../../app-types.js').App} App */
/** @typedef {import('../../store/state.js').AppSettings} AppSettings */
/** @typedef {import('../../store/state.js').ImportData} ImportData */
/** @typedef {import('../theme.js').Theme} Theme */
/** @typedef {import('../../audio/player.js').VoicePref} VoicePref */
/** @typedef {import('../../store/setting-ranges.js').NumericSetting} NumericSetting */

/** The description under the speaking checks switch, verbatim from the Global Constraints. */
export const SPEECH_DESCRIPTION = "Speaking checks send your voice to Google's speech service while recognising. Off, your speaking is self-rated and nothing leaves the phone.";
/** The word that confirms a reset. */
const RESET_WORD = 'reset';
const NAME_MAX = 40;

/** @type {readonly [Theme, string][]} */
const THEMES = [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']];
/** The legal notice of the site, kept on the maintainer's own site (§ 18 MStV). */
export const IMPRESSUM_URL = 'https://phil-wicke.com/imprint.html';

/** @type {readonly [VoicePref, string][]} */
const VOICE_CHOICES = [['female', 'Female'], ['male', 'Male'], ['device', 'Device voice']];

/**
 * A numeric setting kept in its range and on its step (setting-ranges.js): whole minutes, whole
 * items, retention to the hundredth. A value that is not a finite number gives the default.
 * @param {NumericSetting} key
 * @param {number} value
 * @returns {number}
 */
export function clampSetting(key, value) {
  if (!Number.isFinite(value)) return DEFAULT_APP_SETTINGS[key];
  return clampToRange(key, value);
}

/**
 * The name of the backup file, by the local date: `slovelingo-backup-YYYY-MM-DD.json`.
 * @param {number} now epoch ms
 * @param {string} [tz] IANA zone, for tests; the phone's zone when omitted
 * @returns {string}
 */
export function backupFilename(now, tz) {
  return `slovelingo-backup-${localDateKey(now, tz)}.json`;
}

/**
 * What a validated file holds, for the confirmation card: its item states (rule cards' included)
 * and its sessions.
 * @param {Pick<ImportData, 'items' | 'sessions'>} data
 * @returns {{ items: number, sessions: number }}
 */
export function importSummary(data) {
  return { items: Object.keys(data.items).length, sessions: data.sessions.length };
}

/**
 * @param {number} count
 * @param {string} noun singular
 * @returns {string}
 */
const counted = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/**
 * The confirmation card's question.
 * @param {{ items: number, sessions: number }} summary
 * @returns {string}
 */
export function importQuestion(summary) {
  return `Replace your progress with this file? It holds ${counted(summary.items, 'item')} and ${counted(summary.sessions, 'session')}.`;
}

/**
 * A switch: a button with role switch whose label is its name, aria-checked its state, and an
 * optional description under it. A tap flips it and reports the new value, with the button, so
 * the caller can set it back when the change is not kept.
 * @param {{ id: string, label: string, description?: string, checked: boolean, onChange: (on: boolean, button: HTMLElement) => void }} options
 * @returns {HTMLElement}
 */
export function renderSwitch({ id, label, description, checked, onChange }) {
  const descriptionId = `${id}-description`;
  const button = h('button', {
    type: 'button', role: 'switch', class: 'switch', id, 'aria-checked': String(checked),
    'aria-describedby': description ? descriptionId : null,
    onclick: () => {
      const on = button.getAttribute('aria-checked') !== 'true';
      button.setAttribute('aria-checked', String(on));
      onChange(on, button);
    },
  },
  h('span', { class: 'switch-label' }, label),
  h('span', { class: 'switch-track', 'aria-hidden': 'true' }, h('span', { class: 'switch-thumb' })));
  return h('div', { class: 'switch-row' }, button, description ? h('p', { class: 'quiet', id: descriptionId }, description) : null);
}

/**
 * A labelled text field.
 * @param {string} id
 * @param {string} label
 * @param {string} value
 * @param {number} max
 * @param {(value: string, input: HTMLInputElement) => void} onCommit called on change, when the learner leaves the field or presses Enter, with the field
 * @param {string} [hint]
 * @returns {HTMLElement}
 */
function textField(id, label, value, max, onCommit, hint) {
  const input = /** @type {HTMLInputElement} */ (h('input', {
    id, type: 'text', class: 'text-input', maxlength: String(max), autocomplete: 'off', value,
    'aria-describedby': hint ? `${id}-hint` : null,
    onchange: () => onCommit(input.value, input),
  }));
  return h('div', { class: 'field' },
    h('label', { class: 'field-label', for: id }, label),
    input,
    hint ? h('p', { class: 'quiet', id: `${id}-hint` }, hint) : null);
}

/**
 * A group of radios inside a fieldset. A pick reports the choice and `check`, which checks the
 * radio of a value again, for a change the store did not keep.
 * @template {string} T
 * @param {string} name
 * @param {string} legend
 * @param {readonly (readonly [T, string])[]} choices
 * @param {T} value
 * @param {(value: T, check: (value: T) => void) => void} onPick
 * @returns {HTMLElement}
 */
function radios(name, legend, choices, value, onPick) {
  const inputs = choices.map(([choice]) => /** @type {HTMLInputElement} */ (h('input', { type: 'radio', name, value: choice, checked: choice === value })));
  /** @param {T} picked */
  const check = (picked) => { inputs.forEach((input, i) => { input.checked = choices[i][0] === picked; }); };
  inputs.forEach((input, i) => input.addEventListener('change', () => onPick(choices[i][0], check)));
  return h('fieldset', { class: 'choice-list' },
    h('legend', { class: 'field-label' }, legend),
    choices.map(([, label], i) => h('label', { class: 'choice' }, inputs[i], h('span', null, label))));
}

/**
 * @param {HTMLElement} container
 * @param {App} app
 */
export function renderSettings(container, app) {
  draw(container, app, null);
}

/**
 * Builds the screen, with a notice in the data section when one is given (after an import).
 * @param {HTMLElement} container
 * @param {App} app
 * @param {string|null} message
 */
function draw(container, app, message) {
  const settings = app.state.settings;
  const status = h('p', { class: 'settings-saved', role: 'status' });

  /**
   * Saves a change at once and says so. When the store refuses it, the settings from before come
   * back: in the app, in the player (mute and voice, where they changed), on the page (the theme)
   * and in the control, through `restore`.
   * @param {Partial<AppSettings>} changes
   * @param {(settings: AppSettings) => void} [restore] puts the settings given back into the control that changed
   */
  const save = async (changes, restore) => {
    const previous = app.state.settings;
    app.state.settings = { ...previous, ...changes };
    status.textContent = '';
    try {
      await saveSettings(app.adapter, app.state.settings);
      status.textContent = 'Saved';
    } catch (error) {
      console.error(error);
      app.state.settings = previous;
      if ('mute' in changes) app.player.setMute(previous.mute);
      if ('voice' in changes) app.player.setVoice(previous.voice);
      if ('theme' in changes) applyTheme(previous.theme);
      restore?.(previous);
      status.textContent = 'Not saved. Try again.';
    }
  };

  /**
   * A number field kept in its range: the clamped value goes back into the field and is saved; an
   * empty or unreadable field gets the saved value back.
   * @param {NumericSetting} key
   * @param {string} id
   * @param {string} label
   * @param {string} hint
   * @returns {HTMLElement}
   */
  const numberField = (key, id, label, hint) => {
    const { min, max } = SETTING_RANGES[key];
    return h('div', { class: 'field' },
      h('label', { class: 'field-label', for: id }, label),
      h('input', {
        id, type: 'number', class: 'text-input number-input', min: String(min), max: String(max), step: '1', inputmode: 'numeric',
        value: String(settings[key]), 'aria-describedby': `${id}-hint`,
        onchange: (/** @type {Event} */ event) => {
          const input = /** @type {HTMLInputElement} */ (event.target);
          if (input.value.trim() === '' || Number.isNaN(input.valueAsNumber)) {
            input.value = String(app.state.settings[key]);
            return;
          }
          const value = clampSetting(key, input.valueAsNumber);
          input.value = String(value);
          void save(/** @type {Partial<AppSettings>} */ ({ [key]: value }), (restored) => { input.value = String(restored[key]); });
        },
      }),
      h('p', { class: 'quiet', id: `${id}-hint` }, hint));
  };

  const retentionPercent = Math.round(settings.desiredRetention * 100);
  const retentionShown = h('output', { class: 'range-value', for: 'settings-retention' }, `${retentionPercent}%`);
  /** Shows a percent on the slider and its label. @param {HTMLInputElement} input @param {number} percent */
  const showRetention = (input, percent) => {
    input.value = String(percent);
    retentionShown.textContent = `${percent}%`;
    input.setAttribute('aria-valuetext', `${percent}%`);
  };
  const retention = h('div', { class: 'field' },
    h('div', { class: 'range-head' },
      h('label', { class: 'field-label', for: 'settings-retention' }, 'Target recall'),
      retentionShown),
    h('input', {
      id: 'settings-retention', type: 'range', class: 'range-input', min: '85', max: '92', step: '1', value: String(retentionPercent),
      'aria-valuetext': `${retentionPercent}%`, 'aria-describedby': 'settings-retention-hint',
      oninput: (/** @type {Event} */ event) => {
        const input = /** @type {HTMLInputElement} */ (event.target);
        retentionShown.textContent = `${input.value}%`;
        input.setAttribute('aria-valuetext', `${input.value}%`);
      },
      onchange: (/** @type {Event} */ event) => {
        const input = /** @type {HTMLInputElement} */ (event.target);
        void save({ desiredRetention: clampSetting('desiredRetention', Number(input.value) / 100) },
          (restored) => showRetention(input, Math.round(restored.desiredRetention * 100)));
      },
    }),
    h('p', { class: 'quiet', id: 'settings-retention-hint' }, 'How likely you are to recall an item when it comes back. Higher means more reviews.'));

  mount(container, h('section', { class: 'screen screen-settings' },
    h('div', { class: 'settings-head' }, h('h1', { class: 'screen-title' }, 'Settings'), status),
    h('p', null, h('a', { class: 'back-link', href: '#/stats' }, 'Your statistics')),
    h('form', { class: 'settings-form', onsubmit: (/** @type {SubmitEvent} */ event) => event.preventDefault() },
      h('section', { class: 'settings-group', 'aria-labelledby': 'settings-you' },
        h('h2', { class: 'section-title', id: 'settings-you' }, 'You'),
        textField('settings-name', 'Name', settings.name, NAME_MAX,
          (value, input) => { void save({ name: value.trim().slice(0, NAME_MAX) }, (restored) => { input.value = restored.name; }); },
          'Optional. The name stays on this phone.')),
      h('section', { class: 'settings-group', 'aria-labelledby': 'settings-practice' },
        h('h2', { class: 'section-title', id: 'settings-practice' }, 'Practice'),
        numberField('dailyMinutes', 'settings-minutes', 'Daily goal', 'Minutes a day, 3 to 60.'),
        numberField('newPerDay', 'settings-new', 'New items per day', '0 to 20. Fewer new items, fewer reviews later.'),
        retention),
      h('section', { class: 'settings-group', 'aria-labelledby': 'settings-look' },
        h('h2', { class: 'section-title', id: 'settings-look' }, 'Look'),
        radios('settings-theme', 'Theme', THEMES, settings.theme, (theme, check) => {
          applyTheme(theme);
          void save({ theme }, (restored) => check(restored.theme));
        })),
      h('section', { class: 'settings-group', 'aria-labelledby': 'settings-sound' },
        h('h2', { class: 'section-title', id: 'settings-sound' }, 'Sound'),
        radios('settings-voice', 'Voice', VOICE_CHOICES, settings.voice, (voice, check) => {
          void save({ voice }, (restored) => check(restored.voice));
          app.player.setVoice(voice);
        }),
        h('p', { class: 'quiet' }, "Female and male are the course's recordings, and in a dialogue each speaker keeps a voice of their own. The device voice is your phone's own Slovenian voice."),
        renderSwitch({
          id: 'settings-mute', label: 'Mute', description: 'No sound at all: every exercise has a silent form.', checked: settings.mute,
          onChange: (mute, button) => {
            void save({ mute }, (restored) => button.setAttribute('aria-checked', String(restored.mute)));
            app.player.setMute(mute);
          },
        }),
        renderSwitch({
          id: 'settings-speech', label: 'Speaking checks', description: SPEECH_DESCRIPTION, checked: settings.speech,
          onChange: (speech, button) => { void save({ speech }, (restored) => button.setAttribute('aria-checked', String(restored.speech))); },
        }))),
    renderData(container, app, message),
    h('p', { class: 'settings-legal' }, h('a', { href: IMPRESSUM_URL, target: '_blank', rel: 'noopener' }, 'Impressum'))));
}

/**
 * The data section: export, import with its confirmation card, and reset with its typed word.
 * @param {HTMLElement} container
 * @param {App} app
 * @param {string|null} message a notice to show at once, "Progress imported."
 * @returns {HTMLElement}
 */
function renderData(container, app, message) {
  const notice = h('p', { class: 'notice settings-notice', role: 'status', tabindex: '-1', hidden: !message }, message ?? '');
  /** @param {string} text */
  const say = (text) => {
    notice.textContent = text;
    notice.hidden = false;
  };

  const exportButton = h('button', {
    type: 'button', class: 'btn btn-secondary',
    onclick: async () => {
      exportButton.setAttribute('disabled', '');
      try {
        say(await exportProgress(app));
      } catch {
        say('The export did not work. Try again.');
      } finally {
        exportButton.removeAttribute('disabled');
      }
    },
  }, 'Export progress');

  /** The file waiting for Replace. @type {ImportData|null} */
  let pending = null;
  const question = h('p', { class: 'en-text', id: 'settings-import-question' });
  const replace = h('button', {
    type: 'button', class: 'btn btn-primary',
    onclick: async () => {
      const data = pending;
      if (!data) return;
      pending = null;
      replace.setAttribute('disabled', '');
      let message = 'Progress imported.';
      try {
        await importState(app.adapter, data);
      } catch (error) {
        console.error(error);
        message = 'The import did not work. Your progress may be incomplete: import the file again.';
      } finally {
        await reloadState(app);
      }
      applySettings(app);
      draw(container, app, message);
      /** @type {HTMLElement|null} */ (container.querySelector('.settings-notice'))?.focus();
    },
  }, 'Replace');
  const confirmCard = h('div', { class: 'card', role: 'group', 'aria-labelledby': 'settings-import-question', hidden: true },
    question,
    h('div', { class: 'actions' },
      replace,
      h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => { pending = null; confirmCard.hidden = true; importButton.focus(); } }, 'Cancel')));

  const fileInput = /** @type {HTMLInputElement} */ (h('input', {
    type: 'file', accept: 'application/json', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true',
    onchange: async () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (!file) return;
      notice.hidden = true;
      pending = null;
      confirmCard.hidden = true;
      let text;
      try {
        text = await file.text();
      } catch (error) {
        console.error(error);
        say('Nothing was imported. The file could not be read.');
        return;
      }
      const result = validateImport(text);
      if (!result.ok) {
        say(`Nothing was imported. ${result.reason}`);
        return;
      }
      pending = result.data;
      question.textContent = importQuestion(importSummary(result.data));
      replace.removeAttribute('disabled');
      confirmCard.hidden = false;
      replace.focus();
    },
  }));
  const importButton = h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => fileInput.click() }, 'Import progress');

  const resetField = /** @type {HTMLInputElement} */ (h('input', {
    id: 'settings-reset-word', type: 'text', class: 'text-input', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false',
    oninput: () => {
      if (resetField.value === RESET_WORD) resetConfirm.removeAttribute('disabled');
      else resetConfirm.setAttribute('disabled', '');
    },
  }));
  const resetConfirm = h('button', {
    type: 'button', class: 'btn btn-primary', disabled: true,
    onclick: async () => {
      if (resetField.value !== RESET_WORD) return;
      resetConfirm.setAttribute('disabled', '');
      let finished = false;
      try {
        for (const store of STORE_NAMES) await app.adapter.clear(store);
        await saveSettings(app.adapter, { ...DEFAULT_APP_SETTINGS });
        finished = true;
      } catch {
        // A store that refused a write: the screen says so below, drawn from what the store holds.
      } finally {
        await reloadState(app);
      }
      applySettings(app);
      if (finished) {
        navigate('/onboarding', { replace: true });
        return;
      }
      draw(container, app, 'The reset did not finish. Try again.');
      /** @type {HTMLElement|null} */ (container.querySelector('.settings-notice'))?.focus();
    },
  }, 'Reset everything');
  const resetCard = h('div', { class: 'card', hidden: true },
    h('p', { class: 'en-text' }, 'This deletes your progress, settings and notes on this phone. Export your progress first to keep a copy.'),
    h('div', { class: 'field' },
      h('label', { class: 'field-label', for: 'settings-reset-word' }, 'Type reset to confirm'),
      resetField),
    h('div', { class: 'actions' },
      resetConfirm,
      h('button', {
        type: 'button', class: 'btn btn-quiet',
        onclick: () => {
          resetCard.hidden = true;
          resetField.value = '';
          resetConfirm.setAttribute('disabled', '');
          resetOpen.hidden = false;
          resetOpen.focus();
        },
      }, 'Cancel')));
  const resetOpen = h('button', {
    type: 'button', class: 'btn btn-quiet settings-reset-open',
    onclick: () => {
      resetCard.hidden = false;
      resetOpen.hidden = true;
      resetField.focus();
    },
  }, 'Reset everything');

  return h('section', { class: 'settings-group', 'aria-labelledby': 'settings-data' },
    h('h2', { class: 'section-title', id: 'settings-data' }, 'Your data'),
    h('p', { class: 'quiet' }, 'Your progress lives on this phone. A backup file keeps it safe and moves it to another phone.'),
    h('div', { class: 'actions actions-stack' }, exportButton, importButton),
    fileInput,
    notice,
    confirmCard,
    resetOpen,
    resetCard);
}

/**
 * Exports the whole state as the backup file: shared as a file where the phone can share files,
 * downloaded otherwise (or when sharing fails for a reason other than the learner closing the sheet).
 * @param {App} app
 * @returns {Promise<string>} what to tell the learner
 */
async function exportProgress(app) {
  const now = Date.now();
  const json = await exportState(app.adapter, now);
  const name = backupFilename(now);
  const file = new File([json], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return 'Backup shared.';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'Nothing was exported.';
    }
  }
  const url = URL.createObjectURL(file);
  const link = h('a', { href: url, download: name, hidden: true });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return `Backup saved as ${name}.`;
}

/**
 * Reads the state back from the store after an import or a reset, finished or not, so the app
 * holds what the store holds. When the store cannot be read either, the state in memory stays.
 * @param {App} app
 */
async function reloadState(app) {
  try {
    app.state = await loadState(app.adapter);
  } catch (error) {
    // The store cannot be read now either; the state in memory is the best there is.
    console.error(error);
  }
}

/**
 * Puts the loaded settings to work after an import or a reset: the theme, mute and the voice.
 * @param {App} app
 */
function applySettings(app) {
  applyTheme(app.state.settings.theme);
  app.player.setMute(app.state.settings.mute);
  app.player.setVoice(app.state.settings.voice);
}
