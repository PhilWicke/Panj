// The dialogue scene (spec 4.2, point 5): the lesson's scripted exchange. The title and the
// setting, then the lines in order, as a transcript that grows: a line of another speaker shows
// its Slovenian large with the English under it and plays (unless muted), then the scene goes on;
// a learner line shows the English and a typed answer field, graded against the line's Slovenian
// with the diacritic rule, with the feedback panel after it. Once the learner goes on, the line
// stays in the transcript as it should be said. The outcome is one recall per item a learner line
// practises, with that line's result, and one `aux` for the learner lines without items. Spoken
// learner lines arrive with Task 14; this exercise types them whatever the speech setting says.

import { h, mount } from '../../util/dom.js';
import { grade } from '../../engine/grading.js';
import { renderFeedback } from '../components/feedback.js';
import { answerField } from './slot.js';

/** @typedef {import('./registry.js').ExerciseRender} ExerciseRender */
/** @typedef {import('./registry.js').ExerciseOutcome} ExerciseOutcome */
/** @typedef {import('../../engine/scheduler.js').RecallResult} RecallResult */
/** @typedef {import('../../content/types.js').DialogueLine} DialogueLine */

/** The learner's speaker id. */
const LEARNER = 'you';
/** Labels of the roles the content uses; any other role shows as written, capitalised. */
/** @type {Record<string, string>} */
const SPEAKERS = { you: 'You', host: 'Your host' };

/**
 * @param {string} speaker
 * @returns {string}
 */
export function speakerLabel(speaker) {
  return SPEAKERS[speaker] ?? `${speaker.charAt(0).toUpperCase()}${speaker.slice(1)}`;
}

/**
 * How a learner line's answer counts: as graded for a line without items, and a miss for a line
 * when any of its items would count it as one (a second slip in a row, effectiveResult).
 * @param {DialogueLine} line
 * @param {RecallResult} result as graded
 * @param {(itemId: string, recall: RecallResult) => RecallResult} effective
 * @returns {RecallResult}
 */
export function lineEffective(line, result, effective) {
  const items = line.new_items ?? [];
  return items.some((itemId) => effective(itemId, result) === 'wrong') ? 'wrong' : result;
}

/**
 * The scene's outcome. `results` runs parallel to `lines`, with each learner line's result as
 * graded and null for the other lines. A learner line with items gives a recall of each item with
 * its result; the learner lines without items make the `aux`, correct when none of them was
 * missed (a slip passes). Both are returned together.
 * @param {DialogueLine[]} lines
 * @param {(RecallResult|null|undefined)[]} results
 * @returns {{ recalls: { itemId: string, recall: RecallResult }[], aux: { kind: string, correct: boolean } }}
 */
export function dialogueOutcome(lines, results) {
  /** @type {{ itemId: string, recall: RecallResult }[]} */
  const recalls = [];
  let correct = true;
  lines.forEach((line, i) => {
    const result = results[i];
    if (line.speaker !== LEARNER || !result) return;
    const items = line.new_items ?? [];
    if (items.length > 0) for (const itemId of items) recalls.push({ itemId, recall: result });
    else if (result === 'wrong') correct = false;
  });
  return { recalls, aux: { kind: 'dialogue', correct } };
}

/**
 * A line as it is said, for the transcript.
 * @param {DialogueLine} line
 * @returns {HTMLElement[]}
 */
function said(line) {
  return [
    h('p', { class: 'eyebrow' }, speakerLabel(line.speaker)),
    h('p', { class: 'sl-title', lang: 'sl' }, line.sl),
    h('p', { class: 'en-text' }, line.en),
  ];
}

/** @type {ExerciseRender} */
export function render(container, entry, ctx) {
  const dialogue = ctx.lesson?.dialogue;
  if (!dialogue) return Promise.resolve({});
  return new Promise((resolve) => {
    const lines = dialogue.lines;
    /** @type {(RecallResult|null)[]} */
    const results = lines.map(() => null);
    const transcript = h('ul', { class: 'examples', 'aria-label': 'The scene', 'aria-live': 'polite' });
    const actions = h('div', { class: 'actions' });
    const finish = () => resolve(dialogueOutcome(lines, results));

    /** @param {number} index */
    const step = async (index) => {
      if (index >= lines.length) {
        if (lines.at(-1)?.speaker === LEARNER) return finish();
        const next = h('button', { type: 'button', class: 'btn btn-primary', onclick: finish }, 'Continue');
        actions.append(next);
        next.focus();
        return;
      }
      const line = lines[index];
      if (line.speaker !== LEARNER) {
        transcript.append(h('li', { class: 'lesson-card' }, said(line)));
        // A scene left mid-way stops talking.
        if (!ctx.mode.mute && container.isConnected) await ctx.play(line.sl).catch(() => 'none');
        return step(index + 1);
      }

      const card = h('li', { class: 'lesson-card' });
      const feedbackSlot = h('div', { class: 'feedback-slot' });
      const { form, input } = answerField({
        id: `answer-${dialogue.id}-${index}`,
        label: 'Your line in Slovenian',
        onAnswer: (answer) => {
          const graded = grade(answer, line.sl, []);
          results[index] = graded.result;
          const panel = renderFeedback({
            answer, graded, effective: lineEffective(line, graded.result, ctx.effective), target: line.sl, rule: ctx.rule,
            onDone: () => {
              card.replaceChildren(...said(line));
              void step(index + 1);
            },
          });
          feedbackSlot.append(panel);
          /** @type {HTMLElement|null} */ (panel.querySelector('[data-autofocus]'))?.focus();
        },
      });
      card.append(
        h('p', { class: 'eyebrow' }, speakerLabel(line.speaker)),
        h('p', { class: 'prompt-en' }, line.en),
        form,
        feedbackSlot);
      transcript.append(card);
      input.focus();
    };

    mount(container, h('article', { class: 'exercise exercise-dialogue' },
      h('p', { class: 'eyebrow' }, 'Dialogue'),
      h('h2', { class: 'sl-title', lang: 'sl' }, dialogue.title_sl),
      h('p', { class: 'en-text' }, dialogue.title_en),
      h('p', { class: 'helper' }, dialogue.setting_en),
      transcript,
      actions));
    void step(0);
  });
}
