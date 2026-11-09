// The ranges of the numeric settings and the options of the choice settings, shared by the
// Settings screen (which keeps what the learner types inside them) and the store's import (which
// gives a hand-edited backup's value outside them the default, Ruling 84). One place, so the two
// never disagree.

/** @typedef {'dailyMinutes'|'newPerDay'|'desiredRetention'} NumericSetting */

/** The range of each numeric setting (spec 4.2) and the step its values keep. @type {Readonly<Record<NumericSetting, { min: number, max: number, step: number }>>} */
export const SETTING_RANGES = Object.freeze({
  dailyMinutes: Object.freeze({ min: 3, max: 60, step: 1 }),
  newPerDay: Object.freeze({ min: 0, max: 20, step: 1 }),
  desiredRetention: Object.freeze({ min: 0.85, max: 0.92, step: 0.01 }),
});

/** The themes a learner can choose. @type {readonly string[]} */
export const THEME_OPTIONS = Object.freeze(['system', 'light', 'dark']);
/** The voices a learner can choose. @type {readonly string[]} */
export const VOICE_OPTIONS = Object.freeze(['female', 'male', 'device']);

/**
 * A finite number kept in its range and on its step: whole minutes, whole items, retention to the
 * hundredth. The caller decides what a value that is not a finite number becomes.
 * @param {NumericSetting} key
 * @param {number} value a finite number
 * @returns {number}
 */
export function clampToRange(key, value) {
  const { min, max, step } = SETTING_RANGES[key];
  const stepped = Math.round(value / step) * step;
  return Number(Math.min(max, Math.max(min, stepped)).toFixed(2));
}

/**
 * Whether a value is a finite number inside the setting's range, on its step or not.
 * @param {NumericSetting} key
 * @param {unknown} value
 * @returns {value is number}
 */
export function withinRange(key, value) {
  const { min, max } = SETTING_RANGES[key];
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}
