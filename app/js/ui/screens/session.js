// The session screen. It builds today's queue with buildSession, keeps the entries some exercise
// is registered for, and plays them in order, one exercise at a time, without waiting for the one
// and ten minute steps: the queue interleaves enough other work (Ruling 22). Every recall goes
// through applyRecall: effectiveResult decides how it counts, recordRecall (or skipAheadState for
// a rule's correct quick check, Ruling 21) gives the next state, which is saved at once. A typed
// recall that counts as a miss comes back after the next two entries until it is right or a slip.
// At the end a SessionRecord is appended and the closing menu (components/menu.js) is offered:
// stop, three more minutes, a speaking round, continue the lesson. A speaking round
// (`?mode=speaking`) plays the speaking entries buildSession planned when speech recognition is
// on, else the self-rated speaking exercise over up to five review-phase items. Each session
// starts with speech recognition offered again, even if it was refused in an earlier one
// (resetRecognition). The pure parts are exported for the tests.

import { h, mount } from '../../util/dom.js';
import { buildSession, closingMenu } from '../../engine/session.js';
import { createState, effectiveResult, recordRecall, skipAheadState } from '../../engine/scheduler.js';
import { honeyFor } from '../../engine/progress.js';
import { currentLesson, todayTotals, unmetItems } from '../../engine/course.js';
import { isRuleId } from '../../util/ids.js';
import { shuffle } from '../../util/shuffle.js';
import { onlyKnown } from '../../content/loader.js';
import { saveItemState, appendSession } from '../../store/state.js';
import { renderFor } from '../exercises/registry.js';
import { renderMenu } from '../components/menu.js';
import { navigate } from '../../router.js';
import { resetRecognition } from '../../audio/speech.js';

/** @typedef {import('../../app-types.js').App} App */
/** @typedef {import('../../engine/session.js').QueueEntry} QueueEntry */
/** @typedef {import('../../engine/scheduler.js').ItemState} ItemState */
/** @typedef {import('../../engine/scheduler.js').Settings} Settings */
/** @typedef {import('../../engine/scheduler.js').RecallResult} RecallResult */
/** @typedef {import('../../engine/progress.js').SessionRecord} SessionRecord */
/** @typedef {import('../exercises/registry.js').ExerciseContext} ExerciseContext */
/** @typedef {import('../exercises/registry.js').ExerciseOutcome} ExerciseOutcome */

const MINUTE_MS = 60_000;
/** Entries a missed recall waits behind before it comes back. */
const REQUEUE_GAP = 2;
/** Kinds whose missed recall is played again; slot and dialogue entries play as planned. */
const RETRIED_KINDS = new Set(['typed_en_sl', 'typed_sl_en']);
/** Items a speaking round speaks when buildSession planned no speaking entries. */
const SPEAKING_ROUND = 5;

/**
 * Puts `entry` back into the run-time queue after the REQUEUE_GAP entries that follow `index`, or
 * at the end when fewer remain. Changes `queue` in place.
 * @param {QueueEntry[]} queue
 * @param {number} index the entry being played
 * @param {QueueEntry} entry
 * @returns {number} where it went
 */
export function requeue(queue, index, entry) {
  const at = Math.min(index + 1 + REQUEUE_GAP, queue.length);
  queue.splice(at, 0, entry);
  return at;
}

/**
 * The entry that plays a missed recall again: the typed recall itself, a typed recall of the one
 * item for a fluency pass, nothing for every other kind.
 * @param {QueueEntry} entry
 * @param {string} itemId the item that was missed
 * @returns {QueueEntry|null}
 */
export function retryEntry(entry, itemId) {
  if (entry.kind === 'fluency') return { kind: 'typed_en_sl', itemId };
  return RETRIED_KINDS.has(entry.kind) ? entry : null;
}

/**
 * The state after a recall and how the recall counts. Items: effectiveResult, then recordRecall
 * with the recall as given (it applies the same rule and remembers the raw result). Rule items: a
 * correct quick check on a rule not yet in review graduates it through skipAheadState; anything
 * else records as an item does.
 * @param {Record<string, ItemState>} states
 * @param {string} itemId an item or rule id
 * @param {RecallResult} recall as graded
 * @param {number} now epoch ms
 * @param {Settings} settings
 * @param {string} [tz]
 * @returns {{ state: ItemState, effective: RecallResult }}
 */
export function stateAfterRecall(states, itemId, recall, now, settings, tz) {
  const previous = states[itemId] ?? createState(itemId, now);
  const effective = effectiveResult(previous, recall);
  if (isRuleId(itemId) && recall === 'correct' && (previous.phase === 'new' || previous.phase === 'learning')) {
    return { state: skipAheadState(itemId, now), effective };
  }
  return { state: recordRecall(previous, recall, now, settings, tz), effective };
}

/**
 * The queue of a speaking round. With speech recognition on, the speaking entries buildSession
 * planned (over review-phase items, recognition-judged); otherwise, or when it planned none, the
 * speaking exercise over up to SPEAKING_ROUND review-phase items drawn through `rng`, which is
 * self-rated while speech is off. Rule items are never spoken.
 * @param {QueueEntry[]} planned buildSession's queue
 * @param {Record<string, ItemState>} states
 * @param {boolean} speech `mode.speech`
 * @param {() => number} rng a generator in [0, 1)
 * @returns {QueueEntry[]}
 */
export function speakingQueue(planned, states, speech, rng) {
  const own = speech ? planned.filter((entry) => entry.kind === 'speaking') : [];
  if (own.length > 0) return own;
  const pool = Object.values(states).filter((state) => state.phase === 'review' && !isRuleId(state.itemId)).map((state) => state.itemId);
  return shuffle(pool, rng).slice(0, SPEAKING_ROUND).map((itemId) => ({ kind: 'speaking', itemId }));
}

/**
 * Whether the screen can play an entry: an exercise is registered for its kind (a fluency pass
 * plays through the typed recall) and the bundle has the item it needs.
 * @param {App} app
 * @param {QueueEntry} entry
 * @returns {boolean}
 */
function playable(app, entry) {
  if (entry.kind === 'fluency') return Boolean(renderFor('typed_en_sl')) && (entry.itemIds ?? []).some((id) => app.items.has(id));
  if (!renderFor(entry.kind)) return false;
  return entry.itemId === undefined || app.items.has(entry.itemId);
}

/**
 * Runs a session in `container`. `params.mode` is `continue` to raise the day's new-item cap by
 * the lesson's remaining items (the closing menu's "Continue the lesson", Ruling 22), or
 * `speaking` for a speaking round (speakingQueue).
 * @param {HTMLElement} container
 * @param {App} app
 * @param {Record<string, string>} [params]
 * @returns {() => void} stops the session and its sound when the screen is left; work done so far is recorded
 */
export function renderSession(container, app, params = {}) {
  const settings = app.state.settings;
  const mode = { mute: settings.mute, speech: settings.speech };
  const startedAt = Date.now();
  resetRecognition();
  /** @type {Record<string, number>} exercises played per kind */
  const kinds = {};
  const tally = { played: 0, recalls: 0, correct: 0, newItems: 0, kinds };
  let alive = true;
  let recorded = false;

  const known = () => onlyKnown(app.state.items, app.known);
  const { newToday, minutesToday } = todayTotals(app.state.sessions, startedAt);
  const { lesson, unitLessons, remaining } = currentLesson(app.index, app.units, known(), app.allowPending);
  const newPerDay = settings.newPerDay + (params.mode === 'continue' ? remaining : 0);
  const { queue: planned } = buildSession({
    now: startedAt, states: known(), lesson, unitLessons, rules: app.index.rules, settings: { ...settings, newPerDay },
    mode, newToday, minutesToday, allowPending: app.allowPending,
  });
  const round = params.mode === 'speaking' ? speakingQueue(planned, known(), mode.speech, Math.random) : planned;
  const queue = round.filter((entry) => playable(app, entry));

  const progress = h('div', { class: 'progress-fill' });
  const bar = h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Session progress', 'aria-valuemin': '0' }, progress);
  const stage = h('div', { class: 'stage' });
  const end = h('button', { type: 'button', class: 'btn btn-quiet session-end', onclick: () => { void leave(); } }, 'End');
  mount(container, h('section', { class: 'screen screen-session' }, h('div', { class: 'session-bar' }, end, bar), stage));

  /** @param {number} done */
  const showProgress = (done) => {
    bar.setAttribute('aria-valuemax', String(queue.length));
    bar.setAttribute('aria-valuenow', String(done));
    progress.style.setProperty('width', `${queue.length === 0 ? 100 : Math.round((done / queue.length) * 100)}%`);
  };

  /**
   * @param {string} itemId
   * @param {RecallResult} recall
   * @param {number} now
   * @returns {Promise<RecallResult>} how the recall counted
   */
  const applyRecall = async (itemId, recall, now) => {
    const { state, effective } = stateAfterRecall(app.state.items, itemId, recall, now, settings);
    app.state.items[itemId] = state;
    await saveItemState(app.adapter, state);
    return effective;
  };

  /**
   * @param {string|undefined} itemId
   * @param {QueueEntry} entry
   * @returns {ExerciseContext}
   */
  const contextFor = (itemId, entry) => {
    const found = itemId === undefined ? undefined : app.items.get(itemId);
    const item = found?.item ?? null;
    const ruleId = entry.ruleId ?? item?.rules?.find((id) => app.rules.has(id));
    return {
      item,
      rule: ruleId === undefined ? null : app.rules.get(ruleId) ?? null,
      lesson: (entry.lessonId === undefined ? undefined : app.lessons.get(entry.lessonId)) ?? found?.lesson ?? null,
      rules: app.index.rules,
      settings,
      mode,
      play: (text) => app.player.play(text),
      rng: Math.random,
      allowPending: app.allowPending,
      effective: (id, recall) => effectiveResult(app.state.items[id] ?? createState(id, Date.now()), recall),
    };
  };

  /**
   * Records the recalls of an outcome and re-queues a missed typed recall.
   * @param {QueueEntry} entry
   * @param {number} index
   * @param {ExerciseOutcome} outcome
   */
  const settle = async (entry, index, outcome) => {
    const recalls = outcome.recalls
      ?? (outcome.recall !== undefined && outcome.itemId !== undefined ? [{ itemId: outcome.itemId, recall: outcome.recall }] : []);
    for (const { itemId, recall } of recalls) {
      const effective = await applyRecall(itemId, recall, Date.now());
      tally.recalls += 1;
      if (effective !== 'wrong') {
        tally.correct += 1;
      } else {
        const retry = retryEntry(entry, itemId);
        if (retry) requeue(queue, index, retry);
      }
    }
  };

  /** @returns {Promise<SessionRecord|null>} the record of the work done, appended once */
  const record = async () => {
    if (recorded || tally.played === 0) return null;
    recorded = true;
    const endedAt = Date.now();
    /** @type {SessionRecord} */
    const session = {
      id: `${startedAt}-${globalThis.crypto.randomUUID()}`,
      startedAt,
      endedAt,
      minutes: (endedAt - startedAt) / MINUTE_MS,
      recalls: tally.recalls,
      correct: tally.correct,
      newItems: tally.newItems,
      honey: honeyFor(tally.correct),
      kinds: tally.kinds,
    };
    app.state.sessions.push(session);
    await appendSession(app.adapter, session);
    return session;
  };

  const leave = async () => {
    alive = false;
    await record();
    navigate('/today');
  };

  const close = async () => {
    const session = await record();
    showProgress(queue.length);
    end.hidden = true;
    const options = closingMenu({
      minutesToday: todayTotals(app.state.sessions, Date.now()).minutesToday,
      settings,
      lessonRemaining: lesson !== null && unmetItems(lesson, known(), app.allowPending) > 0,
      mode,
    });
    /** @type {Record<(typeof options)[number], () => void>} */
    const actions = {
      stop: () => navigate('/today'),
      more3: () => navigate('/session'),
      speaking: () => navigate('/session?mode=speaking'),
      continue: () => navigate('/session?mode=continue'),
    };
    const minutes = Math.max(1, Math.round(session?.minutes ?? 0));
    /** @type {string[]} */
    const parts = [];
    if (tally.recalls > 0) parts.push(`${tally.correct} of ${tally.recalls} answers right`);
    if (tally.newItems > 0) parts.push(`${tally.newItems} new ${tally.newItems === 1 ? 'item' : 'items'}`);
    parts.push(`about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`);
    const summary = parts.join(', ');
    mount(stage, h('article', { class: 'exercise closing' },
      h('h2', { class: 'prompt' }, 'Session complete.'),
      h('p', { class: 'en-text' }, `${summary.charAt(0).toUpperCase()}${summary.slice(1)}.`),
      renderMenu(options, (option) => actions[option]())));
    /** @type {HTMLElement|null} */ (stage.querySelector('button'))?.focus();
  };

  const play = async () => {
    if (queue.length === 0) {
      end.hidden = true;
      showProgress(0);
      mount(stage, h('article', { class: 'exercise closing' },
        h('h2', { class: 'prompt' }, 'Nothing to practise right now.'),
        h('p', { class: 'en-text' }, 'Your reviews are done for the moment. Come back later today or tomorrow.'),
        h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: () => navigate('/today') }, 'Back to Today'))));
      return;
    }
    for (let index = 0; index < queue.length; index += 1) {
      const entry = queue[index];
      showProgress(index);
      if (entry.kind === 'fluency') {
        const typed = /** @type {import('../exercises/registry.js').ExerciseRender} */ (renderFor('typed_en_sl'));
        for (const itemId of entry.itemIds ?? []) {
          if (!app.items.has(itemId)) continue;
          const outcome = await typed(stage, { ...entry, itemId }, contextFor(itemId, entry));
          if (!alive) return;
          await settle(entry, index, outcome);
        }
      } else {
        const render = /** @type {import('../exercises/registry.js').ExerciseRender} */ (renderFor(entry.kind));
        const outcome = await render(stage, entry, contextFor(entry.itemId, entry));
        if (!alive) return;
        await settle(entry, index, outcome);
      }
      tally.played += 1;
      tally.kinds[entry.kind] = (tally.kinds[entry.kind] ?? 0) + 1;
      if (entry.kind === 'meet') tally.newItems += 1;
    }
    if (alive) await close();
  };

  play().catch((error) => {
    console.error(error);
    if (!alive) return;
    mount(stage, h('article', { class: 'exercise closing' },
      h('h2', { class: 'prompt' }, 'Something went wrong.'),
      h('p', { class: 'en-text' }, 'The session stopped. What you answered so far is kept.'),
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: () => navigate('/today') }, 'Back to Today'))));
  });

  return () => {
    alive = false;
    app.player.stop();
    record().catch((error) => console.error(error));
  };
}
