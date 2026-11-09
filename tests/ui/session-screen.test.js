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
// (Ruling 94). The sitting's quiet choices: a run built while one holds leaves out what it drops;
// "Can't listen right now" beside an audio exercise skips it without a miss and prunes the rest,
// beside a meet draws the meet again without sound, and silences every context of the sitting;
// the Quiet control in the session bar holds both choices and reads "Quiet on" while one holds;
// a dialogue on screen stays as it is after "Can't listen right now", its host lines silent; a
// speaker's voice reaches the player until that choice is made; a run
// whose every entry a choice skipped says nothing was practised, with no minutes; the closing menu
// offers "Can't talk right now" after "A speaking round", and a draw a choice leaves behind cannot
// draw over the screen after it. The closing screen of a unit's last lesson (its consolidation lesson at the
// unit's lessonCount, or the role alone without one) offers the unit's checkpoint between the
// summary and the menu once the run has met the lesson's last item, and keeps it when "Can't talk
// right now" draws the menu again; an earlier lesson's closing screen does not.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../helpers/fake-dom.js';
import { elements } from '../helpers/dom-query.js';
import { acceptedChunk } from '../helpers/items.js';
import { DEFAULT_SETTINGS, createState, recordRecall, skipAheadState } from '../../app/js/engine/scheduler.js';
import { createMemoryStore } from '../../app/js/store/memory.js';
import { DEFAULT_APP_SETTINGS } from '../../app/js/store/state.js';
import { register } from '../../app/js/ui/exercises/registry.js';
import { chooseQuiet, quietChoices, resetQuiet } from '../../app/js/ui/quiet.js';
import { pruneQueue, renderSession, requeue, retryEntry, stateAfterRecall, speakingQueue } from '../../app/js/ui/screens/session.js';
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
/** The element each of those entries was rendered into, in the same order. @type {any[]} */
const hosts = [];
/** Resolves the exercise showing. @type {((outcome: any) => void)|null} */
let finish = null;
/** How often the player was asked to play. */
let plays = 0;
/** A fake exercise: it notes its entry, context and element and waits for the test to answer it. @type {any} */
const waitingExercise = (/** @type {any} */ container, /** @type {any} */ entry, /** @type {any} */ ctx) => new Promise((resolve) => {
  shown.push(entry);
  contexts.push(ctx);
  hosts.push(container);
  finish = resolve;
});

before(() => {
  document = installFakeDom();
  Object.defineProperty(globalThis, 'location', { value: { hash: '', replace() {} }, configurable: true, writable: true });
  for (const kind of /** @type {const} */ (['typed_en_sl', 'listening', 'perception', 'meet', 'speaking', 'dialogue'])) register(kind, waitingExercise);
});

beforeEach(() => {
  shown.length = 0;
  contexts.length = 0;
  hosts.length = 0;
  finish = null;
  plays = 0;
  resetQuiet();
});

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
    player: player(audio),
  });
}

/** A player that reports `audio` and counts its plays. @param {boolean} audio */
const player = (audio) => ({ play: async () => { plays += 1; return 'none'; }, stop() {}, setMute() {}, setVoice() {}, audioAvailable: async () => audio });

const UNIT = { id: 'u01', order: 1, title_sl: 'Prvi stik', title_en: 'First contact', motif: 'flower', lessonCount: 5, lessons: ['u01-l01'] };
/** One lesson of two accepted items, with no rules, structured, production or dialogue. */
const LESSON = {
  id: 'u01-l01', unit: 'u01', order: 1, title_sl: 'Prvi pozdrav', title_en: 'First hello', rules: [], structured: [], production: [],
  items: [acceptedChunk('u01-l01-i01', 'Dober dan.', 'Good day.'), acceptedChunk('u01-l01-i02', 'Hvala.', 'Thank you.')],
};

/**
 * An app over a memory store with the one lesson and no states, as sessionApp otherwise: the
 * session meets the lesson's items.
 * @param {{ settings?: Record<string, unknown>, audio?: boolean }} parts
 */
function lessonApp({ settings = {}, audio = false }) {
  const ids = LESSON.items.map((item) => item.id);
  return /** @type {any} */ ({
    adapter: createMemoryStore(),
    persistent: true,
    state: { items: {}, sessions: [], settings: { ...DEFAULT_APP_SETTINGS, mute: true, onboarded: true, ...settings }, flags: [], meta: { schemaVersion: 1, createdAt: T0 } },
    index: {
      version: 't', mode: 'dev', generated: '', units: [UNIT], rules: [], counts: { scheduledItems: ids.length, lemmasMet: 0 },
      lessonIndex: [{ id: LESSON.id, unit: 'u01', order: 1, title_sl: LESSON.title_sl, title_en: LESSON.title_en, itemCount: ids.length }],
    },
    units: [{ unit: UNIT, lessons: [LESSON] }],
    known: new Set(ids),
    items: new Map(LESSON.items.map((item) => [item.id, { item, lesson: LESSON }])),
    lessons: new Map([[LESSON.id, LESSON]]),
    rules: new Map(),
    allowPending: false,
    player: player(audio),
  });
}

/**
 * An app over a memory store with one unit u01 of `lessonCount` lessons whose one bundled lesson,
 * u01-l0<order>, sits at that order with that role and holds `items` accepted items
 * u01-l0<order>-i0<k>, and no states; otherwise as lessonApp.
 * @param {{ order: number, role: string, lessonCount?: number, items?: number, settings?: Record<string, unknown>, audio?: boolean }} parts
 */
function unitEndApp({ order, role, lessonCount, items = 1, settings = {}, audio = false }) {
  const lessonId = `u01-l0${order}`;
  const unit = { ...UNIT, lessonCount, lessons: [lessonId] };
  const lesson = {
    id: lessonId, unit: 'u01', order, role, title_sl: `Lekcija ${order}`, title_en: `Lesson ${order}`, rules: [], structured: [], production: [],
    items: Array.from({ length: items }, (_, k) => acceptedChunk(`${lessonId}-i0${k + 1}`, `sl ${lessonId}-i0${k + 1}`, `en ${lessonId}-i0${k + 1}`)),
  };
  const ids = lesson.items.map((item) => item.id);
  return /** @type {any} */ ({
    adapter: createMemoryStore(),
    persistent: true,
    state: { items: {}, sessions: [], settings: { ...DEFAULT_APP_SETTINGS, mute: true, onboarded: true, ...settings }, flags: [], meta: { schemaVersion: 1, createdAt: T0 } },
    index: {
      version: 't', mode: 'dev', generated: '', units: [unit], rules: [], counts: { scheduledItems: ids.length, lemmasMet: 0 },
      lessonIndex: [{ id: lessonId, unit: 'u01', order, title_sl: lesson.title_sl, title_en: lesson.title_en, itemCount: ids.length }],
    },
    units: [{ unit, lessons: [lesson] }],
    known: new Set(ids),
    items: new Map(lesson.items.map((item) => [item.id, { item, lesson }])),
    lessons: new Map([[lessonId, lesson]]),
    rules: new Map(),
    allowPending: false,
    player: player(audio),
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

test('pruneQueue removes the dropped kinds after the entry on screen and counts them', () => {
  const q = [typed('a'), { kind: 'listening', itemId: 'b' }, typed('c'), { kind: 'perception' }, { kind: 'speaking', itemId: 'd' }];
  assert.equal(pruneQueue(q, 1, new Set(['listening', 'perception'])), 2);
  assert.deepEqual(q.map((e) => e.kind), ['typed_en_sl', 'typed_en_sl', 'speaking']);
  assert.equal(pruneQueue(q, 0, new Set()), 0);
});

test("a meet on screen is drawn again without sound after \"Can't listen right now\"", async () => {
  const app = lessonApp({ settings: { mute: false }, audio: true });
  const container = /** @type {any} */ (document.createElement('main'));
  renderSession(container, app);
  await settle();
  assert.equal(shown[0].kind, 'meet');
  assert.equal(contexts[0].mode.mute, false);
  button(container.querySelector('.quiet-offer'), "Can't listen right now").dispatch('click');
  await settle();
  assert.deepEqual(shown.map((e) => e.kind), ['meet', 'meet'], 'drawn again');
  assert.equal(contexts[1].mode.mute, true, 'Listen hides');
  assert.equal(button(container.querySelector('.quiet-offer'), "Can't listen right now"), undefined, 'the offer is gone');
  assert.equal(quietChoices().cantListen, true);
});

test('a stale exercise context plays nothing once the learner cannot listen', async () => {
  const app = lessonApp({ settings: { mute: false }, audio: true });
  const container = /** @type {any} */ (document.createElement('main'));
  renderSession(container, app);
  await settle();
  button(container.querySelector('.quiet-offer'), "Can't listen right now").dispatch('click');
  await settle();
  const before = plays;
  assert.equal(await contexts[0].play('Dober dan.'), 'none');
  assert.equal(await contexts[1].play('Dober dan.'), 'none');
  assert.equal(plays, before, 'the player was not called');
});

test("\"Can't listen right now\" beside a listening exercise skips it with no miss and drops perception", async () => {
  const app = sessionApp({ states: byId(due('u01-l01-i01')), settings: { mute: false }, audio: true });
  const container = /** @type {any} */ (document.createElement('main'));
  renderSession(container, app);
  await settle();
  assert.equal(container.querySelector('.quiet-offer').textContent, '', 'no offer beside a typed recall');
  await answer({ itemId: 'u01-l01-i01', recall: 'correct' });
  assert.equal(shown[1].kind, 'listening');
  button(container.querySelector('.quiet-offer'), "Can't listen right now").dispatch('click');
  await settle();
  assert.deepEqual(shown.map((e) => e.kind), ['typed_en_sl', 'listening'], 'no perception drill');
  assert.ok(container.querySelector('.closing-menu'));
  const record = app.state.sessions.at(-1);
  assert.deepEqual([record.kinds, record.recalls, record.correct], [{ typed_en_sl: 1 }, 1, 1]);
});

test('a run started while a choice holds builds without the dropped kinds, until resetQuiet', async () => {
  chooseQuiet('listen');
  const second = /** @type {any} */ (document.createElement('main'));
  renderSession(second, sessionApp({ states: byId(due('u01-l01-i01')), settings: { mute: false }, audio: true }));
  await settle();
  assert.equal(progressbar(second).getAttribute('aria-valuemax'), '1', 'no listening or perception entry');
  resetQuiet();
  const third = /** @type {any} */ (document.createElement('main'));
  renderSession(third, sessionApp({ states: byId(due('u01-l01-i01')), settings: { mute: false }, audio: true }));
  await settle();
  assert.equal(progressbar(third).getAttribute('aria-valuemax'), '3');
});

test('the Quiet control holds both choices, pressed once chosen, listening pressed under the learner\'s mute', async () => {
  const container = /** @type {any} */ (document.createElement('main'));
  renderSession(container, sessionApp({ states: byId(due('u01-l01-i01')), settings: { mute: false }, audio: true }));
  await settle();
  const quiet = button(container.querySelector('.session-bar'), 'Quiet');
  quiet.dispatch('click');
  assert.equal(quiet.getAttribute('aria-expanded'), 'true');
  const panel = container.querySelector('.quiet-panel');
  assert.equal(panel.hidden, false);
  const [listen, talk] = elements(panel).filter((e) => e.tagName === 'BUTTON');
  assert.deepEqual([listen.textContent, talk.textContent], ["Can't listen right now", "Can't talk right now"]);
  assert.deepEqual([listen.getAttribute('aria-pressed'), talk.getAttribute('aria-pressed')], ['false', 'false']);
  talk.dispatch('click');
  talk.dispatch('click');
  assert.deepEqual([talk.getAttribute('aria-pressed'), talk.getAttribute('aria-disabled')], ['true', 'true']);
  assert.deepEqual(quietChoices(), { cantListen: false, cantTalk: true });
  assert.ok(elements(panel).some((e) => e.textContent === 'Lasts until you leave the session.'));
  resetQuiet();
  const muted = /** @type {any} */ (document.createElement('main'));
  renderSession(muted, sessionApp({ states: byId(due('u01-l01-i01')), settings: { mute: true }, audio: true }));
  await settle();
  const mutedListen = elements(muted.querySelector('.quiet-panel')).find((e) => e.textContent === "Can't listen right now");
  assert.deepEqual([mutedListen.getAttribute('aria-pressed'), mutedListen.getAttribute('aria-disabled')], ['true', 'true']);
});

test('the session bar\'s Quiet toggle reads "Quiet on", pressed, while a choice holds, and "Quiet" otherwise', async () => {
  for (const label of ["Can't listen right now", "Can't talk right now"]) {
    resetQuiet();
    const container = /** @type {any} */ (document.createElement('main'));
    renderSession(container, sessionApp({ states: byId(due('u01-l01-i01')), settings: { mute: false }, audio: true }));
    await settle();
    const toggle = container.querySelector('.session-quiet');
    assert.deepEqual([toggle.textContent, toggle.classList.contains('is-on')], ['Quiet', false], 'a new sitting');
    toggle.dispatch('click');
    button(container.querySelector('.quiet-panel'), label).dispatch('click');
    await settle();
    assert.deepEqual([toggle.textContent, toggle.classList.contains('is-on')], ['Quiet on', true], label);
    assert.deepEqual([toggle.getAttribute('aria-expanded'), toggle.getAttribute('aria-controls')], ['true', 'session-quiet-panel'], 'still the panel\'s disclosure');
    const next = /** @type {any} */ (document.createElement('main'));
    renderSession(next, sessionApp({ states: byId(due('u01-l01-i01')), settings: { mute: false }, audio: true }));
    await settle();
    assert.equal(next.querySelector('.session-quiet').textContent, 'Quiet on', `${label}: a later run of the sitting starts on`);
  }
  resetQuiet();
  const muted = /** @type {any} */ (document.createElement('main'));
  renderSession(muted, sessionApp({ states: byId(due('u01-l01-i01')), settings: { mute: true }, audio: true }));
  await settle();
  const toggle = muted.querySelector('.session-quiet');
  assert.deepEqual([toggle.textContent, toggle.classList.contains('is-on')], ['Quiet on', true], "the learner's mute holds from the start");
});

test("a run whose every entry a quiet choice skips says nothing was practised, with no minutes and no record", async () => {
  const app = sessionApp({ states: byId(later('u01-l01-i01'), later('u01-l01-i02')), settings: { mute: false }, audio: true });
  const container = /** @type {any} */ (document.createElement('main'));
  renderSession(container, app, { mode: 'speaking' });
  await settle();
  assert.equal(shown[0].kind, 'speaking');
  button(container.querySelector('.quiet-offer'), "Can't talk right now").dispatch('click');
  await settle();
  const closing = container.querySelector('.closing');
  assert.ok(closing.querySelector('.closing-menu'), 'the run closed');
  assert.equal(closing.querySelector('h2').textContent, 'Nothing practised this round.');
  assert.equal(closing.querySelector('.en-text'), null, 'no summary line');
  assert.doesNotMatch(closing.textContent, /about \d+ minute/i, 'no minutes');
  assert.deepEqual(await app.adapter.getAll('sessions'), [], 'no session record');
});

/** One lesson whose dialogue practises an item in review, its other item never met so the lesson is current, and no new item today. */
function dialogueApp() {
  const dialogue = {
    id: 'u01-l01-d', title_sl: 'Pogovor', title_en: 'Talk', setting_en: 'At the door.',
    lines: [
      { speaker: 'host', sl: 'Dober dan.', en: 'Good day.' },
      { speaker: 'you', sl: 'Dober dan.', en: 'Good day.', new_items: ['u01-l01-i01'] },
      { speaker: 'host', sl: 'Hvala.', en: 'Thank you.' },
    ],
  };
  const lesson = { ...LESSON, dialogue };
  const app = lessonApp({ settings: { mute: false, newPerDay: 0 }, audio: false });
  app.state.items = byId(later('u01-l01-i01'));
  app.units = [{ unit: UNIT, lessons: [lesson] }];
  app.lessons = new Map([[lesson.id, lesson]]);
  app.items = new Map(lesson.items.map((item) => [item.id, { item, lesson }]));
  return app;
}

test("a dialogue on screen stays as it is after \"Can't listen right now\", and its next host line plays nothing", async () => {
  const container = /** @type {any} */ (document.createElement('main'));
  renderSession(container, dialogueApp());
  await settle();
  assert.deepEqual(shown.map((e) => e.kind), ['dialogue']);
  assert.equal(contexts[0].mode.mute, false, 'host lines are played');
  button(container.querySelector('.session-bar'), 'Quiet').dispatch('click');
  button(container.querySelector('.quiet-panel'), "Can't listen right now").dispatch('click');
  await settle();
  assert.deepEqual(shown.map((e) => e.kind), ['dialogue'], 'rendered once: the lines typed so far stay');
  const before = plays;
  assert.equal(await contexts[0].play('Hvala.'), 'none');
  assert.equal(plays, before, 'the player was not called');
});

test("a dialogue line with a cast reaches the player with its voice, and not after \"Can't listen right now\"", async () => {
  const container = /** @type {any} */ (document.createElement('main'));
  const app = dialogueApp();
  /** @type {unknown[][]} */
  const calls = [];
  app.player.play = async (/** @type {unknown[]} */ ...args) => { calls.push(args); return 'file'; };
  renderSession(container, app);
  await settle();
  assert.deepEqual(shown.map((e) => e.kind), ['dialogue']);
  assert.equal(await contexts[0].play('Dober dan.', { voice: 'male' }), 'file');
  assert.deepEqual(calls, [['Dober dan.', { voice: 'male' }]], "the speaker's voice goes through to the player");
  button(container.querySelector('.session-bar'), 'Quiet').dispatch('click');
  button(container.querySelector('.quiet-panel'), "Can't listen right now").dispatch('click');
  await settle();
  assert.equal(await contexts[0].play('Hvala.', { voice: 'male' }), 'none');
  assert.equal(calls.length, 1, 'the player was not called');
});

test("the closing menu puts \"Can't talk right now\" after \"A speaking round\", and a tap takes both away", async () => {
  const container = /** @type {any} */ (document.createElement('main'));
  renderSession(container, sessionApp({ states: byId(due('u01-l01-i01')), settings: { mute: false }, audio: true }));
  await settle();
  await answer({ itemId: 'u01-l01-i01', recall: 'correct' });
  await answer({ aux: { kind: 'listening', correct: true } });
  await answer({ aux: { kind: 'perception', correct: true } });
  const labels = () => elements(container.querySelector('.closing-menu')).filter((el) => el.tagName === 'BUTTON').map((el) => el.textContent);
  assert.deepEqual(labels(), ['Stop here', 'A speaking round', "Can't talk right now"]);
  button(container.querySelector('.closing-menu'), "Can't talk right now").dispatch('click');
  assert.deepEqual(labels(), ['Stop here']);
  assert.equal(quietChoices().cantTalk, true);
});

test("a speaking round started after \"Can't talk right now\" has nothing to play", async () => {
  chooseQuiet('talk');
  const container = /** @type {any} */ (document.createElement('main'));
  renderSession(container, sessionApp({ states: byId(later('u01-l01-i01'), later('u01-l01-i02')), settings: { mute: false }, audio: true }), { mode: 'speaking' });
  await settle();
  assert.deepEqual(shown, []);
  assert.ok(elements(container).some((el) => el.tagName === 'H2' && el.textContent === 'Nothing to practise right now.'));
});

test('an exercise a choice skips draws into its own element, so a late draw of it cannot cover the screen after it', async () => {
  const container = /** @type {any} */ (document.createElement('main'));
  renderSession(container, sessionApp({ states: byId(due('u01-l01-i01')), settings: { mute: false }, audio: true }));
  await settle();
  await answer({ itemId: 'u01-l01-i01', recall: 'correct' });
  button(container.querySelector('.quiet-offer'), "Can't listen right now").dispatch('click');
  await settle();
  assert.ok(container.querySelector('.closing-menu'));
  // the skipped listening exercise draws late, as a play that reports no sound after the skip would
  hosts[1].replaceChildren(document.createElement('article'));
  assert.ok(container.querySelector('.closing-menu'), 'the closing menu stays');
  assert.equal(elements(container).includes(hosts[1]), false, 'its element has left the screen');
});

/** Answers every entry right until the run reaches its closing menu. @param {any} root */
async function playToEnd(root) {
  for (let n = 0; n < 50 && !root.querySelector('.closing-menu'); n += 1) {
    const entry = shown.at(-1);
    await answer(entry.kind === 'meet' ? { itemId: entry.itemId }
      : entry.itemId === undefined ? { aux: { kind: entry.kind, correct: true } } : { itemId: entry.itemId, recall: 'correct' });
  }
}

test("the closing screen of the unit's last lesson offers its checkpoint, an earlier lesson's does not", async () => {
  const cases = [
    [{ order: 5, role: 'consolidation', lessonCount: 5 }, true, 'the last of five lessons'],
    [{ order: 3, role: 'consolidation', lessonCount: 3 }, true, 'the last of three: no constant five'],
    [{ order: 4, role: 'theme', lessonCount: 5 }, false, 'an earlier lesson'],
    [{ order: 5, role: 'consolidation', lessonCount: 5, items: 2, settings: { newPerDay: 1 } }, false, 'the last lesson, not finished in this run'],
  ];
  for (const [parts, offered, why] of cases) {
    const container = /** @type {any} */ (document.createElement('main'));
    renderSession(container, unitEndApp(parts));
    await settle();
    await playToEnd(container);
    assert.ok(container.querySelector('.closing-menu'), `${why}: the run closed`);
    const link = elements(container).find((e) => e.tagName === 'A' && e.textContent === 'Take the unit checkpoint');
    assert.equal(Boolean(link), offered, why);
    if (link) {
      assert.equal(link.getAttribute('href'), '#/checkpoint?unit=u01');
      assert.equal(link.className, 'btn btn-secondary');
    }
  }
});

test("the unit checkpoint sits between the summary and the menu, stays when \"Can't talk right now\" draws the menu again, and the menu's first button takes the focus", async () => {
  const container = /** @type {any} */ (document.createElement('main'));
  renderSession(container, unitEndApp({ order: 5, role: 'consolidation', lessonCount: 5, settings: { mute: false }, audio: true }));
  await settle();
  await playToEnd(container);
  const closing = () => container.querySelector('.closing');
  const parts = () => closing().childNodes.map((/** @type {any} */ e) => e.className);
  assert.deepEqual(parts(), ['prompt', 'en-text', 'actions actions-stack closing-checkpoint', 'actions actions-stack closing-menu'], 'the checkpoint spans the column like the menu');
  assert.equal(document.activeElement, button(container.querySelector('.closing-menu'), 'Stop here'));
  button(container.querySelector('.closing-menu'), "Can't talk right now").dispatch('click');
  assert.equal(button(container.querySelector('.closing-menu'), 'A speaking round'), undefined, 'the menu is drawn again');
  assert.deepEqual(parts(), ['prompt', 'en-text', 'actions actions-stack closing-checkpoint', 'actions actions-stack closing-menu'], 'the link stays');
  assert.equal(elements(container.querySelector('.closing-checkpoint')).find((e) => e.tagName === 'A').textContent, 'Take the unit checkpoint');
  assert.equal(document.activeElement, button(container.querySelector('.closing-menu'), 'Stop here'), 'the focus still goes to the menu');
});

test('without lessonCount the consolidation role alone marks the last lesson, and a theme lesson is never the last', async () => {
  const cases = [
    [{ order: 2, role: 'consolidation', lessonCount: undefined }, true, 'no lessonCount: the consolidation lesson'],
    [{ order: 5, role: 'theme', lessonCount: 5 }, false, 'a theme lesson at the unit\'s count'],
  ];
  for (const [parts, offered, why] of cases) {
    const container = /** @type {any} */ (document.createElement('main'));
    renderSession(container, unitEndApp(parts));
    await settle();
    await playToEnd(container);
    assert.ok(container.querySelector('.closing-menu'), `${why}: the run closed`);
    assert.equal(Boolean(container.querySelector('.closing-checkpoint')), offered, why);
  }
});
