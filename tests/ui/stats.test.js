// tests/ui/stats.test.js
// The Stats screen's pure parts: recall accuracy over the last twelve local weeks (Monday to
// Sunday, as weekSummary counts them, through the clock changes), the items by phase (a mastered
// item once, under mastered; rule states and new items left out), the weekly checks' calibration
// lines newest first, the practice per kind from SessionRecord.kinds (Ruling 43) and the short
// date the labels use. The screen itself runs in the browser check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calibrationLines, phaseCounts, practiceByKind, shortDate, weeklyAccuracy } from '../../app/js/ui/screens/stats.js';

const TZ = 'Europe/Berlin';
const HOUR = 3_600_000;
/** An instant of 2026 in Berlin as epoch ms: winter time (UTC+1) from 25 October, summer time (UTC+2) before. */
const berlin = (month, day, hour, minute = 0) => {
  const utc = Date.UTC(2026, month - 1, day, hour, minute);
  const summer = month < 10 || (month === 10 && (day < 25 || (day === 25 && hour < 3)));
  return utc - (summer ? 2 : 1) * HOUR;
};
/** @param {number} startedAt @param {number} recalls @param {number} correct @param {Record<string, number>} [kinds] */
const session = (startedAt, recalls, correct, kinds = { typed_en_sl: recalls }) => ({
  id: `s-${startedAt}`, startedAt, endedAt: startedAt + 600_000, minutes: 10, recalls, correct, newItems: 0, honey: correct, kinds,
});

const NOW = berlin(11, 11, 10);   // Wednesday 11 November 2026
const MONDAYS = ['2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09'];

test('weeklyAccuracy: twelve local weeks from Monday, oldest first, correct over recalls per week', () => {
  const sessions = [
    session(berlin(8, 23, 20), 30, 30),          // Sunday before the twelve weeks: left out
    session(berlin(8, 24, 8), 10, 7),            // the oldest week's Monday morning
    session(berlin(10, 25, 23, 30), 4, 4),       // Sunday night after the clock went back: week of 19 October
    session(berlin(10, 26, 0, 15), 5, 1),        // Monday just after midnight (Sunday 23:15 UTC): week of 26 October
    session(berlin(11, 3, 9), 41, 35),
    session(berlin(11, 8, 23, 30), 20, 15),      // Sunday night: last week, 41 + 20 = 61 recalls
    session(berlin(11, 9, 0, 30), 10, 8),        // Monday 00:30 (Sunday in UTC): this week
    session(berlin(11, 10, 18), 0, 0, { listening: 3 }),   // a session without recalls adds nothing
  ];
  const weeks = weeklyAccuracy(sessions, NOW, TZ);
  assert.equal(weeks.length, 12);
  assert.deepEqual(weeks.map((week) => week.start), MONDAYS);
  assert.deepEqual(weeks[0], { start: '2026-08-24', recalls: 10, correct: 7, pct: 70 });
  assert.deepEqual(weeks[8], { start: '2026-10-19', recalls: 4, correct: 4, pct: 100 });
  assert.deepEqual(weeks[9], { start: '2026-10-26', recalls: 5, correct: 1, pct: 20 });
  assert.deepEqual(weeks[10], { start: '2026-11-02', recalls: 61, correct: 50, pct: 82 }, '50 of 61 is 82 percent, rounded');
  assert.deepEqual(weeks[11], { start: '2026-11-09', recalls: 10, correct: 8, pct: 80 });
  for (const k of [1, 2, 3, 4, 5, 6, 7]) assert.deepEqual(weeks[k], { start: MONDAYS[k], recalls: 0, correct: 0, pct: null }, 'no recalls, no percent');
  assert.equal(weeks.reduce((sum, week) => sum + week.recalls, 0), 90, 'nothing is counted twice');

  // the weeks are the zone's local weeks: in UTC the Monday 00:30 session is a Sunday of last week
  const utc = weeklyAccuracy(sessions, NOW, 'UTC');
  assert.deepEqual(utc[10], { start: '2026-11-02', recalls: 71, correct: 58, pct: 82 });
  assert.equal(utc[11].recalls, 0);
  assert.deepEqual(weeklyAccuracy([], NOW, TZ).map((week) => week.pct), Array(12).fill(null));
  // on a Monday the current week starts that day
  assert.equal(weeklyAccuracy([], berlin(11, 9, 0, 5), TZ)[11].start, '2026-11-09');
  assert.equal(weeklyAccuracy([], berlin(11, 8, 23, 55), TZ)[11].start, '2026-11-02');
});

test('phaseCounts counts the non-rule items past new by phase, a mastered item once under mastered', () => {
  /** @param {string} itemId @param {string} phase @param {boolean} [mastered] */
  const st = (itemId, phase, mastered = false) => ({ itemId, phase, mastered });
  const states = {
    'u01-l01-i01': st('u01-l01-i01', 'new'),
    'u01-l01-i02': st('u01-l01-i02', 'learning'),
    'u01-l01-i03': st('u01-l01-i03', 'learning'),
    'u01-l01-i04': st('u01-l01-i04', 'review'),
    'u01-l01-i05': st('u01-l01-i05', 'review', true),
    'u01-l01-i06': st('u01-l01-i06', 'lapsed', true),
    'u01-l01-i07': st('u01-l01-i07', 'lapsed'),
    'r-ti-vi': st('r-ti-vi', 'review', true),
    'r-biti-present': st('r-biti-present', 'learning'),
  };
  assert.deepEqual(phaseCounts(states), { learning: 2, review: 1, lapsed: 1, mastered: 2 });
  assert.deepEqual(phaseCounts({}), { learning: 0, review: 0, lapsed: 0, mastered: 0 });
});

test('calibrationLines: the weekly checks newest first, prediction against result', () => {
  const checks = [
    { at: '2026-10-27', total: 12, correct: 9, predicted: 10 },
    { at: '2026-11-03', total: 18, correct: 16, predicted: 14 },
  ];
  assert.deepEqual(calibrationLines(checks), ['3 Nov: predicted 14, got 16 of 18', '27 Oct: predicted 10, got 9 of 12']);
  assert.deepEqual(checks.map((check) => check.at), ['2026-10-27', '2026-11-03'], 'the list it was given is not reordered');
  assert.deepEqual(calibrationLines(undefined), []);
  assert.deepEqual(calibrationLines([]), []);
});

test('practiceByKind sums SessionRecord.kinds over the sessions, in a fixed order with plain names', () => {
  const sessions = [
    session(NOW, 8, 6, { meet: 3, typed_en_sl: 8, rule: 1, listening: 2 }),
    session(NOW + HOUR, 5, 5, { typed_en_sl: 5, perception: 4, dialogue: 1, speaking: 0 }),
    session(NOW + 2 * HOUR, 8, 6, { weekly: 8 }),
    session(NOW + 3 * HOUR, 8, 8, { checkpoint: 8, fluency: 1, structured: 2, slot: 1, typed_sl_en: 2 }),
  ];
  assert.deepEqual(practiceByKind(sessions), [
    { kind: 'meet', label: 'Met', count: 3 },
    { kind: 'typed_en_sl', label: 'Typed recall', count: 13 },
    { kind: 'typed_sl_en', label: 'Meaning recall', count: 2 },
    { kind: 'structured', label: 'Choose the form', count: 2 },
    { kind: 'slot', label: 'Change the phrase', count: 1 },
    { kind: 'dialogue', label: 'Dialogues', count: 1 },
    { kind: 'listening', label: 'Listening', count: 2 },
    { kind: 'perception', label: 'Hearing drills', count: 4 },
    { kind: 'rule', label: 'Rule cards', count: 1 },
    { kind: 'fluency', label: 'Quick rounds', count: 1 },
    { kind: 'checkpoint', label: 'Checkpoints', count: 8 },
    { kind: 'weekly', label: 'Weekly checks', count: 8 },
  ], 'a kind never done (speaking here) is left out');
  assert.deepEqual(practiceByKind([]), []);
});

test('shortDate writes a date key as day and short month', () => {
  assert.equal(shortDate('2026-11-03'), '3 Nov');
  assert.equal(shortDate('2026-01-31'), '31 Jan');
  assert.equal(shortDate('2026-12-01'), '1 Dec');
});
