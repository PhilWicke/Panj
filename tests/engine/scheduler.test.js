// tests/engine/scheduler.test.js
// The item state machine over the vendored FSRS: learning steps, graduation, review, lapse,
// relearning and mastery, all counted in the learner's local days.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as vendored from '../../app/js/engine/fsrs.vendored.js';
import {
  DEFAULT_SETTINGS, LEARNING_STEPS_MS, RELEARNING_STEPS_MS, GRADUATE_AFTER, MASTERY_SESSIONS,
  createState, recordRecall, effectiveResult, isDue, retrievability, skipAheadState,
} from '../../app/js/engine/scheduler.js';
import { localDateKey, startOfLocalDay, startOfNextLocalDay } from '../../app/js/util/time.js';

const { fsrs, createEmptyCard, Rating, State } = vendored;
const TZ = 'Europe/Berlin';
const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5, 9, 0);   // Monday 5 January 2026, 10:00 in Berlin
const S = DEFAULT_SETTINGS;

const recall = (state, result, now, settings = S) => recordRecall(state, result, now, settings, TZ);

/** Three correct recalls at `now`, one minute later and ten minutes after that: the item graduates on the third. */
function graduated(now = T0) {
  let s = createState('u01-l01-i01', now);
  s = recall(s, 'correct', now);
  s = recall(s, 'correct', s.due);
  return recall(s, 'correct', s.due);
}

function deepFreeze(value) {
  if (value && typeof value === 'object') for (const v of Object.values(value)) deepFreeze(v);
  return Object.freeze(value);
}

test('constants match the learning model', () => {
  assert.deepEqual(DEFAULT_SETTINGS, { desiredRetention: 0.9, newPerDay: 7, dailyMinutes: 10 });
  assert.deepEqual([...LEARNING_STEPS_MS], [60_000, 600_000]);
  assert.deepEqual([...RELEARNING_STEPS_MS], [600_000]);
  assert.equal(GRADUATE_AFTER, 3);
  assert.equal(MASTERY_SESSIONS, 3);
});

test('vendored fsrs reproduces reference vectors', async () => {
  const ref = JSON.parse(await readFile(new URL('../../tools/fixtures/fsrs-reference.json', import.meta.url), 'utf8'));
  assert.equal(ref.package, 'ts-fsrs');
  assert.equal(vendored.FSRSVersion, ref.fsrsVersion);
  assert.deepEqual(Object.keys(vendored).sort(), ref.exportNames, 'the wrapper exposes every name of the upstream entry');
  assert.equal(globalThis.FSRS, undefined, 'the global the UMD build needs is removed again');
  for (const scenario of ref.scenarios) {
    const f = fsrs(scenario.options);
    let card = createEmptyCard(new Date(ref.start));
    for (const step of scenario.steps) {
      const now = new Date(step.date);
      ({ card } = f.next(card, now, Rating[step.rating]));
      const where = `${scenario.name}, ${step.rating} at ${step.date}`;
      assert.ok(Math.abs(card.stability - step.card.stability) < 1e-6, `${where}: stability ${card.stability} vs ${step.card.stability}`);
      assert.ok(Math.abs(card.difficulty - step.card.difficulty) < 1e-6, `${where}: difficulty ${card.difficulty} vs ${step.card.difficulty}`);
      assert.equal(card.due.toISOString(), step.card.due, `${where}: due`);
      assert.equal(card.scheduled_days, step.card.scheduled_days, `${where}: scheduled_days`);
      assert.equal(card.state, step.card.state, `${where}: state`);
      assert.equal(card.reps, step.card.reps, `${where}: reps`);
      assert.equal(card.lapses, step.card.lapses, `${where}: lapses`);
      const r = f.retrievability(card, new Date(now.getTime() + DAY));
      assert.ok(Math.abs(r - step.retrievabilityNextDay) < 1e-6, `${where}: retrievability ${r} vs ${step.retrievabilityNextDay}`);
    }
  }
});

test('new item graduates after three correct recalls and is due at the start of the next local day', () => {
  const s0 = createState('u01-l01-i01', T0);
  assert.equal(s0.phase, 'new');
  assert.equal(s0.due, T0);
  assert.ok(isDue(s0, T0));
  assert.equal(retrievability(s0, T0), 1);

  const s1 = recall(s0, 'correct', T0);
  assert.equal(s1.phase, 'learning');
  assert.equal(s1.correctInSession, 1);
  assert.equal(s1.step, 1);
  assert.equal(s1.due, T0 + LEARNING_STEPS_MS[0]);
  assert.equal(s1.sessionKey, '2026-01-05');
  assert.equal(s1.card, null);
  assert.equal(s1.reps, 1);
  assert.equal(s1.lastReview, T0);
  assert.equal(retrievability(s1, T0), 1);
  assert.ok(!isDue(s1, T0) && isDue(s1, s1.due));

  const t2 = s1.due;
  const s2 = recall(s1, 'correct', t2);
  assert.equal(s2.phase, 'learning');
  assert.equal(s2.correctInSession, 2);
  assert.equal(s2.step, 2);
  assert.equal(s2.due, t2 + LEARNING_STEPS_MS[1]);

  const t3 = s2.due;
  const s3 = recall(s2, 'correct', t3);
  assert.equal(s3.phase, 'review');
  assert.equal(s3.correctInSession, GRADUATE_AFTER);
  assert.equal(s3.step, 0);
  assert.ok(s3.card, 'the item carries an FSRS card from now on');
  assert.equal(s3.card.state, State.Review);
  assert.equal(s3.card.reps, 1);
  assert.equal(s3.card.last_review, t3);
  assert.ok(s3.card.stability > 0 && s3.card.difficulty >= 1);
  // due at the start of the next local day, whatever FSRS scheduled: the first review is the next day
  assert.equal(s3.due, startOfNextLocalDay(t3, TZ));
  assert.equal(s3.due, Date.UTC(2026, 0, 5, 23, 0), 'midnight of 6 January in Berlin');
  assert.equal(localDateKey(s3.due, TZ), '2026-01-06');
  assert.ok(s3.card, 'the FSRS card keeps its own scheduling; only due is pinned');
  assert.ok(s3.card.due > s3.due, 'FSRS alone would have waited longer');
  assert.ok(!isDue(s3, t3) && isDue(s3, s3.due));
  // three correct recalls at 10:00, 10:01 and 10:11 on 8 November 2026 in Berlin: due at midnight of the 9th
  const nov = graduated(Date.UTC(2026, 10, 8, 9, 0));
  assert.equal(nov.lastReview, Date.UTC(2026, 10, 8, 9, 11));
  assert.equal(nov.due, startOfNextLocalDay(nov.lastReview, TZ));
  assert.equal(nov.due, Date.UTC(2026, 10, 8, 23, 0));
  assert.equal(retrievability(s3, t3), 1);
  assert.equal(retrievability(s3, s3.due), 1, 'FSRS counts whole days, and the next midnight is less than one away');
  assert.ok(retrievability(s3, s3.due + DAY) < 1 && retrievability(s3, s3.due + DAY) > 0.8, 'the memory model runs on from the card');
  assert.equal(s3.mastered, false);
  assert.deepEqual(s3.masterySessions, []);
  assert.equal(s3.reps, 3);
  assert.equal(s3.lapses, 0);
});

test('wrong answer in learning resets progress', () => {
  let s = createState('u01-l01-i02', T0);
  s = recall(s, 'correct', T0);
  s = recall(s, 'correct', s.due);
  const t = s.due;
  const w = recall(s, 'wrong', t);
  assert.equal(w.phase, 'learning');
  assert.equal(w.correctInSession, 0);
  assert.equal(w.step, 0);
  assert.equal(w.due, t + LEARNING_STEPS_MS[0]);
  assert.equal(w.card, null);
  assert.equal(w.lapses, 0, 'a miss in learning is not a lapse');
  assert.equal(w.reps, 3);
  // three fresh correct recalls are needed again
  let again = recall(w, 'correct', w.due);
  again = recall(again, 'correct', again.due);
  assert.equal(again.phase, 'learning');
  assert.equal(again.correctInSession, 2);
  again = recall(again, 'correct', again.due);
  assert.equal(again.phase, 'review');
  // a wrong first answer puts a new item into learning at step 0
  const fresh = recall(createState('u01-l01-i03', T0), 'wrong', T0);
  assert.equal(fresh.phase, 'learning');
  assert.equal(fresh.correctInSession, 0);
  assert.equal(fresh.step, 0);
  assert.equal(fresh.due, T0 + LEARNING_STEPS_MS[0]);
});

test('slip rates Hard and still counts as a correct step', () => {
  let s = createState('u01-l01-i04', T0);
  s = recall(s, 'slip', T0);
  assert.equal(s.phase, 'learning');
  assert.equal(s.correctInSession, 1);
  assert.equal(s.step, 1);
  s = recall(s, 'correct', s.due);
  const t3 = s.due;
  const bySlip = recall(s, 'slip', t3);
  const byCorrect = recall(s, 'correct', t3);
  assert.equal(bySlip.phase, 'review');
  assert.equal(byCorrect.phase, 'review');
  // Hard gives a harder and less stable card than Good, so an earlier review
  assert.ok(bySlip.card.difficulty > byCorrect.card.difficulty);
  assert.ok(bySlip.card.stability < byCorrect.card.stability);
  assert.equal(bySlip.due, startOfNextLocalDay(t3, TZ), 'graduation by a slip is due the next day too');
  assert.equal(bySlip.due, byCorrect.due);
  // in review a slip keeps the item in review and strengthens the memory less than a correct answer
  const t = byCorrect.due + 9 * HOUR;
  const slipped = recall(byCorrect, 'slip', t);
  const recalled = recall(byCorrect, 'correct', t);
  assert.equal(slipped.phase, 'review');
  assert.equal(recalled.phase, 'review');
  assert.ok(slipped.card.stability > byCorrect.card.stability, 'a slip still strengthens the memory');
  assert.ok(slipped.card.stability < recalled.card.stability);
  assert.ok(slipped.due <= recalled.due);
  assert.equal(slipped.lapses, 0);
  assert.equal(slipped.correctInSession, 1);
});

test('wrong in review lapses, correct in lapsed returns to review', () => {
  const g = graduated();
  const t = g.due + 9 * HOUR;   // the morning of the due day
  const lapsed = recall(g, 'wrong', t);
  assert.equal(lapsed.phase, 'lapsed');
  assert.equal(lapsed.lapses, 1);
  assert.equal(lapsed.step, 0);
  assert.equal(lapsed.correctInSession, 0);
  assert.equal(lapsed.due, t + RELEARNING_STEPS_MS[0]);
  assert.ok(lapsed.card.stability < g.card.stability, 'Again lowers stability');
  assert.ok(lapsed.card.difficulty > g.card.difficulty, 'Again raises difficulty');
  assert.equal(lapsed.card.lapses, 1);
  assert.equal(lapsed.card.reps, 2);
  assert.ok(retrievability(lapsed, t + DAY) < 1, 'a lapsed item keeps its FSRS retrievability');
  // missing the relearning step again keeps the item in relearning without another lapse
  const failed = recall(lapsed, 'wrong', lapsed.due);
  assert.equal(failed.phase, 'lapsed');
  assert.equal(failed.lapses, 1);
  assert.equal(failed.due, lapsed.due + RELEARNING_STEPS_MS[0]);
  assert.deepEqual(failed.card, lapsed.card, 'relearning steps do not touch the FSRS card');
  // a successful recall returns the item to review, due on the day FSRS set when it lapsed
  const back = recall(failed, 'correct', failed.due);
  assert.equal(back.phase, 'review');
  assert.equal(back.step, 0);
  assert.equal(back.lapses, 1);
  assert.deepEqual(back.card, lapsed.card);
  assert.equal(back.due, startOfLocalDay(back.due, TZ));
  assert.equal(localDateKey(back.due, TZ), localDateKey(lapsed.card.due, TZ));
  assert.ok(back.due >= startOfNextLocalDay(failed.due, TZ));
  assert.deepEqual(back.masterySessions, [], 'relearning is not a mastery session');
  assert.equal(back.correctInSession, 1);
  assert.equal(recall(failed, 'slip', failed.due).phase, 'review', 'a slip also ends relearning');
});

test('mastered after correct recalls on three distinct later days, never revoked', () => {
  const g = graduated();                                       // graduated on 5 January
  const day = (n, hour = 9) => Date.UTC(2026, 0, 5 + n, hour, 0);
  // another correct answer on the graduation day is not a later session
  assert.deepEqual(recall(g, 'correct', day(0, 15)).masterySessions, []);
  let s = recall(g, 'correct', day(1));
  assert.deepEqual(s.masterySessions, ['2026-01-06']);
  s = recall(s, 'correct', day(1, 18));                        // the same day again: no new session
  assert.deepEqual(s.masterySessions, ['2026-01-06']);
  s = recall(s, 'slip', day(3));                               // a slip is a successful recall
  assert.deepEqual(s.masterySessions, ['2026-01-06', '2026-01-08']);
  assert.equal(s.mastered, false);
  s = recall(s, 'correct', day(4));
  assert.deepEqual(s.masterySessions, ['2026-01-06', '2026-01-08', '2026-01-09']);
  assert.equal(s.masterySessions.length, MASTERY_SESSIONS);
  assert.equal(s.mastered, true);
  // a lapse keeps the flag, and so does everything after it
  const lapsed = recall(s, 'wrong', day(7));
  assert.equal(lapsed.phase, 'lapsed');
  assert.equal(lapsed.mastered, true);
  const back = recall(lapsed, 'correct', lapsed.due);
  assert.equal(back.mastered, true);
  const later = recall(back, 'correct', day(12));
  assert.equal(later.mastered, true);
  assert.equal(later.masterySessions.length, MASTERY_SESSIONS, 'the list stops at mastery');
});

test('recalls at 23:58 and 00:05 local count as different mastery sessions', () => {
  const g = graduated(Date.UTC(2026, 10, 6, 9, 0));            // graduated on 6 November
  const late = Date.UTC(2026, 10, 8, 22, 58);                   // 23:58 in Berlin, 8 November
  const early = Date.UTC(2026, 10, 8, 23, 5);                   // 00:05 in Berlin, 9 November
  assert.equal(localDateKey(late, 'UTC'), localDateKey(early, 'UTC'), 'the two instants share a UTC day');
  let s = recall(g, 'correct', late);
  assert.deepEqual(s.masterySessions, ['2026-11-08']);
  s = recall(s, 'correct', early);
  assert.deepEqual(s.masterySessions, ['2026-11-08', '2026-11-09']);
  assert.equal(s.sessionKey, '2026-11-09');
  assert.equal(s.correctInSession, 1, 'the session counter restarted with the new local day');
  s = recall(s, 'correct', Date.UTC(2026, 10, 9, 23, 5));      // 00:05 on 10 November
  assert.equal(s.mastered, true);
  // counted in UTC the two recalls would be one session
  const utc = recordRecall(recordRecall(g, 'correct', late, S, 'UTC'), 'correct', early, S, 'UTC');
  assert.deepEqual(utc.masterySessions, ['2026-11-08']);
});

test('skipAheadState is review with a seven day stability', () => {
  const s = skipAheadState('u02-l01-i01', T0);
  assert.equal(s.itemId, 'u02-l01-i01');
  assert.equal(s.phase, 'review');
  assert.equal(s.card.stability, 7);
  assert.equal(s.card.state, State.Review);
  assert.equal(s.card.scheduled_days, 7);
  assert.equal(s.card.due, T0 + 7 * DAY);
  assert.equal(s.card.last_review, T0);
  assert.ok(s.card.difficulty >= 1 && s.card.difficulty <= 10);
  assert.equal(s.due, T0 + 7 * DAY);
  assert.ok(!isDue(s, T0) && isDue(s, s.due));
  assert.equal(s.mastered, false);
  assert.deepEqual(s.masterySessions, []);
  assert.equal(s.lastReview, T0);
  assert.equal(s.reps, 1);
  assert.equal(s.lapses, 0);
  // FSRS-6 is calibrated so that retrievability is 0.9 after one stability
  assert.equal(retrievability(s, T0), 1);
  assert.ok(Math.abs(retrievability(s, T0 + 7 * DAY) - 0.9) < 1e-6);
  // the first review after a skip ahead is a normal review and a first mastery session
  const r = recall(s, 'correct', s.due + HOUR);
  assert.equal(r.phase, 'review');
  assert.ok(r.card.stability > 7);
  assert.deepEqual(r.masterySessions, [localDateKey(s.due + HOUR, TZ)]);
});

test('a new local day is a new session: learning progress and the session counter restart', () => {
  let s = createState('u01-l01-i05', T0);
  s = recall(s, 'correct', T0);
  s = recall(s, 'correct', s.due);
  assert.equal(s.correctInSession, 2);
  const nextDay = T0 + DAY;
  s = recall(s, 'correct', nextDay);
  assert.equal(s.phase, 'learning', 'two recalls yesterday do not carry over');
  assert.equal(s.sessionKey, '2026-01-06');
  assert.equal(s.correctInSession, 1);
  assert.equal(s.step, 1);
  assert.equal(s.due, nextDay + LEARNING_STEPS_MS[0]);
  // in review the counter counts the day's successful recalls and a miss resets it
  const g = graduated();
  const t = g.due + 9 * HOUR;
  let r = recall(g, 'correct', t);
  r = recall(r, 'slip', t + 20 * MINUTE);
  assert.equal(r.correctInSession, 2);
  r = recall(r, 'wrong', t + 40 * MINUTE);
  assert.equal(r.correctInSession, 0);
  assert.equal(recall(r, 'correct', t + DAY).correctInSession, 1);
});

test('the desired retention setting drives the review interval', () => {
  const g = graduated();
  const t = g.due + 9 * HOUR;
  const relaxed = recall(g, 'correct', t, { ...S, desiredRetention: 0.85 });
  const strict = recall(g, 'correct', t, { ...S, desiredRetention: 0.92 });
  assert.ok(relaxed.due > strict.due, 'a lower retention target waits longer');
  assert.equal(relaxed.card.stability, strict.card.stability, 'the memory model is the same, only the interval differs');
  assert.ok(retrievability(relaxed, relaxed.due) < retrievability(strict, strict.due));
});

test('recordRecall leaves its input untouched and rejects unknown results', () => {
  const g = graduated();
  const frozen = deepFreeze(structuredClone(g));
  const next = recordRecall(frozen, 'correct', g.due + HOUR, S, TZ);
  assert.notEqual(next, frozen);
  assert.deepEqual(frozen, g);
  assert.notEqual(next.card, frozen.card);
  assert.notEqual(next.masterySessions, frozen.masterySessions);
  assert.throws(() => recordRecall(g, 'maybe', T0, S, TZ), RangeError);
});

test('a slip right after a slip counts as a miss', () => {
  // learning: correct, slip (a success), slip (a miss) -> the steps start over
  let s = recall(createState('u01-l01-i06', T0), 'correct', T0);
  s = recall(s, 'slip', s.due);
  assert.equal(s.correctInSession, 2);
  assert.equal(s.step, 2);
  assert.equal(s.lastResult, 'slip');
  assert.equal(effectiveResult(s, 'slip'), 'wrong');
  assert.equal(effectiveResult(s, 'correct'), 'correct');
  assert.equal(effectiveResult(s, 'wrong'), 'wrong');
  const t = s.due;
  const missed = recall(s, 'slip', t);
  assert.equal(missed.phase, 'learning');
  assert.equal(missed.correctInSession, 0);
  assert.equal(missed.step, 0);
  assert.equal(missed.due, t + LEARNING_STEPS_MS[0]);
  assert.equal(missed.card, null);
  assert.equal(missed.lastResult, 'slip', 'the raw result is what the state records');
  assert.equal(effectiveResult(missed, 'slip'), 'wrong', 'so a third slip in a row is a miss as well');
  // a fresh item, or one stored before lastResult existed: a first slip is a slip
  const fresh = createState('u01-l01-i07', T0);
  assert.equal(fresh.lastResult, null);
  assert.equal(effectiveResult(fresh, 'slip'), 'slip');
  assert.equal(effectiveResult({ ...fresh, lastResult: undefined }, 'slip'), 'slip');
  assert.equal(effectiveResult(fresh, 'correct'), 'correct');
  assert.equal(effectiveResult(fresh, 'wrong'), 'wrong');
  // review: slip then slip lapses the item, rated Again
  const g = graduated();
  const t1 = g.due + 9 * HOUR;
  const once = recall(g, 'slip', t1);
  assert.equal(once.phase, 'review');
  assert.equal(once.lapses, 0);
  assert.equal(once.correctInSession, 1);
  const twice = recall(once, 'slip', t1 + 20 * MINUTE);
  assert.equal(twice.phase, 'lapsed');
  assert.equal(twice.lapses, 1);
  assert.equal(twice.correctInSession, 0);
  assert.equal(twice.due, t1 + 20 * MINUTE + RELEARNING_STEPS_MS[0]);
  assert.equal(twice.card.lapses, 1);
  assert.ok(twice.card.stability < once.card.stability, 'rated Again, not Hard');
  // the streak belongs to the item, not to the day: a slip the day after a slip is a miss too
  assert.equal(recall(once, 'slip', t1 + DAY).phase, 'lapsed');
});

test('a correct recall clears the slip streak and lastResult records the raw result', () => {
  let s = createState('u01-l01-i08', T0);
  assert.equal(s.lastResult, null);
  s = recall(s, 'slip', T0);
  assert.equal(s.lastResult, 'slip');
  assert.equal(s.correctInSession, 1);
  s = recall(s, 'correct', s.due);
  assert.equal(s.lastResult, 'correct');
  assert.equal(s.correctInSession, 2);
  assert.equal(effectiveResult(s, 'slip'), 'slip', 'the correct answer cleared the streak');
  const t3 = s.due;
  s = recall(s, 'slip', t3);
  assert.equal(s.lastResult, 'slip');
  assert.equal(s.correctInSession, GRADUATE_AFTER, 'the last slip is a success');
  assert.equal(s.phase, 'review');
  assert.equal(s.due, startOfNextLocalDay(t3, TZ));
  // a miss is recorded as given and clears the streak as well
  const w = recall(graduated(), 'wrong', T0 + DAY);
  assert.equal(w.lastResult, 'wrong');
  assert.equal(effectiveResult(w, 'slip'), 'slip');
  // a skip-ahead state starts without a last result
  assert.equal(skipAheadState('u02-l01-i01', T0).lastResult, null);
});
