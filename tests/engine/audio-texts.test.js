// tests/engine/audio-texts.test.js
// The texts a unit records (Rulings 46 and 57): audioTexts takes the `sl` of every accepted item
// and of its examples and every dialogue line of a lesson with at least one accepted item,
// duplicates dropped, first occurrence first, which is bundleTexts's rule for one unit; drillTexts
// is the perception drill's words in one flat list, so the audio tool records them too; unitClips
// is what "Keep offline" fetches: every text in the learner's voice, then the cast's lines in theirs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audioTexts, drillTexts, unitClips } from '../../app/js/util/audio-texts.js';
import { PERCEPTION_SETS } from '../../app/js/content/perception-sets.js';

/** @param {string} id @param {string} sl @param {string} status @param {string[]} examples */
const item = (id, sl, status, examples) => ({ id, sl, examples: examples.map((ex) => ({ sl: ex, en: '-' })), verification: { status } });

const unit = /** @type {any} */ ({
  unit: { id: 'u01' },
  lessons: [
    {
      id: 'u01-l01',
      items: [
        item('u01-l01-i01', 'Živjo.', 'accepted', ['Živjo, kako si?', 'Živjo.']),
        item('u01-l01-i02', 'brat', 'pending', ['Imam brata.']),
        item('u01-l01-i03', 'Dober dan.', 'accepted', ['Dober dan, kako ste?']),
        item('u01-l01-i04', 'sestra', 'rejected', ['To je sestra.']),
      ],
      dialogue: { lines: [{ sl: 'Dober dan.' }, { sl: 'Kar naprej.' }, { sl: 'Živjo, kako si?' }] },
    },
    {
      id: 'u01-l02',
      items: [item('u01-l02-i01', 'teta', 'pending', ['To je teta.'])],
      dialogue: { lines: [{ sl: 'To je moja teta.' }] },
    },
    {
      id: 'u01-l03',
      items: [item('u01-l03-i01', 'Hvala.', 'accepted', [])],
    },
  ],
});

test('audioTexts: accepted items, their examples and the dialogue of a lesson with an accepted item, in order and once each', () => {
  assert.deepEqual(audioTexts(unit), ['Živjo.', 'Živjo, kako si?', 'Dober dan.', 'Dober dan, kako ste?', 'Kar naprej.', 'Hvala.']);
});

test('audioTexts: a lesson without an accepted item contributes nothing, not even its dialogue, and an empty unit gives no texts', () => {
  const texts = audioTexts(unit);
  for (const text of ['brat', 'Imam brata.', 'sestra', 'To je sestra.', 'teta', 'To je teta.', 'To je moja teta.']) {
    assert.ok(!texts.includes(text), text);
  }
  assert.deepEqual(audioTexts(/** @type {any} */ ({ unit: { id: 'u02' }, lessons: [] })), []);
});

const castUnit = /** @type {any} */ ({
  unit: { id: 'u02' },
  lessons: [
    {
      id: 'u02-l01',
      items: [item('u02-l01-i01', 'Živjo.', 'accepted', [])],
      dialogue: {
        cast: { host: 'male', guest: 'female' },
        lines: [
          { speaker: 'host', sl: 'Dober dan.' },
          { speaker: 'you', sl: 'Živjo.' },
          { speaker: 'guest', sl: 'Kar naprej.' },
          { speaker: 'waiter', sl: 'Izvolite.' },
          { speaker: 'host', sl: 'Dober dan.' },
        ],
      },
    },
    {
      id: 'u02-l02',
      items: [item('u02-l02-i01', 'teta', 'pending', [])],
      dialogue: { cast: { host: 'male' }, lines: [{ speaker: 'host', sl: 'To je teta.' }] },
    },
  ],
});

/** @param {string} voice @param {string[]} texts */
const inVoice = (voice, texts) => texts.map((text) => ({ text, voice }));

test("unitClips: every text in the learner's voice, then each cast line in its speaker's voice, each pair once", () => {
  const texts = ['Živjo.', 'Dober dan.', 'Kar naprej.', 'Izvolite.'];
  assert.deepEqual(audioTexts(castUnit), texts);
  assert.deepEqual(unitClips(castUnit, 'Kore'), [...inVoice('Kore', texts), { text: 'Dober dan.', voice: 'Puck' }],
    'the guest speaks in the learner\'s voice: no second copy, and the waiter has no cast entry');
  assert.deepEqual(unitClips(castUnit, 'Puck'), [...inVoice('Puck', texts), { text: 'Kar naprej.', voice: 'Kore' }]);
});

test('unitClips: a lesson without an accepted item contributes nothing, and with no cast it is audioTexts in that voice', () => {
  for (const clip of unitClips(castUnit, 'Kore')) assert.notEqual(clip.text, 'To je teta.');
  assert.deepEqual(unitClips(unit, 'Puck'), inVoice('Puck', audioTexts(unit)));
  assert.deepEqual(unitClips(/** @type {any} */ ({ unit: { id: 'u03' }, lessons: [] }), 'Kore'), []);
});

test('drillTexts is the perception drill word list, flat and in order', () => {
  const texts = drillTexts();
  assert.deepEqual(texts, PERCEPTION_SETS.flat());
  assert.equal(texts.length, 11, 'bil/bila, vas/vaš, kosa/koza/koža, peti/pesti, v šoli/šoli');
  for (const word of ['bil', 'bila', 'vas', 'vaš', 'kosa', 'koza', 'koža', 'peti', 'pesti', 'v šoli', 'šoli']) assert.ok(texts.includes(word), word);
  assert.equal(new Set(texts).size, texts.length, 'no word twice');
  assert.notEqual(drillTexts(), texts, 'a fresh list each call');
});
