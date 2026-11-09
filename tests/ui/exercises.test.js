// tests/ui/exercises.test.js
// The pure parts of the structured, slot and dialogue exercises: blankify takes the first run of
// underscores as the blank (Ruling 10) and the prompt renders it as a gap; shuffle orders the
// options through the rng it is given; the outcomes map a pick to `aux` only, a slot answer to a
// recall of the exercise's item, and a dialogue's learner lines to one recall per item they
// practise plus one `aux` for the lines without items; a slot hides a base chunk that would give
// the answer away; a dialogue line counts as a miss when any of its items would; a line's playback
// holds the scene until it settles or for the line's wait at most; speaker labels. Listening
// offers the meaning among three other meanings of the lesson; a spoken attempt that does not
// match gets one more try, and a recogniser error other than silence turns the exercise self-rated;
// a spoken answer is compared with the item's form and its accepted variants; the perception sets
// are two or three similar words. Through the fake DOM: an audio exercise turns into the no-audio
// line when nothing plays and finishes once, and a `none` that arrives once the learner has
// answered changes nothing; structured input, the meaning pick and the perception drill resolve
// their `aux` through the shared option group; the typed recall's feedback lands in a live region
// that was there before the answer, and the dialogue keeps one live region, its transcript; Speak
// waits while the model line plays; a refused microphone keeps the later speaking exercises
// self-rated until resetRecognition, a lost connection or a failed start only the one exercise.
// The rest of the exercises' DOM runs in the browser check.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom } from '../helpers/fake-dom.js';
import { h } from '../../app/js/util/dom.js';
import { shuffle } from '../../app/js/util/shuffle.js';
import { recognitionBlocked, resetRecognition } from '../../app/js/audio/speech.js';
import { audioExercise } from '../../app/js/ui/components/no-audio.js';
import { blankify, promptWithBlank, structuredOutcome, render as renderStructured } from '../../app/js/ui/exercises/structured.js';
import { slotBase, slotOutcome } from '../../app/js/ui/exercises/slot.js';
import { render as renderTyped } from '../../app/js/ui/exercises/typed.js';
import { dialogueOutcome, lineEffective, speakerLabel, playWaitMs, playWithin, render as renderDialogue } from '../../app/js/ui/exercises/dialogue.js';
import { meaningOptions, render as renderListening } from '../../app/js/ui/exercises/listening.js';
import { attemptOutcome, recognitionFallsBack, spokenVerdict, render as renderSpeaking } from '../../app/js/ui/exercises/speaking.js';
import { pickPerception, render as renderPerception } from '../../app/js/ui/exercises/perception.js';
import { PERCEPTION_SETS } from '../../app/js/content/perception-sets.js';

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

/** @type {ReturnType<typeof installFakeDom>} */
let document;

before(() => {
  document = installFakeDom();
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

/** The button under `root` that reads `text`, if any. @param {any} root @param {string} text */
const button = (root, text) => elements(root).find((el) => el.tagName === 'BUTTON' && el.textContent === text);

/** Lets timers of 0 ms and the promises after them run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

/**
 * An exercise context with nothing in it but the lesson, muted, speech off and a sound that plays.
 * @param {Record<string, unknown>} fields
 * @returns {any}
 */
const context = (fields) => ({
  item: null, rule: null, lesson, rules: [], settings: { speech: false }, mode: { mute: true, speech: false },
  play: async () => 'device', rng: seeded(1), allowPending: false, effective: (/** @type {string} */ id, /** @type {string} */ recall) => recall,
  ...fields,
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

test('recognitionFallsBack: a refusal or a recogniser that cannot run turns this exercise self-rated; silence and the timeout do not', () => {
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

test('audioExercise turns the exercise into the no-audio line when nothing plays, finishes once, and lets a late none pass', async () => {
  /** @type {unknown[]} */
  const outcomes = [];
  /** @type {string[]} */
  const played = [];
  const container = /** @type {any} */ (h('div', null, h('p', null, 'The drill')));
  const ends = audioExercise({
    container, text: 'koza', resolve: (outcome) => outcomes.push(outcome),
    play: async (text) => { played.push(text); return 'none'; },
  });
  ends.listen();
  await settle();
  assert.deepEqual(played, ['koza']);
  assert.equal(container.textContent, 'No audio on this device.Continue', 'the exercise is replaced by one line and Continue');
  const next = button(container, 'Continue');
  assert.equal(document.activeElement, next);
  next.dispatch('click');
  next.dispatch('click');
  ends.finish({ aux: { kind: 'perception', correct: true } });
  assert.deepEqual(outcomes, [{}], 'Continue finishes with no outcome, once');

  const playing = /** @type {any} */ (h('div', null, 'The drill'));
  audioExercise({ container: playing, text: 'bil', resolve: () => {}, play: async () => 'device' }).listen();
  await settle();
  assert.equal(playing.textContent, 'The drill', 'a sound that plays leaves the exercise alone');

  /** @type {(how: 'none') => void} */
  let late = () => {};
  const stage = /** @type {any} */ (h('div', null, 'The next exercise'));
  const finished = audioExercise({ container: stage, text: 'bil', resolve: () => {}, play: () => new Promise((resolve) => { late = resolve; }) });
  finished.listen();
  finished.finish({ aux: { kind: 'perception', correct: true } });
  late('none');
  await settle();
  assert.equal(stage.textContent, 'The next exercise', 'a none after the exercise finished does not draw over the next one');

  /** @type {(how: 'none') => void} */
  let slow = () => {};
  const answeredStage = /** @type {any} */ (h('div', null, 'The feedback'));
  const answering = audioExercise({ container: answeredStage, text: 'bil', resolve: () => {}, play: () => new Promise((resolve) => { slow = resolve; }) });
  answering.listen();
  answering.answered();
  slow('none');
  await settle();
  assert.equal(answeredStage.textContent, 'The feedback', 'a none after the learner answered leaves the answer and its feedback in place');
});

test('listening and perception keep the answer showing when the sound reports none after the pick or the typed answer', async () => {
  const evening = /** @type {Item} */ (lesson.items.find((each) => each.sl === 'Dober večer.'));
  /** A play whose answer the test gives later. */
  const delayed = () => {
    /** @type {(how: 'none') => void} */
    let answer = () => {};
    return { play: () => new Promise((resolve) => { answer = resolve; }), none: () => answer('none') };
  };

  const meaning = delayed();
  let first = true;
  const draw = seeded(3);
  const picking = /** @type {any} */ (h('div'));
  const meant = renderListening(picking, { kind: 'listening', itemId: evening.id },
    context({ item: evening, rng: () => (first ? ((first = false), 0.9) : draw()), play: meaning.play }));
  button(picking, 'Good evening.').dispatch('click');
  meaning.none();
  await settle();
  assert.ok(button(picking, 'Continue'), 'the pick and its feedback stay');
  assert.ok(!picking.textContent.includes('No audio on this device.'));
  button(picking, 'Continue').dispatch('click');
  assert.deepEqual(await meant, { aux: { kind: 'listening', correct: true } });

  const dictation = delayed();
  const typing = /** @type {any} */ (h('div'));
  const written = renderListening(typing, { kind: 'listening', itemId: evening.id }, context({ item: evening, rng: () => 0.1, play: dictation.play }));
  button(typing, "I don't know").dispatch('click');
  dictation.none();
  await settle();
  assert.ok(typing.querySelector('.feedback'), 'the typed answer and its feedback stay');
  button(typing, 'Continue').dispatch('click');
  assert.deepEqual(await written, { aux: { kind: 'listening', correct: false } });

  const drill = delayed();
  const perception = /** @type {any} */ (h('div'));
  const drilled = renderPerception(perception, { kind: 'perception' }, context({ rng: () => 0, play: drill.play }));
  button(perception, 'bil').dispatch('click');
  drill.none();
  await settle();
  assert.equal(elements(perception).find((el) => el.tagName === 'SECTION').textContent, 'Correct.');
  button(perception, 'Continue').dispatch('click');
  assert.deepEqual(await drilled, { aux: { kind: 'perception', correct: true } });
});

test('the typed recall puts its feedback into a polite live region that is in the exercise before the answer', async () => {
  const evening = /** @type {Item} */ (lesson.items.find((each) => each.sl === 'Dober večer.'));
  const stage = /** @type {any} */ (h('div'));
  const outcome = renderTyped(stage, { kind: 'typed_en_sl', itemId: evening.id }, context({ item: evening }));
  const slot = stage.querySelector('.feedback-slot');
  assert.ok(slot, 'the slot is drawn with the exercise');
  assert.equal(slot.getAttribute('aria-live'), 'polite', 'and is a live region before anything is in it');
  assert.equal(slot.childNodes.length, 0);
  button(stage, "I don't know").dispatch('click');
  assert.equal(stage.querySelector('.feedback-slot'), slot, 'the same slot');
  assert.equal(slot.childNodes.length, 1);
  assert.equal(slot.childNodes[0].className, 'feedback feedback-wrong');
  assert.equal(elements(stage).filter((el) => el.getAttribute('aria-live') !== null).length, 1, 'one live region');
  button(stage, 'Continue').dispatch('click');
  assert.deepEqual(await outcome, { itemId: evening.id, recall: 'wrong' });
});

test('the dialogue keeps one live region, its transcript, with the feedback of a learner line inside it', async () => {
  const stage = /** @type {any} */ (h('div'));
  void renderDialogue(stage, { kind: 'dialogue', lessonId: lesson.id }, context({}));
  await settle();
  /** @returns {any[]} */
  const live = () => elements(stage).filter((el) => el.getAttribute('aria-live') !== null);
  assert.equal(live().length, 1, 'one live region while the learner line waits');
  const [transcript] = live();
  assert.equal(transcript.getAttribute('aria-label'), 'The scene');
  button(stage, "I don't know").dispatch('click');
  assert.ok(transcript.querySelector('.feedback'), 'the feedback is announced through the transcript');
  assert.equal(live().length, 1, 'and adds no live region of its own');
});

test('structured input, the meaning pick and the perception drill resolve their aux through the shared option group', async () => {
  const [exercise] = lesson.structured;
  const rule = { id: 'r-biti-present', title_en: 'Biti in the present', card_en: 'Jaz takes sem.' };
  const structured = /** @type {any} */ (h('div'));
  const picked = renderStructured(structured, { kind: 'structured', exerciseId: exercise.id }, context({ rule }));
  assert.equal(elements(structured).find((el) => el.getAttribute('role') === 'group').getAttribute('aria-label'), 'Options');
  button(structured, 'ste').dispatch('click');
  const blank = elements(structured).find((el) => el.classList.contains('blank'));
  assert.equal(blank.textContent, 'sem', 'the gap is filled with the answer');
  assert.ok(blank.classList.contains('blank-filled'));
  const panel = elements(structured).find((el) => el.tagName === 'SECTION');
  assert.equal(panel.textContent, 'Not quite.The answer is sem.Biti in the presentJaz takes sem.', 'headline, answer and the rule line');
  button(structured, 'Continue').dispatch('click');
  assert.deepEqual(await picked, { aux: { kind: 'structured', correct: false } });

  const evening = /** @type {Item} */ (lesson.items.find((each) => each.sl === 'Dober večer.'));
  /** @type {string[]} */
  const heard = [];
  const draw = seeded(3);
  let first = true;
  const meaningRng = () => (first ? ((first = false), 0.9) : draw());
  const listening = /** @type {any} */ (h('div'));
  const meant = renderListening(listening, { kind: 'listening', itemId: evening.id },
    context({ item: evening, rng: meaningRng, play: async (/** @type {string} */ text) => { heard.push(text); return 'device'; } }));
  await settle();
  assert.deepEqual(heard, ['Dober večer.'], 'the line plays at once');
  const group = elements(listening).find((el) => el.getAttribute('role') === 'group');
  assert.equal(group.className, 'options actions-stack');
  assert.equal(group.childNodes.length, 4);
  assert.equal(document.activeElement?.textContent, 'What does it mean?');
  button(listening, 'Good evening.').dispatch('click');
  assert.equal(elements(listening).find((el) => el.tagName === 'SECTION').textContent,
    'Correct.You heardDober večer.It meansGood evening.');
  button(listening, 'Continue').dispatch('click');
  assert.deepEqual(await meant, { aux: { kind: 'listening', correct: true } });

  const silent = /** @type {any} */ (h('div'));
  const skipped = renderListening(silent, { kind: 'listening', itemId: evening.id }, context({ item: evening, play: async () => 'none' }));
  await settle();
  button(silent, 'Continue').dispatch('click');
  assert.deepEqual(await skipped, {}, 'no audio: no outcome');

  const perception = /** @type {any} */ (h('div'));
  const drilled = renderPerception(perception, { kind: 'perception' }, context({ rng: () => 0 }));
  assert.deepEqual(elements(perception).filter((el) => el.classList.contains('option-sl')).map((el) => el.textContent), ['bil', 'bila']);
  button(perception, 'bila').dispatch('click');
  assert.equal(elements(perception).find((el) => el.tagName === 'SECTION').textContent, 'Not quite.It was bil.');
  button(perception, 'Continue').dispatch('click');
  assert.deepEqual(await drilled, { aux: { kind: 'perception', correct: false } });
});

test('speaking: a refused microphone keeps later speaking exercises self-rated until resetRecognition; a lost connection or a failed start only this one', async (t) => {
  const FALLBACK = 'Speech recognition is not available here, so you rate yourself.';
  const FAILED = 'Speech recognition did not work this time, so you rate this one yourself.';
  /** @type {{ error: string }} what the recogniser does on start: fire this error, or throw */
  const next = { error: 'not-allowed' };
  let started = 0;
  class Refusing {
    constructor() {
      /** @type {any} */ this.onerror = null;
      /** @type {any} */ this.onresult = null;
      /** @type {any} */ this.onend = null;
    }

    start() {
      started += 1;
      if (next.error === 'throw') throw new Error('InvalidStateError');
      setTimeout(() => this.onerror?.({ error: next.error }), 0);
    }

    abort() {}
  }
  Object.defineProperty(globalThis, 'SpeechRecognition', { value: Refusing, configurable: true, writable: true });
  t.after(() => {
    delete (/** @type {Record<string, unknown>} */ (globalThis)).SpeechRecognition;
    resetRecognition();
  });

  const evening = /** @type {Item} */ (lesson.items.find((each) => each.sl === 'Dober večer.'));
  const speechOn = () => context({ item: evening, settings: { speech: true }, mode: { mute: true, speech: true }, play: async () => 'none' });
  /** @returns {{ stage: any, outcome: Promise<unknown> }} */
  const show = () => {
    const stage = /** @type {any} */ (h('div'));
    return { stage, outcome: renderSpeaking(stage, { kind: 'speaking', itemId: evening.id }, speechOn()) };
  };
  /** @param {any} stage */
  const selfRated = (stage) => Boolean(button(stage, 'Matched') && button(stage, 'Not yet')) && !button(stage, 'Speak');

  resetRecognition();
  const refused = show();
  assert.ok(button(refused.stage, 'Speak'), 'speech on and a recogniser present: Speak');
  button(refused.stage, 'Speak').dispatch('click');
  await settle();
  assert.ok(selfRated(refused.stage), 'the refusal turns the exercise self-rated, without a dialog');
  assert.ok(refused.stage.textContent.includes(FALLBACK));
  assert.equal(recognitionBlocked(), true);
  button(refused.stage, 'Not yet').dispatch('click');
  assert.deepEqual(await refused.outcome, { aux: { kind: 'speaking', correct: false } }, 'self-rated: aux only');

  const later = show();
  assert.ok(selfRated(later.stage), 'the next speaking exercise is self-rated at once');
  assert.ok(later.stage.textContent.includes(FALLBACK));
  assert.equal(started, 1, 'and does not ask the recogniser again');

  resetRecognition();
  assert.ok(button(show().stage, 'Speak'), 'after resetRecognition (a new session, or the switch turned on) Speak is back');

  for (const error of ['service-not-allowed', 'audio-capture', 'language-not-supported']) {
    resetRecognition();
    next.error = error;
    const each = show();
    button(each.stage, 'Speak').dispatch('click');
    await settle();
    assert.ok(selfRated(each.stage) && each.stage.textContent.includes(FALLBACK), error);
    assert.ok(selfRated(show().stage), `${error} stays for the later exercises`);
  }

  for (const error of ['network', 'throw', 'a-code-from-a-later-browser']) {
    resetRecognition();
    next.error = error;
    const each = show();
    button(each.stage, 'Speak').dispatch('click');
    await settle();
    assert.ok(selfRated(each.stage), `${error}: this exercise is self-rated`);
    assert.ok(each.stage.textContent.includes(FAILED), `${error}: and says it is this once`);
    assert.equal(recognitionBlocked(), false, error);
    assert.ok(button(show().stage, 'Speak'), `${error}: the next speaking exercise offers Speak again`);
  }
});

test('speaking: Speak waits while the model line plays, so the recogniser never starts over it', async (t) => {
  let started = 0;
  class Listening {
    constructor() {
      /** @type {any} */ this.onerror = null;
      /** @type {any} */ this.onresult = null;
      /** @type {any} */ this.onend = null;
    }

    start() {
      started += 1;
      setTimeout(() => this.onerror?.({ error: 'no-speech' }), 0);
    }

    abort() {}
  }
  Object.defineProperty(globalThis, 'SpeechRecognition', { value: Listening, configurable: true, writable: true });
  t.after(() => {
    delete (/** @type {Record<string, unknown>} */ (globalThis)).SpeechRecognition;
    resetRecognition();
  });
  resetRecognition();

  const evening = /** @type {Item} */ (lesson.items.find((each) => each.sl === 'Dober večer.'));
  /** @type {(how: 'device') => void} */
  let ended = () => {};
  const stage = /** @type {any} */ (h('div'));
  void renderSpeaking(stage, { kind: 'speaking', itemId: evening.id }, context({
    item: evening, settings: { speech: true }, mode: { mute: false, speech: true },
    play: () => new Promise((resolve) => { ended = resolve; }),
  }));
  const speak = button(stage, 'Speak');
  assert.ok(!speak.disabled, 'Speak is ready before anything plays');
  button(stage, 'Listen').dispatch('click');
  assert.equal(speak.disabled, true, 'while the model line plays, Speak waits');
  speak.dispatch('click');
  assert.equal(started, 0, 'and no recogniser starts');
  ended('device');
  await settle();
  assert.ok(!speak.disabled, 'once the line has played, Speak is back');
  speak.dispatch('click');
  await settle();
  assert.equal(started, 1);
});
