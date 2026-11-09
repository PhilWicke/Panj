// tests/engine/checkpoint.test.js
// The checkpoint engine over the real scheduler, in UTC: a unit checkpoint is every practisable
// item of the unit (up to 16) plus up to 4 review-phase items from earlier units (Ruling 53,
// sizes are caps); the pass mark is exactly 80 percent of whatever total; applyCheckpoint moves a
// correct new item of a passed checkpoint ahead through skipAheadState, records a correct
// scheduled item, leaves a new item alone otherwise and records a wrong scheduled item (Ruling
// 55); the weekly check draws three blocks of up to six (Ruling 54) and is due every seventh
// active day after the last one; calibration is actual minus predicted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, createState, recordRecall, skipAheadState } from '../../app/js/engine/scheduler.js';
import {
  PASS_MARK, buildUnitCheckpoint, scoreCheckpoint, applyCheckpoint, buildWeeklyCheck, dueWeeklyCheck, calibration, checkpointMinutes,
} from '../../app/js/engine/checkpoint.js';
import { localDateKey } from '../../app/js/util/time.js';
import { shuffle } from '../../app/js/util/shuffle.js';

const TZ = 'UTC';
const HOUR = 3_600_000;
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 2, 9, 0);   // Monday 2 November 2026, 09:00 UTC
const S = DEFAULT_SETTINGS;

const accepted = { review1: null, review2: null, native: null, status: 'accepted' };
const pending = { ...accepted, status: 'pending' };

/** A deterministic generator in [0, 1) (mulberry32), so a shuffle is repeatable. */
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

/** @param {string} id @param {number} n */
const itemId = (id, n) => `${id}-i${String(n).padStart(2, '0')}`;

/**
 * An item of a lesson: `sl` and `en` are made from the id, `accept` only when given.
 * @param {string} lessonId
 * @param {number} n
 * @param {{ accept?: string[], verification?: object }} [extra]
 */
function item(lessonId, n, extra = {}) {
  const id = itemId(lessonId, n);
  return {
    id, type: 'chunk', sl: `sl ${id}`, en: `en ${id}`, register: 'neutral', examples: [], verification: accepted, ...extra,
  };
}

/**
 * A unit of lessons of `perLesson` items each, `uNN-lNN-iNN`.
 * @param {string} unitId
 * @param {number[]} perLesson items per lesson
 * @param {(lessonId: string, n: number) => object} [extraFor] extra fields of an item
 * @returns {any}
 */
function unit(unitId, perLesson, extraFor = () => ({})) {
  const lessons = perLesson.map((count, k) => {
    const lessonId = `${unitId}-l${String(k + 1).padStart(2, '0')}`;
    return {
      id: lessonId, unit: unitId, order: k + 1, title_sl: lessonId, title_en: lessonId,
      items: Array.from({ length: count }, (_, i) => item(lessonId, i + 1, extraFor(lessonId, i + 1))), rules: [], structured: [], production: [],
    };
  });
  return { unit: { id: unitId, order: Number(unitId.slice(1)), title_sl: unitId, title_en: unitId, motif: 'flower', lessons: lessons.map((l) => l.id) }, lessons };
}

/** Every item id of a unit, in lesson order. @param {any} u */
const idsOf = (u) => u.lessons.flatMap((/** @type {any} */ l) => l.items.map((/** @type {any} */ i) => i.id));

/** A rule card with a quick check. @param {string} id */
const rule = (id) => ({
  id, unit: 'u01', title_en: `Rule ${id}`, card_en: 'The card.', example: { sl: 'Primer.', en: 'An example.' },
  quick_check: { prompt_sl: `Midva ___ ${id}.`, options: ['sem', 'sva', 'smo'], answer: 'sva', explain_en: `Because ${id}.` },
});

/** A rule item in learning: its first quick check went wrong. @param {string} id */
const learningRule = (id) => recordRecall(createState(id, T0), 'wrong', T0, S, TZ);
/** An item in learning: met and recalled once. @param {string} id */
const learning = (id) => recordRecall(createState(id, T0), 'correct', T0, S, TZ);
/** An item in review since `at`. @param {string} id @param {number} [at] */
const reviewed = (id, at = T0) => skipAheadState(id, at);
/** An item that lapsed: in review, then missed. @param {string} id */
const lapsed = (id) => recordRecall(skipAheadState(id, T0), 'wrong', T0 + 8 * DAY, S, TZ);

function deepFreeze(value) {
  if (value && typeof value === 'object') for (const v of Object.values(value)) deepFreeze(v);
  return Object.freeze(value);
}

/** `correct` right answers out of `total`, over the items of u01-l01. */
const results = (correct, total) => Array.from({ length: total }, (_, i) => ({ itemId: itemId('u01-l01', i + 1), correct: i < correct }));

test('PASS_MARK is 80 percent', () => {
  assert.equal(PASS_MARK, 80);
});

test('buildUnitCheckpoint: a unit of 8 practisable items gives all 8 as typed items, shuffled with rng', () => {
  const u01 = unit('u01', [8], (lessonId, n) => (n === 1 ? { accept: ['variant'] } : {}));
  const items = buildUnitCheckpoint(u01, {}, seeded(1));
  assert.equal(items.length, 8, 'sizes are caps, not floors (Ruling 53)');
  assert.deepEqual(items.map((i) => i.itemId).sort(), idsOf(u01).sort(), 'every item of the unit, once');
  assert.deepEqual(items.map((i) => i.itemId), shuffle(idsOf(u01), seeded(1)), 'in lesson order, shuffled with rng');
  for (const each of items) {
    assert.equal(each.kind, 'typed_en_sl');
    assert.equal(each.prompt_en, `en ${each.itemId}`);
    assert.equal(each.answer, `sl ${each.itemId}`);
    assert.equal(each.prompt_sl, undefined);
    assert.equal(each.options, undefined);
  }
  assert.deepEqual(items.find((i) => i.itemId === 'u01-l01-i01')?.accept, ['variant']);
  assert.deepEqual(items.find((i) => i.itemId === 'u01-l01-i02')?.accept, [], 'accept is an empty list when the item has none');
  assert.notDeepEqual(buildUnitCheckpoint(u01, {}, seeded(7)).map((i) => i.itemId), items.map((i) => i.itemId), 'another seed, another order');
});

test('buildUnitCheckpoint keeps up to 16 unit items and adds up to 4 review-phase items from earlier units, unit items first', () => {
  const u01 = unit('u01', [8]);
  const u02 = unit('u02', [10, 10]);
  const [a, b, c, d, e, f, g, hh] = idsOf(u01);
  const states = {
    [a]: reviewed(a), [b]: reviewed(b), [c]: lapsed(c), [d]: reviewed(d), [e]: reviewed(e), [f]: lapsed(f),
    [g]: learning(g), [hh]: createState(hh, T0),
  };
  const items = buildUnitCheckpoint(u02, states, seeded(2), { earlier: [u01] });
  assert.equal(items.length, 20);
  const own = items.slice(0, 16);
  assert.ok(own.every((i) => i.itemId.startsWith('u02-')), 'the unit items come first');
  assert.equal(new Set(own.map((i) => i.itemId)).size, 16, 'sixteen distinct items of the unit');
  const review = items.slice(16);
  assert.equal(review.length, 4);
  assert.ok(review.every((i) => i.itemId.startsWith('u01-')), 'then the review items from the earlier unit');
  assert.ok(review.every((i) => ['review', 'lapsed'].includes(states[i.itemId].phase)), 'in review or lapsed');
  assert.ok(review.every((i) => i.kind === 'typed_en_sl' && i.prompt_en === `en ${i.itemId}` && i.answer === `sl ${i.itemId}`));
  assert.equal(new Set(items.map((i) => i.itemId)).size, 20);

  const two = buildUnitCheckpoint(u02, { [a]: reviewed(a), [c]: lapsed(c), [g]: learning(g) }, seeded(3), { earlier: [u01] });
  assert.equal(two.length, 18, 'two review items available: two come');
  assert.deepEqual(two.slice(16).map((i) => i.itemId).sort(), [a, c]);
  assert.equal(buildUnitCheckpoint(u02, states, seeded(4)).length, 16, 'no earlier units: the unit items only');
  assert.equal(buildUnitCheckpoint(u02, states, seeded(4), { earlier: [] }).length, 16);
  assert.equal(buildUnitCheckpoint(u01, {}, seeded(5), { earlier: [u02] }).length, 8, 'earlier items with no state are not review items');
});

test('buildUnitCheckpoint leaves pending items out unless allowPending', () => {
  const u01 = unit('u01', [8], (lessonId, n) => (n <= 3 ? { verification: pending } : {}));
  const strict = buildUnitCheckpoint(u01, {}, seeded(1));
  assert.equal(strict.length, 5);
  assert.ok(strict.every((i) => Number(i.itemId.slice(-2)) > 3));
  assert.equal(buildUnitCheckpoint(u01, {}, seeded(1), { allowPending: true }).length, 8);
  assert.equal(buildUnitCheckpoint(u01, {}, seeded(1), { allowPending: false }).length, 5);
  assert.equal(buildUnitCheckpoint(unit('u03', []), {}, seeded(1)).length, 0, 'a unit without lessons has no checkpoint');
});

test('scoreCheckpoint: the pass mark is exactly 80 percent of whatever total, and 0 of 0 fails', () => {
  assert.deepEqual(scoreCheckpoint(results(16, 20)), { total: 20, correct: 16, pct: 80, passed: true });
  assert.deepEqual(scoreCheckpoint(results(15, 20)), { total: 20, correct: 15, pct: 75, passed: false });
  assert.deepEqual(scoreCheckpoint([]), { total: 0, correct: 0, pct: 0, passed: false });
  assert.deepEqual(scoreCheckpoint(results(7, 8)), { total: 8, correct: 7, pct: 87.5, passed: true }, 'exact, not rounded');
  assert.equal(scoreCheckpoint(results(6, 8)).passed, false, '75 percent');
  assert.equal(scoreCheckpoint(results(8, 8)).pct, 100);
  assert.equal(scoreCheckpoint(results(4, 5)).passed, true, '80 percent of five');
  assert.equal(scoreCheckpoint(results(3, 4)).passed, false, '75 percent of four');
});

test('applyCheckpoint on a passed checkpoint: correct new items skip ahead, correct scheduled items record correct', () => {
  const [a, b, c, d] = idsOf(unit('u01', [4]));
  const now = T0 + 10 * DAY;
  const states = deepFreeze({ [b]: learning(b), [c]: reviewed(c), [d]: lapsed(d) });
  const changed = applyCheckpoint(states, [a, b, c, d].map((id) => ({ itemId: id, correct: true })), true, now, S, TZ);
  assert.deepEqual(Object.keys(changed).sort(), [a, b, c, d]);
  assert.deepEqual(changed[a], skipAheadState(a, now), 'no state yet counts as new and skips ahead');
  assert.equal(changed[a].phase, 'review');
  assert.equal(changed[a].due, now + 7 * DAY);
  assert.deepEqual(changed[b], recordRecall(states[b], 'correct', now, S, TZ), 'a learning item records a correct recall, it does not skip ahead');
  assert.deepEqual(changed[c], recordRecall(states[c], 'correct', now, S, TZ));
  assert.equal(changed[c].phase, 'review');
  assert.deepEqual(changed[d], recordRecall(states[d], 'correct', now, S, TZ));
  assert.equal(changed[d].phase, 'review', 'a lapsed item returns to review');
  const fresh = createState(a, T0);
  assert.deepEqual(applyCheckpoint({ [a]: fresh }, [{ itemId: a, correct: true }], true, now, S, TZ)[a], skipAheadState(a, now), 'a stored new state skips ahead too');
});

test('applyCheckpoint on a failed checkpoint: new items stay new, scheduled items still record their result', () => {
  const [a, b, c] = idsOf(unit('u01', [3]));
  const now = T0 + 10 * DAY;
  const states = deepFreeze({ [a]: createState(a, T0), [c]: reviewed(c) });
  const changed = applyCheckpoint(states, [{ itemId: a, correct: true }, { itemId: b, correct: true }, { itemId: c, correct: true }], false, now, S, TZ);
  assert.deepEqual(Object.keys(changed), [c], 'the new items are left out, whether stored or not');
  assert.deepEqual(changed[c], recordRecall(states[c], 'correct', now, S, TZ));
});

test('applyCheckpoint: wrong items record wrong unless new', () => {
  const [a, b, c, d] = idsOf(unit('u01', [4]));
  const now = T0 + 10 * DAY;
  const states = deepFreeze({ [b]: learning(b), [c]: reviewed(c), [d]: lapsed(d) });
  const wrong = [a, b, c, d].map((id) => ({ itemId: id, correct: false }));
  for (const passed of [true, false]) {
    const changed = applyCheckpoint(states, wrong, passed, now, S, TZ);
    assert.deepEqual(Object.keys(changed).sort(), [b, c, d], `passed ${passed}: the new item stays new`);
    assert.deepEqual(changed[b], recordRecall(states[b], 'wrong', now, S, TZ));
    assert.equal(changed[b].phase, 'learning');
    assert.deepEqual(changed[c], recordRecall(states[c], 'wrong', now, S, TZ));
    assert.equal(changed[c].phase, 'lapsed');
    assert.equal(changed[c].lapses, 1);
    assert.deepEqual(changed[d], recordRecall(states[d], 'wrong', now, S, TZ));
  }
  assert.deepEqual(applyCheckpoint({}, [], true, now, S, TZ), {});
});

test('applyCheckpoint: a rule id skips ahead from new or learning on a correct answer of a passed check (Ruling 30), records otherwise', () => {
  const now = T0 + 10 * DAY;
  const states = deepFreeze({ 'r-ti-vi': learningRule('r-ti-vi'), 'r-biti-present': reviewed('r-biti-present') });
  const correct = [{ itemId: 'r-ti-vi', correct: true }, { itemId: 'r-dual', correct: true }, { itemId: 'r-biti-present', correct: true }];
  const passed = applyCheckpoint(states, correct, true, now, S, TZ);
  assert.deepEqual(passed['r-ti-vi'], skipAheadState('r-ti-vi', now), 'learning rule, correct, passed: skips ahead');
  assert.deepEqual(passed['r-dual'], skipAheadState('r-dual', now), 'new rule, correct, passed: skips ahead');
  assert.deepEqual(passed['r-biti-present'], recordRecall(states['r-biti-present'], 'correct', now, S, TZ), 'a rule in review records correct');
  const failed = applyCheckpoint(states, correct, false, now, S, TZ);
  assert.deepEqual(failed['r-ti-vi'], recordRecall(states['r-ti-vi'], 'correct', now, S, TZ), 'learning rule, correct, not passed: records correct');
  assert.equal('r-dual' in failed, false, 'new rule, correct, not passed: unchanged');
  const wrong = applyCheckpoint(states, [{ itemId: 'r-ti-vi', correct: false }, { itemId: 'r-dual', correct: false }], true, now, S, TZ);
  assert.deepEqual(Object.keys(wrong), ['r-ti-vi']);
  assert.deepEqual(wrong['r-ti-vi'], recordRecall(states['r-ti-vi'], 'wrong', now, S, TZ));
});

test('buildWeeklyCheck draws Recent and Older from the non-new items by lastReview, and Rules from the rules with a state', () => {
  const u01 = unit('u01', [8]);
  const u02 = unit('u02', [10]);
  const ids = [...idsOf(u01), ...idsOf(u02)];   // 18 items
  /** @type {Record<string, any>} */
  const states = {};
  // fifteen items reviewed at distinct hours, the first the most recent
  ids.slice(0, 15).forEach((id, k) => { states[id] = reviewed(id, T0 - k * HOUR); });
  states[ids[15]] = createState(ids[15], T0);                     // new: never in the pool
  states[ids[16]] = { ...reviewed(ids[16]), lastReview: null };    // a review state without a last review: sorts last
  states['u09-l01-i01'] = reviewed('u09-l01-i01');               // not in the loaded units: left out
  states['r-ti-vi'] = reviewed('r-ti-vi');
  states['r-biti-present'] = learningRule('r-biti-present');
  const index = /** @type {any} */ ({ rules: [rule('r-ti-vi'), rule('r-biti-present'), rule('r-dual')] });
  const { blocks } = buildWeeklyCheck(index, [u01, u02], states, seeded(9));
  assert.deepEqual(blocks.map((b) => b.title), ['Recent', 'Older', 'Rules']);
  const [recent, older, rules] = blocks;
  const recentPool = ids.slice(0, 12);
  const olderPool = [...ids.slice(12, 15), ids[16]];
  assert.equal(recent.items.length, 6);
  assert.ok(recent.items.every((i) => recentPool.includes(i.itemId)), 'the recent block draws from the twelve most recently reviewed');
  assert.equal(older.items.length, 4);
  assert.deepEqual(older.items.map((i) => i.itemId).sort(), olderPool.sort(), 'the older block is everything after the first twelve, null last');
  for (const each of [...recent.items, ...older.items]) {
    assert.equal(each.kind, 'typed_en_sl');
    assert.equal(each.prompt_en, `en ${each.itemId}`);
    assert.equal(each.answer, `sl ${each.itemId}`);
    assert.deepEqual(each.accept, []);
  }
  assert.deepEqual(rules.items.map((i) => i.itemId).sort(), ['r-biti-present', 'r-ti-vi'], 'rules with a state that is not new, as rule items');
  for (const each of rules.items) {
    const check = rule(each.itemId).quick_check;
    assert.deepEqual(each, { itemId: each.itemId, kind: 'rule', prompt_sl: check.prompt_sl, options: check.options, answer: check.answer, accept: [], explain_en: check.explain_en });
  }
  const all = blocks.flatMap((b) => b.items.map((i) => i.itemId));
  assert.equal(new Set(all).size, all.length, 'no item twice');
  assert.ok(!all.includes(ids[15]) && !all.includes('u09-l01-i01') && !all.includes('r-dual'));
});

test('buildWeeklyCheck caps each block at six, drops empty blocks and gives no blocks without states', () => {
  const u01 = unit('u01', [8]);
  const four = Object.fromEntries(idsOf(u01).slice(0, 4).map((id, k) => [id, reviewed(id, T0 - k * DAY)]));
  const index = /** @type {any} */ ({ rules: [rule('r-ti-vi')] });
  const small = buildWeeklyCheck(index, [u01], four, seeded(1));
  assert.deepEqual(small.blocks.map((b) => [b.title, b.items.length]), [['Recent', 4]], 'four recent items, no older pool, no rule with a state');
  const eight = Object.fromEntries(idsOf(u01).map((id, k) => [id, reviewed(id, T0 - k * DAY)]));
  const withRule = buildWeeklyCheck(index, [u01], { ...eight, 'r-ti-vi': reviewed('r-ti-vi') }, seeded(1));
  assert.deepEqual(withRule.blocks.map((b) => [b.title, b.items.length]), [['Recent', 6], ['Rules', 1]], 'eight items are all recent: six of them');
  assert.deepEqual(buildWeeklyCheck(index, [u01], {}, seeded(1)), { blocks: [] });
  const u02 = unit('u02', [10, 10]);
  const many = Object.fromEntries([...idsOf(u01), ...idsOf(u02)].map((id, k) => [id, reviewed(id, T0 - k * HOUR)]));
  const big = buildWeeklyCheck(index, [u01, u02], many, seeded(2));
  assert.deepEqual(big.blocks.map((b) => [b.title, b.items.length]), [['Recent', 6], ['Older', 6]]);
});

test('dueWeeklyCheck: every seventh active day after the last check', () => {
  const session = (startedAt) => ({ id: `s-${startedAt}`, startedAt, endedAt: startedAt + 10 * 60_000, minutes: 10, recalls: 8, correct: 6, newItems: 0, honey: 6, kinds: { typed_en_sl: 8 } });
  const days = (n, from = T0) => Array.from({ length: n }, (_, k) => session(from + k * DAY));
  const meta = { schemaVersion: 1, createdAt: T0 };
  const now = T0 + 20 * DAY;
  assert.equal(dueWeeklyCheck([], meta, now, TZ), false);
  assert.equal(dueWeeklyCheck(days(6), meta, now, TZ), false, 'six active days');
  assert.equal(dueWeeklyCheck(days(7), meta, now, TZ), true, 'seven active days');
  assert.equal(dueWeeklyCheck([...days(6), session(T0 + 3 * DAY + 2 * HOUR), session(T0 + 5 * DAY + 5 * HOUR)], meta, now, TZ), false, 'two sessions on one day are one active day');
  assert.equal(dueWeeklyCheck(days(7), { ...meta, weeklyChecks: [] }, now, TZ), true, 'an empty list counts from the first session');
  // a check on the seventh day: the days up to and including it no longer count
  const checked = { ...meta, weeklyChecks: [{ at: localDateKey(T0 + 6 * DAY, TZ), total: 8, correct: 6, predicted: 6 }] };
  assert.equal(dueWeeklyCheck(days(7), checked, now, TZ), false, "the check's own session falls on the day of the check and does not count");
  assert.equal(dueWeeklyCheck(days(13), checked, now, TZ), false, 'six active days after the check');
  assert.equal(dueWeeklyCheck(days(14), checked, now, TZ), true, 'seven active days after the check');
  assert.equal(dueWeeklyCheck([...days(5), ...days(7, T0 + 8 * DAY)], checked, now, TZ), true, 'days before the check are not counted, days after it are');
  const twice = { ...meta, weeklyChecks: [{ at: localDateKey(T0 + 6 * DAY, TZ), total: 8, correct: 6, predicted: 6 }, { at: localDateKey(T0 + 13 * DAY, TZ), total: 8, correct: 7, predicted: 6 }] };
  assert.equal(dueWeeklyCheck(days(20), twice, now, TZ), false, 'the last entry counts: six days after 15 November');
  assert.equal(dueWeeklyCheck(days(21), twice, now, TZ), true);
  // the days are the learner's local days
  const late = [...days(6), session(T0 + 5 * DAY + 14 * HOUR + 30 * 60_000)];   // 23:30 UTC on the sixth day
  assert.equal(dueWeeklyCheck(late, meta, now, 'UTC'), false, 'in UTC the late session is still the sixth day');
  assert.equal(dueWeeklyCheck(late, meta, now, 'Europe/Berlin'), true, 'in Berlin it is 00:30 on a seventh day');
});

test('calibration is actual minus predicted', () => {
  assert.deepEqual(calibration(5, 7), { predicted: 5, actual: 7, delta: 2 });
  assert.deepEqual(calibration(7, 5), { predicted: 7, actual: 5, delta: -2 });
  assert.deepEqual(calibration(6, 6), { predicted: 6, actual: 6, delta: 0 });
  assert.deepEqual(calibration(0, 0), { predicted: 0, actual: 0, delta: 0 });
});

test('checkpointMinutes: twenty seconds an item, rounded, at least a minute', () => {
  assert.equal(checkpointMinutes(8), 3);
  assert.equal(checkpointMinutes(1), 1);
  assert.equal(checkpointMinutes(0), 1);
  assert.equal(checkpointMinutes(3), 1);
  assert.equal(checkpointMinutes(5), 2);
  assert.equal(checkpointMinutes(18), 6);
  assert.equal(checkpointMinutes(20), 7);
});
