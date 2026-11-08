// tests/engine/time.test.js
// Local calendar helpers. The scheduler thinks in the learner's local days: a recall at 23:58 and
// one at 00:05 belong to different days, and a due date snaps to a local midnight.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localDateKey, startOfLocalDay, daysBetween } from '../../app/js/util/time.js';

const TZ = 'Europe/Berlin';

test('local date keys split at local midnight', () => {
  const tz = 'Europe/Berlin';
  const late = Date.UTC(2026, 10, 8, 22, 58);   // 23:58 Berlin
  const early = Date.UTC(2026, 10, 8, 23, 5);   // 00:05 Berlin next day
  assert.notEqual(localDateKey(late, tz), localDateKey(early, tz));
  assert.equal(daysBetween(localDateKey(late, tz), localDateKey(early, tz)), 1);
});

test('date keys are YYYY-MM-DD in the given zone, or in the phone\'s zone without one', () => {
  assert.equal(localDateKey(Date.UTC(2026, 10, 8, 22, 58), TZ), '2026-11-08');
  assert.equal(localDateKey(Date.UTC(2026, 10, 8, 23, 5), TZ), '2026-11-09');
  assert.equal(localDateKey(Date.UTC(2026, 0, 1, 0, 0), 'UTC'), '2026-01-01');
  // the same instant is a different day on the two sides of the globe
  const noonUtc = Date.UTC(2026, 6, 1, 12, 0);
  assert.equal(localDateKey(noonUtc, 'Pacific/Auckland'), '2026-07-02');
  assert.equal(localDateKey(noonUtc, 'America/Los_Angeles'), '2026-07-01');
  const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
  assert.equal(localDateKey(noonUtc), localDateKey(noonUtc, here));
});

test('startOfLocalDay is the local midnight of the instant\'s day, also around the clock changes', () => {
  // in November Berlin is UTC+1, so its midnight is 23:00Z of the evening before
  assert.equal(startOfLocalDay(Date.UTC(2026, 10, 8, 22, 58), TZ), Date.UTC(2026, 10, 7, 23, 0));
  assert.equal(startOfLocalDay(Date.UTC(2026, 10, 8, 23, 5), TZ), Date.UTC(2026, 10, 8, 23, 0));
  // 25 October 2026, the day the clocks go back: midnight was still summer time, UTC+2
  assert.equal(startOfLocalDay(Date.UTC(2026, 9, 25, 15, 0), TZ), Date.UTC(2026, 9, 24, 22, 0));
  // 29 March 2026, the day the clocks go forward: midnight was still winter time, UTC+1
  assert.equal(startOfLocalDay(Date.UTC(2026, 2, 29, 15, 0), TZ), Date.UTC(2026, 2, 28, 23, 0));
  // a midnight maps to itself and one millisecond earlier belongs to the previous day
  for (const t of [Date.UTC(2026, 10, 8, 22, 58), Date.UTC(2026, 9, 25, 15, 0), Date.UTC(2026, 2, 29, 15, 0)]) {
    const start = startOfLocalDay(t, TZ);
    assert.equal(startOfLocalDay(start, TZ), start);
    assert.equal(localDateKey(start, TZ), localDateKey(t, TZ));
    assert.equal(daysBetween(localDateKey(start - 1, TZ), localDateKey(start, TZ)), 1);
  }
  // noon UTC on 1 July is midnight on 2 July in New Zealand (UTC+12 in its winter)
  assert.equal(startOfLocalDay(Date.UTC(2026, 6, 1, 12, 0), 'Pacific/Auckland'), Date.UTC(2026, 6, 1, 12, 0));
  const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
  assert.equal(startOfLocalDay(Date.UTC(2026, 6, 1, 12, 0)), startOfLocalDay(Date.UTC(2026, 6, 1, 12, 0), here));
});

test('daysBetween counts calendar days between keys, negative when the second is earlier', () => {
  assert.equal(daysBetween('2026-11-08', '2026-11-09'), 1);
  assert.equal(daysBetween('2026-11-08', '2026-11-08'), 0);
  assert.equal(daysBetween('2026-12-31', '2027-01-01'), 1);
  assert.equal(daysBetween('2026-03-01', '2026-02-28'), -1);
  assert.equal(daysBetween('2026-03-28', '2026-03-30'), 2);
  assert.equal(daysBetween('2026-01-01', '2026-12-31'), 364);
  assert.throws(() => daysBetween('2026-1-1', '2026-01-02'), RangeError);
  assert.throws(() => daysBetween('2026-01-01', 'tomorrow'), RangeError);
});
