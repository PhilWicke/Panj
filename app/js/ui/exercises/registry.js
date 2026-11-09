// The exercise registry. Every exercise module exports render(container, entry, ctx), which draws
// the exercise into `container` and resolves with its outcome once the learner is done; main.js
// registers each under its queue kind and the session screen looks the kind up, skipping a kind
// with nothing registered. This task registers `meet` and `typed_en_sl` (a `fluency` entry runs
// through the typed render once per item); Tasks 12 to 14 register `rule`, `structured`, `slot`,
// `dialogue`, `listening`, `speaking` and `perception`.

/** @typedef {import('../../engine/session.js').QueueEntry} QueueEntry */
/** @typedef {import('../../engine/session.js').ExerciseKind} ExerciseKind */
/** @typedef {import('../../engine/session.js').Mode} Mode */
/** @typedef {import('../../engine/scheduler.js').RecallResult} RecallResult */
/** @typedef {import('../../content/types.js').Item} Item */
/** @typedef {import('../../content/types.js').Rule} Rule */
/** @typedef {import('../../content/types.js').Lesson} Lesson */
/** @typedef {import('../../store/state.js').AppSettings} AppSettings */

/**
 * What an exercise reports. `recall` (or `recalls`, for a dialogue line that teaches several
 * items) is set only for typed or recognised spoken answers, as `grade` graded them; the session
 * screen applies effectiveResult before recordRecall and re-queues a missed typed recall. Every
 * other exercise reports through `aux`.
 * @typedef {object} ExerciseOutcome
 * @property {string} [itemId]
 * @property {RecallResult} [recall]
 * @property {{ itemId: string, recall: RecallResult }[]} [recalls]
 * @property {{ kind: string, correct: boolean }} [aux]
 */

/**
 * What the session screen hands an exercise. `effective` tells how a recall would count given the
 * stored state (effectiveResult: a slip right after a slip is a miss), so the feedback can say so
 * before the screen records it.
 * @typedef {object} ExerciseContext
 * @property {Item|null} item
 * @property {Rule|null} rule the entry's rule, or the first rule the item exercises that the bundle carries
 * @property {Lesson|null} lesson
 * @property {Rule[]} rules every rule card of the bundle
 * @property {AppSettings} settings
 * @property {Mode} mode
 * @property {(text: string) => Promise<'file'|'device'|'none'>} play
 * @property {() => number} rng
 * @property {boolean} allowPending
 * @property {(itemId: string, recall: RecallResult) => RecallResult} effective
 */

/** @typedef {(container: HTMLElement, entry: QueueEntry, ctx: ExerciseContext) => Promise<ExerciseOutcome>} ExerciseRender */

/** @type {Map<ExerciseKind, ExerciseRender>} */
const renders = new Map();

/**
 * @param {ExerciseKind} kind
 * @param {ExerciseRender} render
 */
export function register(kind, render) {
  renders.set(kind, render);
}

/**
 * @param {ExerciseKind} kind
 * @returns {ExerciseRender|undefined}
 */
export function renderFor(kind) {
  return renders.get(kind);
}
