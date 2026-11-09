// The session screen. It builds today's queue with buildSession, keeps the entries some exercise
// is registered for, and plays them in order, one exercise at a time, without waiting for the one
// and ten minute steps: the queue interleaves enough other work (Ruling 22). The mode it builds
// with mutes the queue when nothing can play (no recording in the learner's voice and no device
// voice, Ruling 81), so no audio exercise is scheduled into the no-audio line; the player's check
// answers within AUDIO_CHECK_MS (Ruling 95). That mute is for buildSession and the closing menu
// only: the exercises get the learner's own mute (Ruling 94), so Listen still shows and host lines
// are still tried. Every recall goes through applyRecall: effectiveResult decides how it counts,
// recordRecall (or skipAheadState for a rule's correct quick check, Ruling 21) gives the next
// state, which is saved at once. A typed recall that counts as a miss comes back after the next
// two entries until it is right or a slip.
// The run's SessionRecord has its id from the start: after every settled entry a provisional
// record is written under it, so a run the browser or the learner abandons still counts for what
// was done (Ruling 78), and the same id is finalised when the run ends; its minutes are credited
// time, the gaps between entries capped (creditedMinutes, Ruling 79). At the end the closing menu
// (components/menu.js) is offered: stop, three more minutes, a speaking round, continue the
// lesson. Three more minutes (`?mode=more`) is a new run over buildMoreRound's queue: the
// review-phase items this run did not practise, weakest first, filled up from its misses, and the
// option is left out when that round would be empty (Ruling 80). A speaking round
// (`?mode=speaking`) plays the speaking entries buildSession planned when speech recognition is
// on, else the self-rated speaking exercise over up to five review-phase items. The run that meets
// the last item of a unit's last lesson (its consolidation lesson, at the unit's lessonCount) also
// offers the unit's checkpoint between the summary and the menu; currentLesson names only a lesson
// with an unmet item, so this happens once, and later the unit page offers it. Each session
// starts with speech recognition offered again, even if it was refused in an earlier one
// (resetRecognition). The pure parts are exported for the tests.
// Quiet choices (ui/quiet.js) hold for the sitting: a run starts from the choices made so far, and
// its queue leaves out what they drop (quietDrops). "Can't listen right now" and "Can't talk right
// now" are offered once each, beside the first exercise that would play sound or ask the learner to
// speak, and both sit in the Quiet panel under the session bar; the closing menu offers "Can't talk
// right now" after its speaking round. A choice prunes the rest of the queue (pruneQueue) and
// reaches the exercise on screen: one whose kind it drops is skipped without an outcome, and a
// meet, dialogue or speaking exercise is drawn again without sound after "Can't listen right now".
// Every interruptible draw has its own element in the stage, so one left behind cannot draw over
// what follows, and once the learner can't listen no exercise context plays anything.

import { h, mount } from '../../util/dom.js';
import { buildMoreRound, buildSession, closingMenu, quietDrops } from '../../engine/session.js';
import { createState, effectiveResult, recordRecall, skipAheadState } from '../../engine/scheduler.js';
import { creditedMinutes, honeyFor } from '../../engine/progress.js';
import { currentLesson, lessonRole, todayTotals, unmetItems } from '../../engine/course.js';
import { isRuleId } from '../../util/ids.js';
import { shuffle } from '../../util/shuffle.js';
import { onlyKnown } from '../../content/loader.js';
import { saveItemState, appendSession } from '../../store/state.js';
import { renderFor } from '../exercises/registry.js';
import { renderMenu } from '../components/menu.js';
import { OFFER_KINDS, QUIET_LABELS, chooseQuiet, offerQuiet, quietChoices } from '../quiet.js';
import { navigate } from '../../router.js';
import { resetRecognition } from '../../audio/speech.js';

/** @typedef {import('../../app-types.js').App} App */
/** @typedef {import('../../engine/session.js').QueueEntry} QueueEntry */
/** @typedef {import('../../engine/session.js').ExerciseKind} ExerciseKind */
/** @typedef {import('../../engine/session.js').Mode} Mode */
/** @typedef {import('../../engine/scheduler.js').ItemState} ItemState */
/** @typedef {import('../../engine/scheduler.js').Settings} Settings */
/** @typedef {import('../../engine/scheduler.js').RecallResult} RecallResult */
/** @typedef {import('../../engine/progress.js').SessionRecord} SessionRecord */
/** @typedef {import('../exercises/registry.js').ExerciseContext} ExerciseContext */
/** @typedef {import('../exercises/registry.js').ExerciseOutcome} ExerciseOutcome */
/** @typedef {import('../quiet.js').QuietKind} QuietKind */

/** Entries a missed recall waits behind before it comes back. */
const REQUEUE_GAP = 2;
/** Kinds whose missed recall is played again; slot and dialogue entries play as planned. */
const RETRIED_KINDS = new Set(['typed_en_sl', 'typed_sl_en']);
/** Items a speaking round speaks when buildSession planned no speaking entries. */
const SPEAKING_ROUND = 5;
/** The quiet choices, in the order the Quiet panel shows them. @type {readonly QuietKind[]} */
const QUIET_KINDS = ['listen', 'talk'];
/** Kinds drawn again after "Can't listen right now", so they show without Listen and play nothing. @type {ReadonlySet<ExerciseKind>} */
const REDRAWN_SILENT = new Set(['meet', 'dialogue', 'speaking']);

/**
 * What the last run practised and missed, for the "Three more minutes" run that may follow it
 * (buildMoreRound); set when a run reaches its closing menu. A more round started without a run
 * before it (a direct link) takes the weakest review items.
 * @type {{ practised: Set<string>, missed: string[] }}
 */
let lastRun = { practised: new Set(), missed: [] };

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
 * Removes, in place, the entries at `from` and after whose kind is in `drops`: a quiet choice
 * prunes the rest of the run, the entry on screen and those before it staying as they are.
 * @param {QueueEntry[]} queue
 * @param {number} from the first index that may go
 * @param {Set<ExerciseKind>} drops quietDrops of the run's mode
 * @returns {number} how many it removed
 */
export function pruneQueue(queue, from, drops) {
  let removed = 0;
  for (let at = queue.length - 1; at >= from; at -= 1) {
    if (!drops.has(queue[at].kind)) continue;
    queue.splice(at, 1);
    removed += 1;
  }
  return removed;
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
 * the lesson's remaining items (the closing menu's "Continue the lesson", Ruling 22), `speaking`
 * for a speaking round (speakingQueue), or `more` for the three more minutes after the run before
 * (buildMoreRound). Each run has its own SessionRecord.
 * @param {HTMLElement} container
 * @param {App} app
 * @param {Record<string, string>} [params]
 * @returns {() => void} stops the session and its sound when the screen is left; work done so far is recorded
 */
export function renderSession(container, app, params = {}) {
  const settings = app.state.settings;
  const { cantListen, cantTalk } = quietChoices();
  /**
   * The mode of buildSession and closingMenu: buildQueue settles `mute` once the player has said
   * whether anything can play. The exercises get the learner's own mute instead (contextFor). The
   * quiet flags start from the sitting's choices and follow every choice made during the run.
   * @type {Required<Mode>}
   */
  const mode = { mute: settings.mute, speech: settings.speech, cantListen, cantTalk };
  const startedAt = Date.now();
  /** The run's record id, fixed from the start so every write replaces the one before (Ruling 78). */
  const id = `${startedAt}-${globalThis.crypto.randomUUID()}`;
  resetRecognition();
  /** @type {Record<string, number>} exercises played per kind */
  const kinds = {};
  const tally = { played: 0, recalls: 0, correct: 0, newItems: 0, kinds };
  /** Epoch ms of each settled entry, the marks the credited time is read from (Ruling 79). */
  /** @type {number[]} */
  const marks = [];
  /** @type {Set<string>} the item ids this run practised, for the more round after it */
  const practised = new Set();
  /** @type {string[]} the item ids this run missed, in order, for the more round after it */
  const missed = [];
  let alive = true;
  let recorded = false;

  const known = () => onlyKnown(app.state.items, app.known);
  const { newToday, minutesToday } = todayTotals(app.state.sessions, startedAt);
  const { lesson, unitLessons, remaining } = currentLesson(app.index, app.units, known(), app.allowPending);
  const newPerDay = settings.newPerDay + (params.mode === 'continue' ? remaining : 0);
  /** @type {QueueEntry[]} the run-time queue, filled by buildQueue */
  const queue = [];
  /** The index of the entry the run is at: -1 before the first, queue.length once the run has ended. */
  let current = -1;
  /** Ends the draw on screen early, when a quiet choice skips it or draws it again. @type {((how: 'skip'|'redraw') => void)|null} */
  let interrupt = null;

  /**
   * Builds this run's queue once the player has said whether anything can play, which it does
   * within AUDIO_CHECK_MS (Ruling 95): the day's plan (muted when nothing can, Ruling 81), a
   * speaking round, or the more round after the last run, without the kinds the quiet choices drop.
   */
  const buildQueue = async () => {
    mode.mute = settings.mute || !(await app.player.audioAvailable());
    const { queue: planned } = buildSession({
      now: startedAt, states: known(), lesson, unitLessons, rules: app.index.rules, settings: { ...settings, newPerDay },
      mode, newToday, minutesToday, allowPending: app.allowPending,
    });
    const round = params.mode === 'speaking' ? speakingQueue(planned, known(), mode.speech, Math.random)
      : params.mode === 'more' ? buildMoreRound({ now: startedAt, states: known(), practised: lastRun.practised, missed: lastRun.missed, settings })
        : planned;
    const drops = quietDrops(mode);
    queue.push(...round.filter((entry) => !drops.has(entry.kind) && playable(app, entry)));
  };

  const progress = h('div', { class: 'progress-fill' });
  const bar = h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Session progress', 'aria-valuemin': '0' }, progress);
  const stage = h('div', { class: 'stage' });
  const end = h('button', { type: 'button', class: 'btn btn-quiet session-end', onclick: () => { void leave(); } }, 'End');
  const quietToggle = h('button', {
    type: 'button', class: 'btn btn-quiet session-quiet', 'aria-expanded': 'false', 'aria-controls': 'session-quiet-panel', onclick: () => togglePanel(),
  }, 'Quiet');
  /** Whether a choice holds for this run: made, or for listening, the learner's own mute. @param {QuietKind} kind */
  const holds = (kind) => (kind === 'listen' ? settings.mute || mode.cantListen : mode.cantTalk);
  const choices = QUIET_KINDS.map((kind) => ({
    kind,
    button: h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => { if (!holds(kind)) choose(kind); } }, QUIET_LABELS[kind]),
  }));
  const panel = h('div', { class: 'quiet-panel', id: 'session-quiet-panel', hidden: true },
    choices.map((choice) => choice.button),
    h('p', { class: 'quiet' }, 'Lasts until you leave the session.'));
  /** The choice offered beside the exercise about to be drawn, empty otherwise. */
  const offer = h('div', { class: 'quiet-offer' });
  // The screen's heading is for assistive technology: each exercise's own heading sits under it.
  mount(container, h('section', { class: 'screen screen-session' },
    h('h1', { class: 'visually-hidden' }, 'Practice session'),
    h('div', { class: 'session-bar' }, end, bar, quietToggle),
    panel,
    offer,
    stage));

  const togglePanel = () => {
    panel.hidden = !panel.hidden;
    quietToggle.setAttribute('aria-expanded', String(!panel.hidden));
  };

  /** Shows each choice pressed, and disabled, while it holds. */
  const drawPanel = () => {
    for (const { kind, button } of choices) {
      button.setAttribute('aria-pressed', String(holds(kind)));
      if (holds(kind)) button.setAttribute('aria-disabled', 'true');
      else button.removeAttribute('aria-disabled');
    }
  };
  drawPanel();

  /** Hides End and Quiet, with Quiet's panel, once the run has nothing more to play. */
  const hideControls = () => {
    for (const control of [end, quietToggle, panel]) control.hidden = true;
  };

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
      // The learner's own mute, not the derived one: Listen shows and host lines are tried (Ruling 94),
      // unless the learner can't listen right now.
      mode: { ...mode, mute: settings.mute || mode.cantListen },
      // Read at play time, so an exercise left behind or drawn again after the choice stays silent.
      play: (text) => (quietChoices().cantListen ? Promise.resolve(/** @type {const} */ ('none')) : app.player.play(text)),
      rng: Math.random,
      allowPending: app.allowPending,
      effective: (id, recall) => effectiveResult(app.state.items[id] ?? createState(id, Date.now()), recall),
    };
  };

  /**
   * Makes a quiet choice for the sitting and applies it to this run: the mode follows it, the sound
   * stops for listening, the rest of the queue loses the kinds it drops, the bar and the panel are
   * drawn again and the offer goes. The exercise on screen is then skipped when the choice drops its
   * kind, drawn again when the learner can't listen and it is a meet, dialogue or speaking exercise,
   * and otherwise stays.
   * @param {QuietKind} kind
   */
  const choose = (kind) => {
    chooseQuiet(kind);
    if (kind === 'listen') {
      mode.cantListen = true;
      app.player.stop();
    } else {
      mode.cantTalk = true;
    }
    const drops = quietDrops(mode);
    pruneQueue(queue, current + 1, drops);
    if (current >= 0) showProgress(current);
    drawPanel();
    mount(offer);
    const entry = queue[current];
    if (!interrupt || !entry) return;
    if (drops.has(entry.kind)) interrupt('skip');
    else if (kind === 'listen' && REDRAWN_SILENT.has(entry.kind)) interrupt('redraw');
  };

  /**
   * Offers a choice beside the entry about to be drawn: listening beside a meet, listening or
   * perception exercise while the learner has sound, else talking beside a speaking exercise; each
   * once per sitting (offerQuiet), and nothing once it is chosen.
   * @param {QueueEntry} entry
   */
  const offerFor = (entry) => {
    /** @type {QuietKind|null} */
    const kind = !settings.mute && !mode.cantListen && OFFER_KINDS.listen.has(entry.kind) && offerQuiet('listen') ? 'listen'
      : !mode.cantTalk && OFFER_KINDS.talk.has(entry.kind) && offerQuiet('talk') ? 'talk'
        : null;
    mount(offer, kind && h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => choose(kind) }, QUIET_LABELS[kind]));
  };

  /**
   * Draws an entry, raced against the quiet choices: a choice that drops its kind skips it, one
   * that draws it again starts a fresh draw with a fresh context. Each draw has its own element in
   * the stage, so an exercise left behind cannot draw over what comes after it.
   * @param {QueueEntry} entry
   * @returns {Promise<ExerciseOutcome|null>} the outcome, or null when the entry was skipped
   */
  const draw = async (entry) => {
    const render = /** @type {import('../exercises/registry.js').ExerciseRender} */ (renderFor(entry.kind));
    for (;;) {
      offerFor(entry);
      const host = h('div');
      mount(stage, host);
      /** @type {Promise<'skip'|'redraw'>} */
      const interrupted = new Promise((resolve) => { interrupt = resolve; });
      const drawn = await Promise.race([render(host, entry, contextFor(entry.itemId, entry)), interrupted]);
      interrupt = null;
      if (drawn === 'redraw') continue;
      mount(offer);
      return drawn === 'skip' ? null : drawn;
    }
  };

  /**
   * Records the recalls of an outcome, notes what was practised and missed, and re-queues a
   * missed typed recall.
   * @param {QueueEntry} entry
   * @param {number} index
   * @param {ExerciseOutcome} outcome
   */
  const settle = async (entry, index, outcome) => {
    const recalls = outcome.recalls
      ?? (outcome.recall !== undefined && outcome.itemId !== undefined ? [{ itemId: outcome.itemId, recall: outcome.recall }] : []);
    for (const { itemId, recall } of recalls) {
      const effective = await applyRecall(itemId, recall, Date.now());
      practised.add(itemId);
      tally.recalls += 1;
      if (effective !== 'wrong') {
        tally.correct += 1;
      } else {
        if (!missed.includes(itemId)) missed.push(itemId);
        const retry = retryEntry(entry, itemId);
        if (retry) requeue(queue, index, retry);
      }
    }
  };

  /**
   * Writes the record of the work done so far under the run's id, replacing the one before.
   * @param {number} endedAt epoch ms
   * @returns {Promise<SessionRecord>}
   */
  const write = async (endedAt) => {
    /** @type {SessionRecord} */
    const session = {
      id,
      startedAt,
      endedAt,
      minutes: creditedMinutes([startedAt, ...marks, endedAt]),
      recalls: tally.recalls,
      correct: tally.correct,
      newItems: tally.newItems,
      honey: honeyFor(tally.correct),
      kinds: tally.kinds,
    };
    await appendSession(app.adapter, session, app.state.sessions);
    return session;
  };

  /** @returns {Promise<SessionRecord|null>} the final record of the work done, written once; null when no entry was settled */
  const record = async () => {
    if (recorded || tally.played === 0) return null;
    recorded = true;
    return write(Date.now());
  };

  const leave = async () => {
    alive = false;
    await record();
    navigate('/today');
  };

  const close = async () => {
    const session = await record();
    lastRun = { practised: new Set(practised), missed: [...missed] };
    current = queue.length;
    showProgress(current);
    hideControls();
    /** @type {Record<ReturnType<typeof closingMenu>[number], () => void>} */
    const actions = {
      stop: () => navigate('/today'),
      more3: () => navigate('/session?mode=more'),
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
    const unit = lesson === null ? undefined : app.index.units.find((candidate) => candidate.id === lesson.unit);
    /**
     * The unit whose checkpoint the closing screen offers: the run's lesson is the unit's last (a
     * consolidation lesson at the unit's lessonCount, or the role alone without one) and has no item
     * left to meet. Null otherwise.
     */
    const checkpointUnit = lesson !== null && unit !== undefined && lessonRole(lesson) === 'consolidation'
      && lesson.order === (unit.lessonCount ?? lesson.order) && unmetItems(lesson, known(), app.allowPending) === 0 ? unit : null;
    /**
     * Draws the summary, the unit's checkpoint when it is offered and the menu from a fresh
     * closingMenu; "Can't talk right now" draws them again without the speaking round.
     */
    const showMenu = () => {
      const now = Date.now();
      const options = closingMenu({
        minutesToday: todayTotals(app.state.sessions, now).minutesToday,
        settings,
        lessonRemaining: lesson !== null && unmetItems(lesson, known(), app.allowPending) > 0,
        mode,
        moreAvailable: buildMoreRound({ now, states: known(), practised, missed, settings }).length > 0,
      });
      const onCantTalk = () => {
        choose('talk');
        showMenu();
      };
      const menu = renderMenu(options, (option) => actions[option](), mode.cantTalk ? {} : { onCantTalk });
      mount(stage, h('article', { class: 'exercise closing' },
        h('h2', { class: 'prompt' }, 'Session complete.'),
        h('p', { class: 'en-text' }, `${summary.charAt(0).toUpperCase()}${summary.slice(1)}.`),
        checkpointUnit && h('div', { class: 'actions closing-checkpoint' },
          h('a', { class: 'btn btn-secondary', href: `#/checkpoint?unit=${checkpointUnit.id}` }, 'Take the unit checkpoint')),
        menu));
      /** @type {HTMLElement|null} */ (menu.querySelector('button'))?.focus();
    };
    showMenu();
  };

  const play = async () => {
    await buildQueue();
    if (!alive) return;
    if (queue.length === 0) {
      hideControls();
      showProgress(0);
      mount(stage, h('article', { class: 'exercise closing' },
        h('h2', { class: 'prompt' }, 'Nothing to practise right now.'),
        h('p', { class: 'en-text' }, 'Your reviews are done for the moment. Come back later today or tomorrow.'),
        h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: () => navigate('/today') }, 'Back to Today'))));
      return;
    }
    for (let index = 0; index < queue.length; index += 1) {
      const entry = queue[index];
      current = index;
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
        const outcome = await draw(entry);
        if (!alive) return;
        // A skipped entry counts for nothing: no outcome, no mark, not played.
        if (outcome === null) continue;
        await settle(entry, index, outcome);
      }
      if (entry.itemId !== undefined) practised.add(entry.itemId);
      tally.played += 1;
      tally.kinds[entry.kind] = (tally.kinds[entry.kind] ?? 0) + 1;
      if (entry.kind === 'meet') tally.newItems += 1;
      marks.push(Date.now());
      // The provisional record: the run counts for what is done so far, should it never reach its end.
      if (alive && !recorded) await write(marks[marks.length - 1]);
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
