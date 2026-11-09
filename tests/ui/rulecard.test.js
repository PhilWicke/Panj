// tests/ui/rulecard.test.js
// The pure parts of the rule card, the rule exercise and the Rules screen: the paradigm cells in
// table order, the example a toggle option swaps in, the quick check's outcome and the state it
// leads to (Rulings 21 and 30), which rules the Rules screen lists and in what groups, the mastery
// meter's value and stage, and the search filter (case- and diacritic-insensitive). Through
// tests/helpers/fake-dom.js, the quick check picks through the shared option group and reports
// once; the rest of the card's DOM runs in the browser check.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom } from '../helpers/fake-dom.js';
import {
  DEFAULT_SETTINGS, MASTERY_SESSIONS, createState, recordRecall, retrievability, skipAheadState,
} from '../../app/js/engine/scheduler.js';
import { renderRuleCard, tableCellsFor, exampleForToggle } from '../../app/js/ui/components/rulecard.js';
import { quickCheckOutcome } from '../../app/js/ui/exercises/rule.js';
import { matchesRule, ruleMastery, rulesByUnit } from '../../app/js/ui/screens/rules.js';
import { stateAfterRecall } from '../../app/js/ui/screens/session.js';

/** @typedef {import('../../app/js/content/types.js').Rule} Rule */
/** @typedef {import('../../app/js/content/types.js').Unit} Unit */

/** @param {string} id @returns {Rule} */
const loadRule = (id) => JSON.parse(readFileSync(new URL(`../../content/rules/${id}.json`, import.meta.url), 'utf8'));
const biti = loadRule('r-biti-present');
const tiVi = loadRule('r-ti-vi');
const T0 = Date.UTC(2026, 0, 5, 9, 0);
const DAY = 86_400_000;
/** @param {number} n @returns {number} n days after T0 */
const day = (n) => T0 + n * DAY;

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

before(() => {
  installFakeDom();
});

/** Every element under `root`, depth first. @param {any} root @returns {any[]} */
function elements(root) {
  /** @type {any[]} */
  const found = [];
  /** @param {any} node */
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (!child.tagName) continue;
      found.push(child);
      walk(child);
    }
  };
  walk(root);
  return found;
}

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

test('the quick check picks through the shared option group: the options in content order, one report, the gap filled, the reason on a miss', () => {
  /** @type {boolean[]} */
  const reports = [];
  const card = /** @type {any} */ (renderRuleCard(biti, { onQuickCheck: (correct) => reports.push(correct) }));
  const check = card.querySelector('.quick-check');
  const group = elements(check).find((el) => el.getAttribute('role') === 'group');
  assert.equal(group.className, 'options', 'the option group of option-group.js');
  assert.deepEqual(group.childNodes.map((/** @type {any} */ b) => b.textContent), ['sem', 'sva', 'smo'], 'as the content orders them');
  assert.ok(group.childNodes.every((/** @type {any} */ b) => b.className === 'btn btn-secondary option' && b.getAttribute('lang') === 'sl'));
  const result = check.querySelector('.pick-result');
  assert.equal(result.getAttribute('aria-live'), 'polite', 'the live region is there before the pick');
  assert.equal(result.childNodes.length, 0);

  const [sem, sva, smo] = group.childNodes;
  sem.dispatch('click');
  smo.dispatch('click');
  assert.deepEqual(reports, [false], 'reported once, at the first pick');
  assert.ok(sva.classList.contains('option-right') && sem.classList.contains('option-wrong'));
  assert.ok([sem, sva, smo].every((b) => b.disabled === true));
  assert.equal(check.querySelector('.blank').textContent, 'sva', 'the gap shows the answer');
  assert.equal(result.textContent, `Not quite.The answer is sva. ${biti.quick_check.explain_en}`);
  assert.equal(elements(card).filter((el) => el.tagName === 'BUTTON' && el.textContent === 'Continue').length, 0,
    'no Continue in the card: the rule exercise adds its own, the Rules screen needs none');

  const right = /** @type {any} */ (renderRuleCard(biti, { onQuickCheck: (correct) => reports.push(correct) }));
  const rightGroup = elements(right.querySelector('.quick-check')).find((el) => el.getAttribute('role') === 'group');
  rightGroup.childNodes[1].dispatch('click');
  assert.deepEqual(reports, [false, true]);
  assert.equal(right.querySelector('.pick-result').textContent, 'Correct.');
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

test('ruleMastery is empty while a rule is learning and fills with the sessions towards mastered, scaled by retrievability', () => {
  const steps = MASTERY_SESSIONS + 1;
  /** @param {import('../../app/js/engine/scheduler.js').ItemState} state @param {number} now */
  const percent = (state, now) => Math.round(ruleMastery(state, now).value * 100);

  const missed = stateAfterRecall({}, 'r-biti-present', 'wrong', T0, DEFAULT_SETTINGS).state;
  assert.equal(missed.phase, 'learning');
  assert.deepEqual(ruleMastery(missed, T0), { stage: 'learning', value: 0 }, 'a wrong first quick check reads empty, not 100 percent');
  assert.deepEqual(ruleMastery(createState('r-biti-present', T0), T0), { stage: 'learning', value: 0 }, 'phase new');

  // A correct first quick check graduates the rule through skipAheadState: the first of the steps.
  const graduated = skipAheadState('r-biti-present', T0);
  assert.deepEqual(ruleMastery(graduated, T0), { stage: 'review', value: retrievability(graduated, T0) / steps });
  assert.equal(percent(graduated, T0), 25, 'a rule that has just graduated is a quarter of the way');
  assert.ok(ruleMastery(graduated, day(30)).value < ruleMastery(graduated, T0).value, 'the meter dips as the rule fades');

  // Each correct recall on a later local day counts one more step (Ruling 18).
  const once = recordRecall(graduated, 'correct', day(8), DEFAULT_SETTINGS, 'UTC');
  assert.equal(once.masterySessions.length, 1);
  assert.deepEqual(ruleMastery(once, day(8)), { stage: 'review', value: (2 / steps) * retrievability(once, day(8)) });
  const twice = recordRecall(once, 'correct', day(20), DEFAULT_SETTINGS, 'UTC');
  assert.equal(twice.mastered, false);
  assert.deepEqual(ruleMastery(twice, day(20)), { stage: 'review', value: (3 / steps) * retrievability(twice, day(20)) });
  assert.ok(percent(twice, day(20)) < 100, 'a rule that is not mastered never reads 100 percent');

  // A lapse keeps the sessions already counted; the rule is back in rotation, not back to learning.
  const lapsed = recordRecall(once, 'wrong', day(9), DEFAULT_SETTINGS, 'UTC');
  assert.equal(lapsed.phase, 'lapsed');
  assert.deepEqual(ruleMastery(lapsed, day(9)), { stage: 'review', value: (2 / steps) * retrievability(lapsed, day(9)) });

  const mastered = recordRecall(twice, 'correct', day(40), DEFAULT_SETTINGS, 'UTC');
  assert.equal(mastered.mastered, true);
  assert.deepEqual(ruleMastery(mastered, day(40)), { stage: 'mastered', value: retrievability(mastered, day(40)) });
  assert.equal(percent(mastered, day(40)), 100);
  const fadedLapse = recordRecall(mastered, 'wrong', day(200), DEFAULT_SETTINGS, 'UTC');
  assert.equal(ruleMastery(fadedLapse, day(200)).stage, 'mastered', 'mastered is a lifetime flag, a lapse does not take it');
});
