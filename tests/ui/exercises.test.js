// tests/ui/exercises.test.js
// The pure parts of the structured, slot and dialogue exercises: blankify takes the first run of
// underscores as the blank (Ruling 10) and the prompt renders it as a gap; shuffle orders the
// options through the rng it is given; the outcomes map a pick to `aux` only, a slot answer to a
// recall of the exercise's item, and a dialogue's learner lines to one recall per item they
// practise plus one `aux` for the lines without items; a slot hides a base chunk that would give
// the answer away; a dialogue line counts as a miss when any of its items would; speaker labels.
// The exercises' DOM runs in the browser check.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom } from '../helpers/fake-dom.js';
import { blankify, shuffle, promptWithBlank, structuredOutcome } from '../../app/js/ui/exercises/structured.js';
import { slotBase, slotOutcome } from '../../app/js/ui/exercises/slot.js';
import { dialogueOutcome, lineEffective, speakerLabel } from '../../app/js/ui/exercises/dialogue.js';

/** @typedef {import('../../app/js/content/types.js').Lesson} Lesson */
/** @typedef {import('../../app/js/content/types.js').Item} Item */
/** @typedef {import('../../app/js/content/types.js').DialogueLine} DialogueLine */

/** @type {Lesson} */
const lesson = JSON.parse(readFileSync(new URL('../../content/lessons/u01-l01.json', import.meta.url), 'utf8'));

/** A deterministic generator in [0, 1) (mulberry32), so shuffles are repeatable. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** @param {Partial<Item>} fields @returns {Item} */
const item = (fields) => ({
  id: 'u03-l02-i01', type: 'chunk', sl: 'Lahko dobim kavo, prosim?', en: 'Can I have a coffee, please?', register: 'neutral',
  examples: [], verification: { review1: null, review2: null, native: null, status: 'accepted' }, ...fields,
});

before(() => {
  installFakeDom();
});

test('blankify splits the prompt at the first run of underscores, also one attached to a stem', () => {
  assert.deepEqual(blankify('Jaz ___ tukaj.'), { before: 'Jaz ', after: ' tukaj.' });
  assert.deepEqual(blankify('Midva ___ lačna.'), { before: 'Midva ', after: ' lačna.' });
  assert.deepEqual(blankify('Pijem kav_'), { before: 'Pijem kav', after: '' }, 'a one-letter blank at the end of a stem');
  assert.deepEqual(blankify('_ je tukaj.'), { before: '', after: ' je tukaj.' });
  assert.deepEqual(blankify('Jaz __ tukaj, ti ___ doma.'), { before: 'Jaz ', after: ' tukaj, ti ___ doma.' }, 'only the first run is the blank');
  assert.deepEqual(blankify('Jaz sem tukaj.'), { before: 'Jaz sem tukaj.', after: '' }, 'no blank: the whole prompt comes before the gap');
  for (const exercise of lesson.structured) {
    const { before: head, after: tail } = blankify(exercise.prompt_sl);
    assert.equal(`${head}___${tail}`, exercise.prompt_sl, exercise.id);
  }
});

test('promptWithBlank draws the text around a gap that reads as "blank" and can be filled', () => {
  const { prompt, blank } = promptWithBlank('Jaz ___ tukaj.');
  const el = /** @type {any} */ (prompt);
  assert.equal(el.getAttribute('lang'), 'sl');
  assert.equal(el.className, 'quick-check-prompt');
  assert.equal(el.childNodes.length, 3);
  assert.equal(el.childNodes[0].textContent, 'Jaz ');
  assert.equal(el.childNodes[1], blank);
  assert.equal(/** @type {any} */ (blank).className, 'blank');
  assert.equal(el.childNodes[2].textContent, ' tukaj.');
  assert.equal(prompt.textContent, 'Jaz blank tukaj.', 'the gap is announced as a blank');

  const stem = /** @type {any} */ (promptWithBlank('Pijem kav_').prompt);
  assert.equal(stem.childNodes.length, 2, 'no empty text after a blank that ends the prompt');
  assert.equal(stem.childNodes[0].textContent, 'Pijem kav');
});

test('shuffle returns a reordered copy drawn from the rng it is given, and leaves the input alone', () => {
  const options = ['sem', 'si', 'je', 'ste'];
  assert.deepEqual(shuffle(options, () => 0), ['si', 'je', 'ste', 'sem'], 'Fisher-Yates from the end, j = 0 each step');
  assert.deepEqual(shuffle(options, () => 0.999), options, 'j = i each step keeps the order');
  assert.deepEqual(options, ['sem', 'si', 'je', 'ste'], 'the input is not changed');
  assert.notEqual(shuffle(options, () => 0.999), options, 'always a new array');

  assert.deepEqual(shuffle(options, seeded(7)), shuffle(options, seeded(7)), 'the same seed gives the same order');
  const firsts = new Set();
  for (let seed = 1; seed <= 30; seed += 1) {
    const order = shuffle(options, seeded(seed));
    assert.deepEqual([...order].sort(), [...options].sort(), `seed ${seed}: the same options`);
    firsts.add(order[0]);
  }
  assert.equal(firsts.size, 4, 'over 30 seeds every option comes first at least once');
  assert.deepEqual(shuffle([], seeded(1)), []);
  assert.deepEqual(shuffle(['sem'], seeded(1)), ['sem']);
});

test('structuredOutcome reports the pick through aux only, never as a recall', () => {
  const [exercise] = lesson.structured;
  assert.deepEqual(structuredOutcome(exercise, 'sem'), { aux: { kind: 'structured', correct: true } });
  assert.deepEqual(structuredOutcome(exercise, 'ste'), { aux: { kind: 'structured', correct: false } });
  assert.ok(!('recall' in structuredOutcome(exercise, 'sem')) && !('itemId' in structuredOutcome(exercise, 'sem')));
});

test('slotBase shows the base chunk with its slot labels, unless the chunk itself would be accepted as the answer', () => {
  const coffee = item({ slots: [{ label: 'drink', fillers: ['u03-l02-i02', 'u03-l02-i03'] }] });
  const water = { id: 'u03-l02-p01', en: 'Ask for water instead.', answer: 'Lahko dobim vodo, prosim?', item: coffee.id, filler: 'vodo' };
  assert.deepEqual(slotBase(coffee, water), { chunk: 'Lahko dobim kavo, prosim?', labels: ['drink'] });
  assert.deepEqual(slotBase(item({}), water), { chunk: 'Lahko dobim kavo, prosim?', labels: [] }, 'a chunk without slots has no labels');

  const [evening] = lesson.production;
  const eveningItem = /** @type {Item} */ (lesson.items.find((each) => each.id === evening.item));
  assert.equal(slotBase(eveningItem, evening), null, 'the chunk is the answer: showing it would give it away');
  assert.equal(slotBase(item({ sl: 'Dober vecer.' }), evening), null, 'nor a chunk that differs from the answer only in diacritics');
  assert.equal(slotBase(item({ sl: 'Hvala lepa.' }), { ...evening, answer: 'Hvala.', accept: ['hvala lepa'] }), null, 'nor one an accept entry matches');
});

test('slotOutcome is a recall of the exercise item as graded', () => {
  const [evening] = lesson.production;
  assert.deepEqual(slotOutcome(evening, 'correct'), { itemId: 'u01-l01-i03', recall: 'correct' });
  assert.deepEqual(slotOutcome(evening, 'slip'), { itemId: 'u01-l01-i03', recall: 'slip' });
  assert.deepEqual(slotOutcome(evening, 'wrong'), { itemId: 'u01-l01-i03', recall: 'wrong' });
});

test('dialogueOutcome gives one recall per item of a learner line and counts the lines without items into aux', () => {
  const lines = /** @type {NonNullable<Lesson['dialogue']>} */ (lesson.dialogue).lines;
  assert.deepEqual(lines.map((line) => line.speaker), ['host', 'you', 'host', 'you', 'host', 'you']);

  assert.deepEqual(dialogueOutcome(lines, [null, 'correct', null, 'slip', null, 'correct']), {
    recalls: [{ itemId: 'u01-l01-i03', recall: 'correct' }, { itemId: 'u01-l01-i07', recall: 'slip' }],
    aux: { kind: 'dialogue', correct: true },
  });
  assert.deepEqual(dialogueOutcome(lines, [null, 'wrong', null, 'correct', null, 'slip']), {
    recalls: [{ itemId: 'u01-l01-i03', recall: 'wrong' }, { itemId: 'u01-l01-i07', recall: 'correct' }],
    aux: { kind: 'dialogue', correct: true },
  }, 'a missed line with items is a missed recall, not a wrong aux; a slip on a line without items passes');
  assert.deepEqual(dialogueOutcome(lines, [null, 'correct', null, 'correct', null, 'wrong']).aux,
    { kind: 'dialogue', correct: false }, 'a missed line without items makes the aux wrong');

  /** @type {DialogueLine[]} */
  const scene = [
    { speaker: 'waiter', sl: 'Kaj boste?', en: 'What will you have?', new_items: ['u03-l02-i09'] },
    { speaker: 'you', sl: 'Kavo in vodo, prosim.', en: 'A coffee and water, please.', new_items: ['u03-l02-i02', 'u03-l02-i03'] },
  ];
  assert.deepEqual(dialogueOutcome(scene, [null, 'slip']), {
    recalls: [{ itemId: 'u03-l02-i02', recall: 'slip' }, { itemId: 'u03-l02-i03', recall: 'slip' }],
    aux: { kind: 'dialogue', correct: true },
  }, 'a line with two items gives two recalls; a host line gives none; no line without items leaves the aux correct');
});

test('lineEffective counts a line as missed when any of its items would count the answer as a miss', () => {
  /** @type {(itemId: string, recall: import('../../app/js/engine/scheduler.js').RecallResult) => import('../../app/js/engine/scheduler.js').RecallResult} */
  const effective = (itemId, recall) => (itemId === 'slipped-before' && recall === 'slip' ? 'wrong' : recall);
  /** @type {DialogueLine} */
  const plain = { speaker: 'you', sl: 'Dobro, hvala.', en: 'Fine, thank you.' };
  const two = { ...plain, new_items: ['fresh', 'slipped-before'] };
  assert.equal(lineEffective(plain, 'slip', effective), 'slip', 'no items: as graded');
  assert.equal(lineEffective({ ...plain, new_items: ['fresh'] }, 'slip', effective), 'slip');
  assert.equal(lineEffective(two, 'slip', effective), 'wrong', 'a second slip on one of its items');
  assert.equal(lineEffective(two, 'correct', effective), 'correct');
  assert.equal(lineEffective(two, 'wrong', effective), 'wrong');
});

test('speakerLabel names the roles generically, in sentence case', () => {
  assert.equal(speakerLabel('you'), 'You');
  assert.equal(speakerLabel('host'), 'Your host');
  assert.equal(speakerLabel('waiter'), 'Waiter');
  assert.equal(speakerLabel('passer-by'), 'Passer-by');
  assert.equal(speakerLabel('colleague'), 'Colleague');
  assert.equal(speakerLabel('guide'), 'Guide', 'a role without a label shows as written, capitalised');
});
