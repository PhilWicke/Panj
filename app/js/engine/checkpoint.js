// Checkpoints (spec 4.6): a unit's checkpoint, the weekly check and the placement check are built
// here as lists of items to answer, scored against the pass mark, and applied to the item states
// through the scheduler. Every function is pure: no DOM, no clock (the screen passes `now`), and
// randomness only through the `rng` passed in, so the tests draw a repeatable order.
//
// Sizes are caps, not floors (Ruling 53): a unit checkpoint is every practisable item of the unit
// up to 16, then up to 4 review-phase items from earlier units; the weekly check is three blocks
// of up to 6 (recent items, older items, the rules' quick checks, Ruling 54). The pass mark is 80
// percent of whatever total. On a passed checkpoint a correct item the learner never met skips
// ahead into review (skipAheadState); an item already scheduled records its result as a recall
// would (Ruling 55), so a checkpoint never sets a learner back on an item they are still learning
// except through the ordinary lapse.

import { createState, recordRecall, skipAheadState } from './scheduler.js';
import { localDateKey } from '../util/time.js';
import { isRuleId } from '../util/ids.js';
import { shuffle } from '../util/shuffle.js';

/** @typedef {import('./scheduler.js').ItemState} ItemState */
/** @typedef {import('./scheduler.js').Settings} Settings */
/** @typedef {import('./progress.js').SessionRecord} SessionRecord */
/** @typedef {import('../store/state.js').Meta} Meta */
/** @typedef {import('../content/types.js').Index} Index */
/** @typedef {import('../content/types.js').UnitContent} UnitContent */
/** @typedef {import('../content/types.js').Item} Item */
/** @typedef {import('../content/types.js').Rule} Rule */

/**
 * One question of a checkpoint. A typed item asks for the Slovenian of `prompt_en` and grades
 * against `answer` and `accept`; a rule item (Ruling 54) is the rule card's quick check, a pick
 * among `options` for the blank in `prompt_sl`, with `explain_en` for a wrong pick.
 * @typedef {object} CheckpointItem
 * @property {string} itemId an item id, or a rule id for a rule item
 * @property {'typed_en_sl'|'rule'} kind
 * @property {string} [prompt_en] typed items: the English to put into Slovenian
 * @property {string} [prompt_sl] rule items: the Slovenian with its blank
 * @property {string[]} [options] rule items: the options, in the content's order
 * @property {string} answer the Slovenian form, or the right option
 * @property {string[]} accept accepted variants; empty for a rule item
 * @property {string} [explain_en] rule items: why the answer is right
 */

/** @typedef {{ itemId: string, correct: boolean }} CheckpointResult how one item went; a slip counts as correct (Ruling 55) */

/** @typedef {{ title: string, items: CheckpointItem[] }} CheckpointBlock */

/** @typedef {{ total: number, correct: number, pct: number, passed: boolean }} CheckpointScore `pct` is exact; the screen rounds it */

/** The share of right answers that passes, in percent. */
export const PASS_MARK = 80;
/** Unit items in a unit checkpoint, at most. */
export const UNIT_ITEMS_MAX = 16;
/** Review-phase items from earlier units in a unit checkpoint, at most. */
export const REVIEW_ITEMS_MAX = 4;
/** Items per block of the weekly check, at most. */
export const BLOCK_SIZE = 6;
/** The weekly check is offered with at least this many items in all (Ruling 53). */
export const WEEKLY_MIN_ITEMS = 6;
/** Active local days between weekly checks. */
export const WEEKLY_EVERY_DAYS = 7;
/** Items of the pool that count as recent in the weekly check. */
const RECENT_POOL = 12;
/** What one item takes, for "about k min". */
const SECONDS_PER_ITEM = 20;

/**
 * @param {Item} item
 * @returns {CheckpointItem}
 */
function typedItem(item) {
  return { itemId: item.id, kind: 'typed_en_sl', prompt_en: item.en, answer: item.sl, accept: item.accept ?? [] };
}

/**
 * @param {Rule} rule
 * @returns {CheckpointItem}
 */
function ruleItem(rule) {
  const check = rule.quick_check;
  return { itemId: rule.id, kind: 'rule', prompt_sl: check.prompt_sl, options: check.options.slice(), answer: check.answer, accept: [], explain_en: check.explain_en };
}

/**
 * The same predicate as unmetItems: an accepted item, or any item in a dev build.
 * @param {Item} item
 * @param {boolean} allowPending
 * @returns {boolean}
 */
function practisable(item, allowPending) {
  return allowPending || item.verification.status === 'accepted';
}

/**
 * The items of a unit's lessons, in lesson order.
 * @param {UnitContent} unitContent
 * @returns {Item[]}
 */
function itemsOf(unitContent) {
  return unitContent.lessons.flatMap((lesson) => lesson.items);
}

/**
 * @param {ItemState|undefined} state
 * @returns {boolean} the item is scheduled in review or relearning
 */
function inReview(state) {
  return state !== undefined && (state.phase === 'review' || state.phase === 'lapsed');
}

/**
 * A unit's checkpoint: every practisable item of the unit in lesson order, shuffled with `rng`
 * and capped at UNIT_ITEMS_MAX, then up to REVIEW_ITEMS_MAX review-phase items from
 * `options.earlier` (the units before it), shuffled; the unit items come first. A unit of eight
 * items gives eight (Ruling 53).
 * @param {UnitContent} unitContent
 * @param {Record<string, ItemState>} states by item id
 * @param {() => number} rng a generator in [0, 1)
 * @param {{ allowPending?: boolean, earlier?: UnitContent[] }} [options] allowPending: a dev build practises pending items; earlier: the units whose review-phase items may be added
 * @returns {CheckpointItem[]}
 */
export function buildUnitCheckpoint(unitContent, states, rng, options = {}) {
  const allowPending = options.allowPending === true;
  const own = shuffle(itemsOf(unitContent).filter((item) => practisable(item, allowPending)), rng).slice(0, UNIT_ITEMS_MAX);
  const chosen = new Set(own.map((item) => item.id));
  const pool = (options.earlier ?? []).flatMap(itemsOf)
    .filter((item) => !chosen.has(item.id) && !isRuleId(item.id) && inReview(states[item.id]));
  const review = shuffle(pool, rng).slice(0, REVIEW_ITEMS_MAX);
  return [...own, ...review].map(typedItem);
}

/**
 * The score of a checkpoint: how many were right, the exact percentage (0 for an empty check) and
 * whether it passes, which an empty check never does.
 * @param {CheckpointResult[]} results
 * @returns {CheckpointScore}
 */
export function scoreCheckpoint(results) {
  const total = results.length;
  const correct = results.filter((result) => result.correct).length;
  const pct = total === 0 ? 0 : (correct / total) * 100;
  return { total, correct, pct, passed: total > 0 && pct >= PASS_MARK };
}

/**
 * The item states a checkpoint changes, by id, and only those (Ruling 55). An item without a
 * state counts as new. Correct in a passed check and new (or a rule still in learning, Ruling 30):
 * the item skips ahead into review. Correct and already scheduled: a correct recall. Correct, new
 * and not passed: unchanged. Wrong and new: unchanged. Wrong otherwise: a wrong recall. The
 * weekly check applies its results with `passed` true. The inputs are left as they are.
 * @param {Record<string, ItemState>} states by item id
 * @param {CheckpointResult[]} results
 * @param {boolean} passed
 * @param {number} now epoch ms
 * @param {Settings} settings
 * @param {string} [tz] IANA zone, for tests; the phone's zone when omitted
 * @returns {Record<string, ItemState>}
 */
export function applyCheckpoint(states, results, passed, now, settings, tz) {
  /** @type {Record<string, ItemState>} */
  const changed = {};
  for (const { itemId, correct } of results) {
    const state = states[itemId] ?? createState(itemId, now);
    const fresh = state.phase === 'new';
    if (correct) {
      const ahead = fresh || (isRuleId(itemId) && state.phase === 'learning');
      if (passed && ahead) changed[itemId] = skipAheadState(itemId, now);
      else if (!fresh) changed[itemId] = recordRecall(state, 'correct', now, settings, tz);
    } else if (!fresh) {
      changed[itemId] = recordRecall(state, 'wrong', now, settings, tz);
    }
  }
  return changed;
}

/**
 * The weekly check: the non-rule items with a state past `new` that the loaded units carry,
 * ordered by lastReview, newest first and null last; the first RECENT_POOL make the recent pool
 * and the rest the older pool. Three blocks of up to BLOCK_SIZE, drawn with `rng`: "Recent",
 * "Older" and "Rules" (the rules of the index whose state is past `new`, as their quick checks).
 * Empty blocks are dropped. The screen offers the check only when the blocks hold WEEKLY_MIN_ITEMS
 * items in all (Ruling 53).
 * @param {Index} index
 * @param {UnitContent[]} units the loaded unit files
 * @param {Record<string, ItemState>} states by item id, rule ids included
 * @param {() => number} rng a generator in [0, 1)
 * @returns {{ blocks: CheckpointBlock[] }}
 */
export function buildWeeklyCheck(index, units, states, rng) {
  /** @type {Map<string, Item>} */
  const items = new Map();
  for (const unit of units) for (const item of itemsOf(unit)) items.set(item.id, item);
  /** @type {{ item: Item, lastReview: number|null }[]} */
  const pool = [];
  for (const [id, state] of Object.entries(states)) {
    const item = items.get(id);
    if (!item || isRuleId(id) || state.phase === 'new') continue;
    pool.push({ item, lastReview: state.lastReview });
  }
  pool.sort((a, b) => {
    if (a.lastReview === b.lastReview) return a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0;
    if (a.lastReview === null) return 1;
    if (b.lastReview === null) return -1;
    return b.lastReview - a.lastReview;
  });
  const recent = pool.slice(0, RECENT_POOL).map((entry) => entry.item);
  const older = pool.slice(RECENT_POOL).map((entry) => entry.item);
  const rules = index.rules.filter((rule) => (states[rule.id]?.phase ?? 'new') !== 'new');
  const blocks = [
    { title: 'Recent', items: shuffle(recent, rng).slice(0, BLOCK_SIZE).map(typedItem) },
    { title: 'Older', items: shuffle(older, rng).slice(0, BLOCK_SIZE).map(typedItem) },
    { title: 'Rules', items: shuffle(rules, rng).slice(0, BLOCK_SIZE).map(ruleItem) },
  ];
  return { blocks: blocks.filter((block) => block.items.length > 0) };
}

/**
 * Whether a weekly check is due: at least WEEKLY_EVERY_DAYS distinct active local days (days a
 * session started on) lie after the day of the last entry of `meta.weeklyChecks`, or since the
 * first session when there is none. The check's own SessionRecord falls on the day of the check,
 * so it never counts towards the next one. `now` is part of the signature the ledger fixed
 * (Ruling 55); the count does not depend on it.
 * @param {SessionRecord[]} sessions
 * @param {Meta} meta
 * @param {number} now epoch ms
 * @param {string} [tz] IANA zone, for tests; the phone's zone when omitted
 * @returns {boolean}
 */
export function dueWeeklyCheck(sessions, meta, now, tz) {
  const last = meta.weeklyChecks?.at(-1)?.at ?? null;
  /** @type {Set<string>} */
  const days = new Set();
  for (const session of sessions) {
    const key = localDateKey(session.startedAt, tz);
    if (last === null || key > last) days.add(key);
  }
  return days.size >= WEEKLY_EVERY_DAYS;
}

/**
 * How the learner's prediction compared with the result: `delta` is positive when they did better
 * than they thought.
 * @param {number} predicted
 * @param {number} actual
 * @returns {{ predicted: number, actual: number, delta: number }}
 */
export function calibration(predicted, actual) {
  return { predicted, actual, delta: actual - predicted };
}

/**
 * The minutes a check of `count` items takes, for "about k min": twenty seconds an item, rounded,
 * at least one.
 * @param {number} count
 * @returns {number}
 */
export function checkpointMinutes(count) {
  return Math.max(1, Math.round((count * SECONDS_PER_ITEM) / 60));
}
