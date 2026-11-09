// tests/ui/rulecard.test.js
// The pure parts of the rule card, the rule exercise and the Rules screen: the paradigm cells in
// table order, the example a toggle option swaps in, the quick check's outcome and the state it
// leads to (Rulings 21 and 30), which rules the Rules screen lists and in what groups, and the
// search filter (case- and diacritic-insensitive). The card's DOM runs in the browser check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_SETTINGS, createState, skipAheadState } from '../../app/js/engine/scheduler.js';
import { tableCellsFor, exampleForToggle } from '../../app/js/ui/components/rulecard.js';
import { quickCheckOutcome } from '../../app/js/ui/exercises/rule.js';
import { matchesRule, rulesByUnit } from '../../app/js/ui/screens/rules.js';
import { stateAfterRecall } from '../../app/js/ui/screens/session.js';

/** @typedef {import('../../app/js/content/types.js').Rule} Rule */
/** @typedef {import('../../app/js/content/types.js').Unit} Unit */

/** @param {string} id @returns {Rule} */
const loadRule = (id) => JSON.parse(readFileSync(new URL(`../../content/rules/${id}.json`, import.meta.url), 'utf8'));
const biti = loadRule('r-biti-present');
const tiVi = loadRule('r-ti-vi');
const T0 = Date.UTC(2026, 0, 5, 9, 0);

/** @param {Partial<Rule>} fields @returns {Rule} */
const rule = (fields) => ({
  id: 'r-test',
  unit: 'u01',
  title_en: 'A test rule',
  card_en: 'A card.',
  example: { sl: 'Jaz sem tukaj.', en: 'I am here.' },
  quick_check: { prompt_sl: 'Jaz ___ tukaj.', options: ['sem', 'si'], answer: 'sem', explain_en: 'Jaz takes sem.' },
  ...fields,
});

/** @param {string} id @param {number} order @returns {Unit} */
const unit = (id, order) => ({ id, order, title_sl: id, title_en: id, motif: 'flower', lessons: [] });

test('tableCellsFor lists the cells row by row, each with its row and col, and skips the missing ones', () => {
  const cells = tableCellsFor(biti);
  assert.equal(cells.length, 9);
  assert.deepEqual(cells[0], { row: '1', col: 'sg', cell: { form: 'sem', pronoun: 'jaz' } });
  assert.deepEqual(cells.map(({ row, col }) => `${row}.${col}`),
    ['1.sg', '1.du', '1.pl', '2.sg', '2.du', '2.pl', '3.sg', '3.du', '3.pl'], 'rows outside, cols inside, in content order');
  assert.deepEqual(cells.filter(({ col }) => col === 'du').map(({ cell }) => cell.form), ['sva', 'sta', 'sta']);
  assert.match(cells[1].cell.note_en ?? '', /exactly two/);

  const sparse = rule({ table: { rows: ['1', '2'], cols: ['sg', 'pl'], cells: { '2.pl': { form: 'ste' }, '1.sg': { form: 'sem' } } } });
  assert.deepEqual(tableCellsFor(sparse), [
    { row: '1', col: 'sg', cell: { form: 'sem' } },
    { row: '2', col: 'pl', cell: { form: 'ste' } },
  ], 'a missing cell is left out, so it renders empty');
  assert.deepEqual(tableCellsFor(tiVi), [], 'a rule without a table has no cells');
});

test('exampleForToggle gives the example of the chosen option, and the card example for anything unknown', () => {
  assert.deepEqual(exampleForToggle(biti, 0, 'dual'), { sl: 'Midva sva tukaj.', en: 'We two are here.' });
  assert.deepEqual(exampleForToggle(biti, 0, 'plural'), { sl: 'Mi smo tukaj.', en: 'We are here.' });
  assert.deepEqual(exampleForToggle(tiVi, 0, 'an older person or a stranger'), { sl: 'Kako ste?', en: 'How are you?' });
  assert.deepEqual(exampleForToggle(biti, 0, 'trial'), biti.example, 'an option the toggle does not have');
  assert.deepEqual(exampleForToggle(biti, 3, 'dual'), biti.example, 'a toggle the rule does not have');
  assert.deepEqual(exampleForToggle(rule({}), 0, 'dual'), rule({}).example, 'a rule without toggles');
});

test('quickCheckOutcome records the quick check on the rule item: correct graduates it, wrong keeps it learning', () => {
  assert.deepEqual(quickCheckOutcome(biti, true), { itemId: 'r-biti-present', recall: 'correct', aux: { kind: 'rule', correct: true } });
  assert.deepEqual(quickCheckOutcome(biti, false), { itemId: 'r-biti-present', recall: 'wrong', aux: { kind: 'rule', correct: false } });

  const right = quickCheckOutcome(biti, true);
  const graduated = stateAfterRecall({}, /** @type {string} */ (right.itemId), /** @type {any} */ (right.recall), T0, DEFAULT_SETTINGS);
  assert.deepEqual(graduated.state, skipAheadState('r-biti-present', T0), 'a correct first quick check skips ahead to review');

  const missed = quickCheckOutcome(biti, false);
  const learning = stateAfterRecall({}, /** @type {string} */ (missed.itemId), /** @type {any} */ (missed.recall), T0, DEFAULT_SETTINGS);
  assert.equal(learning.state.phase, 'learning');
  assert.equal(learning.effective, 'wrong');
});

test('rulesByUnit lists the rules met (a state whose phase is not new), grouped by unit in course order', () => {
  const later = rule({ id: 'r-later', unit: 'u02' });
  const unmet = rule({ id: 'r-unmet', unit: 'u03' });
  const states = {
    'r-later': { ...createState('r-later', T0), phase: /** @type {const} */ ('learning') },
    'r-biti-present': skipAheadState('r-biti-present', T0),
    'r-ti-vi': createState('r-ti-vi', T0),
    'u01-l01-i01': skipAheadState('u01-l01-i01', T0),
  };
  const units = [unit('u01', 1), unit('u02', 2), unit('u03', 3)];
  const groups = rulesByUnit([later, tiVi, biti, unmet], states, units);
  assert.deepEqual(groups.map((group) => [group.unit.id, group.rules.map((r) => r.id)]),
    [['u01', ['r-biti-present']], ['u02', ['r-later']]], 'phase new and no state are left out, units without a rule met too');
  assert.deepEqual(rulesByUnit([biti, tiVi], {}, units), [], 'nothing met yet');
});

test('matchesRule filters by title and card text, ignoring case, diacritics and word order', () => {
  assert.equal(matchesRule(biti, ''), true, 'an empty query keeps every rule');
  assert.equal(matchesRule(biti, '   '), true);
  assert.equal(matchesRule(biti, 'TO BE'), true, 'title, any case');
  assert.equal(matchesRule(biti, 'exactly two'), true, 'card text');
  assert.equal(matchesRule(biti, 'dual biti'), true, 'every word, in any order');
  assert.equal(matchesRule(biti, 'dual stranger'), false, 'one word missing');
  assert.equal(matchesRule(tiVi, 'dual'), false);
  assert.equal(matchesRule(biti, 'Midva sva lačna'), false, 'the quick check is not searched');

  const kava = rule({ title_en: 'Feminine nouns as objects', card_en: 'Feminine nouns in -a take -o: kava, pijem kavo; žena, vidim ženo.' });
  assert.equal(matchesRule(kava, 'zeno'), true, 'a query without diacritics finds the word with them');
  assert.equal(matchesRule(kava, 'ŽENA'), true, 'diacritics and capitals in the query');
  assert.equal(matchesRule(rule({ card_en: 'Say kava.' }), 'káva'), true, 'diacritics in the query alone');
});
