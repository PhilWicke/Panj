// The Rules screen (Pravila, spec 6): every rule card met so far, grouped by unit in course order.
// Each entry shows the compact card and a mastery meter (the rule item's retrievability, honey);
// a tap opens the full card with its table open, where the toggles and the quick check work as in
// a session but record nothing. A search box filters by title and card text, ignoring case and
// diacritics. The pure parts are exported for the tests.

import { h, mount } from '../../util/dom.js';
import { retrievability } from '../../engine/scheduler.js';
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
  const percent = Math.round(retrievability(state, now) * 100);
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
        'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(percent), 'aria-valuetext': `${percent} percent`,
      }, h('div', { class: 'meter-fill', style: { width: `${percent}%` } })),
      h('span', { class: 'rule-mastery-value' }, `${percent}%`),
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
