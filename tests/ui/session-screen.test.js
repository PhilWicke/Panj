// tests/ui/session-screen.test.js
// The pure parts of the session screen and its feedback: the run-time queue re-queues a missed
// typed recall after the next two entries (Ruling 22); one function turns a recall into the next
// state, rules through skipAheadState on a correct quick check (Ruling 21) and slips through
// effectiveResult (Ruling 17); a speaking round keeps the planned speaking entries with speech on
// and otherwise speaks up to five review-phase items; a slip names its letters (Ruling 19). The
// course position (currentLesson, todayTotals) is tested in tests/engine/course.test.js. Through
// tests/helpers/fake-dom.js and fake exercises, the screen itself: a provisional SessionRecord
// after each settled entry, finalised under the same id when the run ends, nothing for a run
// without a settled entry (Ruling 78); the closing menu offers three more minutes only when the
// round would have content and the more run plays that round (Ruling 80); with nothing able to
// play, the queue is built muted (Ruling 81), while the exercises keep the learner's own mute
// (Ruling 94).
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../helpers/fake-dom.js';
import { DEFAULT_SETTINGS, createState, recordRecall, skipAheadState } from '../../app/js/engine/scheduler.js';
import { createMemoryStore } from '../../app/js/store/memory.js';
import { DEFAULT_APP_SETTINGS } from '../../app/js/store/state.js';
import { register } from '../../app/js/ui/exercises/registry.js';
import { renderSession, requeue, retryEntry, stateAfterRecall, speakingQueue } from '../../app/js/ui/screens/session.js';
import { mindThe } from '../../app/js/ui/components/feedback.js';

const TZ = 'Europe/Berlin';
const MINUTE = 60_000;
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5, 9, 0);   // Monday 5 January 2026, 10:00 in Berlin
const S = DEFAULT_SETTINGS;

/** @type {ReturnType<typeof installFakeDom>} */
let document;
/** The entries the fake exercises were asked to render, in order. @type {any[]} */
const shown = [];
/** The context each of those entries was rendered with, in the same order. @type {any[]} */
const contexts = [];
/** Resolves the exercise showing. @type {((outcome: any) => void)|null} */
let finish = null;
/** A fake exercise: it notes its entry and context and waits for the test to answer it. @type {any} */
const waitingExercise = (/** @type {any} */ container, /** @type {any} */ entry, /** @type {any} */ ctx) => new Promise((resolve) => {
  shown.push(entry);
  contexts.push(ctx);
  finish = resolve;
});

before(() => {
  document = installFakeDom();
  Object.defineProperty(globalThis, 'location', { value: { hash: '', replace() {} }, configurable: true, writable: true });
  for (const kind of /** @type {const} */ (['typed_en_sl', 'listening', 'perception'])) register(kind, waitingExercise);
});

beforeEach(() => {
  shown.length = 0;
  contexts.length = 0;
  finish = null;
});

/** Every element under `root`, depth first. @param {any} root @returns {any[]} */
function elements(root) {
  /** @type {any[]} */
  const found = [];
  /** @param {any} node */
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (!child.tagName) continue;
      found.push(child);
      walk(child);
    }
  };
  walk(root);
  return found;
}

/** The button under `root` that reads `text`. @param {any} root @param {string} text */
const button = (root, text) => elements(root).find((el) => el.tagName === 'BUTTON' && el.textContent === text);
/** The session's progress bar. @param {any} root */
const progressbar = (root) => elements(root).find((el) => el.getAttribute('role') === 'progressbar');
/** Lets the screen's handlers, and the store promises they wait on, finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
/** Answers the exercise showing and lets the screen settle. @param {any} outcome */
async function answer(outcome) {
  const done = finish;
  finish = null;
  assert.ok(done, 'an exercise is showing');
  done(outcome);
  await settle();
}

const NOW = Date.now();
/** A review-phase item due a day ago. @param {string} id */
const due = (id) => skipAheadState(id, NOW - 8 * DAY);
/** A review-phase item due in six days. @param {string} id */
const later = (id) => skipAheadState(id, NOW - DAY);
/** @param {any[]} list */
const byId = (...list) => Object.fromEntries(list.map((s) => [s.itemId, s]));

/**
 * An app over a memory store with the states given, every one of them known and with content,
 * no lesson, and a player that reports `audio`.
 * @param {{ states: Record<string, any>, settings?: Record<string, unknown>, audio?: boolean }} parts
 */
function sessionApp({ states, settings = {}, audio = false }) {
  const ids = Object.keys(states);
  return /** @type {any} */ ({
    adapter: createMemoryStore(),
    persistent: true,
    state: { items: states, sessions: [], settings: { ...DEFAULT_APP_SETTINGS, mute: true, onboarded: true, ...settings }, flags: [], meta: { schemaVersion: 1, createdAt: T0 } },
    index: { version: 't', mode: 'dev', generated: '', units: [], rules: [], lessonIndex: [], counts: { scheduledItems: ids.length, lemmasMet: 0 } },
    units: [],
    known: new Set(ids),
    items: new Map(ids.map((id) => [id, { item: { id, type: 'chunk', sl: `sl ${id}`, en: `en ${id}`, register: 'neutral', examples: [] }, lesson: null }])),
    lessons: new Map(),
    rules: new Map(),
    allowPending: false,
    player: { play: async () => 'none', stop() {}, setMute() {}, setVoice() {}, audioAvailable: async () => audio },
  });
}

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

test('the screen writes a provisional record after each settled entry and finalises the same id when the run ends (Ruling 78)', async () => {
  const app = sessionApp({ states: byId(due('u01-l01-i01'), due('u01-l01-i02')) });
  const container = /** @type {any} */ (document.createElement('main'));
  renderSession(container, app);
  await settle();
  assert.deepEqual(await app.adapter.getAll('sessions'), [], 'nothing is written before an entry settles');
  assert.equal(shown.length, 1);
  assert.equal(shown[0].kind, 'typed_en_sl');
  assert.equal(progressbar(container).getAttribute('aria-valuemax'), '2');

  await answer({ itemId: shown[0].itemId, recall: 'correct' });
  const provisional = await app.adapter.getAll('sessions');
  assert.equal(provisional.length, 1, 'exactly one session in the store');
  const [record] = provisional;
  assert.match(record.id, /^\d+-[0-9a-f-]{36}$/, 'the id of the run');
  assert.equal(record.recalls, 1);
  assert.equal(record.correct, 1);
  assert.equal(record.honey, 1);
  assert.equal(record.newItems, 0);
  assert.deepEqual(record.kinds, { typed_en_sl: 1 });
  assert.ok(record.startedAt >= NOW && record.endedAt >= record.startedAt, 'the times of this run');
  assert.ok(record.minutes >= 0 && record.minutes < 1, 'credited time so far');
  assert.deepEqual(app.state.sessions.map((s) => s.id), [record.id], 'the in-memory list holds it once');
  assert.equal(shown.length, 2, 'the second entry is showing');

  // the learner ends the run: the same id is finalised, not a second row
  button(container, 'End').dispatch('click');
  await settle();
  const final = await app.adapter.getAll('sessions');
  assert.equal(final.length, 1, 'one session still');
  assert.equal(final[0].id, record.id);
  assert.equal(final[0].recalls, 1);
  assert.ok(final[0].endedAt >= record.endedAt);
  assert.deepEqual(app.state.sessions.map((s) => s.id), [record.id], 'and once in memory');
  assert.deepEqual(app.state.sessions[0], final[0]);
});

test('a run with no settled entry writes nothing, when ended or when the screen is left', async () => {
  const app = sessionApp({ states: byId(due('u01-l01-i01')) });
  const container = /** @type {any} */ (document.createElement('main'));
  renderSession(container, app);
  await settle();
  assert.equal(shown.length, 1);
  button(container, 'End').dispatch('click');
  await settle();
  assert.deepEqual(await app.adapter.getAll('sessions'), []);
  assert.deepEqual(app.state.sessions, []);

  const other = sessionApp({ states: byId(due('u01-l01-i01')) });
  const leave = renderSession(/** @type {any} */ (document.createElement('main')), other);
  await settle();
  leave();
  await settle();
  assert.deepEqual(await other.adapter.getAll('sessions'), []);
});

test('the closing menu offers three more minutes only when the round has content, and the more run plays it (Ruling 80)', async () => {
  // one due item and one review item the run does not touch: a round of one
  const app = sessionApp({ states: byId(due('u01-l01-i01'), later('u01-l01-i02')) });
  const container = /** @type {any} */ (document.createElement('main'));
  renderSession(container, app);
  await settle();
  assert.deepEqual(shown.map((e) => e.itemId), ['u01-l01-i01'], 'the due item only; the other is not due');
  await answer({ itemId: 'u01-l01-i01', recall: 'correct' });
  const menu = container.querySelector('.closing-menu');
  assert.ok(menu, 'the closing menu is showing');
  assert.deepEqual(elements(menu).filter((el) => el.tagName === 'BUTTON').map((el) => el.textContent), ['Stop here', 'Three more minutes']);
  assert.equal((await app.adapter.getAll('sessions')).length, 1, 'the run is recorded once');

  // the more run: a new run over the round, with its own record
  shown.length = 0;
  renderSession(container, app, { mode: 'more' });
  await settle();
  assert.deepEqual(shown, [{ kind: 'typed_en_sl', itemId: 'u01-l01-i02' }], 'the review item the run before did not practise');
  assert.equal(progressbar(container).getAttribute('aria-valuemax'), '1');
  await answer({ itemId: 'u01-l01-i02', recall: 'correct' });
  const sessions = await app.adapter.getAll('sessions');
  assert.equal(sessions.length, 2, 'its own SessionRecord');
  assert.notEqual(sessions[0].id, sessions[1].id);

  // every review item practised and nothing missed: no round, so no option
  const done = sessionApp({ states: byId(due('u01-l01-i01')) });
  const second = /** @type {any} */ (document.createElement('main'));
  shown.length = 0;
  renderSession(second, done);
  await settle();
  await answer({ itemId: 'u01-l01-i01', recall: 'correct' });
  assert.deepEqual(elements(second.querySelector('.closing-menu')).filter((el) => el.tagName === 'BUTTON').map((el) => el.textContent), ['Stop here']);

  // the one item missed: it comes back through the misses, so the option is offered
  const missed = sessionApp({ states: byId(due('u01-l01-i01')) });
  const third = /** @type {any} */ (document.createElement('main'));
  shown.length = 0;
  renderSession(third, missed);
  await settle();
  await answer({ itemId: 'u01-l01-i01', recall: 'wrong' });
  assert.equal(shown.length, 2, 'the missed recall is played again');
  await answer({ itemId: 'u01-l01-i01', recall: 'correct' });
  assert.deepEqual(elements(third.querySelector('.closing-menu')).filter((el) => el.tagName === 'BUTTON').map((el) => el.textContent), ['Stop here', 'Three more minutes']);
});

test('with no recording and no device voice the queue is built muted: no listening or perception entry (Ruling 81)', async () => {
  const silent = sessionApp({ states: byId(due('u01-l01-i01')), settings: { mute: false }, audio: false });
  const container = /** @type {any} */ (document.createElement('main'));
  renderSession(container, silent);
  await settle();
  assert.equal(progressbar(container).getAttribute('aria-valuemax'), '1', 'the recall alone');
  await answer({ itemId: 'u01-l01-i01', recall: 'correct' });
  assert.deepEqual(shown.map((e) => e.kind), ['typed_en_sl']);
  const options = elements(container.querySelector('.closing-menu')).filter((el) => el.tagName === 'BUTTON').map((el) => el.textContent);
  assert.ok(!options.includes('A speaking round'), 'the menu follows the same mode');

  const sound = sessionApp({ states: byId(due('u01-l01-i01')), settings: { mute: false }, audio: true });
  const other = /** @type {any} */ (document.createElement('main'));
  shown.length = 0;
  renderSession(other, sound);
  await settle();
  assert.equal(progressbar(other).getAttribute('aria-valuemax'), '3', 'with audio: the recall, a listening entry and the perception drill');
  assert.deepEqual(shown.map((e) => e.kind), ['typed_en_sl']);

  const chosen = sessionApp({ states: byId(due('u01-l01-i01')), settings: { mute: true }, audio: true });
  const third = /** @type {any} */ (document.createElement('main'));
  renderSession(third, chosen);
  await settle();
  assert.equal(progressbar(third).getAttribute('aria-valuemax'), '1', 'the learner\'s mute stands whatever can play');
});

test('the exercises get the learner\'s own mute: the mute derived from no audio builds the queue only (Ruling 94)', async () => {
  const silent = sessionApp({ states: byId(due('u01-l01-i01')), settings: { mute: false }, audio: false });
  const container = /** @type {any} */ (document.createElement('main'));
  renderSession(container, silent);
  await settle();
  assert.equal(progressbar(container).getAttribute('aria-valuemax'), '1', 'no listening and no perception entry');
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].mode.mute, false, 'Listen shows and host lines are tried');
  assert.equal(contexts[0].mode.speech, silent.state.settings.speech, 'the rest of the mode as built');
  await answer({ itemId: 'u01-l01-i01', recall: 'correct' });
  assert.deepEqual(shown.map((e) => e.kind), ['typed_en_sl']);

  const chosen = sessionApp({ states: byId(due('u01-l01-i01')), settings: { mute: true }, audio: true });
  const other = /** @type {any} */ (document.createElement('main'));
  shown.length = 0;
  contexts.length = 0;
  renderSession(other, chosen);
  await settle();
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].mode.mute, true, 'the learner\'s mute reaches the exercises');
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
