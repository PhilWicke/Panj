// The sitting's quiet choices. "Can't listen right now" and "Can't talk right now" split the
// session mute in two for one sitting: a choice holds until resetQuiet starts a new sitting, and
// each choice is offered once per sitting, beside the first exercise of OFFER_KINDS that would play
// sound or ask the learner to speak. The choices live in this module's memory only, never in
// IndexedDB, localStorage, the export or a session record, so a reload starts a fresh sitting too.
// The engine takes them as Mode.cantListen and Mode.cantTalk: buildSession and closingMenu leave
// out what they drop, and quietDrops (engine/session.js) names those kinds.

/** @typedef {import('../engine/session.js').ExerciseKind} ExerciseKind */
/** @typedef {'listen'|'talk'} QuietKind */

/** The choices' copy, word for word. */
export const QUIET_LABELS = Object.freeze({ listen: "Can't listen right now", talk: "Can't talk right now" });

/**
 * The exercise kinds each choice is offered beside: the first one that would play sound for
 * `listen`, the first one that asks the learner to speak for `talk`.
 * @type {Readonly<Record<QuietKind, ReadonlySet<ExerciseKind>>>}
 */
export const OFFER_KINDS = Object.freeze({
  listen: new Set(/** @type {ExerciseKind[]} */ (['meet', 'listening', 'perception'])),
  talk: new Set(/** @type {ExerciseKind[]} */ (['speaking'])),
});

/** The Mode flag each choice sets. @type {Readonly<Record<QuietKind, 'cantListen'|'cantTalk'>>} */
const FLAGS = Object.freeze({ listen: 'cantListen', talk: 'cantTalk' });

/** What the sitting has chosen so far. */
const chosen = { cantListen: false, cantTalk: false };
/** The kinds offered so far in the sitting. @type {Set<QuietKind>} */
const offered = new Set();

/**
 * The sitting's choices, as a fresh copy the caller may change.
 * @returns {{ cantListen: boolean, cantTalk: boolean }}
 */
export function quietChoices() {
  return { ...chosen };
}

/**
 * Makes a choice for the rest of the sitting; choosing a kind again changes nothing.
 * @param {QuietKind} kind
 */
export function chooseQuiet(kind) {
  chosen[FLAGS[kind]] = true;
}

/**
 * Whether to offer a choice now: true the first time it is asked per sitting while the kind is not
 * chosen, and the kind then counts as offered; false after that, and always for a chosen kind.
 * @param {QuietKind} kind
 * @returns {boolean}
 */
export function offerQuiet(kind) {
  if (chosen[FLAGS[kind]] || offered.has(kind)) return false;
  offered.add(kind);
  return true;
}

/** Starts a new sitting: nothing chosen, nothing offered. */
export function resetQuiet() {
  chosen.cantListen = false;
  chosen.cantTalk = false;
  offered.clear();
}
