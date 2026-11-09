// The daily session builder. Given the item states, the current lesson with its unit's lessons,
// the rule cards, the settings and the mode, buildSession returns today's queue of exercises as a
// plan that assumes correct answers; the session screen runs it one entry at a time and handles
// retries itself. Every function is pure: nothing here reads the clock, draws randomness except
// through the `rng` passed in, or writes to its inputs.
//
// The queue, in order:
//   1. due reviews (typed recall, oldest due first) interleaved with the lesson's new items. A new
//      item is a meet, a first recall and two later recalls spaced by other work; an item left in
//      learning on an earlier day gets the recalls it still needs, first. A rule card comes right
//      after the meet of the first item that introduces it, then the lesson's structured exercises
//      for that rule, and only then the item's first recall. An item's slot production is its
//      third recall.
//   2. rule cards the lesson lists but no item introduces, until their quick check is recorded.
//   3. with sound, unless the learner can't listen right now: listening over known items, then one
//      perception drill.
//   4. the lesson's dialogue, once every item it practises has graduated.
//   5. with sound and speech recognition on, unless the learner can't talk right now: speaking over
//      known items.
//   6. one fluency pass over five review-phase items, when there are at least five.
// The two quiet choices (Mode.cantListen, Mode.cantTalk) split the mute in two for one sitting and
// are independent: can't listen keeps speaking, can't talk keeps listening and perception.
// quietDrops names the kinds they leave out, for a caller that filters a queue already built.
// A consolidation lesson (lessonRole) brings its unit's earlier lessons together. Its meets queue
// no rule card and no structured exercise, and step 2 is left out. Its practice comes in groups of
// one exercise: each structured exercise, after its rule's card when the bundle carries the rule,
// it has not faded and its card is not queued yet, and each production over a practisable item of
// an earlier lesson of the unit that the learner has met, taken in turn (structured 1, production
// 1, structured 2, ...), the rest of the longer list last. With N the lesson's practisable items
// and G the groups, group g is anchored to N[floor(g * N.length / G)] and comes right after that
// item's first recall in the run that meets it, so the groups fall between the new items and each
// plays once over the lesson. A due review of an earlier item whose production plays today is left
// out, the production being its recall. Production over the lesson's own items stays their third
// recall; any other production is not queued.
// buildMoreRound plans the closing menu's "Three more minutes" (Ruling 80): typed recall over the
// review-phase items the run did not practise, weakest first, filled up from the run's misses.
// Items whose verification is not `accepted` never enter the queue (the compiler keeps them in the
// lesson's `items`), unless `allowPending` is set, which a dev build does to try pending content
// end to end; items the builder has no content for are trusted, since their state means they were
// accepted when they were practised. Rule ids share the states with the items (a rule's quick
// check is a scheduled item whose id is the rule id) and are never typed recalls.

import { GRADUATE_AFTER, isDue, retrievability } from './scheduler.js';
import { lessonRole, practisable as practisableItem } from './course.js';
import { localDateKey } from '../util/time.js';
import { isRuleId } from '../util/ids.js';

/** @typedef {import('./scheduler.js').ItemState} ItemState */
/** @typedef {import('./scheduler.js').Settings} Settings */
/** @typedef {import('../content/types.js').Lesson} Lesson */
/** @typedef {import('../content/types.js').Rule} Rule */
/** @typedef {import('../content/types.js').Item} Item */

/** @typedef {'meet'|'typed_en_sl'|'typed_sl_en'|'structured'|'slot'|'dialogue'|'listening'|'speaking'|'perception'|'rule'|'fluency'} ExerciseKind */

/**
 * One exercise of the day's queue. The fields set depend on the kind: `meet`, `typed_en_sl`,
 * `typed_sl_en`, `listening` and `speaking` carry `itemId`; `rule` carries `ruleId`; `structured`
 * carries `exerciseId` and `ruleId`; `slot` carries `exerciseId` and `itemId`; `dialogue` carries
 * `exerciseId`; `fluency` carries `itemIds`; `perception` carries nothing. `lessonId` is set when
 * the entry belongs to a lesson the builder was given.
 * @typedef {object} QueueEntry
 * @property {ExerciseKind} kind
 * @property {string} [itemId]
 * @property {string[]} [itemIds] `fluency` only: up to five review-phase items for the quick typed pass (Ruling 5)
 * @property {string} [ruleId]
 * @property {string} [exerciseId]
 * @property {string} [lessonId]
 */

/**
 * @typedef {object} Mode
 * @property {boolean} mute no sound: no listening, speaking or perception entries
 * @property {boolean} speech speech recognition is on, so speaking entries are added (unless muted or the learner can't talk)
 * @property {boolean} [cantListen] the learner can't listen right now, for this sitting: no listening or perception entries (false when omitted)
 * @property {boolean} [cantTalk] the learner can't talk right now, for this sitting: no speaking entries, in the queue or the closing menu (false when omitted)
 */

/**
 * @typedef {object} SessionInput
 * @property {number} now epoch ms
 * @property {Record<string, ItemState>} states by item id (rule ids included)
 * @property {Lesson|null} lesson the current lesson, or null when there is none
 * @property {Lesson[]} unitLessons the lessons of the current unit
 * @property {Rule[]} rules the rule cards the bundle carries
 * @property {Settings} settings
 * @property {Mode} mode
 * @property {number} newToday items met earlier today
 * @property {number} minutesToday minutes practised earlier today
 * @property {() => number} [rng] a generator in [0, 1); Math.random when omitted
 * @property {string} [tz] IANA zone, for tests; the phone's zone when omitted
 * @property {boolean} [allowPending] a dev build practises items whose verification is not accepted; never set on a strict build (false when omitted)
 */

/**
 * @typedef {object} Session
 * @property {QueueEntry[]} queue
 * @property {number} newCount items met for the first time in this queue
 * @property {number} reviewCount due reviews in this queue
 * @property {number} estimatedMinutes the sum of MINUTES_PER_KIND over the queue
 */

/** @typedef {{ intro: QueueEntry[], later: QueueEntry[][] }} LearningUnit an item's entries: what is emitted when it comes up, then one group per later recall */

/** Minutes a typed recall takes, the unit of the review forecast. */
export const REVIEW_MINUTES = 0.25;
/** Minutes a new item takes: its meet and the GRADUATE_AFTER recalls that graduate it. */
export const NEW_ITEM_MINUTES = 0.75;
/**
 * Minutes per queue entry. A meet's time is counted with its item's recalls, so a new item adds
 * NEW_ITEM_MINUTES and a slot in place of the third recall adds nothing more.
 * @type {Readonly<Record<ExerciseKind, number>>}
 */
export const MINUTES_PER_KIND = Object.freeze({
  meet: NEW_ITEM_MINUTES - GRADUATE_AFTER * REVIEW_MINUTES,
  typed_en_sl: REVIEW_MINUTES,
  typed_sl_en: REVIEW_MINUTES,
  structured: 0.25,
  slot: REVIEW_MINUTES,
  dialogue: 1,
  listening: 0.25,
  speaking: 0.5,
  perception: 0.25,
  rule: 0.5,
  fluency: 1,
});

const FLUENCY_ITEMS = 5;
const LISTENING_PER_SESSION = 2;
const SPEAKING_PER_SESSION = 2;
const MORE_MINUTES_UNTIL = 15;
/** The most items a "Three more minutes" round holds. */
export const MORE_ITEMS = 8;
/** Below this many unpractised review items, the round fills up from the run's misses. */
export const MORE_MIN = 3;
const DAY_MS = 86_400_000;

/**
 * The review load in a window: every scheduled item (phase not `new`, rule items left out) due by
 * `now` plus `days` days, at REVIEW_MINUTES each. Items already overdue count, since they are
 * load whether they are reviewed today or tomorrow.
 * @param {Record<string, ItemState>} states
 * @param {number} now epoch ms
 * @param {number} [days]
 * @returns {number} minutes
 */
export function forecastReviewMinutes(states, now, days = 1) {
  const horizon = now + days * DAY_MS;
  let count = 0;
  for (const [id, state] of Object.entries(states)) {
    if (state.phase !== 'new' && !isRuleId(id) && state.due <= horizon) count += 1;
  }
  return count * REVIEW_MINUTES;
}

/**
 * The exercise kinds the sitting's quiet choices leave out: listening and perception when the
 * learner can't listen right now, speaking when they can't talk right now. The mute is not a quiet
 * choice and adds nothing here.
 * @param {Mode} mode
 * @returns {Set<ExerciseKind>}
 */
export function quietDrops(mode) {
  /** @type {Set<ExerciseKind>} */
  const drops = new Set();
  if (mode.cantListen) {
    drops.add('listening');
    drops.add('perception');
  }
  if (mode.cantTalk) drops.add('speaking');
  return drops;
}

/**
 * The options of the closing menu, in display order: stop always; three more minutes while a
 * round is available (buildMoreRound) and until the goal plus MORE_MINUTES_UNTIL minutes are done;
 * a speaking round when sound is on and the learner can talk right now; continue the lesson when
 * it has items left.
 * @param {{ minutesToday: number, settings: Settings, lessonRemaining: boolean, mode: Mode, moreAvailable: boolean }} input
 * @returns {('stop'|'more3'|'speaking'|'continue')[]}
 */
export function closingMenu({ minutesToday, settings, lessonRemaining, mode, moreAvailable }) {
  /** @type {('stop'|'more3'|'speaking'|'continue')[]} */
  const options = ['stop'];
  if (moreAvailable && minutesToday < settings.dailyMinutes + MORE_MINUTES_UNTIL) options.push('more3');
  if (!mode.mute && !mode.cantTalk) options.push('speaking');
  if (lessonRemaining) options.push('continue');
  return options;
}

/**
 * @typedef {object} MoreRoundInput
 * @property {number} now epoch ms
 * @property {Record<string, ItemState>} states by item id (rule ids included; they never enter the round)
 * @property {Set<string>} practised the item ids the run that just ended practised
 * @property {string[]} missed the item ids the run missed, in order
 * @property {Settings} [settings] the learner's settings, part of the input Ruling 80 fixes; the round does not read them yet
 */

/**
 * The queue of "Three more minutes" (Ruling 80): typed recall over the review-phase items the run
 * did not practise, the weakest retrievability first, at most MORE_ITEMS; when fewer than MORE_MIN
 * qualify, the run's missed items follow, in order and without repeats. Rule items, the dialogue,
 * listening, perception and meets never appear; the round is empty when nothing qualifies and
 * nothing was missed.
 * @param {MoreRoundInput} input
 * @returns {QueueEntry[]}
 */
export function buildMoreRound({ now, states, practised, missed }) {
  const fresh = Object.values(states)
    .filter((state) => state.phase === 'review' && !isRuleId(state.itemId) && !practised.has(state.itemId))
    .map((state) => ({ itemId: state.itemId, r: retrievability(state, now) }))
    .sort((a, b) => a.r - b.r || (a.itemId < b.itemId ? -1 : 1))
    .slice(0, MORE_ITEMS)
    .map(({ itemId }) => itemId);
  const ids = new Set(fresh);
  if (fresh.length < MORE_MIN) {
    for (const itemId of missed) if (!isRuleId(itemId)) ids.add(itemId);
  }
  return [...ids].map((itemId) => ({ kind: 'typed_en_sl', itemId }));
}

/**
 * `count` entries spread over `groups` groups as evenly as possible, the earlier groups taking
 * the remainder.
 * @param {number} count
 * @param {number} groups
 * @returns {number[]}
 */
function spread(count, groups) {
  const base = Math.floor(count / groups);
  const extra = count % groups;
  return Array.from({ length: groups }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * Up to `n` elements of `pool` in random order, without repeats (a partial Fisher-Yates shuffle).
 * @template T
 * @param {T[]} pool
 * @param {number} n
 * @param {() => number} rng
 * @returns {T[]}
 */
function sample(pool, n, rng) {
  const copy = pool.slice();
  const taken = Math.min(n, copy.length);
  for (let i = 0; i < taken; i += 1) {
    const j = i + Math.floor(rng() * (copy.length - i));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, taken);
}

/**
 * Two lists taken in turn, the first list leading, the rest of the longer list last.
 * @template T
 * @param {T[]} first
 * @param {T[]} second
 * @returns {T[]}
 */
function alternate(first, second) {
  /** @type {T[]} */
  const out = [];
  for (let i = 0; i < Math.max(first.length, second.length); i += 1) {
    if (i < first.length) out.push(first[i]);
    if (i < second.length) out.push(second[i]);
  }
  return out;
}

/**
 * The learning units interleaved with the reviews. Unit i opens step i; its second recall comes in
 * step i + 1 and its third in step i + 2, after the next items' introductions, so the recalls of
 * one item are spaced by other work. The reviews are spread over the gaps before, between and
 * after the steps, the earlier gaps taking more, so a session opens with reviews.
 * @param {LearningUnit[]} units
 * @param {QueueEntry[]} reviews
 * @returns {QueueEntry[]}
 */
function interleave(units, reviews) {
  /** @type {QueueEntry[][]} */
  const steps = [];
  const stepCount = units.length === 0 ? 0 : units.length + GRADUATE_AFTER - 1;
  for (let i = 0; i < stepCount; i += 1) {
    /** @type {QueueEntry[]} */
    const step = [];
    if (i < units.length) step.push(...units[i].intro);
    for (let lag = 1; lag < GRADUATE_AFTER; lag += 1) {
      const unit = units[i - lag];
      if (unit && unit.later[lag - 1]) step.push(...unit.later[lag - 1]);
    }
    steps.push(step);
  }
  const shares = spread(reviews.length, steps.length + 1);
  /** @type {QueueEntry[]} */
  const queue = [];
  let taken = 0;
  for (let gap = 0; gap <= steps.length; gap += 1) {
    queue.push(...reviews.slice(taken, taken + shares[gap]));
    taken += shares[gap];
    if (gap < steps.length) queue.push(...steps[gap]);
  }
  return queue;
}

/**
 * Today's queue. See the module comment for its shape.
 * @param {SessionInput} input
 * @returns {Session}
 */
export function buildSession(input) {
  const { now, states, lesson, unitLessons, rules, settings, mode, newToday, rng = Math.random, tz, allowPending = false } = input;
  const todayKey = localDateKey(now, tz);
  /** the current lesson when it is a consolidation lesson, else null */
  const consolidation = lesson && lessonRole(lesson) === 'consolidation' ? lesson : null;

  /** @type {Map<string, { item: Item, lesson: Lesson }>} the items the builder has content for */
  const known = new Map();
  for (const l of lesson ? [lesson, ...unitLessons] : unitLessons) {
    for (const item of l.items) if (!known.has(item.id)) known.set(item.id, { item, lesson: l });
  }
  const ruleIds = new Set(rules.map((rule) => rule.id));
  /** @param {string} id @returns {boolean} an item (not a rule) that may be practised: accepted, unknown, or any known item with allowPending */
  const practisable = (id) => {
    if (isRuleId(id)) return false;
    const entry = known.get(id);
    return !entry || practisableItem(entry.item, allowPending);
  };
  /** @param {string} id @returns {string|undefined} */
  const lessonOf = (id) => known.get(id)?.lesson.id;
  /** @param {string} itemId @returns {QueueEntry} */
  const typed = (itemId) => {
    const lessonId = lessonOf(itemId);
    return lessonId ? { kind: 'typed_en_sl', itemId, lessonId } : { kind: 'typed_en_sl', itemId };
  };
  /** @param {ItemState} a @param {ItemState} b */
  const byDue = (a, b) => a.due - b.due || (a.itemId < b.itemId ? -1 : 1);

  const scheduled = Object.entries(states).filter(([id]) => practisable(id)).map(([, state]) => state);
  const unfinished = scheduled.filter((state) => state.phase === 'learning').sort(byDue);
  const reviewPhase = scheduled.filter((state) => state.phase === 'review');

  // New items: the lesson's practisable items not met yet, in lesson order, up to the per-day cap
  // and the budget: tomorrow's forecast plus NEW_ITEM_MINUTES per new item stays within the daily goal.
  const remaining = lesson
    ? lesson.items.filter((item) => practisable(item.id) && (states[item.id]?.phase ?? 'new') === 'new')
    : [];
  const budget = Math.floor((settings.dailyMinutes - forecastReviewMinutes(states, now, 1)) / NEW_ITEM_MINUTES);
  const fresh = remaining.slice(0, Math.max(0, Math.min(settings.newPerDay - newToday, remaining.length, budget)));

  // A consolidation lesson's groups (see the module comment), kept only when their anchor is new today.
  /** @type {Map<string, QueueEntry[]>} the groups queued today by the id of their anchor item, in group order */
  const anchored = new Map();
  /** @type {Set<string>} earlier items whose production is queued today */
  const produced = new Set();
  if (consolidation) {
    const earlier = new Set(unitLessons
      .filter((l) => l.order < consolidation.order)
      .flatMap((l) => l.items.filter((item) => practisable(item.id)).map((item) => item.id)));
    /** @type {QueueEntry[]} */
    const structured = consolidation.structured.map((exercise) => ({
      kind: 'structured', exerciseId: exercise.id, ruleId: exercise.rule, lessonId: consolidation.id,
    }));
    /** @type {QueueEntry[]} */
    const production = consolidation.production
      .filter((exercise) => earlier.has(exercise.item) && (states[exercise.item]?.phase ?? 'new') !== 'new')
      .map((exercise) => ({ kind: 'slot', exerciseId: exercise.id, itemId: exercise.item, lessonId: consolidation.id }));
    const groups = alternate(structured, production);
    const anchors = consolidation.items.filter((item) => practisable(item.id));
    const freshIds = new Set(fresh.map((item) => item.id));
    groups.forEach((group, g) => {
      const anchor = anchors[Math.floor((g * anchors.length) / groups.length)];
      if (!anchor || !freshIds.has(anchor.id)) return;
      anchored.set(anchor.id, [...(anchored.get(anchor.id) ?? []), group]);
      if (group.itemId !== undefined) produced.add(group.itemId);
    });
  }

  const reviews = scheduled
    .filter((state) => (state.phase === 'review' || state.phase === 'lapsed') && isDue(state, now) && !produced.has(state.itemId))
    .sort(byDue)
    .map((state) => typed(state.itemId));

  /** @type {Set<string>} items that graduate within this plan */
  const learningToday = new Set();
  /** @type {Set<string>} rules queued in this session, card or practice */
  const queuedRules = new Set();
  /** @param {string} ruleId the rule's quick-check item is in review and recallable at the retention target */
  const faded = (ruleId) => {
    const state = states[ruleId];
    return state !== undefined && state.phase === 'review' && retrievability(state, now) >= settings.desiredRetention;
  };
  /**
   * The card (unless faded) and the lesson's structured exercises for a rule the bundle carries.
   * @param {string} ruleId @param {Lesson} inLesson @returns {QueueEntry[]}
   */
  const ruleEntries = (ruleId, inLesson) => {
    queuedRules.add(ruleId);
    /** @type {QueueEntry[]} */
    const entries = faded(ruleId) ? [] : [{ kind: 'rule', ruleId, lessonId: inLesson.id }];
    for (const exercise of inLesson.structured) {
      if (exercise.rule === ruleId) entries.push({ kind: 'structured', exerciseId: exercise.id, ruleId, lessonId: inLesson.id });
    }
    return entries;
  };
  /**
   * An item's entries: the meet (for a new item), right after it the cards of the rules the item
   * introduces with their structured exercises (not in a consolidation lesson), then `needed`
   * recalls of which the last is the item's slot production when its lesson has one.
   * @param {string} itemId @param {boolean} meet @param {number} needed @returns {LearningUnit}
   */
  const unitFor = (itemId, meet, needed) => {
    learningToday.add(itemId);
    const entry = known.get(itemId);
    const lessonId = entry?.lesson.id;
    /** @type {QueueEntry[][]} */
    const groups = Array.from({ length: needed }, () => [typed(itemId)]);
    const production = entry ? entry.lesson.production.filter((exercise) => exercise.item === itemId) : [];
    if (production.length > 0) {
      groups[needed - 1] = production.map((exercise) => ({ kind: 'slot', exerciseId: exercise.id, itemId, lessonId }));
    }
    /** @type {QueueEntry[]} */
    const intro = meet && lessonId ? [{ kind: 'meet', itemId, lessonId }] : [];
    if (meet && entry && !consolidation) {
      for (const ruleId of entry.item.rules ?? []) {
        if (!queuedRules.has(ruleId) && ruleIds.has(ruleId)) intro.push(...ruleEntries(ruleId, entry.lesson));
      }
    }
    intro.push(...groups[0]);
    return { intro, later: groups.slice(1) };
  };

  /**
   * A consolidation group as queued: a structured exercise comes after its rule's card when the
   * bundle carries the rule, it has not faded and its card is not queued yet.
   * @param {QueueEntry} group @returns {QueueEntry[]}
   */
  const withCard = (group) => {
    const ruleId = group.kind === 'structured' ? group.ruleId : undefined;
    if (ruleId === undefined) return [group];
    const card = !queuedRules.has(ruleId) && ruleIds.has(ruleId) && !faded(ruleId);
    queuedRules.add(ruleId);
    return card ? [{ kind: 'rule', ruleId, lessonId: group.lessonId }, group] : [group];
  };

  /** @type {LearningUnit[]} */
  const units = [];
  for (const state of unfinished) {
    const done = state.sessionKey === todayKey ? state.correctInSession : 0;
    units.push(unitFor(state.itemId, false, Math.max(1, GRADUATE_AFTER - done)));
  }
  for (const item of fresh) {
    const unit = unitFor(item.id, true, GRADUATE_AFTER);
    for (const group of anchored.get(item.id) ?? []) unit.intro.push(...withCard(group));
    units.push(unit);
  }

  const queue = interleave(units, reviews);

  // Rules the lesson lists that no item introduces today or later, never quick-checked: shown
  // after the learning work until their quick check is recorded. Not in a consolidation lesson.
  if (lesson && !consolidation) {
    for (const ruleId of lesson.rules) {
      if (queuedRules.has(ruleId) || !ruleIds.has(ruleId) || states[ruleId] !== undefined) continue;
      if (remaining.some((item) => (item.rules ?? []).includes(ruleId))) continue;
      queue.push(...ruleEntries(ruleId, lesson));
    }
  }

  // The dialogue, once every item it practises has graduated or graduates within this plan.
  /** @type {QueueEntry|null} */
  let dialogue = null;
  if (lesson?.dialogue) {
    const practised = new Set(lesson.dialogue.lines.flatMap((line) => line.new_items ?? []));
    const graduated = (/** @type {string} */ id) => {
      const phase = states[id]?.phase;
      return practisable(id) && (phase === 'review' || phase === 'lapsed' || learningToday.has(id));
    };
    if ([...practised].every(graduated)) dialogue = { kind: 'dialogue', exerciseId: lesson.dialogue.id, lessonId: lesson.id };
  }

  if (queue.length === 0 && !dialogue) return { queue: [], newCount: 0, reviewCount: 0, estimatedMinutes: 0 };

  // Known material for the extras: review-phase items, those not reviewed today first.
  const notDue = reviewPhase.filter((state) => !isDue(state, now));
  const due = reviewPhase.filter((state) => isDue(state, now));
  /** @param {number} n @returns {string[]} */
  const pick = (n) => {
    const picked = sample(notDue, n, rng);
    return picked.concat(sample(due, n - picked.length, rng)).map((state) => state.itemId);
  };

  if (!mode.mute && !mode.cantListen) {
    for (const itemId of pick(LISTENING_PER_SESSION)) queue.push({ kind: 'listening', itemId });
    queue.push({ kind: 'perception' });
  }
  if (dialogue) queue.push(dialogue);
  if (!mode.mute && !mode.cantTalk && mode.speech) {
    for (const itemId of pick(SPEAKING_PER_SESSION)) queue.push({ kind: 'speaking', itemId });
  }
  if (reviewPhase.length >= FLUENCY_ITEMS) queue.push({ kind: 'fluency', itemIds: pick(FLUENCY_ITEMS) });

  return {
    queue,
    newCount: fresh.length,
    reviewCount: reviews.length,
    estimatedMinutes: queue.reduce((sum, entry) => sum + MINUTES_PER_KIND[entry.kind], 0),
  };
}
