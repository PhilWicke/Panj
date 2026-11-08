// tests/util/hash.test.js
// sha256Hex is the one hashing primitive shared by the content compiler (bundle
// version), the audio ids and anything else that needs a stable digest in Node
// and in the browser alike.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256Hex } from '../../app/js/util/hash.js';

test('sha256Hex gives the lowercase hex SHA-256 of the UTF-8 bytes', async () => {
  assert.equal(await sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const slovenian = 'Živjo, kako si? Dober večer.';
  assert.equal(await sha256Hex(slovenian), createHash('sha256').update(slovenian, 'utf8').digest('hex'));
});
