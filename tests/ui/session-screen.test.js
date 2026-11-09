// tests/ui/session-screen.test.js
// The pure parts of the session screen and its feedback: the run-time queue re-queues a missed
// typed recall after the next two entries (Ruling 22); one function turns a recall into the next
// state, rules through skipAheadState on a correct quick check (Ruling 21) and slips through
// effectiveResult (Ruling 17); a speaking round keeps the planned speaking entries with speech on
// and otherwise speaks up to five review-phase items; a slip names its letters (Ruling 19). The
// course position (currentLesson, todayTotals) is tested in tests/engine/course.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, createState, recordRecall, skipAheadState } from '../../app/js/engine/scheduler.js';
import { requeue, retryEntry, stateAfterRecall, speakingQueue } from '../../app/js/ui/screens/session.js';
import { mindThe } from '../../app/js/ui/components/feedback.js';

const TZ = 'Europe/Berlin';
const MINUTE = 60_000;
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5, 9, 0);   // Monday 5 January 2026, 10:00 in Berlin
const S = DEFAULT_SETTINGS;

/** @param {string} id */
const typed = (id) => ({ kind: 'typed_en_sl', itemId: id, lessonId: 'u01-l01' });

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

test('requeue puts a missed recall after the next two entries, or at the end when fewer remain', () => {
  const queue = ['a', 'b', 'c', 'd', 'e'].map(typed);
  const miss = typed('x');
  assert.equal(requeue(queue, 0, miss), 3);
  assert.deepEqual(queue.map((e) => e.itemId), ['a', 'b', 'c', 'x', 'd', 'e']);

  const tail = ['a', 'b', 'c'].map(typed);
  assert.equal(requeue(tail, 1, miss), 3, 'one entry left: at the end');
  assert.deepEqual(tail.map((e) => e.itemId), ['a', 'b', 'c', 'x']);

  const last = ['a'].map(typed);
  assert.equal(requeue(last, 0, miss), 1, 'the last entry: right after it');
  assert.deepEqual(last.map((e) => e.itemId), ['a', 'x']);
});

test('retryEntry re-queues typed recalls, turns a fluency miss into a typed recall, and leaves other kinds as planned', () => {
  const entry = typed('u01-l01-i01');
  assert.equal(retryEntry(entry, 'u01-l01-i01'), entry);
  assert.deepEqual(retryEntry({ kind: 'fluency', itemIds: ['u01-l01-i01', 'u01-l01-i02'] }, 'u01-l01-i02'),
    { kind: 'typed_en_sl', itemId: 'u01-l01-i02' });
  for (const kind of ['meet', 'slot', 'dialogue', 'structured', 'rule', 'listening', 'speaking', 'perception']) {
    assert.equal(retryEntry(/** @type {any} */ ({ kind, itemId: 'u01-l01-i01' }), 'u01-l01-i01'), null, kind);
  }
});

test('stateAfterRecall records an item recall, starting from a fresh state when there is none', () => {
  const { state, effective } = stateAfterRecall({}, 'u01-l01-i01', 'wrong', T0, S, TZ);
  assert.equal(effective, 'wrong');
  assert.deepEqual(state, recordRecall(createState('u01-l01-i01', T0), 'wrong', T0, S, TZ));
});

test('stateAfterRecall: a slip right after a slip counts as a miss, and the state keeps the slip as given', () => {
  const first = stateAfterRecall({}, 'u01-l01-i02', 'slip', T0, S, TZ);
  assert.equal(first.effective, 'slip');
  const second = stateAfterRecall({ 'u01-l01-i02': first.state }, 'u01-l01-i02', 'slip', T0 + MINUTE, S, TZ);
  assert.equal(second.effective, 'wrong');
  assert.equal(second.state.lastResult, 'slip', 'recordRecall gets the recall as given');
  assert.equal(second.state.correctInSession, 0, 'and counts it as a miss');
});

test('stateAfterRecall: a correct quick check graduates a new or learning rule item through skipAheadState, otherwise it records', () => {
  const fresh = stateAfterRecall({}, 'r-ti-vi', 'correct', T0, S, TZ);
  assert.equal(fresh.effective, 'correct');
  assert.equal(fresh.state.phase, 'review');
  assert.equal(fresh.state.due, T0 + 7 * DAY, 'due in a week');

  const missed = stateAfterRecall({}, 'r-ti-vi', 'wrong', T0, S, TZ);
  assert.equal(missed.state.phase, 'learning', 'a wrong quick check records wrong');
  const retried = stateAfterRecall({ 'r-ti-vi': missed.state }, 'r-ti-vi', 'correct', T0 + MINUTE, S, TZ);
  assert.equal(retried.state.phase, 'review', 'a learning rule item graduates on a correct quick check');
  assert.equal(retried.state.due, T0 + MINUTE + 7 * DAY);

  const later = T0 + 10 * DAY;
  const reviewed = stateAfterRecall({ 'r-ti-vi': fresh.state }, 'r-ti-vi', 'correct', later, S, TZ);
  assert.deepEqual(reviewed.state, recordRecall(fresh.state, 'correct', later, S, TZ), 'in review it records correct');
});

test('mindThe names the slipped letters', () => {
  assert.equal(mindThe(['č']), 'Mind the č');
  assert.equal(mindThe(['č', 'ž']), 'Mind the č and ž');
  assert.equal(mindThe(['č', 'š', 'ž']), 'Mind the č, š and ž');
});

test('speakingQueue keeps the planned speaking entries with speech on, else a round of up to five review-phase items', () => {
  const planned = [typed('u01-l01-i01'), { kind: 'speaking', itemId: 'u01-l01-i01' }, { kind: 'listening', itemId: 'u01-l01-i02' }, { kind: 'speaking', itemId: 'u01-l01-i03' }];
  /** @type {Record<string, any>} seven review items, one rule item and one learning item */
  const states = {};
  for (let i = 1; i <= 7; i += 1) states[`u01-l01-i0${i}`] = skipAheadState(`u01-l01-i0${i}`, T0 - DAY);
  states['r-ti-vi'] = skipAheadState('r-ti-vi', T0 - DAY);
  states['u01-l01-i08'] = recordRecall(createState('u01-l01-i08', T0), 'correct', T0, S, TZ);
  const review = new Set(Object.keys(states).filter((id) => id.startsWith('u01') && id !== 'u01-l01-i08'));

  assert.deepEqual(speakingQueue(planned, states, true, seeded(1)), [{ kind: 'speaking', itemId: 'u01-l01-i01' }, { kind: 'speaking', itemId: 'u01-l01-i03' }]);

  const round = speakingQueue(planned, states, false, seeded(1));
  assert.equal(round.length, 5);
  assert.ok(round.every((entry) => entry.kind === 'speaking' && entry.itemId !== undefined && review.has(entry.itemId)), 'review-phase items only, no rule and no learning item');
  assert.equal(new Set(round.map((entry) => entry.itemId)).size, 5, 'no repeats');
  assert.deepEqual(speakingQueue(planned, states, false, seeded(1)), round, 'repeatable with the same generator');
  assert.equal(speakingQueue([typed('u01-l01-i01')], states, true, seeded(1)).length, 5, 'speech on but no speaking entry planned: the round of review items');
  assert.equal(speakingQueue([], { 'u01-l01-i01': states['u01-l01-i01'], 'u01-l01-i02': states['u01-l01-i02'] }, false, seeded(1)).length, 2, 'fewer than five review items: all of them');
  assert.deepEqual(speakingQueue([], {}, false, seeded(1)), [], 'nothing in review: nothing to speak');
});
