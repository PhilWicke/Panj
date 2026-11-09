// tests/ui/quiet.test.js
// The sitting's quiet choices, held in memory only: the labels word for word, the exercise kinds
// each offer sits beside, a choice that holds and is idempotent, quietChoices handing out a copy,
// offerQuiet answering true once per kind per sitting and never for a chosen kind, and resetQuiet
// starting a new sitting with nothing chosen and nothing offered.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { OFFER_KINDS, QUIET_LABELS, chooseQuiet, offerQuiet, quietChoices, resetQuiet } from '../../app/js/ui/quiet.js';

beforeEach(() => { resetQuiet(); });

test('the labels are the concept\'s copy, word for word, and the offers sit beside the kinds that play or speak', () => {
  assert.deepEqual(QUIET_LABELS, { listen: "Can't listen right now", talk: "Can't talk right now" });
  assert.deepEqual([...OFFER_KINDS.listen].sort(), ['listening', 'meet', 'perception']);
  assert.deepEqual([...OFFER_KINDS.talk], ['speaking']);
});

test('a sitting starts quiet-free; a choice holds, twice is once, and resetQuiet starts a new sitting', () => {
  assert.deepEqual(quietChoices(), { cantListen: false, cantTalk: false });
  chooseQuiet('listen');
  chooseQuiet('listen');
  assert.deepEqual(quietChoices(), { cantListen: true, cantTalk: false });
  const copy = quietChoices();
  copy.cantTalk = true;
  assert.equal(quietChoices().cantTalk, false, 'a copy, not the state');
  resetQuiet();
  assert.deepEqual(quietChoices(), { cantListen: false, cantTalk: false });
});

test('offerQuiet answers true once per kind per sitting, and never for a chosen kind', () => {
  assert.equal(offerQuiet('listen'), true);
  assert.equal(offerQuiet('listen'), false);
  chooseQuiet('talk');
  assert.equal(offerQuiet('talk'), false);
  resetQuiet();
  assert.equal(offerQuiet('listen'), true);
  assert.equal(offerQuiet('talk'), true);
});
