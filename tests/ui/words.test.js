// tests/ui/words.test.js
// The Words screen's pure parts: wordRows lists the lesson items met so far (state past `new`) in
// course order, the index's lesson order and then the item order in the lesson, each with its
// phase or "mastered"; matchesWord filters on the Slovenian and the English, every word of the
// query, ignoring case and diacritics. The screen itself runs in the browser check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesWord, wordRows } from '../../app/js/ui/screens/words.js';

/** @param {string} id @param {string} sl @param {string} en @param {string} [register] */
const item = (id, sl, en, register = 'neutral') => ({
  id, type: 'chunk', sl, en, register, examples: [],
  verification: { review1: null, review2: null, native: null, status: 'accepted' },
});

/** @param {string} id @param {any[]} items */
const lesson = (id, items) => ({ id, unit: id.slice(0, 3), order: Number(id.slice(-2)), title_sl: id, title_en: id, items, rules: [], structured: [], production: [] });

/** The fields wordRows reads of a state. @param {string} itemId @param {string} phase @param {boolean} [mastered] */
const state = (itemId, phase, mastered = false) => ({ itemId, phase, mastered });

const L1 = lesson('u01-l01', [item('u01-l01-i01', 'Živjo', 'Hi', 'colloquial'), item('u01-l01-i02', 'Dober dan.', 'Good day.'), item('u01-l01-i03', 'Hvala.', 'Thank you.')]);
const L2 = lesson('u01-l02', [item('u01-l02-i01', 'Kako ste?', 'How are you? (formal)', 'formal'), item('u01-l02-i02', 'Čaj', 'Tea')]);
const L3 = lesson('u02-l01', [item('u02-l01-i01', 'Ena kava, prosim.', 'A coffee, please.')]);

/**
 * An app as wordRows reads it: the index's lesson order, the lessons by id (in another order on
 * purpose) and the states.
 * @param {Record<string, any>} items
 */
const appWith = (items) => ({
  index: { lessonIndex: [L1, L2, L3].map(({ id, unit, order }) => ({ id, unit, order, title_sl: id, title_en: id, itemCount: 3 })) },
  lessons: new Map([[L3.id, L3], [L2.id, L2], [L1.id, L1]]),
  state: { items },
});

const STATES = {
  'u02-l01-i01': state('u02-l01-i01', 'review'),
  'u01-l02-i02': state('u01-l02-i02', 'lapsed', true),
  'u01-l02-i01': state('u01-l02-i01', 'lapsed'),
  'u01-l01-i03': state('u01-l01-i03', 'review', true),
  'u01-l01-i02': state('u01-l01-i02', 'new'),
  'u01-l01-i01': state('u01-l01-i01', 'learning'),
  'r-ti-vi': state('r-ti-vi', 'review'),
  'u09-l01-i01': state('u09-l01-i01', 'review'),
};

test('wordRows lists the lesson items met so far in course order, each with its phase or mastered', () => {
  const rows = wordRows(appWith(STATES), '');
  assert.deepEqual(rows.map((row) => [row.item.id, row.status]), [
    ['u01-l01-i01', 'learning'],
    ['u01-l01-i03', 'mastered'],
    ['u01-l02-i01', 'lapsed'],
    ['u01-l02-i02', 'mastered'],
    ['u02-l01-i01', 'review'],
  ], 'new items, items without a state, rule states and states outside the course are left out; mastered wins over the phase');
  assert.equal(rows[0].item, L1.items[0], 'a row carries the item content itself');
  assert.deepEqual(wordRows(appWith({}), ''), [], 'nothing met, no rows');
});

test('wordRows filters with the search query, ignoring case and diacritics', () => {
  const ids = (query) => wordRows(appWith(STATES), query).map((row) => row.item.id);
  assert.deepEqual(ids('zivjo'), ['u01-l01-i01'], '"zivjo" finds "Živjo"');
  assert.deepEqual(ids('  CAJ '), ['u01-l02-i02'], '"caj" finds "Čaj", whatever the case and spaces');
  assert.deepEqual(ids('thank'), ['u01-l01-i03'], 'the English is searched too');
  assert.deepEqual(ids('dober'), [], 'a new item stays out whatever the query');
  assert.deepEqual(ids('formal how'), ['u01-l02-i01'], 'every word must occur, in any order');
  assert.deepEqual(ids('xyz'), []);
});

test('matchesWord: every word of the query in the Slovenian or the English, case and diacritics aside', () => {
  const zivjo = L1.items[0];
  const caj = L2.items[1];
  assert.equal(matchesWord(zivjo, ''), true, 'an empty query matches every word');
  assert.equal(matchesWord(zivjo, '   '), true);
  assert.equal(matchesWord(zivjo, 'Živjo'), true);
  assert.equal(matchesWord(zivjo, 'ZIVJO'), true);
  assert.equal(matchesWord(zivjo, 'živ'), true, 'a part of a word matches');
  assert.equal(matchesWord(zivjo, 'hi'), true);
  assert.equal(matchesWord(caj, 'čaj tea'), true);
  assert.equal(matchesWord(caj, 'caj coffee'), false, 'every word must occur');
  assert.equal(matchesWord(L3.items[0], 'kava prosim'), true);
});
