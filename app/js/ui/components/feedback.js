// The feedback panel after a typed answer (spec 4.5, Ruling 19). A wrong answer shows the
// learner's answer with the error marked inside it (typed letters that do not belong struck
// through, wrong letters highlighted, missing letters shown in a dashed box where they belong),
// the full correct form beside it in Slovenian size, the one-line rule when the item has one (on a
// miss, not on a slip that passes), and a retry: the learner types the correct form once more, ungraded, before going on. A slip names
// the letters ("Mind the č"); a second slip in a row says that it counts as a miss.

import { h } from '../../util/dom.js';

/** @typedef {import('../../engine/grading.js').GradeResult} GradeResult */
/** @typedef {import('../../engine/grading.js').DiffOp} DiffOp */
/** @typedef {import('../../engine/scheduler.js').RecallResult} RecallResult */
/** @typedef {import('../../content/types.js').Rule} Rule */

/**
 * "Mind the č", "Mind the č and ž", "Mind the č, š and ž".
 * @param {string[]} letters the slipped letters, as grade's slipChars gives them
 * @returns {string}
 */
export function mindThe(letters) {
  if (letters.length <= 1) return `Mind the ${letters[0] ?? 'accents'}`;
  return `Mind the ${letters.slice(0, -1).join(', ')} and ${letters[letters.length - 1]}`;
}

/**
 * The headline of the panel.
 * @param {GradeResult} graded
 * @param {RecallResult} effective how the recall counts
 * @returns {string}
 */
function headline(graded, effective) {
  if (graded.result === 'correct') return 'Correct.';
  if (graded.result === 'slip') {
    const mind = `${mindThe(graded.slipChars)}.`;
    return effective === 'wrong' ? `${mind} A second slip in a row counts as a miss.` : `Nearly. ${mind}`;
  }
  return 'Not quite.';
}

/**
 * The learner's answer with the diff runs marked.
 * @param {DiffOp[]} diff
 * @returns {HTMLElement}
 */
function markedAnswer(diff) {
  return h('span', { class: 'diff', lang: 'sl' }, diff.map((op) => {
    if (op.type === 'del') return h('del', { class: 'diff-del' }, op.text);
    if (op.type === 'sub') return h('mark', { class: 'diff-sub' }, op.text);
    if (op.type === 'add') return h('ins', { class: 'diff-add', title: 'Missing letters' }, op.text);
    return h('span', null, op.text);
  }));
}

/**
 * @param {object} opts
 * @param {string} opts.answer what the learner typed
 * @param {GradeResult} opts.graded
 * @param {RecallResult} opts.effective how the recall counts (effectiveResult)
 * @param {string} opts.target the Slovenian form as written in the content
 * @param {Rule|null} opts.rule
 * @param {() => void} opts.onDone called once, when the learner goes on
 * @returns {HTMLElement}
 */
export function renderFeedback({ answer, graded, effective, target, rule, onDone }) {
  const missed = effective === 'wrong';
  const tone = graded.result === 'correct' ? 'correct' : missed ? 'wrong' : 'slip';
  // A slip shows the variant the learner was writing; anything else shows the main form.
  const correctForm = graded.result === 'slip' && graded.matched ? graded.matched : target;
  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    onDone();
  };

  const actions = h('div', { class: 'actions' });
  const panel = h('section', { class: `feedback feedback-${tone}`, 'aria-live': 'polite' },
    h('p', { class: 'feedback-headline' }, headline(graded, effective)),
    graded.result !== 'correct' && h('div', { class: 'feedback-row' },
      h('span', { class: 'feedback-label' }, 'Your answer'),
      answer.trim() ? markedAnswer(graded.diff) : h('span', { class: 'feedback-empty' }, 'No answer')),
    h('div', { class: 'feedback-row' },
      h('span', { class: 'feedback-label' }, graded.result === 'correct' ? 'In Slovenian' : 'Correct form'),
      h('span', { class: 'sl-display feedback-form', lang: 'sl' }, correctForm)),
    missed && rule && h('div', { class: 'rule-line' },
      h('p', { class: 'rule-line-title' }, rule.title_en),
      h('p', null, rule.card_en)),
    actions);

  const continueButton = h('button', { type: 'button', class: missed ? 'btn btn-secondary' : 'btn btn-primary', onclick: done }, 'Continue');
  if (!missed) {
    continueButton.dataset.autofocus = '';
    actions.append(continueButton);
    return panel;
  }

  const retry = () => {
    const input = /** @type {HTMLInputElement} */ (h('input', {
      type: 'text', class: 'answer-input', lang: 'sl', autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off',
      spellcheck: 'false', enterkeyhint: 'done', 'aria-label': 'Type the correct form once more',
    }));
    const form = h('form', { class: 'retry-form', onsubmit: (/** @type {SubmitEvent} */ event) => { event.preventDefault(); done(); } },
      h('label', { class: 'feedback-label' }, 'Type it once more', input),
      h('button', { type: 'submit', class: 'btn btn-primary' }, 'Done'));
    actions.replaceChildren(form);
    input.focus();
  };
  actions.append(
    h('button', { type: 'button', class: 'btn btn-primary', 'data-autofocus': '', onclick: retry }, 'Type it again'),
    continueButton);
  return panel;
}
