// tests/engine/course.test.js
// The course position, pure over the bundle and the item states: today's new items and minutes
// come from today's session records (buildSession's newToday and minutesToday); the current lesson
// is the first in course order with a practisable item not met yet, with the lessons of its unit;
// unmetItems counts what a lesson still has to introduce.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, createState, recordRecall } from '../../app/js/engine/scheduler.js';
import { currentLesson, todayTotals, unmetItems } from '../../app/js/engine/course.js';

const TZ = 'Europe/Berlin';
const MINUTE = 60_000;
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5, 9, 0);   // Monday 5 January 2026, 10:00 in Berlin
const S = DEFAULT_SETTINGS;

const pending = { review1: null, review2: null, native: null, status: 'pending' };
const accepted = { ...pending, status: 'accepted' };
/** @param {string} id @param {[string, object][]} items */
const lesson = (id, items) => ({ id, unit: id.slice(0, 3), items: items.map(([itemId, verification]) => ({ id: itemId, verification })) });
/** @param {string} id @returns {Record<string, any>} the item met and recalled once */
const met = (id) => ({ [id]: recordRecall(createState(id, T0), 'correct', T0, S, TZ) });

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

test('unmetItems counts the practisable items not met yet: accepted ones, or every one with allowPending', () => {
  const l = /** @type {any} */ (lesson('u01-l01', [['u01-l01-i01', accepted], ['u01-l01-i02', pending], ['u01-l01-i03', accepted]]));
  assert.equal(unmetItems(l, {}, false), 2);
  assert.equal(unmetItems(l, {}, true), 3);
  assert.equal(unmetItems(l, met('u01-l01-i01'), false), 1);
  assert.equal(unmetItems(l, { 'u01-l01-i03': createState('u01-l01-i03', T0) }, false), 2, 'a state in phase new is not met');
  assert.equal(unmetItems(l, { ...met('u01-l01-i01'), ...met('u01-l01-i03') }, false), 0);
});

test('currentLesson is the first lesson in course order with a practisable item not met yet, with its unit lessons', () => {
  const l1 = lesson('u01-l01', [['u01-l01-i01', accepted], ['u01-l01-i02', pending]]);
  const l2 = lesson('u01-l02', [['u01-l02-i01', accepted]]);
  const l3 = lesson('u02-l01', [['u02-l01-i01', accepted]]);
  const index = { lessonIndex: [{ id: 'u01-l01', unit: 'u01' }, { id: 'u01-l02', unit: 'u01' }, { id: 'u02-l01', unit: 'u02' }] };
  const units = [{ unit: { id: 'u01' }, lessons: [l1, l2] }, { unit: { id: 'u02' }, lessons: [l3] }];
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
