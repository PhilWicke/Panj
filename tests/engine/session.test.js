// tests/engine/session.test.js
// The daily session builder: due reviews interleaved with the lesson's new items under the per-day
// and forecast caps, rule cards right after the meet that introduces them, slot production as the third
// recall, the dialogue once its items have graduated, audio kinds by mode, one fluency pass to
// close, the closing menu, and the "Three more minutes" round (Ruling 80).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS, GRADUATE_AFTER, createState, recordRecall, skipAheadState, retrievability, isDue,
} from '../../app/js/engine/scheduler.js';
import { localDateKey } from '../../app/js/util/time.js';
import {
  buildSession, forecastReviewMinutes, closingMenu, buildMoreRound, REVIEW_MINUTES, NEW_ITEM_MINUTES, MINUTES_PER_KIND, MORE_ITEMS, MORE_MIN,
} from '../../app/js/engine/session.js';

const TZ = 'Europe/Berlin';
const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5, 9, 0);   // Monday 5 January 2026, 10:00 in Berlin
const S = DEFAULT_SETTINGS;              // retention 0.9, 7 new per day, 10 minutes
const SOUND = { mute: false, speech: false };
const MUTE = { mute: true, speech: false };
const SPEECH = { mute: false, speech: true };

/** A deterministic generator in [0, 1) (mulberry32), so picks are repeatable. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const verified = (status) => ({ review1: null, review2: null, native: null, status });
const item = (id, rules = [], status = 'accepted') => ({
  id, type: 'chunk', sl: `sl ${id}`, en: `en ${id}`, register: 'neutral', examples: [], rules, verification: verified(status),
});
const rule = (id) => ({
  id, unit: 'u01', title_en: id, card_en: 'One idea.', example: { sl: 'sl', en: 'en' },
  quick_check: { prompt_sl: 'a _', options: ['x', 'y'], answer: 'x', explain_en: 'why' },
});
const RULES = [rule('r-a'), rule('r-b'), rule('r-c')];

/**
 * The test lesson u01-l02: three items, r-a introduced by the first two, r-b by the second, three
 * structured exercises (two for r-a, one for r-b), one production exercise for item 2, a dialogue
 * over items 2 and 3.
 */
function lesson(overrides = {}) {
  return {
    id: 'u01-l02', unit: 'u01', order: 2, title_sl: 'Lekcija', title_en: 'Lesson',
    items: [item('u01-l02-i01', ['r-a']), item('u01-l02-i02', ['r-a', 'r-b']), item('u01-l02-i03')],
    rules: ['r-a', 'r-b'],
    structured: [
      { id: 'u01-l02-s01', prompt_sl: 'a _', options: ['x', 'y'], answer: 'x', rule: 'r-a', en: 'a' },
      { id: 'u01-l02-s02', prompt_sl: 'b _', options: ['x', 'y'], answer: 'x', rule: 'r-b', en: 'b' },
      { id: 'u01-l02-s03', prompt_sl: 'c _', options: ['x', 'y'], answer: 'y', rule: 'r-a', en: 'c' },
    ],
    production: [{ id: 'u01-l02-p01', en: 'Say two.', answer: 'sl u01-l02-i02', accept: [], item: 'u01-l02-i02' }],
    dialogue: {
      id: 'u01-l02-d', title_sl: 'Pogovor', title_en: 'Talk', setting_en: 'At the table.',
      lines: [
        { speaker: 'host', sl: 'sl', en: 'en' },
        { speaker: 'you', sl: 'sl u01-l02-i02', en: 'en', new_items: ['u01-l02-i02'] },
        { speaker: 'you', sl: 'sl u01-l02-i03', en: 'en', new_items: ['u01-l02-i03'] },
      ],
    },
    ...overrides,
  };
}

/** A lesson of n plain items and nothing else, for the cap tests. */
const plainLesson = (n) => lesson({
  items: Array.from({ length: n }, (_, i) => item(`u01-l02-i${String(i + 1).padStart(2, '0')}`)),
  rules: [], structured: [], production: [], dialogue: undefined,
});

/** A review-phase item due exactly at `due` (a skip-ahead state taken seven days earlier). */
const review = (id, due) => skipAheadState(id, due - 7 * DAY);
const byId = (...list) => Object.fromEntries(list.map((s) => [s.itemId, s]));
const recall = (state, result, now) => recordRecall(state, result, now, S, TZ);

function build(overrides = {}) {
  const current = overrides.lesson === undefined ? lesson() : overrides.lesson;
  return buildSession({
    now: T0, states: {}, lesson: current, unitLessons: current ? [current] : [], rules: RULES, settings: S, mode: MUTE,
    newToday: 0, minutesToday: 0, rng: seeded(1), tz: TZ, ...overrides,
  });
}
const kinds = (queue) => queue.map((e) => e.kind);
const isRecall = (e) => e.kind === 'typed_en_sl' || e.kind === 'slot';
/** Positions of the typed and slot recalls of one item. */
const recallsOf = (queue, itemId) => queue.flatMap((e, i) => (isRecall(e) && e.itemId === itemId ? [i] : []));
const referencedItems = (queue) => new Set(queue.flatMap((e) => [e.itemId, ...(e.itemIds ?? [])]).filter(Boolean));

function deepFreeze(value) {
  if (value && typeof value === 'object') for (const v of Object.values(value)) deepFreeze(v);
  return Object.freeze(value);
}

test('reviews come first and new items respect the daily cap', () => {
  // four earlier items due today, given in a scrambled order; eight new items in the lesson
  const states = byId(
    review('u01-l01-i03', T0 - 2 * DAY), review('u01-l01-i01', T0 - 3 * HOUR), review('u01-l01-i04', T0), review('u01-l01-i02', T0 - DAY),
  );
  const big = plainLesson(8);
  const { queue, newCount, reviewCount, estimatedMinutes } = build({ states, lesson: big, newToday: 2 });
  assert.equal(reviewCount, 4);
  assert.equal(newCount, 5, 'seven per day minus the two met earlier today');
  const reviews = queue.filter((e) => e.kind === 'typed_en_sl' && e.itemId.startsWith('u01-l01-'));
  assert.deepEqual(reviews.map((e) => e.itemId), ['u01-l01-i03', 'u01-l01-i02', 'u01-l01-i01', 'u01-l01-i04'], 'oldest due first');
  assert.deepEqual(queue[0], { kind: 'typed_en_sl', itemId: 'u01-l01-i03' }, 'the session opens with the oldest review');
  const meets = queue.filter((e) => e.kind === 'meet');
  assert.deepEqual(meets.map((e) => e.itemId), ['u01-l02-i01', 'u01-l02-i02', 'u01-l02-i03', 'u01-l02-i04', 'u01-l02-i05'], 'lesson order');
  for (const meet of meets) {
    assert.equal(meet.lessonId, 'u01-l02');
    const at = queue.indexOf(meet);
    const recalls = recallsOf(queue, meet.itemId);
    assert.equal(recalls.length, GRADUATE_AFTER, 'a meet and three recalls');
    assert.equal(recalls[0], at + 1, 'the first recall follows the meet at once when the item introduces no rule');
    assert.ok(recalls[1] > recalls[0] + 1 && recalls[2] > recalls[1] + 1, 'the later recalls are spaced by other work');
  }
  const firstMeet = queue.findIndex((e) => e.kind === 'meet');
  assert.ok(queue.slice(firstMeet).some((e) => e.kind === 'typed_en_sl' && e.itemId.startsWith('u01-l01-')), 'reviews continue between the new items');
  assert.ok(!queue.some((e) => e.itemId === 'u01-l02-i06'), 'the sixth item waits for another day');
  assert.equal(estimatedMinutes, 4 * REVIEW_MINUTES + 5 * NEW_ITEM_MINUTES);
  assert.equal(queue.length, 4 + 5 * (1 + GRADUATE_AFTER), 'nothing else in mute mode with fewer than five review items');
  // at the cap already: reviews only
  const capped = build({ states, lesson: big, newToday: 7 });
  assert.equal(capped.newCount, 0);
  assert.deepEqual(kinds(capped.queue), Array(4).fill('typed_en_sl'));
  assert.equal(build({ lesson: big, settings: { ...S, newPerDay: 0 } }).newCount, 0, 'the setting can be zero');
  // a lesson with two items left introduces two
  const small = build({ lesson: plainLesson(2) });
  assert.equal(small.newCount, 2);
  assert.equal(small.reviewCount, 0);
  // a lapsed item due for its relearning step is a review; a review not due yet is not
  const lapsed = recall(review('u01-l01-i05', T0 - HOUR), 'wrong', T0 - HOUR);
  assert.equal(lapsed.phase, 'lapsed');
  const mixed = build({ states: byId(lapsed, review('u01-l01-i06', T0 + DAY)), lesson: null });
  assert.deepEqual(mixed.queue, [{ kind: 'typed_en_sl', itemId: 'u01-l01-i05' }]);
  assert.equal(mixed.reviewCount, 1);
});

test("new items are reduced when tomorrow's forecast would exceed the budget", () => {
  const dueTomorrow = (n) => byId(...Array.from({ length: n }, (_, i) => review(`u01-l01-i${String(i + 1).padStart(2, '0')}`, T0 + DAY - HOUR)));
  const big = plainLesson(8);
  assert.equal(forecastReviewMinutes(dueTomorrow(28), T0), 7);
  const r = build({ states: dueTomorrow(28), lesson: big });
  assert.equal(r.reviewCount, 0, 'nothing is due yet today');
  assert.equal(r.newCount, 4, 'floor((10 - 7) / 0.75)');
  assert.equal(build({ states: dueTomorrow(40), lesson: big }).newCount, 0, 'the forecast alone fills the budget');
  assert.equal(build({ states: dueTomorrow(40), lesson: big, settings: { ...S, dailyMinutes: 20 } }).newCount, 7, 'a larger budget restores the per-day cap');
  assert.equal(build({ states: dueTomorrow(29), lesson: big, settings: { ...S, dailyMinutes: 8 } }).newCount, 1, 'floor((8 - 7.25) / 0.75)');
  // the forecast window: items due by now plus `days` days, phase not new, rule items left out
  const learning = recall(createState('u01-l03-i02', T0 - HOUR), 'correct', T0 - HOUR);
  const states = {
    ...byId(review('u02-l01-i01', T0 + 2 * DAY), review('u02-l01-i02', T0 - DAY), createState('u01-l03-i01', T0 - HOUR), learning),
    'r-a': review('r-a', T0 - DAY),
  };
  assert.equal(forecastReviewMinutes(states, T0), 2 * REVIEW_MINUTES, 'the overdue review and the learning step; not the new item, the rule or the item due in two days');
  assert.equal(forecastReviewMinutes(states, T0, 2), 3 * REVIEW_MINUTES);
  assert.equal(forecastReviewMinutes(states, T0, 0), 2 * REVIEW_MINUTES);
  assert.equal(forecastReviewMinutes({}, T0), 0);
});

test('rule card appears after the first meet that references it, then its structured items', () => {
  const { queue } = build();
  const find = (pred) => { const i = queue.findIndex(pred); assert.ok(i >= 0, 'entry present'); return i; };
  const meet1 = find((e) => e.kind === 'meet' && e.itemId === 'u01-l02-i01');
  const meet2 = find((e) => e.kind === 'meet' && e.itemId === 'u01-l02-i02');
  const ruleA = find((e) => e.kind === 'rule' && e.ruleId === 'r-a');
  const ruleB = find((e) => e.kind === 'rule' && e.ruleId === 'r-b');
  assert.equal(queue.filter((e) => e.kind === 'rule').length, 2, 'once per rule, although two items reference r-a');
  assert.ok(ruleA > meet1 && ruleA < meet2, 'r-a follows the first item that references it');
  assert.equal(ruleA, meet1 + 1, 'right after the meet, before the item\'s first recall');
  assert.deepEqual(queue.slice(meet1, meet1 + 5), [
    { kind: 'meet', itemId: 'u01-l02-i01', lessonId: 'u01-l02' },
    { kind: 'rule', ruleId: 'r-a', lessonId: 'u01-l02' },
    { kind: 'structured', exerciseId: 'u01-l02-s01', ruleId: 'r-a', lessonId: 'u01-l02' },
    { kind: 'structured', exerciseId: 'u01-l02-s03', ruleId: 'r-a', lessonId: 'u01-l02' },
    { kind: 'typed_en_sl', itemId: 'u01-l02-i01', lessonId: 'u01-l02' },
  ], 'meet, the card, the lesson\'s structured exercises for the rule in order, then the item\'s first recall');
  assert.equal(ruleB, meet2 + 1, 'r-a is already queued, so r-b comes right after the second meet');
  assert.deepEqual(queue[ruleB + 1], { kind: 'structured', exerciseId: 'u01-l02-s02', ruleId: 'r-b', lessonId: 'u01-l02' });
  assert.equal(queue.filter((e) => e.kind === 'structured').length, 3, 'each structured exercise once');
  // a faded rule: its quick-check item is in review with retrievability at or above the target; the card goes, the practice stays
  const fadedA = review('r-a', T0 + 6 * DAY);
  assert.ok(retrievability(fadedA, T0) >= S.desiredRetention);
  const faded = build({ states: byId(fadedA) }).queue;
  assert.ok(!faded.some((e) => e.kind === 'rule' && e.ruleId === 'r-a'));
  assert.ok(faded.some((e) => e.kind === 'rule' && e.ruleId === 'r-b'));
  const first = faded.findIndex((e) => e.kind === 'meet');
  assert.deepEqual(faded.slice(first + 1, first + 4).map((e) => e.exerciseId ?? e.kind), ['u01-l02-s01', 'u01-l02-s03', 'typed_en_sl'], 'structured exercises keep their place, before the first recall');
  // below the target the card is back
  const weakA = review('r-a', T0 - 60 * DAY);
  assert.ok(retrievability(weakA, T0) < S.desiredRetention);
  assert.ok(build({ states: byId(weakA) }).queue.some((e) => e.kind === 'rule' && e.ruleId === 'r-a'));
  // a rule item still in learning (checked once on an earlier day) does not fade
  const checkedA = recall(createState('r-a', T0 - DAY), 'correct', T0 - DAY);
  assert.ok(build({ states: byId(checkedA) }).queue.some((e) => e.kind === 'rule' && e.ruleId === 'r-a'));
  // r-c: listed by the lesson, introduced by no item; shown after the new items until its quick check is recorded
  const withC = lesson({ rules: ['r-a', 'r-b', 'r-c'], structured: [...lesson().structured, { id: 'u01-l02-s04', prompt_sl: 'd _', options: ['x', 'y'], answer: 'x', rule: 'r-c', en: 'd' }] });
  const q = build({ lesson: withC }).queue;
  const ruleC = q.findIndex((e) => e.kind === 'rule' && e.ruleId === 'r-c');
  assert.ok(ruleC > Math.max(...q.flatMap((e, i) => (isRecall(e) ? [i] : []))), 'after the learning work');
  assert.deepEqual(q[ruleC + 1], { kind: 'structured', exerciseId: 'u01-l02-s04', ruleId: 'r-c', lessonId: 'u01-l02' });
  assert.equal(q.filter((e) => e.ruleId === 'r-c').length, 2);
  const checkedC = recall(createState('r-c', T0 - DAY), 'correct', T0 - DAY);
  assert.ok(!build({ lesson: withC, states: byId(checkedC) }).queue.some((e) => e.ruleId === 'r-c'), 'once checked it waits for an item that references it');
  // a rule still to be introduced by an item beyond today's cap is not shown ahead of that item
  const late = build({ lesson: withC, settings: { ...S, newPerDay: 1 } }).queue;
  assert.ok(!late.some((e) => e.ruleId === 'r-b'), 'r-b belongs to item 2, which waits for another day');
  assert.ok(late.some((e) => e.kind === 'rule' && e.ruleId === 'r-c'));
  // a rule the bundle does not carry is never queued
  const strange = lesson({ items: [item('u01-l02-i01', ['r-zzz'])], rules: ['r-zzz'], structured: [{ id: 'u01-l02-s01', prompt_sl: 'a _', options: ['x', 'y'], answer: 'x', rule: 'r-zzz', en: 'a' }] });
  assert.ok(!build({ lesson: strange }).queue.some((e) => e.kind === 'rule' || e.kind === 'structured'));
});

test('production waits for two correct recalls of its item', () => {
  const { queue } = build();
  const two = recallsOf(queue, 'u01-l02-i02');
  assert.equal(two.length, GRADUATE_AFTER);
  assert.deepEqual(two.map((i) => queue[i].kind), ['typed_en_sl', 'typed_en_sl', 'slot'], 'the slot production is the third, graduating recall');
  assert.deepEqual(queue[two[2]], { kind: 'slot', exerciseId: 'u01-l02-p01', itemId: 'u01-l02-i02', lessonId: 'u01-l02' });
  assert.deepEqual(recallsOf(queue, 'u01-l02-i01').map((i) => queue[i].kind), ['typed_en_sl', 'typed_en_sl', 'typed_en_sl'], 'an item without production keeps a typed third recall');
  // met earlier today with two correct recalls: one recall left, the slot, and no second meet
  let s = recall(createState('u01-l02-i02', T0 - 30 * MINUTE), 'correct', T0 - 30 * MINUTE);
  s = recall(s, 'correct', s.due);
  assert.equal(s.correctInSession, 2);
  assert.equal(s.sessionKey, localDateKey(T0, TZ));
  const resumed = build({ states: byId(s) });
  assert.ok(!resumed.queue.some((e) => e.kind === 'meet' && e.itemId === 'u01-l02-i02'));
  assert.deepEqual(recallsOf(resumed.queue, 'u01-l02-i02').map((i) => resumed.queue[i].kind), ['slot']);
  assert.equal(resumed.newCount, 2, 'the unfinished item is not new again');
  // left in learning yesterday: the three recalls start over, the slot still last, before today's new items
  const old = recall(createState('u01-l02-i02', T0 - DAY), 'correct', T0 - DAY);
  const q2 = build({ states: byId(old) }).queue;
  assert.deepEqual(recallsOf(q2, 'u01-l02-i02').map((i) => q2[i].kind), ['typed_en_sl', 'typed_en_sl', 'slot']);
  assert.ok(!q2.some((e) => e.kind === 'meet' && e.itemId === 'u01-l02-i02'));
  assert.ok(recallsOf(q2, 'u01-l02-i02')[0] < q2.findIndex((e) => e.kind === 'meet'), 'unfinished work first');
  // a learning item waits even when its step is not due yet
  const fresh = recall(createState('u01-l02-i02', T0 - MINUTE / 2), 'correct', T0 - MINUTE / 2);
  assert.ok(!isDue(fresh, T0));
  assert.equal(recallsOf(build({ states: byId(fresh) }).queue, 'u01-l02-i02').length, 2);
  // two production exercises: both after the second recall, the first in place of the third typed recall
  const twice = lesson({ production: [...lesson().production, { id: 'u01-l02-p02', en: 'Again.', answer: 'sl u01-l02-i02', accept: [], item: 'u01-l02-i02' }] });
  const q3 = build({ lesson: twice }).queue;
  assert.deepEqual(recallsOf(q3, 'u01-l02-i02').map((i) => q3[i].exerciseId ?? q3[i].kind), ['typed_en_sl', 'typed_en_sl', 'u01-l02-p01', 'u01-l02-p02']);
  // an item that graduated on an earlier day does not get its production again
  assert.ok(!build({ states: byId(review('u01-l02-i02', T0 + 3 * DAY)) }).queue.some((e) => e.kind === 'slot'));
});

test('mute mode drops audio-only kinds; speech adds speaking only when on', () => {
  // six items in review, two of them due today
  const pool = byId(
    review('u01-l01-i01', T0 - DAY), review('u01-l01-i02', T0), review('u01-l01-i03', T0 + DAY),
    review('u01-l01-i04', T0 + 2 * DAY), review('u01-l01-i05', T0 + 3 * DAY), review('u01-l01-i06', T0 + 4 * DAY),
  );
  const notDue = ['u01-l01-i03', 'u01-l01-i04', 'u01-l01-i05', 'u01-l01-i06'];
  const muted = build({ states: pool, mode: { mute: true, speech: true } }).queue;
  assert.ok(!muted.some((e) => ['listening', 'speaking', 'perception'].includes(e.kind)), 'mute wins over speech');
  const sound = build({ states: pool, mode: SOUND }).queue;
  const listening = sound.filter((e) => e.kind === 'listening');
  assert.equal(listening.length, 2);
  for (const e of listening) assert.ok(notDue.includes(e.itemId), `${e.itemId} is a known item not reviewed today`);
  assert.notEqual(listening[0].itemId, listening[1].itemId);
  assert.deepEqual(sound.filter((e) => e.kind === 'perception'), [{ kind: 'perception' }]);
  assert.ok(!sound.some((e) => e.kind === 'speaking'));
  const speech = build({ states: pool, mode: SPEECH }).queue;
  const speaking = speech.filter((e) => e.kind === 'speaking');
  assert.equal(speaking.length, 2);
  for (const e of speaking) assert.ok(notDue.includes(e.itemId));
  assert.notEqual(speaking[0].itemId, speaking[1].itemId);
  // placement: the audio kinds come after the reviews and new items, the dialogue after listening, speaking after the dialogue, fluency last
  const at = (kind) => speech.findIndex((e) => e.kind === kind);
  const lastLearning = Math.max(...speech.flatMap((e, i) => (isRecall(e) || e.kind === 'meet' ? [i] : [])));
  assert.ok(at('listening') > lastLearning && at('perception') > at('listening'));
  assert.ok(at('dialogue') > at('perception') && at('speaking') > at('dialogue'));
  assert.equal(speech.at(-1).kind, 'fluency');
  // nothing to practise: no audio extras are tacked on
  const idle = build({ states: byId(review('u01-l01-i01', T0 + DAY)), lesson: null, mode: SPEECH });
  assert.deepEqual(idle, { queue: [], newCount: 0, reviewCount: 0, estimatedMinutes: 0 });
  // with fewer known items than wanted, the picks are what there is
  const few = build({ states: byId(review('u01-l01-i01', T0 + DAY)), mode: SPEECH }).queue;
  assert.deepEqual(few.filter((e) => e.kind === 'listening'), [{ kind: 'listening', itemId: 'u01-l01-i01' }]);
  assert.deepEqual(few.filter((e) => e.kind === 'speaking'), [{ kind: 'speaking', itemId: 'u01-l01-i01' }]);
  // the same seed gives the same queue
  assert.deepEqual(build({ states: pool, mode: SPEECH, rng: seeded(7) }).queue, build({ states: pool, mode: SPEECH, rng: seeded(7) }).queue);
});

test('pending items are never queued even if present in the lesson', () => {
  const mixed = lesson({ items: [item('u01-l02-i01'), item('u01-l02-i02', ['r-b'], 'pending'), item('u01-l02-i03', [], 'rejected')] });
  // states of items that are not accepted, as a dev build could leave behind: in review and in learning
  const states = byId(review('u01-l02-i02', T0 - DAY), recall(createState('u01-l02-i03', T0 - DAY), 'correct', T0 - DAY));
  const r = build({ lesson: mixed, states, mode: SPEECH });
  const referenced = referencedItems(r.queue);
  assert.ok(!referenced.has('u01-l02-i02') && !referenced.has('u01-l02-i03'), 'no entry names a pending or rejected item');
  assert.equal(r.newCount, 1);
  assert.equal(r.reviewCount, 0);
  assert.ok(!r.queue.some((e) => e.kind === 'slot'), 'the production exercise of a pending item is not queued');
  assert.ok(!r.queue.some((e) => e.kind === 'dialogue'), 'a dialogue that practises a pending item waits');
  assert.ok(!r.queue.some((e) => e.kind === 'listening' || e.kind === 'speaking'), 'nor do the audio kinds use them');
  // five such items in review are not a fluency pool
  const five = byId(...[2, 3, 4, 5, 6].map((n) => review(`u01-l02-i0${n}`, T0 + DAY)));
  const all = lesson({ items: [item('u01-l02-i01'), ...[2, 3, 4, 5, 6].map((n) => item(`u01-l02-i0${n}`, [], 'pending'))] });
  assert.ok(!build({ lesson: all, states: five }).queue.some((e) => e.kind === 'fluency'));
  // an item the builder has no content for is trusted: its state means it was accepted when it was practised
  assert.equal(build({ lesson: mixed, states: byId(review('u03-l01-i01', T0 - DAY)) }).reviewCount, 1);
  // when the item is accepted the same lesson plays in full
  const accepted = build({ lesson: lesson(), states: byId(review('u01-l02-i03', T0 + 3 * DAY)) }).queue;
  assert.ok(accepted.some((e) => e.kind === 'slot') && accepted.some((e) => e.kind === 'dialogue'));
});

test('allowPending lets a dev build practise pending items', () => {
  // the test lesson with every item pending, as a dev build compiles it
  const pending = lesson({ items: lesson().items.map((i) => ({ ...i, verification: verified('pending') })) });
  const input = { now: T0, states: {}, lesson: pending, unitLessons: [pending], rules: RULES, settings: S, mode: SPEECH, newToday: 0, minutesToday: 0, rng: seeded(1), tz: TZ };
  const strict = buildSession(input);
  assert.equal(referencedItems(strict.queue).size, 0, 'by default no entry names a pending item');
  assert.equal(strict.newCount, 0);
  assert.deepEqual(buildSession({ ...input, allowPending: false }), strict);
  const session = buildSession({ ...input, allowPending: true });
  assert.ok(session.queue.some((e) => e.kind === 'meet'));         // the pending lesson's items are met
  assert.ok(session.newCount > 0);
  assert.equal(session.newCount, 3);
  assert.deepEqual(session, buildSession({ ...input, lesson: lesson(), unitLessons: [lesson()] }), 'the queue the lesson gives once its items are accepted');
  assert.ok(session.queue.some((e) => e.kind === 'slot') && session.queue.some((e) => e.kind === 'dialogue'));
  // pending items with states: a due review, unfinished learning, the dialogue over them, the audio and fluency material
  const more = lesson({ items: [...pending.items, ...[4, 5, 6, 7].map((n) => item(`u01-l02-i0${n}`, [], 'pending'))] });
  const states = byId(
    review('u01-l02-i02', T0 - DAY), recall(createState('u01-l02-i03', T0 - DAY), 'correct', T0 - DAY),
    ...[4, 5, 6, 7].map((n) => review(`u01-l02-i0${n}`, T0 + n * DAY)),
  );
  const dev = buildSession({ ...input, lesson: more, unitLessons: [more], states, allowPending: true });
  assert.equal(dev.reviewCount, 1);
  assert.equal(dev.newCount, 1);
  assert.deepEqual(dev.queue[0], { kind: 'typed_en_sl', itemId: 'u01-l02-i02', lessonId: 'u01-l02' }, 'the due pending item opens the session');
  assert.deepEqual(recallsOf(dev.queue, 'u01-l02-i03').map((i) => dev.queue[i].kind), ['typed_en_sl', 'typed_en_sl', 'typed_en_sl'], 'the unfinished pending item gets its recalls');
  assert.ok(dev.queue.some((e) => e.kind === 'dialogue'), 'the dialogue over pending items is ready once they graduate');
  assert.equal(dev.queue.filter((e) => e.kind === 'listening').length, 2);
  assert.equal(dev.queue.filter((e) => e.kind === 'speaking').length, 2);
  assert.equal(dev.queue.at(-1).kind, 'fluency');
  assert.equal(forecastReviewMinutes(states, T0), 2 * REVIEW_MINUTES, 'the forecast never looked at verification');
  const off = buildSession({ ...input, lesson: more, unitLessons: [more], states });
  assert.equal(referencedItems(off.queue).size, 0);
  assert.deepEqual([off.newCount, off.reviewCount], [0, 0]);
  // a rejected item is not accepted either, so the flag admits it too
  const rejected = lesson({ items: [item('u01-l02-i01', [], 'rejected')], rules: [], structured: [], production: [], dialogue: undefined });
  assert.equal(buildSession({ ...input, lesson: rejected, unitLessons: [rejected], allowPending: true }).newCount, 1);
  assert.equal(buildSession({ ...input, lesson: rejected, unitLessons: [rejected] }).newCount, 0);
  // rule ids are never typed recalls, with or without the flag
  assert.equal(buildSession({ ...input, states: byId(review('r-a', T0 - DAY)), allowPending: true }).reviewCount, 0);
});

test('closing menu options follow the rules', () => {
  assert.deepEqual(closingMenu({ minutesToday: 10, settings: S, lessonRemaining: true, mode: SOUND, moreAvailable: true }), ['stop', 'more3', 'speaking', 'continue']);
  assert.deepEqual(closingMenu({ minutesToday: 25, settings: S, lessonRemaining: true, mode: SOUND, moreAvailable: true }), ['stop', 'speaking', 'continue'], 'at the goal plus 15 minutes, no more3');
  assert.deepEqual(closingMenu({ minutesToday: 24.9, settings: S, lessonRemaining: false, mode: MUTE, moreAvailable: true }), ['stop', 'more3']);
  assert.deepEqual(closingMenu({ minutesToday: 40, settings: S, lessonRemaining: false, mode: MUTE, moreAvailable: true }), ['stop']);
  assert.deepEqual(closingMenu({ minutesToday: 0, settings: { ...S, dailyMinutes: 5 }, lessonRemaining: false, mode: SPEECH, moreAvailable: true }), ['stop', 'more3', 'speaking']);
  assert.deepEqual(closingMenu({ minutesToday: 19.9, settings: { ...S, dailyMinutes: 5 }, lessonRemaining: true, mode: MUTE, moreAvailable: true }), ['stop', 'more3', 'continue']);
  assert.deepEqual(closingMenu({ minutesToday: 10, settings: S, lessonRemaining: true, mode: SOUND, moreAvailable: false }), ['stop', 'speaking', 'continue'], 'no round to offer: no more3, whatever the minutes (Ruling 80)');
  assert.deepEqual(closingMenu({ minutesToday: 0, settings: S, lessonRemaining: false, mode: MUTE, moreAvailable: false }), ['stop']);
});

test('buildMoreRound: unpractised review items weakest first, capped at eight, filled from the misses below three, empty when nothing qualifies (Ruling 80)', () => {
  assert.equal(MORE_ITEMS, 8);
  assert.equal(MORE_MIN, 3);
  // ten review items that skipped ahead one to ten days ago: the older, the weaker
  const pool = byId(...Array.from({ length: 10 }, (_, i) => skipAheadState(`u01-l01-i${String(i + 1).padStart(2, '0')}`, T0 - (i + 1) * DAY)));
  const round = buildMoreRound({ now: T0, states: pool, practised: new Set(), missed: [], settings: S });
  assert.equal(round.length, MORE_ITEMS, 'capped');
  assert.ok(round.every((e) => e.kind === 'typed_en_sl' && Object.keys(e).length === 2), 'typed recall, the id and nothing else');
  assert.deepEqual(round.map((e) => e.itemId), ['u01-l01-i10', 'u01-l01-i09', 'u01-l01-i08', 'u01-l01-i07', 'u01-l01-i06', 'u01-l01-i05', 'u01-l01-i04', 'u01-l01-i03'],
    'the weakest first; the two strongest are left out');
  for (let i = 1; i < round.length; i += 1) {
    assert.ok(retrievability(pool[round[i - 1].itemId], T0) <= retrievability(pool[round[i].itemId], T0), 'rising retrievability');
  }
  // practised items, rule items, learning and lapsed items are left out
  const mixed = {
    ...byId(review('u01-l01-i01', T0 - DAY), review('u01-l01-i02', T0 + DAY), skipAheadState('r-a', T0 - DAY)),
    'u01-l01-i03': recall(createState('u01-l01-i03', T0 - HOUR), 'correct', T0 - HOUR),
    'u01-l01-i04': recall(review('u01-l01-i04', T0 - DAY), 'wrong', T0 - HOUR),
  };
  assert.equal(mixed['u01-l01-i03'].phase, 'learning');
  assert.equal(mixed['u01-l01-i04'].phase, 'lapsed');
  assert.deepEqual(buildMoreRound({ now: T0, states: mixed, practised: new Set(['u01-l01-i01']), missed: [], settings: S }),
    [{ kind: 'typed_en_sl', itemId: 'u01-l01-i02' }], 'the one review item the run did not practise; the due one was practised');
  // below three unpractised items, the run's misses follow, in order, without repeats, never a rule
  const filled = buildMoreRound({
    now: T0, states: mixed, practised: new Set(['u01-l01-i01']), missed: ['u01-l01-i04', 'r-a', 'u01-l01-i03', 'u01-l01-i04', 'u01-l01-i02'], settings: S,
  });
  assert.deepEqual(filled.map((e) => e.itemId), ['u01-l01-i02', 'u01-l01-i04', 'u01-l01-i03']);
  // three or more unpractised items: the misses are not appended
  const three = byId(review('u01-l01-i01', T0), review('u01-l01-i02', T0 + DAY), review('u01-l01-i03', T0 + 2 * DAY));
  assert.equal(buildMoreRound({ now: T0, states: three, practised: new Set(), missed: ['u01-l01-i09'], settings: S }).length, 3);
  assert.ok(!buildMoreRound({ now: T0, states: three, practised: new Set(), missed: ['u01-l01-i09'], settings: S }).some((e) => e.itemId === 'u01-l01-i09'));
  // nothing qualifies and nothing was missed: empty, so the menu leaves the option out
  assert.deepEqual(buildMoreRound({ now: T0, states: {}, practised: new Set(), missed: [], settings: S }), []);
  assert.deepEqual(buildMoreRound({ now: T0, states: byId(review('u01-l01-i01', T0)), practised: new Set(['u01-l01-i01']), missed: [], settings: S }), []);
  assert.deepEqual(buildMoreRound({ now: T0, states: byId(review('u01-l01-i01', T0)), practised: new Set(['u01-l01-i01']), missed: ['u01-l01-i01'], settings: S }),
    [{ kind: 'typed_en_sl', itemId: 'u01-l01-i01' }], 'a practised item that was missed comes back through the misses');
  // the inputs are left alone
  const practised = new Set(['u01-l01-i01']);
  const missed = Object.freeze(['u01-l01-i04']);
  buildMoreRound({ now: T0, states: Object.freeze(mixed), practised, missed: /** @type {string[]} */ (/** @type {unknown} */ (missed)), settings: S });
  assert.deepEqual([...practised], ['u01-l01-i01']);
});

test('the dialogue waits for its items to graduate and a fluency pass closes the queue once five items are in review', () => {
  // items 2 and 3 are met today and graduate within the plan, so the dialogue comes at the end
  const { queue } = build();
  const d = queue.findIndex((e) => e.kind === 'dialogue');
  assert.deepEqual(queue[d], { kind: 'dialogue', exerciseId: 'u01-l02-d', lessonId: 'u01-l02' });
  assert.equal(d, queue.length - 1, 'last, since fewer than five items are in review');
  assert.ok(d > Math.max(...recallsOf(queue, 'u01-l02-i02'), ...recallsOf(queue, 'u01-l02-i03')));
  // item 3 is beyond today's cap: no dialogue yet
  const half = build({ states: byId(review('u01-l02-i02', T0 + 3 * DAY)), settings: { ...S, newPerDay: 1 } }).queue;
  assert.deepEqual(half.filter((e) => e.kind === 'meet').map((e) => e.itemId), ['u01-l02-i01']);
  assert.ok(!half.some((e) => e.kind === 'dialogue'));
  // both graduated on earlier days (one of them lapsed): the dialogue is queued
  const lapsed3 = recall(review('u01-l02-i03', T0 - HOUR), 'wrong', T0 - HOUR);
  const done = build({ states: byId(review('u01-l02-i02', T0 + 3 * DAY), lapsed3) }).queue;
  assert.ok(done.some((e) => e.kind === 'dialogue'));
  // an unfinished learning item graduates within the plan as well
  const learning3 = recall(createState('u01-l02-i03', T0 - DAY), 'correct', T0 - DAY);
  assert.ok(build({ states: byId(review('u01-l02-i02', T0 + 3 * DAY), learning3) }).queue.some((e) => e.kind === 'dialogue'));
  // no dialogue in the lesson, no entry
  assert.ok(!build({ lesson: lesson({ dialogue: undefined }) }).queue.some((e) => e.kind === 'dialogue'));
  // fluency needs five items in review phase: lapsed items and rule items do not count
  const four = byId(...[1, 2, 3, 4].map((n) => review(`u01-l01-i0${n}`, T0 + n * DAY)));
  const lapsed = recall(review('u01-l01-i05', T0 - HOUR), 'wrong', T0 - HOUR);
  const padded = { ...four, [lapsed.itemId]: lapsed, 'r-a': review('r-a', T0 + DAY) };
  assert.ok(!build({ states: padded }).queue.some((e) => e.kind === 'fluency'));
  const five = { ...four, ...byId(review('u01-l01-i05', T0 + 5 * DAY)) };
  const closing = build({ states: five }).queue.at(-1);
  assert.equal(closing.kind, 'fluency');
  assert.deepEqual([...closing.itemIds].sort(), Object.keys(five).sort(), 'all five, in a shuffled order');
  assert.deepEqual(Object.keys(closing).sort(), ['itemIds', 'kind']);
  // with more known items the pass prefers those not reviewed today, picked at random, repeatable per seed
  const many = byId(
    review('u01-l01-i01', T0 - DAY), review('u01-l01-i02', T0 - HOUR), review('u01-l01-i03', T0),
    ...[4, 5, 6, 7, 8].map((n) => review(`u01-l01-i0${n}`, T0 + n * DAY)),
  );
  const pass = build({ states: many, rng: seeded(3) }).queue.at(-1);
  assert.equal(pass.itemIds.length, 5);
  assert.deepEqual([...pass.itemIds].sort(), ['u01-l01-i04', 'u01-l01-i05', 'u01-l01-i06', 'u01-l01-i07', 'u01-l01-i08']);
  assert.deepEqual(build({ states: many, rng: seeded(3) }).queue.at(-1), pass);
  assert.notDeepEqual(build({ states: many, rng: seeded(4) }).queue.at(-1).itemIds, pass.itemIds, 'another seed, another order');
  // a mastered item is a review item
  const mastered = { ...four, ...byId({ ...review('u01-l01-i05', T0 + 5 * DAY), mastered: true }) };
  assert.equal(build({ states: mastered }).queue.at(-1).kind, 'fluency');
});

test('the estimate adds up per kind, a session without a lesson is reviews only, and inputs are left untouched', () => {
  assert.equal(MINUTES_PER_KIND.typed_en_sl, REVIEW_MINUTES);
  assert.equal(MINUTES_PER_KIND.meet + GRADUATE_AFTER * MINUTES_PER_KIND.typed_en_sl, NEW_ITEM_MINUTES, 'a new item is its meet and three recalls');
  assert.equal(MINUTES_PER_KIND.slot, MINUTES_PER_KIND.typed_en_sl, 'so a slot in place of the third recall changes nothing');
  const states = byId(review('u01-l01-i01', T0 - DAY), review('u01-l01-i02', T0));
  const bare = build({ lesson: null, states });
  assert.deepEqual(bare.queue, [{ kind: 'typed_en_sl', itemId: 'u01-l01-i01' }, { kind: 'typed_en_sl', itemId: 'u01-l01-i02' }]);
  assert.equal(bare.newCount, 0);
  assert.equal(bare.reviewCount, 2);
  assert.equal(bare.estimatedMinutes, 2 * REVIEW_MINUTES);
  // the default lesson: three new items, two rule cards, three structured exercises, the dialogue
  const full = build();
  assert.equal(full.estimatedMinutes, 3 * NEW_ITEM_MINUTES + 2 * MINUTES_PER_KIND.rule + 3 * MINUTES_PER_KIND.structured + MINUTES_PER_KIND.dialogue);
  const withSound = build({ mode: SPEECH, states: byId(...[1, 2, 3, 4, 5].map((n) => review(`u01-l01-i0${n}`, T0 + n * DAY))) });
  assert.equal(withSound.estimatedMinutes, full.estimatedMinutes + 2 * MINUTES_PER_KIND.listening + MINUTES_PER_KIND.perception + 2 * MINUTES_PER_KIND.speaking + MINUTES_PER_KIND.fluency);
  // a frozen input is not written to, and the result does not share its arrays with the content
  const input = deepFreeze({
    now: T0, states: byId(review('u01-l01-i01', T0 - DAY), recall(createState('u01-l02-i03', T0 - DAY), 'correct', T0 - DAY)),
    lesson: lesson(), unitLessons: [lesson()], rules: RULES, settings: S, mode: SPEECH, newToday: 0, minutesToday: 0,
  });
  const out = buildSession(input);
  assert.ok(out.queue.length > 0);
  assert.ok(!Object.isFrozen(out.queue));
  // the shape of every entry: a kind from the list and only the fields the kind needs
  const KINDS = new Set(['meet', 'typed_en_sl', 'typed_sl_en', 'structured', 'slot', 'dialogue', 'listening', 'speaking', 'perception', 'rule', 'fluency']);
  for (const e of out.queue) {
    assert.ok(KINDS.has(e.kind));
    for (const [k, v] of Object.entries(e)) assert.ok(v !== undefined && v !== null, `${e.kind}.${k} is set`);
  }
});
