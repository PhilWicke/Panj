// Typed recall, English to Slovenian: the core exercise (spec 4.5). The English prompt and the
// shared typed answer field (an input set up for Slovenian, Enter or "Check" to submit, "I don't
// know" to see the answer). The answer is graded against the item's form and accepted variants,
// the feedback panel shows the result, and the outcome carries the recall as graded; the session
// screen records it. A fluency entry runs through here once per item.

import { h, mount } from '../../util/dom.js';
import { grade } from '../../engine/grading.js';
import { answerField, feedbackSlot, mountFeedback } from '../components/answer-field.js';

/** @typedef {import('./registry.js').ExerciseRender} ExerciseRender */

/** @type {ExerciseRender} */
export function render(container, entry, ctx) {
  const item = ctx.item;
  if (!item) return Promise.resolve({});
  return new Promise((resolve) => {
    const feedback = feedbackSlot();
    const { form, input } = answerField({
      id: `answer-${item.id}`,
      label: 'Your answer in Slovenian',
      onAnswer: (answer) => {
        const graded = grade(answer, item.sl, item.accept ?? []);
        mountFeedback(feedback, {
          answer, graded, effective: ctx.effective(item.id, graded.result), target: item.sl, rule: ctx.rule,
          onDone: () => resolve({ itemId: item.id, recall: graded.result }),
        });
      },
    });

    mount(container, h('article', { class: 'exercise exercise-typed' },
      h('p', { class: 'eyebrow' }, entry.kind === 'fluency' ? 'Quick round: write in Slovenian' : 'Write in Slovenian'),
      h('h2', { class: 'prompt-en' }, item.en),
      form,
      feedback));
    input.focus();
  });
}
