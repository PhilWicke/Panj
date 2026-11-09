// tests/engine/progress.test.js
// Progress counters over the item states and the session records: the items the learner can recall
// now, the words met, the hive fill per lesson and unit, the Monday-based week with its one grace
// day, honey and the hours practised. Every function is pure and counts in the learner's local days.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_SETTINGS, createState, recordRecall, skipAheadState, retrievability } from '../../app/js/engine/scheduler.js';
import { localDateKey } from '../../app/js/util/time.js';
import {
  recallNow, wordsMet, lessonFill, hiveFill, weekSummary, honeyFor, hoursPracticed, a1Hours,
} from '../../app/js/engine/progress.js';

const TZ = 'Europe/Berlin';
const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5, 9, 0);   // Monday 5 January 2026, 10:00 in Berlin
const R = DEFAULT_SETTINGS.desiredRetention;   // 0.9

/** A review-phase item that skipped ahead `days` days ago: the older, the lower its retrievability. */
const reviewed = (id, days) => skipAheadState(id, T0 - days * DAY);
const byId = (...list) => Object.fromEntries(list.map((s) => [s.itemId, s]));

// The fixtures of the recall tests, with their retrievability at T0 (the retention target is 0.9).
const fresh = reviewed('u01-l01-i01', 1);       // 0.98
const edge = reviewed('u01-l01-i02', 6);        // 0.91
const fading = reviewed('u01-l01-i03', 8);      // 0.89
const gone = reviewed('u01-l01-i04', 14);       // 0.85
const lapsed = recordRecall(reviewed('u01-l01-i05', 8), 'wrong', T0 - HOUR, DEFAULT_SETTINGS, TZ);
const learning = recordRecall(createState('u01-l01-i06', T0 - HOUR), 'correct', T0 - HOUR, DEFAULT_SETTINGS, TZ);
const unmet = createState('u01-l01-i07', T0);
const mastered = { ...reviewed('u01-l01-i08', 1), mastered: true, masterySessions: ['2025-12-20', '2025-12-27', '2026-01-03'] };
const ruleItem = reviewed('r-biti-present', 1);

const verified = (status) => ({ review1: null, review2: null, native: null, status });
/** @param {string} id @param {string} sl @param {string[]} [examples] @param {string} [status] */
const item = (id, sl, examples = [], status = 'accepted') => ({
  id, type: 'chunk', sl, en: `en ${id}`, register: 'neutral', examples: examples.map((e) => ({ sl: e, en: 'en' })), verification: verified(status),
});
/** @param {string} id @param {object[]} items @param {object} [dialogue] */
const lesson = (id, items, dialogue) => ({
  id, unit: id.slice(0, 3), order: Number(id.slice(-2)), title_sl: `L ${id}`, title_en: `L ${id}`, items, rules: [], structured: [], production: [],
  ...(dialogue ? { dialogue } : {}),
});
const unit = (id, lessons) => ({ id, order: Number(id.slice(1)), title_sl: `U ${id}`, title_en: `U ${id}`, motif: 'flower', lessons: lessons.map((l) => l.id) });
/** @param {string[]} lines */
const dialogue = (id, lines) => ({ id: `${id}-d`, title_sl: 'd', title_en: 'd', setting_en: 'At the door.', lines: lines.map((sl) => ({ speaker: 'host', sl, en: 'en' })) });

/** A session record of `minutes` minutes started at `startedAt`. */
const session = (startedAt, minutes = 10) => ({
  id: `s-${startedAt}`, startedAt, endedAt: startedAt + minutes * MINUTE, minutes, recalls: 20, correct: 18, newItems: 3, honey: 18, kinds: { typed_en_sl: 20 },
});
/** An instant of January 2026 in Berlin (UTC+1), as epoch ms. */
const berlin = (day, hour, minute = 0) => Date.UTC(2026, 0, day, hour, minute) - HOUR;

const FIXTURE = new URL('../../tools/fixtures/content-valid/', import.meta.url);
/** The content-valid fixture as the bundle carries it: one unit, one lesson of three items with a dialogue. */
async function fixtureUnit() {
  const [units, l01] = await Promise.all([
    readFile(new URL('units.json', FIXTURE), 'utf8').then(JSON.parse),
    readFile(new URL('lessons/u01-l01.json', FIXTURE), 'utf8').then(JSON.parse),
  ]);
  return { unit: units[0], lessons: [l01] };
}

function deepFreeze(value) {
  if (value && typeof value === 'object') for (const v of Object.values(value)) deepFreeze(v);
  return Object.freeze(value);
}

// The brief's tests, by name.

test('recallNow counts review items above retention and excludes lapsed', () => {
  // the fixtures straddle the target: edge is just above it, fading just below
  assert.ok(retrievability(fresh, T0) > 0.95 && retrievability(edge, T0) > R && retrievability(fading, T0) < R && retrievability(gone, T0) < 0.85);
  assert.equal(lapsed.phase, 'lapsed');
  assert.equal(retrievability(lapsed, T0), 1, 'a fresh lapse still predicts recall; the phase excludes it');
  const states = byId(fresh, edge, fading, gone, lapsed, learning, unmet, mastered);
  assert.equal(recallNow(states, T0, R), 3, 'fresh, edge and the mastered item');
  assert.equal(recallNow(states, T0, 0.85), 4, 'a lower target admits the fading item');
  assert.equal(recallNow(states, T0, 0.92), 2, 'a higher target drops the edge item');
  assert.equal(recallNow(states, T0 + 30 * DAY, R), 0, 'retrievability falls with time');
  assert.equal(recallNow({}, T0, R), 0);
  assert.equal(recallNow(byId({ ...lapsed, mastered: true }), T0, R), 0, 'a lapsed item is out whether or not it was mastered');
  // a rule's quick-check item shares the states but is not one of the counted items of the course
  assert.equal(recallNow({ ...states, [ruleItem.itemId]: ruleItem }, T0, R), 3);
});

test('lessonFill is the share of accepted items recallable now', () => {
  const l = lesson('u01-l01', [
    item('u01-l01-i01', 'a'), item('u01-l01-i02', 'b'), item('u01-l01-i03', 'c'), item('u01-l01-i04', 'd'), item('u01-l01-i05', 'e'),
    item('u01-l01-i09', 'f', [], 'pending'),
  ]);
  const states = byId(fresh, edge, fading, gone, lapsed, reviewed('u01-l01-i09', 1));
  assert.equal(lessonFill(states, l, T0, R), 2 / 5, 'fresh and edge of the five accepted items; the pending item counts neither way');
  assert.equal(lessonFill(states, l, T0, 0.85), 3 / 5);
  assert.equal(lessonFill(states, l, T0 + 30 * DAY, R), 0);
  assert.equal(lessonFill({}, l, T0, R), 0);
  assert.equal(lessonFill(byId(fresh, edge), lesson('u01-l02', [item('u01-l01-i01', 'a'), item('u01-l01-i02', 'b')]), T0, R), 1);
  assert.equal(lessonFill(states, lesson('u01-l03', []), T0, R), 0, 'no accepted items, no division');
  assert.equal(lessonFill(states, lesson('u01-l04', [item('u01-l01-i09', 'f', [], 'pending')]), T0, R), 0);
});

test('week starts Monday and grace day makes four of seven count as met', () => {
  const sunday = berlin(11, 20);
  const sessions = [session(berlin(5, 8)), session(berlin(6, 12)), session(berlin(8, 7, 30)), session(berlin(10, 22))];   // Mon Tue Thu Sat
  const week = weekSummary(sessions, sunday, 5, TZ);
  assert.equal(week.weekStart, '2026-01-05');
  assert.deepEqual(week.days.map((d) => d.date), ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09', '2026-01-10', '2026-01-11']);
  assert.deepEqual(week.days.map((d) => d.active), [true, true, false, true, false, true, false]);
  assert.deepEqual(week.days.map((d) => d.minutes), [10, 10, 0, 10, 0, 10, 0]);
  assert.deepEqual([week.activeDays, week.target, week.graceUsed, week.met, week.remainingDays], [4, 5, true, true, 0]);
  // five days: met without the grace day
  const five = weekSummary([...sessions, session(berlin(11, 9))], sunday, 5, TZ);
  assert.deepEqual([five.activeDays, five.graceUsed, five.met], [5, false, true]);
  // three days: not met, and the grace day does not stretch
  const three = weekSummary(sessions.slice(0, 3), sunday, 5, TZ);
  assert.deepEqual([three.activeDays, three.graceUsed, three.met], [3, false, false]);
  // Monday to Sunday whichever day `now` falls on; the days after today remain
  for (let i = 0; i < 7; i += 1) {
    const w = weekSummary(sessions, berlin(5 + i, 12), 5, TZ);
    assert.equal(w.weekStart, '2026-01-05');
    assert.equal(w.days.length, 7);
    assert.equal(w.remainingDays, 6 - i);
  }
  // the neighbouring weeks' sessions are left out
  const neighbours = weekSummary([session(berlin(4, 23, 30)), ...sessions, session(berlin(12, 0, 30))], sunday, 5, TZ);
  assert.equal(neighbours.activeDays, 4);
  assert.deepEqual(neighbours.days.map((d) => d.minutes), week.days.map((d) => d.minutes));
  // two sessions on one day are one active day with their minutes added
  const twice = weekSummary([session(berlin(5, 8), 4), session(berlin(5, 21), 6.5)], berlin(5, 22), 5, TZ);
  assert.deepEqual(twice.days[0], { date: '2026-01-05', active: true, minutes: 10.5 });
  assert.deepEqual([twice.activeDays, twice.remainingDays], [1, 6]);
  // a session is what makes a day active, however short it was
  assert.deepEqual(weekSummary([session(berlin(5, 8), 0)], berlin(5, 9), 5, TZ).days[0], { date: '2026-01-05', active: true, minutes: 0 });
  // the target is a parameter with the grace rule applied to it; the default is five
  const t3 = weekSummary(sessions.slice(0, 3), sunday, 3, TZ);
  assert.deepEqual([t3.target, t3.graceUsed, t3.met], [3, false, true]);
  const t4 = weekSummary(sessions.slice(0, 3), sunday, 4, TZ);
  assert.deepEqual([t4.target, t4.graceUsed, t4.met], [4, true, true]);
  assert.equal(weekSummary([], sunday, undefined, TZ).target, 5);
  // without a zone the phone's zone applies
  const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
  assert.deepEqual(weekSummary(sessions, sunday), weekSummary(sessions, sunday, 5, here));
  // Sunday night and Monday morning are different weeks in Berlin; in UTC the same Monday morning is still Sunday
  assert.equal(weekSummary([], berlin(11, 23, 58), 5, TZ).weekStart, '2026-01-05');
  assert.equal(weekSummary([], berlin(12, 0, 5), 5, TZ).weekStart, '2026-01-12');
  assert.equal(weekSummary([], berlin(12, 0, 5), 5, 'UTC').weekStart, '2026-01-05');
  // the week of a clock change has seven days too (29 March 2026, the clocks went forward that night)
  const dst = weekSummary([], Date.UTC(2026, 2, 29, 13, 0), 5, TZ);
  assert.deepEqual([dst.weekStart, dst.days.length, dst.days[6].date, dst.remainingDays], ['2026-03-23', 7, '2026-03-29', 0]);
  // an empty week
  const none = weekSummary([], berlin(7, 12), 5, TZ);
  assert.deepEqual([none.activeDays, none.graceUsed, none.met, none.remainingDays], [0, false, false, 4]);
  assert.ok(none.days.every((d) => !d.active && d.minutes === 0));
});

test('sessions at 23:58 and 00:05 local land on different days', () => {
  const late = session(Date.UTC(2026, 0, 7, 22, 58), 3);    // Wednesday 23:58 in Berlin, ended 00:01 Thursday
  const early = session(Date.UTC(2026, 0, 7, 23, 5), 4);    // Thursday 00:05 in Berlin
  assert.notEqual(localDateKey(late.startedAt, TZ), localDateKey(early.startedAt, TZ));
  const week = weekSummary([late, early], Date.UTC(2026, 0, 8, 12), 5, TZ);
  assert.deepEqual(week.days.slice(2, 4), [
    { date: '2026-01-07', active: true, minutes: 3 },
    { date: '2026-01-08', active: true, minutes: 4 },
  ]);
  assert.equal(week.activeDays, 2);
  // a session belongs to the local day it started on, so the late one keeps Wednesday although it ended on Thursday
  assert.equal(localDateKey(late.endedAt, TZ), '2026-01-08');
  // in UTC both instants are still Wednesday
  const utc = weekSummary([late, early], Date.UTC(2026, 0, 8, 12), 5, 'UTC');
  assert.deepEqual(utc.days.map((d) => d.active), [false, false, true, false, false, false, false]);
  assert.equal(utc.days[2].minutes, 7);
});

test('hoursPracticed rounds to one decimal', () => {
  assert.equal(hoursPracticed([]), 0);
  assert.equal(hoursPracticed([session(T0, 30)]), 0.5);
  assert.equal(hoursPracticed([session(T0, 70)]), 1.2);     // 1.1666...
  assert.equal(hoursPracticed([session(T0, 75)]), 1.3);     // 1.25 rounds up
  assert.equal(hoursPracticed([session(T0, 3)]), 0.1);      // 0.05 rounds up
  assert.equal(hoursPracticed([session(T0, 2)]), 0);        // 0.033 rounds down
  assert.equal(hoursPracticed([session(T0, 10), session(T0 + DAY, 10), session(T0 + 2 * DAY, 7)]), 0.5);   // 27 minutes
  assert.equal(hoursPracticed([session(T0, 6.6), session(T0 + DAY, 6.6), session(T0 + 2 * DAY, 6.6)]), 0.3);   // fractional minutes
  assert.equal(hoursPracticed([session(T0, 1680)]), 28);    // "28 hours practised"
});

// Beyond the brief: the words met against the compiler's count, the hive, honey, the A1 budget and purity.

test('wordsMet counts the distinct tokens of met items, their examples and the dialogue of a lesson with a met item', async () => {
  const content = await fixtureUnit();
  assert.deepEqual(content.lessons[0].items.map((i) => i.id), ['u01-l01-i01', 'u01-l01-i02', 'u01-l01-i03']);
  assert.equal(wordsMet({}, [content]), 0, 'nothing met yet, so the dialogue counts nothing either');
  // the first item in learning: živjo, kako, si, and with it the whole dialogue (dober, dan, to, je, moj, brat, dobrodošli)
  const first = recordRecall(createState('u01-l01-i01', T0), 'correct', T0, DEFAULT_SETTINGS, TZ);
  assert.equal(wordsMet(byId(first), [content]), 10);
  // the second item adds ste; dober and dan are already counted
  assert.equal(wordsMet(byId(first, edge), [content]), 11);
  // a state in phase new is not a met item
  assert.equal(wordsMet(byId(first, edge, createState('u01-l01-i03', T0)), [content]), 11);
  // every item met: the compiler's lemmasMet for this fixture, which tests/content/build.test.js pins at 11
  assert.equal(wordsMet(byId(fresh, edge, fading), [content]), 11);
  // lapsed items were met; a rule's state has no words of its own
  assert.equal(wordsMet({ ...byId(fresh, edge), 'u01-l01-i03': { ...lapsed, itemId: 'u01-l01-i03' }, [ruleItem.itemId]: ruleItem }, [content]), 11);
  // tokens are distinct across lessons and units, in lowercase and without punctuation
  const l2 = lesson('u02-l01', [item('u02-l01-i01', 'DOBER DAN!', ['Dober večer, kako ste?'])], dialogue('u02-l01', ['Kar naprej, prosim.']));
  const l3 = lesson('u02-l02', [item('u02-l02-i01', 'Hvala.')], dialogue('u02-l02', ['Ni za kaj.']));
  const more = [content, { unit: unit('u02', [l2, l3]), lessons: [l2, l3] }];
  assert.equal(wordsMet(byId(fresh, edge, fading), more), 11, 'unmet lessons add nothing, dialogue included');
  assert.equal(wordsMet(byId(fresh, edge, fading, reviewed('u02-l01-i01', 1)), more), 11 + 4, 'večer, kar, naprej, prosim');
  assert.equal(wordsMet(byId(fresh, edge, fading, reviewed('u02-l01-i01', 1), reviewed('u02-l02-i01', 1)), more), 15 + 4, 'hvala, ni, za, kaj');
  assert.equal(wordsMet(byId(reviewed('u02-l02-i01', 1)), more), 4);
});

test('hiveFill gives one cell per lesson and the unit share weighted by items', () => {
  const l1 = lesson('u01-l01', [item('u01-l01-i01', 'a'), item('u01-l01-i02', 'b'), item('u01-l01-i03', 'c'), item('u01-l01-i04', 'd')]);
  const l2 = lesson('u01-l02', [item('u01-l02-i01', 'e')]);
  const l3 = lesson('u01-l03', [item('u01-l03-i01', 'f', [], 'pending')]);
  const content = { unit: unit('u01', [l1, l2, l3]), lessons: [l1, l2, l3] };
  const states = byId(fresh, edge, fading, gone, reviewed('u01-l02-i01', 1), reviewed('u01-l03-i01', 1));
  assert.deepEqual(hiveFill(states, content, T0, R), {
    unitId: 'u01',
    cells: [{ lessonId: 'u01-l01', fill: 0.5 }, { lessonId: 'u01-l02', fill: 1 }, { lessonId: 'u01-l03', fill: 0 }],
    fill: 3 / 5,
  });
  assert.equal(hiveFill(states, content, T0, 0.85).fill, 4 / 5);
  assert.deepEqual(hiveFill({}, content, T0, R), { unitId: 'u01', cells: [{ lessonId: 'u01-l01', fill: 0 }, { lessonId: 'u01-l02', fill: 0 }, { lessonId: 'u01-l03', fill: 0 }], fill: 0 });
  // a unit without lessons: the strict build leaves all-pending lessons out, the unit file stays
  assert.deepEqual(hiveFill(states, { unit: unit('u02', []), lessons: [] }, T0, R), { unitId: 'u02', cells: [], fill: 0 });
  // the cells agree with lessonFill
  for (const l of [l1, l2, l3]) {
    assert.equal(hiveFill(states, content, T0, R).cells.find((c) => c.lessonId === l.id)?.fill, lessonFill(states, l, T0, R));
  }
});

test('honey is one per correct recall and A1 courses budget 120 to 180 hours', () => {
  assert.equal(honeyFor(0), 0);
  assert.equal(honeyFor(18), 18);
  assert.deepEqual(a1Hours, { min: 120, max: 180 });
  assert.ok(Object.isFrozen(a1Hours));
});

test('the counters leave their inputs alone and return fresh objects', () => {
  const l1 = lesson('u01-l01', [item('u01-l01-i01', 'a'), item('u01-l01-i02', 'b')], dialogue('u01-l01', ['Dober dan.']));
  const states = deepFreeze(byId(fresh, edge, lapsed, learning));
  const content = deepFreeze({ unit: unit('u01', [l1]), lessons: [l1] });
  const sessions = deepFreeze([session(berlin(5, 8)), session(berlin(6, 8), 7)]);
  assert.equal(recallNow(states, T0, R), 2);
  assert.equal(wordsMet(states, [content]), 4, 'a, b, dober, dan');
  assert.equal(lessonFill(states, l1, T0, R), 1);
  const a = hiveFill(states, content, T0, R);
  const b = hiveFill(states, content, T0, R);
  assert.deepEqual(a, b);
  assert.notEqual(a.cells, b.cells);
  const w1 = weekSummary(sessions, berlin(6, 9), 5, TZ);
  const w2 = weekSummary(sessions, berlin(6, 9), 5, TZ);
  assert.deepEqual(w1, w2);
  assert.notEqual(w1.days, w2.days);
  assert.equal(hoursPracticed(sessions), 0.3);
});
