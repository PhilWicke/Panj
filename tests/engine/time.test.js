// tests/engine/time.test.js
// Local calendar helpers. The scheduler thinks in the learner's local days: a recall at 23:58 and
// one at 00:05 belong to different days, and a due date snaps to a local midnight.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localDateKey, startOfLocalDay, startOfNextLocalDay, daysBetween, formatterCacheSize, formatDateEn } from '../../app/js/util/time.js';

const TZ = 'Europe/Berlin';
const HOUR = 3_600_000;

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

test('startOfNextLocalDay is the start of the following local day, across both DST changes', () => {
  const tz = 'Europe/Berlin';
  // 2026-03-28 is a 24 h day followed by the 23 h day of 2026-03-29; 2026-10-24 by the 25 h day of 2026-10-25
  assert.equal(localDateKey(startOfNextLocalDay(Date.UTC(2026, 2, 28, 12), tz), tz), '2026-03-29');
  assert.equal(startOfNextLocalDay(Date.UTC(2026, 2, 28, 12), tz), startOfLocalDay(Date.UTC(2026, 2, 29, 12), tz));
  assert.equal(localDateKey(startOfNextLocalDay(Date.UTC(2026, 9, 24, 23, 30), tz), tz), '2026-10-26'); // 01:30 local on the 25th, still summer time
  assert.equal(startOfNextLocalDay(Date.UTC(2026, 9, 24, 23, 30), tz), startOfLocalDay(Date.UTC(2026, 9, 26, 12), tz));
  // the short and the long day: 23 hours from the start of 29 March to the start of 30 March, 25 from 25 to 26 October
  assert.equal(startOfNextLocalDay(Date.UTC(2026, 2, 29, 15), tz) - startOfLocalDay(Date.UTC(2026, 2, 29, 15), tz), 23 * HOUR);
  assert.equal(startOfNextLocalDay(Date.UTC(2026, 9, 25, 15), tz) - startOfLocalDay(Date.UTC(2026, 9, 25, 15), tz), 25 * HOUR);
  // 23:58 on 8 November in Berlin: the next day starts two minutes later; a midnight gives the following midnight
  assert.equal(startOfNextLocalDay(Date.UTC(2026, 10, 8, 22, 58), tz), Date.UTC(2026, 10, 8, 23, 0));
  assert.equal(startOfNextLocalDay(Date.UTC(2026, 10, 8, 23, 0), tz), Date.UTC(2026, 10, 9, 23, 0));
  assert.equal(startOfNextLocalDay(Date.UTC(2026, 10, 8, 23, 0) - 1, tz), Date.UTC(2026, 10, 8, 23, 0));
  // noon UTC on 1 July is midnight on 2 July in New Zealand, so the next local day starts a day later
  assert.equal(startOfNextLocalDay(Date.UTC(2026, 6, 1, 12, 0), 'Pacific/Auckland'), Date.UTC(2026, 6, 2, 12, 0));
  const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
  assert.equal(startOfNextLocalDay(Date.UTC(2026, 6, 1, 12, 0)), startOfNextLocalDay(Date.UTC(2026, 6, 1, 12, 0), here));
});

test('wallClock caches one formatter per zone', () => {
  // zones no other test of this file uses, so the count does not depend on what ran before
  const before = formatterCacheSize();
  for (let i = 0; i < 1000; i += 1) localDateKey(Date.UTC(2026, 0, 1, i % 24), 'Asia/Tokyo');
  assert.equal(formatterCacheSize(), before + 1, 'a thousand calls in a new zone add one formatter');
  for (let i = 0; i < 1000; i += 1) startOfLocalDay(Date.UTC(2026, 5, 1, i % 24), 'Asia/Tokyo');
  assert.equal(formatterCacheSize(), before + 1, 'every helper shares the zone\'s formatter');
  localDateKey(Date.UTC(2026, 0, 1), 'Asia/Kolkata');
  assert.equal(formatterCacheSize(), before + 2, 'another zone is another formatter');
  // the cached formatter answers as a fresh one would: 00:00Z is 09:00 in Tokyo, 16:00Z is 01:00 the next day
  assert.equal(localDateKey(Date.UTC(2026, 0, 1, 0), 'Asia/Tokyo'), '2026-01-01');
  assert.equal(localDateKey(Date.UTC(2026, 0, 1, 16), 'Asia/Tokyo'), '2026-01-02');
  assert.equal(startOfLocalDay(Date.UTC(2026, 0, 1, 16), 'Asia/Tokyo'), Date.UTC(2026, 0, 1, 15));
});

test('formatDateEn writes a date key in English, day, month name and year, whatever the phone\'s locale', () => {
  assert.equal(formatDateEn('2026-11-02'), '2 November 2026');
  assert.equal(formatDateEn('2027-01-31'), '31 January 2027');
  assert.equal(formatDateEn('2026-05-09'), '9 May 2026', 'no leading zero on the day');
  const months = Array.from({ length: 12 }, (_, i) => formatDateEn(`2026-${String(i + 1).padStart(2, '0')}-15`).split(' ')[1]);
  assert.deepEqual(months, ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']);
  assert.equal(formatDateEn('not a date'), 'not a date', 'anything that is not a date key is shown as it is');
  assert.equal(formatDateEn('2026-13-01'), '2026-13-01', 'nor a month past December');
});
