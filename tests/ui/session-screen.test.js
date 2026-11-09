// tests/ui/session-screen.test.js
// The pure parts of the session screen and its feedback: the run-time queue re-queues a missed
// typed recall after the next two entries (Ruling 22); today's new items and minutes come from
// today's session records; one function turns a recall into the next state, rules through
// skipAheadState on a correct quick check (Ruling 21) and slips through effectiveResult (Ruling 17);
// the current lesson is the first with an item not met yet; a slip names its letters (Ruling 19).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, createState, recordRecall } from '../../app/js/engine/scheduler.js';
import { requeue, retryEntry, todayTotals, stateAfterRecall, currentLesson } from '../../app/js/ui/screens/session.js';
import { mindThe } from '../../app/js/ui/components/feedback.js';

const TZ = 'Europe/Berlin';
const MINUTE = 60_000;
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5, 9, 0);   // Monday 5 January 2026, 10:00 in Berlin
const S = DEFAULT_SETTINGS;

/** @param {string} id */
const typed = (id) => ({ kind: 'typed_en_sl', itemId: id, lessonId: 'u01-l01' });

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

test("todayTotals sums the new items and minutes of the sessions that started on today's local date", () => {
  const record = (startedAt, minutes, newItems) => ({ id: String(startedAt), startedAt, endedAt: startedAt + minutes * MINUTE, minutes, recalls: 0, correct: 0, newItems, honey: 0, kinds: {} });
  const sessions = [
    record(T0 - DAY, 9, 7),                       // yesterday
    record(Date.UTC(2026, 0, 4, 22, 58), 12, 3),  // 23:58 yesterday in Berlin, ran past midnight: counts for yesterday
    record(Date.UTC(2026, 0, 4, 23, 5), 4, 2),    // 00:05 today in Berlin
    record(T0 - 30 * MINUTE, 6.5, 5),             // this morning
  ];
  assert.deepEqual(todayTotals(sessions, T0, TZ), { newToday: 7, minutesToday: 10.5 });
  assert.deepEqual(todayTotals([], T0, TZ), { newToday: 0, minutesToday: 0 });
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

test('currentLesson is the first lesson in course order with a practisable item not met yet, with its unit lessons', () => {
  const pending = { review1: null, review2: null, native: null, status: 'pending' };
  const accepted = { ...pending, status: 'accepted' };
  const lesson = (id, items) => ({ id, unit: id.slice(0, 3), items: items.map(([itemId, verification]) => ({ id: itemId, verification })) });
  const l1 = lesson('u01-l01', [['u01-l01-i01', accepted], ['u01-l01-i02', pending]]);
  const l2 = lesson('u01-l02', [['u01-l02-i01', accepted]]);
  const l3 = lesson('u02-l01', [['u02-l01-i01', accepted]]);
  const index = { lessonIndex: [{ id: 'u01-l01', unit: 'u01' }, { id: 'u01-l02', unit: 'u01' }, { id: 'u02-l01', unit: 'u02' }] };
  const units = [{ unit: { id: 'u01' }, lessons: [l1, l2] }, { unit: { id: 'u02' }, lessons: [l3] }];
  const met = (id) => ({ [id]: recordRecall(createState(id, T0), 'correct', T0, S, TZ) });
  const at = (states, allowPending) => currentLesson(/** @type {any} */ (index), /** @type {any} */ (units), states, allowPending);

  let found = at({}, false);
  assert.equal(found.lesson?.id, 'u01-l01');
  assert.deepEqual(found.unitLessons.map((l) => l.id), ['u01-l01', 'u01-l02']);
  assert.equal(found.remaining, 1);

  found = at(met('u01-l01-i01'), false);
  assert.equal(found.lesson?.id, 'u01-l02', 'the pending item does not hold the lesson open in a strict build');
  found = at(met('u01-l01-i01'), true);
  assert.equal(found.lesson?.id, 'u01-l01', 'in a dev build it does');
  assert.equal(found.remaining, 1);

  found = at({ ...met('u01-l01-i01'), ...met('u01-l01-i02'), ...met('u01-l02-i01') }, true);
  assert.equal(found.lesson?.id, 'u02-l01');
  assert.deepEqual(found.unitLessons.map((l) => l.id), ['u02-l01']);

  found = at({ ...met('u01-l01-i01'), ...met('u01-l01-i02'), ...met('u01-l02-i01'), ...met('u02-l01-i01') }, true);
  assert.deepEqual(found, { lesson: null, unitLessons: [], remaining: 0 }, 'every item met: no current lesson');
});

test('mindThe names the slipped letters', () => {
  assert.equal(mindThe(['č']), 'Mind the č');
  assert.equal(mindThe(['č', 'ž']), 'Mind the č and ž');
  assert.equal(mindThe(['č', 'š', 'ž']), 'Mind the č, š and ž');
});
