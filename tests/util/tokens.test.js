// tests/util/tokens.test.js
// The one word tokeniser. The compiler's lemmasMet and the progress counter wordsMet split text
// the same way, or the counter could not be measured against its denominator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wordTokens } from '../../app/js/util/tokens.js';

test('wordTokens lowercases and splits on anything that is not a letter or digit', () => {
  assert.deepEqual(wordTokens('Živjo, kako si? Dober dan. 12:30 (DOBRODOŠLI)'), ['živjo', 'kako', 'si', 'dober', 'dan', '12', '30', 'dobrodošli']);
  assert.deepEqual(wordTokens(' ... '), []);
  assert.deepEqual(wordTokens(''), []);
  assert.deepEqual(wordTokens('Lahko dobim kavo, prosim? Ni za kaj.'), ['lahko', 'dobim', 'kavo', 'prosim', 'ni', 'za', 'kaj']);
  assert.deepEqual(wordTokens('Pijem kav_'), ['pijem', 'kav'], 'the blank marker separates');
  assert.deepEqual(wordTokens('e-mail\tin\nnova vrstica'), ['e', 'mail', 'in', 'nova', 'vrstica']);
});

test('wordTokens normalises to NFC, so a decomposed and a precomposed letter are one token', () => {
  assert.deepEqual(wordTokens('čaj'), ['čaj']);
  assert.equal(wordTokens('čaj')[0], wordTokens('ČAJ')[0]);
  assert.equal(new Set([...wordTokens('Živjo'), ...wordTokens('živjo'), ...wordTokens('ŽIVJO')]).size, 1);
});
