// The rule exercise: a `rule` queue entry shows the interactive rule card. The quick check is the
// rule item's recall (its item id is the rule id): once the learner has picked an option and seen
// the feedback, "Continue" resolves with `correct` or `wrong`. The session screen records it, and
// its stateAfterRecall graduates a new or learning rule item on a correct pick (Rulings 21, 30).

import { h, mount } from '../../util/dom.js';
import { renderRuleCard } from '../components/rulecard.js';

/** @typedef {import('./registry.js').ExerciseRender} ExerciseRender */
/** @typedef {import('./registry.js').ExerciseOutcome} ExerciseOutcome */
/** @typedef {import('../../content/types.js').Rule} Rule */

/**
 * What a quick check reports: a recall of the rule item.
 * @param {Rule} rule
 * @param {boolean} correct
 * @returns {ExerciseOutcome}
 */
export function quickCheckOutcome(rule, correct) {
  return { itemId: rule.id, recall: correct ? 'correct' : 'wrong', aux: { kind: 'rule', correct } };
}

/** @type {ExerciseRender} */
export function render(container, entry, ctx) {
  const rule = ctx.rule;
  if (!rule) return Promise.resolve({});
  return new Promise((resolve) => {
    const actions = h('div', { class: 'actions' });
    const card = renderRuleCard(rule, {
      onQuickCheck: (correct) => {
        const next = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => resolve(quickCheckOutcome(rule, correct)) }, 'Continue');
        actions.append(next);
        next.focus();
      },
    });
    // The eyebrow is the exercise's heading, so the card's own title (an h3) sits under it.
    mount(container, h('article', { class: 'exercise exercise-rule' },
      h('h2', { class: 'eyebrow' }, 'Rule card'),
      card,
      actions));
    /** @type {HTMLElement|null} */ (card.querySelector('.rule-title'))?.focus();
  });
}
