// tests/content/native-confirm.test.js
// nativeConfirm enters a native speaker's answers from native-confirmations.tsv: a confirmation
// accepts the item, a correction replaces its text across the corpus and refreshes the review
// fingerprints of what it changed, and a line it cannot apply stays in the file, reported.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyReview } from '../../tools/apply-review.js';
import { nativeConfirm } from '../../tools/native-confirm.js';
import { reviewGuard, slFingerprint } from '../../tools/review-guard.js';
import { copyFixture, editJson, removeCopies, reviewDoc } from './helpers.js';

after(removeCopies);

const LESSON = 'lessons/u01-l01.json';
const NATIVE_LIST = fileURLToPath(new URL('../../content/NATIVE_LIST.md', import.meta.url));

/** @param {string} file */
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));

/**
 * content-valid with u01-l01-i02 and u01-l01-i03 doubted by review2 and so pending, their rows on
 * the native list, and reviews/u01-l01.review.json accepting every other key, applied after
 * `edit` has changed the lesson, so every recorded fingerprint is current.
 * @param {(lesson: any) => void} [edit]
 */
const fixture = (edit) => copyFixture('content-valid', async (dir) => {
  await editJson(dir, LESSON, (doc) => {
    for (const item of doc.items) item.verification = { review1: null, review2: null, native: null, status: 'pending' };
    edit?.(doc);
  });
  await writeFile(join(dir, 'NATIVE_LIST.md'), await readFile(NATIVE_LIST, 'utf8'));
  await mkdir(join(dir, 'reviews'));
  const review = await reviewDoc(dir, 'u01-l01', {
    review2: {
      'u01-l01-i02': { verdict: 'doubtful', reason: 'Is the comma right?' },
      'u01-l01-i03': { verdict: 'doubtful', reason: 'Is brat the usual word?' },
    },
  });
  await writeFile(join(dir, 'reviews/u01-l01.review.json'), JSON.stringify(review, null, 2) + '\n');
  await applyReview({ lessonPath: join(dir, LESSON), reviewPath: join(dir, 'reviews/u01-l01.review.json'), nativeListPath: join(dir, 'NATIVE_LIST.md') });
});

/** Writes the tsv and runs nativeConfirm on the copy. @param {string} dir @param {string} tsv */
async function confirm(dir, tsv) {
  await writeFile(join(dir, 'native-confirmations.tsv'), tsv);
  return nativeConfirm({ contentDir: dir, tsvPath: join(dir, 'native-confirmations.tsv'), nativeListPath: join(dir, 'NATIVE_LIST.md') });
}

/** @param {string} dir */
const state = async (dir) => {
  const lesson = await readJson(join(dir, LESSON));
  return {
    lesson,
    item: (/** @type {string} */ id) => lesson.items.find((/** @type {any} */ item) => item.id === id),
    list: await readFile(join(dir, 'NATIVE_LIST.md'), 'utf8'),
    tsv: await readFile(join(dir, 'native-confirmations.tsv'), 'utf8'),
    review: await readJson(join(dir, 'reviews/u01-l01.review.json')),
  };
};

test('a confirmed line accepts the item and removes its list row and its tsv line', async () => {
  const dir = await fixture();
  assert.ok((await readFile(join(dir, 'NATIVE_LIST.md'), 'utf8')).includes('| u01-l01-i02 |'), 'the fixture lists the item');
  const r = await confirm(dir, 'id\tverdict\tcorrection\nu01-l01-i02\tconfirmed\n');
  assert.deepEqual(r, { confirmed: 1, corrected: 0, replaced: 0, unmatched: [], untouched: [] });
  const { item, list, tsv } = await state(dir);
  assert.equal(item('u01-l01-i02').verification.native, 'confirmed');
  assert.equal(item('u01-l01-i02').verification.status, 'accepted');
  assert.ok(!list.includes('| u01-l01-i02 |'), list);
  assert.ok(list.includes('| u01-l01-i03 |'), 'the other row stays');
  assert.equal(tsv, 'id\tverdict\tcorrection\n');
});

test('a correction replaces the old text across the corpus, refreshes the fingerprints of what it changed and names what it left', async () => {
  const dir = await fixture((lesson) => {
    lesson.structured[0] = { ...lesson.structured[0], prompt_sl: 'To je moj ___.', options: ['brat', 'brata'], answer: 'brat', en: 'This is my brother.' };
  });
  const r = await confirm(dir, 'id\tverdict\tcorrection\nu01-l01-i03\tcorrected\tbratec\n');
  const { lesson, item, review, list, tsv } = await state(dir);
  assert.equal(item('u01-l01-i03').sl, 'bratec');
  assert.equal(item('u01-l01-i03').verification.native, 'corrected');
  assert.equal(item('u01-l01-i03').verification.status, 'accepted');
  assert.equal(item('u01-l01-i03').examples[0].sl, 'To je moj bratec.');
  assert.equal(lesson.dialogue.lines[2].sl, 'To je moj bratec.');
  assert.equal(r.replaced, 2);
  assert.equal(r.corrected, 1);
  assert.equal(review.applied['u01-l01-d-03'], slFingerprint(lesson.dialogue.lines[2]));
  assert.deepEqual([...r.untouched].sort(), ['lessons/u01-l01.json structured/u01-l01-s01/answer', 'lessons/u01-l01.json structured/u01-l01-s01/options/0']);
  assert.deepEqual(lesson.structured[0].options, ['brat', 'brata'], 'structured exercises are left as they are');
  assert.deepEqual(await reviewGuard({ contentDir: dir }), []);
  assert.ok(!list.includes('| u01-l01-i03 |'), list);
  assert.equal(tsv, 'id\tverdict\tcorrection\n');
});

test('a hand-filled tsv reads through a BOM, CRLF, spaces, blank lines, capitals and decomposed letters; an unknown id or verdict is reported and its line kept', async () => {
  const dir = await fixture();
  const decomposed = 'bratček';
  const r = await confirm(dir, `﻿id\tverdict\tcorrection\r\n\r\n u01-l01-i03 \t Corrected \t ${decomposed} \r\nu01-l01-i99\tconfirmed\r\nu01-l01-i02\tmaybe\r\n`);
  const { item, list, tsv } = await state(dir);
  assert.equal(item('u01-l01-i03').sl, 'bratček');
  assert.equal(item('u01-l01-i03').sl, item('u01-l01-i03').sl.normalize('NFC'));
  assert.equal(item('u01-l01-i03').examples[0].sl, 'To je moj bratček.');
  assert.equal(r.corrected, 1);
  assert.equal(r.confirmed, 0);
  assert.deepEqual(r.unmatched, [{ id: 'u01-l01-i99', reason: 'no such item' }, { id: 'u01-l01-i02', reason: 'verdict must be confirmed or corrected' }]);
  assert.equal(tsv, 'id\tverdict\tcorrection\nu01-l01-i99\tconfirmed\nu01-l01-i02\tmaybe\n');
  assert.ok(list.includes('| u01-l01-i02 |'), list);
  assert.equal(item('u01-l01-i02').verification.status, 'pending');
});
