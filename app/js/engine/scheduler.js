// The item state machine: learning steps, graduation, review, lapse and relearning, mastery.
// FSRS (vendored, FSRS-6 through the package's legacy API) is the long-term memory model: it
// gets one rating when an item graduates and one per review-phase recall, and it answers
// retrievability. The steps inside a session (one and ten minutes, ten minutes after a lapse) are
// this module's own, so FSRS runs with its short-term steps off. Every function is pure.
//
// Days are the learner's local days (app/js/util/time.js). An item that graduates is due at the
// start of the next local day whatever FSRS scheduled (spec 4.2, the first review is the next day);
// the card keeps the fields the rating produced and drives every later review, which is due from
// the start of the local day FSRS schedules and never before the next local day, so an item
// reviewed late in the evening is in the next day's session whatever the time. Mastery needs
// successful review-phase recalls on MASTERY_SESSIONS distinct local days after the recall that
// brought the item into review. A slip is a success rated Hard, but a slip right after a slip on
// the same item counts as a miss (spec 5): effectiveResult decides, and lastResult remembers.

import { fsrs, createEmptyCard, Rating } from './fsrs.vendored.js';
import { localDateKey, startOfLocalDay, startOfNextLocalDay, daysBetween } from '../util/time.js';

/**
 * @typedef {object} Settings
 * @property {number} desiredRetention FSRS request retention, 0.85 to 0.92
 * @property {number} newPerDay new items per day, 0 to 20
 * @property {number} dailyMinutes the daily goal in minutes
 */

/** @typedef {'new'|'learning'|'review'|'lapsed'} Phase */

/** @typedef {'correct'|'slip'|'wrong'} RecallResult */

/**
 * The FSRS card as stored: plain JSON with times as epoch ms, so it survives IndexedDB and the
 * export file alike. Field names are the vendored module's; `state` uses its State values
 * (0 new, 1 learning, 2 review, 3 relearning).
 * @typedef {object} FsrsCard
 * @property {number} due epoch ms
 * @property {number} stability days
 * @property {number} difficulty 1 to 10
 * @property {number} scheduled_days
 * @property {number} reps
 * @property {number} lapses
 * @property {number} learning_steps
 * @property {number} state
 * @property {number|null} last_review epoch ms
 */

/**
 * @typedef {object} ItemState
 * @property {string} itemId
 * @property {Phase} phase
 * @property {number} step index of the learning or relearning step the item waits on
 * @property {number} correctInSession successful recalls (correct or slip) in the session `sessionKey`; a miss resets it
 * @property {string|null} sessionKey local date key of the session the counter belongs to
 * @property {boolean} mastered lifetime flag, never revoked
 * @property {string[]} masterySessions local date keys of the review-phase sessions counted towards mastery
 * @property {FsrsCard|null} card null until the item graduates
 * @property {number} due epoch ms
 * @property {number|null} lastReview epoch ms of the last recall
 * @property {RecallResult|null} lastResult the last recall as the learner gave it, null before the first; a slip right after a slip counts as a miss (effectiveResult)
 * @property {number} reps recalls recorded, whatever the result
 * @property {number} lapses misses in review phase
 */

/** @type {Readonly<Settings>} */
export const DEFAULT_SETTINGS = Object.freeze({ desiredRetention: 0.9, newPerDay: 7, dailyMinutes: 10 });
export const LEARNING_STEPS_MS = Object.freeze([60_000, 600_000]);
export const RELEARNING_STEPS_MS = Object.freeze([600_000]);
export const GRADUATE_AFTER = 3;
export const MASTERY_SESSIONS = 3;

const DAY_MS = 86_400_000;
const SKIP_AHEAD_STABILITY_DAYS = 7;
const RESULTS = new Set(['correct', 'slip', 'wrong']);

/** @type {Map<number, any>} */
const engines = new Map();

/**
 * The FSRS instance for a retention target. An instance holds parameters only, so one per target
 * is shared. Short-term steps are off: this module runs the learning and relearning steps itself.
 * @param {number} retention
 */
function engine(retention) {
  let instance = engines.get(retention);
  if (!instance) {
    instance = fsrs({ request_retention: retention, enable_short_term: false });
    engines.set(retention, instance);
  }
  return instance;
}

/**
 * @param {FsrsCard} card
 * @returns {object} the card as the vendored module takes it, with Date fields
 */
function toFsrs(card) {
  return { ...card, due: new Date(card.due), last_review: card.last_review === null ? undefined : new Date(card.last_review) };
}

/**
 * @param {any} card a card returned by the vendored module
 * @returns {FsrsCard}
 */
function fromFsrs(card) {
  return {
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    scheduled_days: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    learning_steps: card.learning_steps,
    state: card.state,
    last_review: card.last_review ? card.last_review.getTime() : null,
  };
}

/**
 * @param {RecallResult} result
 * @returns {number} the FSRS rating: correct is Good, slip is Hard, wrong is Again
 */
function ratingFor(result) {
  if (result === 'wrong') return Rating.Again;
  return result === 'slip' ? Rating.Hard : Rating.Good;
}

/**
 * Rates the item's card (a fresh one when it has none yet) and returns the stored form.
 * @param {FsrsCard|null} card
 * @param {RecallResult} result
 * @param {number} now
 * @param {Settings} settings
 * @returns {FsrsCard}
 */
function rate(card, result, now, settings) {
  const current = card ? toFsrs(card) : createEmptyCard(new Date(now));
  return fromFsrs(engine(settings.desiredRetention).next(current, new Date(now), ratingFor(result)).card);
}

/**
 * A review is due from the start of the local day FSRS scheduled and never before the next local day.
 * @param {number} cardDue epoch ms
 * @param {number} now epoch ms
 * @param {string} [tz]
 * @returns {number}
 */
function reviewDue(cardDue, now, tz) {
  return Math.max(startOfLocalDay(cardDue, tz), startOfNextLocalDay(now, tz));
}

/**
 * A successful review-phase recall counts as a mastery session when it falls on a later local day
 * than the last counted session, or, when none is counted yet, than the recall before it (the one
 * that brought the item into review). At MASTERY_SESSIONS the item is mastered for good and the
 * list stops growing.
 * @param {ItemState} next the state being built, changed in place
 * @param {ItemState} previous the state before this recall
 * @param {string} key local date key of this recall
 * @param {string} [tz]
 */
function countMasterySession(next, previous, key, tz) {
  if (next.mastered) return;
  const last = previous.masterySessions.at(-1)
    ?? (previous.lastReview === null ? null : localDateKey(previous.lastReview, tz));
  if (last !== null && daysBetween(last, key) < 1) return;
  next.masterySessions.push(key);
  if (next.masterySessions.length >= MASTERY_SESSIONS) next.mastered = true;
}

/**
 * The state of an item the learner has not met yet: phase `new`, due at once.
 * @param {string} itemId
 * @param {number} now epoch ms
 * @returns {ItemState}
 */
export function createState(itemId, now) {
  return {
    itemId,
    phase: 'new',
    step: 0,
    correctInSession: 0,
    sessionKey: null,
    mastered: false,
    masterySessions: [],
    card: null,
    due: now,
    lastReview: null,
    lastResult: null,
    reps: 0,
    lapses: 0,
  };
}

/**
 * @param {ItemState} state
 * @param {number} now epoch ms
 * @returns {boolean}
 */
export function isDue(state, now) {
  return state.due <= now;
}

/**
 * The predicted probability of recall: 1 while the item has no FSRS card (new or learning), the
 * FSRS value otherwise, also for lapsed items.
 * @param {ItemState} state
 * @param {number} now epoch ms
 * @returns {number}
 */
export function retrievability(state, now) {
  if (state.phase === 'new' || state.phase === 'learning' || !state.card) return 1;
  return engine(DEFAULT_SETTINGS.desiredRetention).retrievability(toFsrs(state.card), new Date(now));
}

/**
 * The result a recall counts as: a slip right after a slip on the same item is a miss (spec 5, "a
 * soft pass once, a fail if repeated"), any other recall counts as given. recordRecall drives every
 * branch from it and stores the raw result, and the session screen words its feedback with it.
 * @param {ItemState} state the state before the recall
 * @param {RecallResult} result
 * @returns {RecallResult}
 */
export function effectiveResult(state, result) {
  return result === 'slip' && (state.lastResult ?? null) === 'slip' ? 'wrong' : result;
}

/**
 * Records a typed recall, or a spoken one judged by recognition, and returns the next state. The
 * input is left as it is.
 *
 * The recall counts as effectiveResult says: a slip right after a slip is a miss, so every branch
 * below runs on the effective result, while `lastResult` records the result as given. Learning: a
 * success advances the step and the item is due after that step; the GRADUATE_AFTER-th success of
 * the session graduates it to review with an FSRS card rated Good (Hard for a slip) and due at the
 * start of the next local day, whatever the card says (the card keeps its own fields for the
 * reviews that follow). A miss restarts the steps. Review: a success rates Good or Hard and
 * reschedules by FSRS; a miss rates Again, counts a lapse and sends the item through the relearning
 * step. Lapsed: a success returns the item to review on the day FSRS set when it lapsed; a miss
 * repeats the relearning step without touching the card. A new local day starts a new session: the
 * session counter, and in learning the steps, start over.
 *
 * @param {ItemState} state
 * @param {RecallResult} result
 * @param {number} now epoch ms
 * @param {Settings} settings
 * @param {string} [tz] IANA zone, for tests; the phone's zone when omitted
 * @returns {ItemState}
 */
export function recordRecall(state, result, now, settings, tz) {
  if (!RESULTS.has(result)) throw new RangeError(`Unknown recall result: ${String(result)}`);
  const effective = effectiveResult(state, result);
  const success = effective !== 'wrong';
  const key = localDateKey(now, tz);
  const sameSession = state.sessionKey === key;
  /** @type {ItemState} */
  const next = {
    ...state,
    masterySessions: state.masterySessions.slice(),
    card: state.card ? { ...state.card } : null,
    sessionKey: key,
    correctInSession: success ? (sameSession ? state.correctInSession : 0) + 1 : 0,
    step: sameSession ? state.step : 0,
    lastReview: now,
    lastResult: result,
    reps: state.reps + 1,
  };

  if (state.phase === 'new' || state.phase === 'learning') {
    next.phase = 'learning';
    if (!success) {
      next.step = 0;
      next.due = now + LEARNING_STEPS_MS[0];
    } else if (next.correctInSession >= GRADUATE_AFTER) {
      next.phase = 'review';
      next.step = 0;
      next.card = rate(null, effective, now, settings);
      next.due = startOfNextLocalDay(now, tz);
    } else {
      next.due = now + LEARNING_STEPS_MS[Math.min(next.step, LEARNING_STEPS_MS.length - 1)];
      next.step += 1;
    }
    return next;
  }

  const relearning = state.phase === 'lapsed';
  // Every review-phase recall is an FSRS rating. Relearning steps leave the card alone, unless a
  // review item somehow has none (not produced here): then it gets a card from this recall.
  if (!relearning || !next.card) next.card = rate(state.card, effective, now, settings);
  next.step = 0;
  if (!success) {
    if (!relearning) next.lapses += 1;
    next.phase = 'lapsed';
    next.due = now + RELEARNING_STEPS_MS[0];
  } else {
    next.phase = 'review';
    next.due = reviewDue(next.card.due, now, tz);
    if (!relearning) countMasterySession(next, state, key, tz);
  }
  return next;
}

/**
 * The state of an item the learner got right in a passed checkpoint: in review with a stability of
 * seven days and due in seven days, so it still comes up. Difficulty is FSRS's own for a first
 * rating of Good; the checkpoint answer is the one recall recorded.
 * @param {string} itemId
 * @param {number} now epoch ms
 * @returns {ItemState}
 */
export function skipAheadState(itemId, now) {
  const due = now + SKIP_AHEAD_STABILITY_DAYS * DAY_MS;
  return {
    ...createState(itemId, now),
    phase: 'review',
    card: { ...rate(null, 'correct', now, DEFAULT_SETTINGS), stability: SKIP_AHEAD_STABILITY_DAYS, scheduled_days: SKIP_AHEAD_STABILITY_DAYS, due },
    due,
    lastReview: now,
    reps: 1,
  };
}
