// The interactive rule card (spec 4.2, point 2). The full card shows the title, the card text and
// the example; each toggle swaps the example live; "Show table" opens the paradigm with its rows
// and cols, the dual column marked, and a tap on a form with a note shows the note under the
// table; the German and English helpers share one helper line; the quick check at the bottom
// offers its options through the shared option group (option-group.js), marks the right one,
// explains a wrong pick and reports through onQuickCheck once. The compact card is the title and
// the card text, for lists.

import { h } from '../../util/dom.js';
import { optionGroup } from './option-group.js';

/** @typedef {import('../../content/types.js').Rule} Rule */
/** @typedef {import('../../content/types.js').RuleCell} RuleCell */

/** Headers for the row and col keys the content uses; any other key shows as written. */
/** @type {Record<string, string>} */
const LABELS = { 1: '1st', 2: '2nd', 3: '3rd', sg: 'Singular', du: 'Dual', pl: 'Plural' };
/** Cols marked in the table, with the caption under their header: the dual is new to German and English speakers. */
/** @type {Record<string, string>} */
const MARKED_COLS = { du: 'exactly two' };
const BLANK = /_+/;

/**
 * The cells of the rule's paradigm table, row by row and within a row col by col, as the content
 * orders them. A cell the content leaves out is left out here and renders empty.
 * @param {Rule} rule
 * @returns {{ row: string, col: string, cell: RuleCell }[]}
 */
export function tableCellsFor(rule) {
  const table = rule.table;
  if (!table) return [];
  /** @type {{ row: string, col: string, cell: RuleCell }[]} */
  const cells = [];
  for (const row of table.rows) {
    for (const col of table.cols) {
      const cell = table.cells[`${row}.${col}`];
      if (cell) cells.push({ row, col, cell });
    }
  }
  return cells;
}

/**
 * The example a toggle option swaps in, or the card's own example when the rule has no such
 * toggle or option.
 * @param {Rule} rule
 * @param {number} toggleIndex
 * @param {string} option
 * @returns {{ sl: string, en: string }}
 */
export function exampleForToggle(rule, toggleIndex, option) {
  const examples = rule.toggles?.[toggleIndex]?.examples;
  return (examples && Object.hasOwn(examples, option) ? examples[option] : undefined) ?? rule.example;
}

/** @param {string} key @returns {string} */
const label = (key) => LABELS[key] ?? key;

/**
 * The paradigm table and the note line under it.
 * @param {Rule} rule
 * @param {string} id
 * @returns {HTMLElement}
 */
function renderTable(rule, id) {
  const table = /** @type {NonNullable<Rule['table']>} */ (rule.table);
  const cells = new Map(tableCellsFor(rule).map(({ row, col, cell }) => [`${row}.${col}`, cell]));
  const hasNotes = [...cells.values()].some((cell) => cell.note_en);
  const hint = 'Forms with a dot have a note. Tap one to read it.';
  const note = h('p', { class: 'rule-note quiet', 'aria-live': 'polite' }, hint);
  /** @type {HTMLElement|null} */
  let pressed = null;

  /**
   * @param {RuleCell} cell
   * @returns {HTMLElement[]}
   */
  const cellBody = (cell) => [
    cell.pronoun ? h('span', { class: 'rule-cell-pronoun', lang: 'sl' }, cell.pronoun) : null,
    h('span', { class: 'rule-cell-form', lang: 'sl' }, cell.form),
  ].filter((el) => el !== null);

  /**
   * @param {RuleCell} cell
   * @returns {HTMLElement}
   */
  const noted = (cell) => {
    const button = h('button', {
      type: 'button', class: 'rule-cell rule-cell-noted', 'aria-pressed': 'false',
      onclick: () => {
        const open = pressed !== button;
        pressed?.setAttribute('aria-pressed', 'false');
        pressed = open ? button : null;
        button.setAttribute('aria-pressed', String(open));
        note.classList.toggle('quiet', !open);
        if (open) {
          note.replaceChildren(h('span', { class: 'rule-note-form', lang: 'sl' }, [cell.pronoun, cell.form].filter(Boolean).join(' ')), ': ', cell.note_en ?? '');
        } else {
          note.replaceChildren(hint);
        }
      },
    }, cellBody(cell), h('span', { class: 'visually-hidden' }, ', has a note'));
    return button;
  };

  return h('div', { class: 'rule-table-wrap reveal', id, hidden: true },
    h('table', { class: 'rule-table' },
      h('caption', { class: 'visually-hidden' }, `${rule.title_en}, the forms`),
      h('thead', null, h('tr', null,
        h('td', null),
        table.cols.map((col) => h('th', { scope: 'col', class: MARKED_COLS[col] ? 'rule-col-marked' : null },
          label(col),
          MARKED_COLS[col] && h('span', { class: 'rule-col-caption' }, MARKED_COLS[col]))))),
      h('tbody', null, table.rows.map((row) => h('tr', null,
        h('th', { scope: 'row' }, label(row)),
        table.cols.map((col) => {
          const cell = cells.get(`${row}.${col}`);
          return h('td', { class: MARKED_COLS[col] ? 'rule-col-marked' : null },
            cell && (cell.note_en ? noted(cell) : h('span', { class: 'rule-cell' }, cellBody(cell))));
        }))))),
    hasNotes && note);
}

/**
 * The example and the toggles that swap it.
 * @param {Rule} rule
 * @returns {HTMLElement[]}
 */
function renderExample(rule) {
  const sl = h('p', { class: 'rule-example-sl', lang: 'sl' }, rule.example.sl);
  const en = h('p', { class: 'en-text' }, rule.example.en);
  const example = h('div', { class: 'rule-example', 'aria-live': 'polite' }, sl, en);
  const toggles = (rule.toggles ?? []).map((toggle, index) => {
    const initial = toggle.options.find((option) => exampleForToggle(rule, index, option).sl === rule.example.sl);
    /** @type {HTMLElement[]} */
    const buttons = toggle.options.map((option) => {
      const button = h('button', {
        type: 'button', class: 'segment', 'aria-pressed': String(option === initial),
        onclick: () => {
          for (const other of buttons) other.setAttribute('aria-pressed', String(other === button));
          const shown = exampleForToggle(rule, index, option);
          sl.textContent = shown.sl;
          en.textContent = shown.en;
        },
      }, option);
      return button;
    });
    return h('div', { class: 'rule-toggle', role: 'group', 'aria-label': toggle.label },
      h('p', { class: 'rule-toggle-label' }, toggle.label),
      h('div', { class: 'segmented' }, buttons));
  });
  return [example, ...toggles];
}

/**
 * The quick check: the prompt with its blank as a visible gap, the options through the shared
 * option group in the order the content gives them, and the feedback after a pick. The group adds
 * no Continue: the rule exercise adds its own, and the Rules screen needs none.
 * @param {Rule} rule
 * @param {(correct: boolean) => void} onQuickCheck
 * @returns {HTMLElement}
 */
function renderQuickCheck(rule, onQuickCheck) {
  const check = rule.quick_check;
  const [before, ...rest] = check.prompt_sl.split(BLANK);
  const blank = h('span', { class: 'blank' }, h('span', { class: 'visually-hidden' }, 'blank'));
  const prompt = h('p', { class: 'quick-check-prompt', lang: 'sl' }, before, rest.length > 0 && blank, rest.join(''));
  const { group, result } = optionGroup({
    options: check.options, answer: check.answer, label: 'Options', lang: 'sl',
    onPick: (choice, correct) => {
      blank.replaceChildren(check.answer);
      blank.classList.add('blank-filled');
      onQuickCheck(correct);
      return !correct && h('p', null, 'The answer is ', h('span', { lang: 'sl', class: 'quick-check-answer' }, check.answer), '. ', check.explain_en);
    },
  });

  return h('section', { class: 'quick-check', 'aria-label': 'Quick check' },
    h('p', { class: 'eyebrow' }, 'Quick check'),
    prompt,
    group,
    result);
}

/**
 * The rule card. `compact` draws the title and the card text only; `tableOpen` opens the table
 * at once, for the Rules screen.
 * @param {Rule} rule
 * @param {{ onQuickCheck(correct: boolean): void, compact?: boolean, tableOpen?: boolean }} opts
 * @returns {HTMLElement}
 */
export function renderRuleCard(rule, opts) {
  const title = h('h3', { class: 'rule-title', tabindex: '-1' }, rule.title_en);
  const text = h('p', { class: 'rule-text' }, rule.card_en);
  if (opts.compact) return h('article', { class: 'rule-card rule-card-compact' }, title, text);

  const helper = [rule.helper_de, rule.helper_en].filter(Boolean).join(' ');
  /** @type {HTMLElement|null} */
  let tableToggle = null;
  /** @type {HTMLElement|null} */
  let table = null;
  if (rule.table) {
    const tableId = `rule-table-${rule.id}`;
    const panel = renderTable(rule, tableId);
    const button = h('button', {
      type: 'button', class: 'btn btn-secondary', 'aria-expanded': 'false', 'aria-controls': tableId,
      onclick: () => {
        const open = panel.hidden;
        panel.hidden = !open;
        button.setAttribute('aria-expanded', String(open));
        button.textContent = open ? 'Hide table' : 'Show table';
      },
    }, 'Show table');
    if (opts.tableOpen) {
      panel.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      button.textContent = 'Hide table';
    }
    tableToggle = button;
    table = panel;
  }

  return h('article', { class: 'rule-card' },
    title,
    text,
    renderExample(rule),
    tableToggle && h('div', { class: 'tools' }, tableToggle),
    table,
    helper && h('p', { class: 'helper' }, helper),
    renderQuickCheck(rule, opts.onQuickCheck));
}
