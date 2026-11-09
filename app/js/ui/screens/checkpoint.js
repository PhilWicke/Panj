// The checkpoint screen (spec 4.6): a unit's checkpoint from the unit page (`?unit=uNN`), the
// weekly check from Today (`?weekly=1`) and the placement check from onboarding (`?placement=1`).
// An intro card says what the check is, how many items and about how long, and for the weekly
// check asks for a prediction; then one item at a time, a typed recall through the shared answer
// field and feedback panel without the session's retry, a rule's quick check through the option
// group; then the end card. The engine (engine/checkpoint.js) builds, scores and applies; this
// screen applies the results only at the end, so leaving early records nothing. A passed unit
// checkpoint seals the unit in meta.sealed; the weekly check appends to meta.weeklyChecks and
// shows the calibration line; each check appends one SessionRecord. The placement runs the first
// unit's checkpoint and goes on to the next units while passing, each pass sealing its unit. The
// pure wording helpers are exported for the tests.

import { h, mount } from '../../util/dom.js';
import { localDateKey } from '../../util/time.js';
import { onlyKnown } from '../../content/loader.js';
import { navigate } from '../../router.js';
import { grade } from '../../engine/grading.js';
import { honeyFor } from '../../engine/progress.js';
import {
  WEEKLY_MIN_ITEMS, applyCheckpoint, buildUnitCheckpoint, buildWeeklyCheck, calibration, checkpointMinutes, scoreCheckpoint,
} from '../../engine/checkpoint.js';
import { appendSession, saveItemState, saveMeta } from '../../store/state.js';
import { answerField, mountFeedback } from '../components/answer-field.js';
import { optionGroup } from '../components/option-group.js';
import { promptWithBlank } from '../exercises/structured.js';

/** @typedef {import('../../app-types.js').App} App */
/** @typedef {import('../../content/types.js').UnitContent} UnitContent */
/** @typedef {import('../../engine/checkpoint.js').CheckpointItem} CheckpointItem */
/** @typedef {import('../../engine/checkpoint.js').CheckpointResult} CheckpointResult */
/** @typedef {import('../../engine/checkpoint.js').CheckpointScore} CheckpointScore */
/** @typedef {import('../../engine/progress.js').SessionRecord} SessionRecord */
/** @typedef {import('../../util/dom.js').Child} Child */
/** @typedef {'unit'|'weekly'|'placement'} CheckMode */

/**
 * One check to run: its items in blocks (the weekly check's three, or one block for a unit), the
 * unit it seals when passed, and where leaving it goes.
 * @typedef {object} Check
 * @property {CheckMode} mode
 * @property {string|null} unitId the unit a unit or placement check seals
 * @property {string} title "Unit 1 checkpoint", "Weekly check", "Placement check"
 * @property {string|null} subtitle the unit's Slovenian title
 * @property {{ label: string|null, items: CheckpointItem[] }[]} blocks a label names the block in the item's eyebrow
 * @property {{ href: string, label: string }} home the way out, before and after the check
 */

const MINUTE_MS = 60_000;
/** The units the placement check runs through, in order, while passing. */
const PLACEMENT_UNITS = ['u01', 'u02', 'u03'];
/** The share of items the prediction input starts at. */
const PREDICTION_SHARE = 0.8;

/**
 * "8 items, about 3 min".
 * @param {number} count
 * @returns {string}
 */
export function countLine(count) {
  return `${count} ${count === 1 ? 'item' : 'items'}, about ${checkpointMinutes(count)} min`;
}

/**
 * Where the weekly check's prediction input starts: 80 percent of the items.
 * @param {number} count
 * @returns {number}
 */
export function defaultPrediction(count) {
  return Math.round(PREDICTION_SHARE * count);
}

/**
 * One line on what the check is.
 * @param {CheckMode} mode
 * @returns {string}
 */
export function aboutLine(mode) {
  if (mode === 'weekly') return 'A quick look back at what you have learnt.';
  if (mode === 'placement') return "Pass a unit's checkpoint to start after it.";
  return 'Type each phrase in Slovenian. 80 percent passes and seals the unit.';
}

/**
 * "7 of 8 right, 88 percent." The percent is rounded here, for display only.
 * @param {CheckpointScore} score
 * @returns {string}
 */
export function resultLine(score) {
  return `${score.correct} of ${score.total} right, ${Math.round(score.pct)} percent.`;
}

/**
 * @param {boolean} passed
 * @returns {string}
 */
export function verdictLine(passed) {
  return passed ? 'Passed. The unit is sealed in your hive.' : 'Not yet. Keep practising and take it again when you are ready.';
}

/**
 * The weekly check's calibration line: the prediction, the result and the difference in words.
 * @param {number} predicted
 * @param {number} actual
 * @returns {string}
 */
export function calibrationLine(predicted, actual) {
  const { delta } = calibration(predicted, actual);
  const judged = delta === 0 ? 'Spot on.' : delta > 0 ? `${delta} more than you thought.` : `${-delta} fewer than you thought.`;
  return `You predicted ${predicted} and got ${actual}. ${judged}`;
}

/** @param {Check} check @returns {number} */
const totalOf = (check) => check.blocks.reduce((sum, block) => sum + block.items.length, 0);

/**
 * Whether a unit has an item the learner can be checked on: an accepted one, or any in a dev build.
 * @param {App} app
 * @param {UnitContent} content
 * @returns {boolean}
 */
function hasPractisable(app, content) {
  return content.lessons.some((lesson) => lesson.items.some((item) => app.allowPending || item.verification.status === 'accepted'));
}

/**
 * The check of a unit: its practisable items and review items from the units before it.
 * @param {App} app
 * @param {string} unitId
 * @param {CheckMode} mode `unit` or `placement`
 * @returns {Check|null} null when the course has no such unit
 */
function unitCheck(app, unitId, mode) {
  const unit = app.index.units.find((candidate) => candidate.id === unitId);
  const content = app.units.find((candidate) => candidate.unit.id === unitId);
  if (!unit || !content) return null;
  const earlier = app.units.filter((candidate) => candidate.unit.order < unit.order);
  const states = onlyKnown(app.state.items, app.known);
  const items = hasPractisable(app, content)
    ? buildUnitCheckpoint(content, states, Math.random, { allowPending: app.allowPending, earlier })
    : [];
  const placement = mode === 'placement';
  return {
    mode,
    unitId,
    title: placement ? 'Placement check' : `Unit ${unit.order} checkpoint`,
    subtitle: placement ? null : unit.title_sl,
    blocks: [{ label: placement ? `Unit ${unit.order}` : null, items }],
    home: placement ? { href: '#/today', label: 'Skip the check' } : { href: `#/unit?id=${unit.id}`, label: 'Back to the unit' },
  };
}

/**
 * @param {App} app
 * @returns {Check}
 */
function weeklyCheck(app) {
  const { blocks } = buildWeeklyCheck(app.index, app.units, onlyKnown(app.state.items, app.known), Math.random);
  return {
    mode: 'weekly',
    unitId: null,
    title: 'Weekly check',
    subtitle: null,
    blocks: blocks.map((block) => ({ label: block.title, items: block.items })),
    home: { href: '#/today', label: 'Back to Today' },
  };
}

/**
 * The lines every card opens with: the title and, for a unit, its Slovenian title.
 * @param {Check} check
 * @returns {HTMLElement[]}
 */
function heading(check) {
  return [
    h('h1', { class: 'screen-title', tabindex: '-1' }, check.title),
    check.subtitle ? h('p', { class: 'sl-title', lang: 'sl' }, check.subtitle) : null,
  ].filter((el) => el !== null);
}

/**
 * Runs a checkpoint in `container`.
 * @param {HTMLElement} container
 * @param {App} app
 * @param {Record<string, string>} [params] `unit=uNN`, `weekly=1` or `placement=1`
 * @returns {() => void} stops the check when the screen is left; nothing is recorded before the end card
 */
export function renderCheckpoint(container, app, params = {}) {
  const settings = app.state.settings;
  let alive = true;

  /** @param {...Child} children */
  const view = (...children) => {
    if (alive) mount(container, h('section', { class: 'screen screen-checkpoint' }, ...children));
  };

  /**
   * The intro card, or the reason the check cannot run.
   * @param {Check} check
   * @param {(predicted: number) => void} onStart
   */
  const intro = (check, onStart) => {
    const total = totalOf(check);
    const back = h('a', { class: 'btn btn-quiet', href: check.home.href }, check.home.label);
    if (total === 0 || (check.mode === 'weekly' && total < WEEKLY_MIN_ITEMS)) {
      view(heading(check),
        h('p', { class: 'en-text' }, check.mode === 'weekly'
          ? `The weekly check needs at least ${WEEKLY_MIN_ITEMS} items you have met. Practise a little more first.`
          : 'There is nothing to check here yet.'),
        h('div', { class: 'actions' }, back));
      return;
    }
    const prediction = check.mode === 'weekly' ? /** @type {HTMLInputElement} */ (h('input', {
      id: 'checkpoint-prediction', type: 'number', class: 'text-input number-input', min: '0', max: String(total), step: '1',
      inputmode: 'numeric', value: String(defaultPrediction(total)),
    })) : null;
    const start = () => {
      const typed = prediction ? Math.round(Number(prediction.value)) : 0;
      onStart(Number.isFinite(typed) ? Math.min(total, Math.max(0, typed)) : defaultPrediction(total));
    };
    view(h('form', { class: 'checkpoint-intro', onsubmit: (/** @type {SubmitEvent} */ event) => { event.preventDefault(); start(); } },
      heading(check),
      h('p', { class: 'en-text' }, aboutLine(check.mode)),
      h('p', { class: 'checkpoint-count' }, countLine(total)),
      prediction && h('div', { class: 'field' },
        h('label', { class: 'field-label', for: 'checkpoint-prediction' }, `How many of these ${total} will you get right?`),
        prediction),
      h('div', { class: 'actions actions-stack' },
        h('button', { type: 'submit', class: 'btn btn-primary btn-large' }, 'Start'),
        back)));
  };

  /**
   * One item, answered: a typed recall graded against the answer and its variants, or a rule's
   * quick check. A slip is right for the pass mark (Ruling 55).
   * @param {Check} check
   * @param {CheckpointItem} item
   * @param {string|null} label the block's name
   * @param {number} n 1-based
   * @param {number} total
   * @returns {Promise<CheckpointResult>}
   */
  const ask = (check, item, label, n, total) => new Promise((resolve) => {
    const head = h('div', { class: 'session-bar' },
      h('a', { class: 'btn btn-quiet session-end', href: check.home.href }, 'End'),
      h('p', { class: 'checkpoint-progress' }, `${n} of ${total}`));
    const verb = item.kind === 'rule' ? 'choose the form' : 'write in Slovenian';
    const eyebrow = label ? `${label}: ${verb}` : `${verb.charAt(0).toUpperCase()}${verb.slice(1)}`;
    if (item.kind === 'rule') {
      const { prompt, blank } = promptWithBlank(item.prompt_sl ?? '');
      const { group, result, actions } = optionGroup({
        options: item.options ?? [], answer: item.answer, label: item.prompt_sl ?? '', lang: 'sl',
        onPick: (choice, correct) => {
          blank.replaceChildren(item.answer);
          blank.classList.add('blank-filled');
          return !correct && h('p', null, 'The answer is ', h('span', { lang: 'sl', class: 'quick-check-answer' }, item.answer), '. ', item.explain_en ?? '');
        },
        onContinue: (choice, correct) => resolve({ itemId: item.itemId, correct }),
      });
      view(head, h('article', { class: 'exercise exercise-structured' }, h('p', { class: 'eyebrow' }, eyebrow), prompt, group, result, actions));
      prompt.setAttribute('tabindex', '-1');
      prompt.focus();
      return;
    }
    const slot = h('div', { class: 'feedback-slot' });
    const { form, input } = answerField({
      id: `checkpoint-${item.itemId}`,
      label: 'Your answer in Slovenian',
      onAnswer: (answer) => {
        const graded = grade(answer, item.answer, item.accept);
        mountFeedback(slot, {
          answer, graded, effective: graded.result, target: item.answer, rule: null, retry: false,
          onDone: () => resolve({ itemId: item.itemId, correct: graded.result !== 'wrong' }),
        });
      },
    });
    view(head, h('article', { class: 'exercise exercise-typed' }, h('p', { class: 'eyebrow' }, eyebrow), h('h2', { class: 'prompt-en' }, item.prompt_en ?? ''), form, slot));
    input.focus();
  });

  /**
   * Applies and records a finished check: the changed states, the seal of a passed unit, the
   * weekly check's entry, and one SessionRecord.
   * @param {Check} check
   * @param {CheckpointResult[]} results
   * @param {number} predicted
   * @param {number} startedAt
   * @returns {Promise<CheckpointScore>}
   */
  const finish = async (check, results, predicted, startedAt) => {
    const now = Date.now();
    const score = scoreCheckpoint(results);
    const weekly = check.mode === 'weekly';
    const changed = applyCheckpoint(onlyKnown(app.state.items, app.known), results, weekly || score.passed, now, settings);
    for (const state of Object.values(changed)) {
      app.state.items[state.itemId] = state;
      await saveItemState(app.adapter, state);
    }
    const meta = app.state.meta;
    if (check.unitId !== null && score.passed) {
      meta.sealed = { ...(meta.sealed ?? {}), [check.unitId]: localDateKey(now) };
      await saveMeta(app.adapter, meta);
    }
    if (weekly) {
      meta.weeklyChecks = [...(meta.weeklyChecks ?? []), { at: localDateKey(now), total: score.total, correct: score.correct, predicted }];
      await saveMeta(app.adapter, meta);
    }
    /** @type {SessionRecord} */
    const record = {
      id: `${startedAt}-${globalThis.crypto.randomUUID()}`,
      startedAt,
      endedAt: now,
      minutes: (now - startedAt) / MINUTE_MS,
      recalls: score.total,
      correct: score.correct,
      newItems: 0,
      honey: honeyFor(score.correct),
      kinds: { [weekly ? 'weekly' : 'checkpoint']: score.total },
    };
    app.state.sessions.push(record);
    await appendSession(app.adapter, record);
    return score;
  };

  /**
   * Plays every item of a check, then applies it.
   * @param {Check} check
   * @param {number} predicted
   * @returns {Promise<CheckpointScore|null>} null when the screen was left
   */
  const run = async (check, predicted) => {
    const startedAt = Date.now();
    const items = check.blocks.flatMap((block) => block.items.map((item) => ({ item, label: block.label })));
    /** @type {CheckpointResult[]} */
    const results = [];
    for (let i = 0; i < items.length; i += 1) {
      if (!alive) return null;
      results.push(await ask(check, items[i].item, items[i].label, i + 1, items.length));
    }
    if (!alive) return null;
    return finish(check, results, predicted, startedAt);
  };

  /**
   * The end card: the result, the verdict or the calibration line, and the way on.
   * @param {Check} check
   * @param {CheckpointScore} score
   * @param {number|null} predicted the weekly check's prediction
   */
  const endCard = (check, score, predicted) => {
    const weekly = check.mode === 'weekly';
    const onward = check.mode === 'placement' ? { href: '#/today', label: 'Start on Today' }
      : weekly ? { href: '#/today', label: 'Back to Today' }
        : score.passed ? { href: '#/hive', label: 'See your hive' } : check.home;
    view(heading(check),
      h('p', { class: 'prompt checkpoint-result' }, resultLine(score)),
      weekly ? h('p', { class: 'en-text' }, calibrationLine(predicted ?? 0, score.correct)) : h('p', { class: 'en-text' }, verdictLine(score.passed)),
      h('div', { class: 'actions actions-stack' }, h('a', { class: 'btn btn-primary btn-large', href: onward.href }, onward.label)));
    /** @type {HTMLElement|null} */ (container.querySelector('.screen-title'))?.focus();
  };

  const notFound = () => {
    view(h('h1', { class: 'screen-title' }, 'Checkpoint not found'),
      h('p', { class: 'en-text' }, 'This check is not in the course.'),
      h('div', { class: 'actions' }, h('a', { class: 'btn btn-quiet', href: '#/today' }, 'Back to Today')));
  };

  /** @param {Promise<void>} flow */
  const guard = (flow) => {
    flow.catch((error) => {
      console.error(error);
      if (!alive) return;
      view(h('h1', { class: 'screen-title' }, 'Something went wrong.'),
        h('p', { class: 'en-text' }, 'The check stopped and nothing was recorded.'),
        h('div', { class: 'actions' }, h('a', { class: 'btn btn-primary', href: '#/today' }, 'Back to Today')));
    });
  };

  if (params.weekly === '1') {
    const check = weeklyCheck(app);
    intro(check, (predicted) => guard((async () => {
      const score = await run(check, predicted);
      if (score) endCard(check, score, predicted);
    })()));
  } else if (params.placement === '1') {
    const first = unitCheck(app, PLACEMENT_UNITS[0], 'placement');
    if (!first) notFound();
    else {
      intro(first, () => guard((async () => {
        let check = first;
        for (let k = 0; ; k += 1) {
          const score = await run(check, 0);
          if (!score) return;
          const nextId = PLACEMENT_UNITS[k + 1];
          const next = score.passed && nextId !== undefined ? unitCheck(app, nextId, 'placement') : null;
          if (!next || totalOf(next) === 0 || !next.blocks[0].items.some((item) => item.itemId.startsWith(`${nextId}-`))) {
            endCard(check, score, null);
            return;
          }
          check = next;
        }
      })()));
    }
  } else if (params.unit) {
    const check = unitCheck(app, params.unit, 'unit');
    if (!check) notFound();
    else {
      intro(check, () => guard((async () => {
        const score = await run(check, 0);
        if (score) endCard(check, score, null);
      })()));
    }
  } else {
    notFound();
  }

  return () => {
    alive = false;
  };
}
