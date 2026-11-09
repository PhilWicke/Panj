// The Rules screen (Pravila, spec 6): every rule card met so far, grouped by unit in course order.
// Each entry shows the compact card and a mastery meter (honey): empty and marked "Learning" until
// the rule's quick check graduates it, then its progress towards mastered times its retrievability;
// a tap opens the full card with its table open, where the toggles and the quick check work as in
// a session but record nothing. A search box filters by title and card text, ignoring case and
// diacritics. The pure parts are exported for the tests.

import { h, mount } from '../../util/dom.js';
import { MASTERY_SESSIONS, retrievability } from '../../engine/scheduler.js';
import { stripDiacritics } from '../../engine/grading.js';
import { renderRuleCard } from '../components/rulecard.js';

/** @typedef {import('../../main.js').App} App */
/** @typedef {import('../../content/types.js').Rule} Rule */
/** @typedef {import('../../content/types.js').Unit} Unit */
/** @typedef {import('../../engine/scheduler.js').ItemState} ItemState */

/**
 * The rules the learner has met (their item has a state whose phase is not `new`), grouped by
 * unit in the order of `units`, each group in the order of `rules`. Units without one are left out.
 * @param {Rule[]} rules
 * @param {Record<string, ItemState>} states by id, rule ids included
 * @param {Unit[]} units in course order
 * @returns {{ unit: Unit, rules: Rule[] }[]}
 */
export function rulesByUnit(rules, states, units) {
  const met = rules.filter((rule) => (states[rule.id]?.phase ?? 'new') !== 'new');
  return units
    .map((unit) => ({ unit, rules: met.filter((rule) => rule.unit === unit.id) }))
    .filter((group) => group.rules.length > 0);
}

/** @param {string} text @returns {string} lowercase and without diacritics */
const fold = (text) => stripDiacritics(text).toLowerCase();

/**
 * Whether a rule matches the search: every word of the query occurs in its title or card text,
 * ignoring case and diacritics. An empty query matches every rule.
 * @param {Rule} rule
 * @param {string} query
 * @returns {boolean}
 */
export function matchesRule(rule, query) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const text = fold(`${rule.title_en} ${rule.card_en}`);
  return words.every((word) => text.includes(word));
}

/**
 * The mastery meter of a rule. While the rule is learning (no FSRS card yet) the meter is empty:
 * retrievability says 1 there by convention, which is no prediction. From review on, the way to
 * mastered (spec 4.2, correct recalls in MASTERY_SESSIONS later sessions on distinct local days) has
 * MASTERY_SESSIONS + 1 steps: graduating is the first, each session counted towards mastery one more,
 * mastered all of them. The value is the share of steps done times the retrievability now, so it dips
 * as the rule fades and a rule that is not mastered never reaches 1. A lapse keeps the sessions
 * counted (the rule is back in rotation, stage review), and mastered is a lifetime flag.
 * @param {ItemState} state
 * @param {number} now epoch ms
 * @returns {{ stage: 'learning'|'review'|'mastered', value: number }} value 0 to 1
 */
export function ruleMastery(state, now) {
  if (state.phase === 'new' || state.phase === 'learning' || !state.card) return { stage: 'learning', value: 0 };
  const steps = MASTERY_SESSIONS + 1;
  const done = state.mastered ? steps : Math.min(1 + state.masterySessions.length, MASTERY_SESSIONS);
  return { stage: state.mastered ? 'mastered' : 'review', value: (done / steps) * retrievability(state, now) };
}

/** No-op: the quick check on the Rules screen is practice and records nothing. */
const practice = () => {};

/**
 * One entry of the list: the compact card, the mastery meter, and the button that opens the full card.
 * @param {Rule} rule
 * @param {ItemState} state
 * @param {number} now epoch ms
 * @returns {HTMLElement}
 */
function renderEntry(rule, state, now) {
  const { stage, value } = ruleMastery(state, now);
  const percent = Math.round(value * 100);
  const shown = stage === 'learning' ? 'Learning' : stage === 'mastered' ? 'Mastered' : `${percent}%`;
  const fullId = `rule-full-${rule.id}`;
  const labelId = `rule-mastery-${rule.id}`;
  const compact = renderRuleCard(rule, { compact: true, onQuickCheck: practice });
  const holder = h('div', { class: 'rule-entry-full', id: fullId, hidden: true });
  /** @type {HTMLElement|null} */
  let full = null;

  const toggle = h('button', {
    type: 'button', class: 'btn btn-quiet rule-open', 'aria-expanded': 'false', 'aria-controls': fullId,
    onclick: () => {
      const opening = holder.hidden;
      if (opening && !full) {
        full = renderRuleCard(rule, { onQuickCheck: practice, tableOpen: true });
        holder.append(full);
      }
      holder.hidden = !opening;
      compact.hidden = opening;
      toggle.setAttribute('aria-expanded', String(opening));
      toggle.textContent = opening ? 'Close card' : 'Open card';
      if (opening) /** @type {HTMLElement|null} */ (full?.querySelector('.rule-title') ?? null)?.focus();
    },
  }, 'Open card');

  return h('li', { class: 'rule-entry' },
    compact,
    holder,
    h('div', { class: 'rule-entry-meta' },
      h('span', { class: 'rule-mastery-label', id: labelId }, 'Mastery'),
      h('div', {
        class: 'meter', role: 'meter', 'aria-labelledby': labelId,
        'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(percent),
        'aria-valuetext': stage === 'review' ? `${percent} percent` : `${shown}, ${percent} percent`,
      }, h('div', { class: 'meter-fill', style: { width: `${percent}%` } })),
      h('span', { class: 'rule-mastery-value' }, shown),
      toggle));
}

/**
 * @param {HTMLElement} container
 * @param {App} app
 */
export function renderRules(container, app) {
  const now = Date.now();
  const groups = rulesByUnit(app.index.rules, app.state.items, app.index.units);
  const title = h('h1', { class: 'screen-title' }, 'Rules');
  if (groups.length === 0) {
    mount(container, h('section', { class: 'screen screen-rules' }, title,
      h('p', { class: 'en-text' }, 'Rule cards appear here as you meet them.')));
    return;
  }

  /** @type {{ rule: Rule, entry: HTMLElement, group: HTMLElement }[]} */
  const entries = [];
  const sections = groups.map(({ unit, rules }) => {
    const headingId = `rules-${unit.id}`;
    const list = h('ul', { class: 'rule-list' });
    const group = h('section', { class: 'rule-group', 'aria-labelledby': headingId },
      h('h2', { class: 'rule-group-title', id: headingId },
        h('span', { class: 'eyebrow' }, `Unit ${unit.order}`),
        h('span', { class: 'sl-title', lang: 'sl' }, unit.title_sl),
        h('span', { class: 'en-text' }, unit.title_en)),
      list);
    for (const rule of rules) {
      const entry = renderEntry(rule, app.state.items[rule.id], now);
      list.append(entry);
      entries.push({ rule, entry, group });
    }
    return group;
  });

  const none = h('p', { class: 'en-text', hidden: true }, 'No rule card matches your search.');
  const search = /** @type {HTMLInputElement} */ (h('input', {
    id: 'rules-search', type: 'search', class: 'search-input', placeholder: 'Search rule cards',
    autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'search',
    oninput: () => {
      for (const { rule, entry } of entries) entry.hidden = !matchesRule(rule, search.value);
      for (const group of sections) group.hidden = entries.every((each) => each.group !== group || each.entry.hidden);
      none.hidden = entries.some(({ entry }) => !entry.hidden);
    },
  }));

  mount(container, h('section', { class: 'screen screen-rules' },
    title,
    h('div', { class: 'search' }, h('label', { class: 'visually-hidden', for: 'rules-search' }, 'Search rule cards'), search),
    sections,
    none));
}
