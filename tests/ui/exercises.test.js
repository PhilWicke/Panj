// tests/ui/exercises.test.js
// The pure parts of the structured, slot and dialogue exercises: blankify takes the first run of
// underscores as the blank (Ruling 10) and the prompt renders it as a gap; shuffle orders the
// options through the rng it is given; the outcomes map a pick to `aux` only, a slot answer to a
// recall of the exercise's item, and a dialogue's learner lines to one recall per item they
// practise plus one `aux` for the lines without items; a slot hides a base chunk that would give
// the answer away; a dialogue line counts as a miss when any of its items would; a line's playback
// holds the scene until it settles or for the line's wait at most; speaker labels. Listening
// offers the meaning among three other meanings of the lesson; a spoken attempt that does not
// match gets one more try, and a recogniser that cannot run turns the exercise self-rated; a
// spoken answer is compared with the item's form and its accepted variants; the perception sets
// are two or three similar words. The exercises' DOM runs in the browser check.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom } from '../helpers/fake-dom.js';
import { shuffle } from '../../app/js/util/shuffle.js';
import { blankify, promptWithBlank, structuredOutcome } from '../../app/js/ui/exercises/structured.js';
import { slotBase, slotOutcome } from '../../app/js/ui/exercises/slot.js';
import { dialogueOutcome, lineEffective, speakerLabel, playWaitMs, playWithin } from '../../app/js/ui/exercises/dialogue.js';
import { meaningOptions } from '../../app/js/ui/exercises/listening.js';
import { attemptOutcome, recognitionFallsBack, spokenVerdict } from '../../app/js/ui/exercises/speaking.js';
import { PERCEPTION_SETS, pickPerception } from '../../app/js/ui/exercises/perception.js';

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

test('playWaitMs gives a line its allowance plus time for its length at a slow speaking rate', () => {
  assert.equal(playWaitMs(''), 3000);
  assert.equal(playWaitMs('Dober večer.'), 4200);
  assert.ok(playWaitMs('Dober večer, kako ste danes?') > playWaitMs('Dober večer.'), 'a longer line waits longer');
});

test('playWithin goes on when the playback settles, however it settles, and after the wait when it never does', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  /** @param {() => Promise<unknown>} play @param {number} ms */
  const watch = (play, ms) => {
    const state = { settled: false, rejected: false };
    playWithin(play, ms).then(() => { state.settled = true; }, () => { state.rejected = true; });
    return state;
  };

  let calls = 0;
  const played = watch(() => { calls += 1; return Promise.resolve('device'); }, 5000);
  await flush();
  assert.ok(played.settled, 'a playback that ends lets the scene go on at once');
  assert.equal(calls, 1, 'the line is played once');

  const failed = watch(() => Promise.reject(new Error('no voice')), 5000);
  const thrown = watch(() => { throw new Error('player missing'); }, 5000);
  await flush();
  assert.ok(failed.settled && !failed.rejected, 'a failed playback goes on, never rejects');
  assert.ok(thrown.settled && !thrown.rejected, 'nor does a player that throws');

  /** @type {(value: string) => void} */
  let endLate = () => {};
  const stalled = watch(() => new Promise((resolve) => { endLate = resolve; }), 5000);
  const silent = watch(() => new Promise(() => {}), 4200);
  await flush();
  assert.ok(!stalled.settled && !silent.settled, 'a playback still going holds the scene');
  t.mock.timers.tick(4199);
  await flush();
  assert.ok(!silent.settled, 'until its wait is up');
  t.mock.timers.tick(1);
  await flush();
  assert.ok(silent.settled && !silent.rejected, 'a playback that never settles holds the scene for its wait at most');
  assert.ok(!stalled.settled);
  t.mock.timers.tick(800);
  await flush();
  assert.ok(stalled.settled, 'each line its own wait');
  endLate('device');
  await flush();
  assert.ok(stalled.settled && !stalled.rejected, 'an end after the wait changes nothing');
});

test('meaningOptions puts the meaning among three other meanings of the lesson, shuffled, or gives null when there are too few', () => {
  const evening = /** @type {Item} */ (lesson.items.find((each) => each.sl === 'Dober večer.'));
  const others = new Set(lesson.items.filter((each) => each.id !== evening.id).map((each) => each.en));
  const options = /** @type {string[]} */ (meaningOptions(evening, lesson, seeded(3)));
  assert.equal(options.length, 4);
  assert.equal(new Set(options).size, 4, 'four different meanings');
  assert.equal(options.filter((option) => option === evening.en).length, 1);
  for (const option of options) if (option !== evening.en) assert.ok(others.has(option), `${option} is another item of the lesson`);
  assert.deepEqual(meaningOptions(evening, lesson, seeded(3)), options, 'the same seed gives the same options');

  const places = new Set();
  const seen = new Set();
  for (let seed = 1; seed <= 40; seed += 1) {
    const each = /** @type {string[]} */ (meaningOptions(evening, lesson, seeded(seed)));
    places.add(each.indexOf(evening.en));
    for (const option of each) seen.add(option);
  }
  assert.equal(places.size, 4, 'the meaning takes every place');
  assert.equal(seen.size, lesson.items.length, 'every other meaning of the lesson is drawn as a distractor');

  const twin = item({ id: 'u01-l01-i90', en: evening.en });
  const small = { ...lesson, items: [evening, twin, item({ id: 'u01-l01-i91', en: 'Hi.' }), item({ id: 'u01-l01-i92', en: 'Bye.' })] };
  assert.equal(meaningOptions(evening, small, seeded(1)), null, 'another item with the same meaning is no distractor, so two are left');
  assert.equal(meaningOptions(evening, null, seeded(1)), null, 'no lesson');
});

test('attemptOutcome: a match is a correct recall; anything else gets one more try, then counts as a miss', () => {
  assert.equal(attemptOutcome('match', 1), 'correct');
  assert.equal(attemptOutcome('match', 2), 'correct');
  assert.equal(attemptOutcome('close', 1), 'retry');
  assert.equal(attemptOutcome('miss', 1), 'retry');
  assert.equal(attemptOutcome('close', 2), 'wrong');
  assert.equal(attemptOutcome('miss', 2), 'wrong');
});

test('recognitionFallsBack: a refusal or a recogniser that cannot run turns the exercise self-rated; silence and the timeout do not', () => {
  for (const error of ['not-allowed', 'service-not-allowed', 'audio-capture', 'network', 'language-not-supported', 'unavailable', 'start-failed']) {
    assert.equal(recognitionFallsBack(error), true, error);
  }
  for (const error of ['no-speech', 'timeout', 'aborted']) assert.equal(recognitionFallsBack(error), false, error);
});

test('spokenVerdict compares the transcript with the item form and its accepted variants, the best one counting', () => {
  const thanks = item({ sl: 'Hvala.', accept: ['Hvala lepa.'] });
  assert.equal(spokenVerdict('Hvala', thanks), 'match');
  assert.equal(spokenVerdict('hvala lepa', thanks), 'match', 'an accepted variant');
  assert.equal(spokenVerdict('hvala lep', thanks), 'close', 'close to the variant');
  assert.equal(spokenVerdict('nasvidenje', thanks), 'miss');
  assert.equal(spokenVerdict('dober vecer', item({ sl: 'Dober večer.' })), 'match', 'an item without variants');
});

test('PERCEPTION_SETS hold two or three similar words each, and pickPerception draws a set and the word to play from it', () => {
  assert.ok(PERCEPTION_SETS.length >= 5);
  for (const words of PERCEPTION_SETS) {
    assert.ok(words.length === 2 || words.length === 3, words.join('/'));
    assert.equal(new Set(words).size, words.length, `${words.join('/')}: different words`);
  }
  const joined = PERCEPTION_SETS.map((words) => words.join('/'));
  for (const pair of ['bil/bila', 'vas/vaš', 'peti/pesti', 'v šoli/šoli']) assert.ok(joined.includes(pair), pair);
  assert.ok(PERCEPTION_SETS.some((words) => words.includes('kosa') && words.includes('koza')), 'kosa/koza');

  assert.deepEqual(pickPerception(() => 0), { words: PERCEPTION_SETS[0], target: PERCEPTION_SETS[0][0] });
  const last = PERCEPTION_SETS[PERCEPTION_SETS.length - 1];
  assert.deepEqual(pickPerception(() => 0.999), { words: last, target: last[last.length - 1] });
  const targets = new Set();
  for (let seed = 1; seed <= 200; seed += 1) {
    const { words, target } = pickPerception(seeded(seed));
    assert.ok(words.includes(target));
    targets.add(target);
  }
  assert.equal(targets.size, PERCEPTION_SETS.flat().length, 'every word gets played');
});
