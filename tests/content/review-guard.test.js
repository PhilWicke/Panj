// tests/content/review-guard.test.js
// The review guard: accepted Slovenian text must be the text its reviewers saw. slFingerprint
// covers the Slovenian of an entry and nothing else; reviewGuard compares it with the
// fingerprint recorded when the review was applied.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { entriesOf, reviewGuard, slFingerprint } from '../../tools/review-guard.js';
import { copyFixture, editJson, removeCopies, reviewDoc } from './helpers.js';

after(removeCopies);

const LESSON = 'lessons/u01-l01.json';
const REVIEW = 'reviews/u01-l01.review.json';

test('slFingerprint follows the Slovenian text and ignores English, helpers and metadata', () => {
  const entry = { sl: 'Dober dan.', en: 'Good day.', examples: [{ sl: 'Dober dan, gospa.', en: 'Good day, madam.' }], helper: null, register: 'neutral' };
  const fp = slFingerprint(entry);
  assert.match(fp, /^[0-9a-f]{16}$/);
  assert.equal(slFingerprint({ ...entry, en: 'Hello.', helper: 'Like Guten Tag.', register: 'formal' }), fp);
  assert.notEqual(slFingerprint({ ...entry, examples: [{ sl: 'Dober dan, gospod.', en: 'Good day, madam.' }] }), fp);
  assert.notEqual(slFingerprint({ ...entry, forms: { acc: 'dan' } }), fp);
  assert.equal(slFingerprint({ register: 'neutral', helper: null, examples: [{ en: 'Good day, madam.', sl: 'Dober dan, gospa.' }], en: 'Good day.', sl: 'Dober dan.' }), fp, 'key order does not matter');
});

test('entriesOf names items, structured, production, dialogue lines and introduced rules, in that order', async () => {
  const dir = await copyFixture('content-valid');
  const lesson = JSON.parse(await readFile(join(dir, LESSON), 'utf8'));
  const rule = JSON.parse(await readFile(join(dir, 'rules/r-biti-present.json'), 'utf8'));
  const entries = entriesOf(lesson, new Map([[rule.id, rule]]));
  assert.deepEqual([...entries.keys()], [
    'u01-l01-i01', 'u01-l01-i02', 'u01-l01-i03', 'u01-l01-s01', 'u01-l01-p01', 'u01-l01-p02',
    'u01-l01-d-01', 'u01-l01-d-02', 'u01-l01-d-03', 'u01-l01-d-04', 'r-biti-present',
  ]);
  assert.equal(entries.get('u01-l01-d-03'), lesson.dialogue.lines[2]);
  assert.equal(entries.get('r-biti-present'), rule);
});

/** Writes reviews/u01-l01.review.json: both halves accept every key, applied holds every current fingerprint. @param {string} dir */
async function acceptedReview(dir) {
  const review = await reviewDoc(dir, 'u01-l01');
  const lesson = JSON.parse(await readFile(join(dir, LESSON), 'utf8'));
  const rule = JSON.parse(await readFile(join(dir, 'rules/r-biti-present.json'), 'utf8'));
  const applied = Object.fromEntries([...entriesOf(lesson, new Map([[rule.id, rule]]))].map(([key, entry]) => [key, slFingerprint(entry)]));
  await mkdir(join(dir, 'reviews'), { recursive: true });
  await writeFile(join(dir, REVIEW), JSON.stringify({ ...review, applied }, null, 2) + '\n');
}

test('an accepted item edited after its review is reported, and resetting it to pending clears the report', async () => {
  const copy = await copyFixture('content-valid', acceptedReview);
  assert.deepEqual(await reviewGuard({ contentDir: copy }), []);
  await editJson(copy, LESSON, (doc) => { doc.items[1].examples[0].sl = 'Dober dan, gospa.'; });
  assert.deepEqual(await reviewGuard({ contentDir: copy }), [{ lesson: 'u01-l01', key: 'u01-l01-i02', message: 'accepted, but its Slovenian text changed after the review' }]);
  await editJson(copy, LESSON, (doc) => { doc.items[1].verification = { review1: null, review2: null, native: null, status: 'pending' }; });
  assert.deepEqual(await reviewGuard({ contentDir: copy }), []);
});

test('every line of a lesson with an accepted item needs both reviews accepting its current text', async () => {
  const copy = await copyFixture('content-valid', acceptedReview);
  await editJson(copy, REVIEW, (doc) => {
    delete doc.applied['u01-l01-d-04'];
    doc.reviews[1].lines['u01-l01-p01'] = { verdict: 'doubtful', reason: 'Unnatural.' };
  });
  assert.deepEqual(await reviewGuard({ contentDir: copy }), [
    { lesson: 'u01-l01', key: 'u01-l01-p01', message: 'not accepted by both reviews' },
    { lesson: 'u01-l01', key: 'u01-l01-d-04', message: 'not reviewed in its current form' },
  ]);
  await editJson(copy, LESSON, (doc) => {
    for (const item of doc.items) item.verification = { review1: null, review2: null, native: null, status: 'pending' };
  });
  assert.deepEqual(await reviewGuard({ contentDir: copy }), [], 'a lesson without an accepted item ships no line');
});

test('the latest round that judged a key decides', async () => {
  const copy = await copyFixture('content-valid', acceptedReview);
  await editJson(copy, LESSON, (doc) => { doc.dialogue.lines[3].sl = 'Živjo. Dobrodošli pri nas.'; });
  const changed = [{ lesson: 'u01-l01', key: 'u01-l01-d-04', message: 'not reviewed in its current form' }];
  assert.deepEqual(await reviewGuard({ contentDir: copy }), changed);
  const round2 = await reviewDoc(copy, 'u01-l01', { only: ['u01-l01-d-04'] });
  await writeFile(join(copy, 'reviews/u01-l01.r2.review.json'), JSON.stringify(round2, null, 2) + '\n');
  assert.deepEqual(await reviewGuard({ contentDir: copy }), changed, 'a round not yet applied records nothing');
  const lesson = JSON.parse(await readFile(join(copy, LESSON), 'utf8'));
  await writeFile(join(copy, 'reviews/u01-l01.r2.review.json'), JSON.stringify({ ...round2, applied: { 'u01-l01-d-04': slFingerprint(lesson.dialogue.lines[3]) } }, null, 2) + '\n');
  assert.deepEqual(await reviewGuard({ contentDir: copy }), []);
});

test('an accepted item without a review is reported; a native confirmation stands in for the review', async () => {
  const bare = await copyFixture('content-valid');
  assert.deepEqual((await reviewGuard({ contentDir: bare })).filter((i) => i.key === 'u01-l01-i01'), [{ lesson: 'u01-l01', key: 'u01-l01-i01', message: 'accepted without a recorded review' }]);
  await editJson(bare, LESSON, (doc) => { doc.items[0].verification.native = 'confirmed'; });
  assert.deepEqual((await reviewGuard({ contentDir: bare })).filter((i) => i.key === 'u01-l01-i01'), []);
});

const exec = promisify(execFile);
const CLI = fileURLToPath(new URL('../../tools/review-guard.js', import.meta.url));

/** Runs the CLI and resolves with its exit code and output, whatever the code. @param {string[]} args */
async function cli(...args) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [CLI, ...args]);
    return { code: 0, stdout, stderr };
  } catch (err) {
    const failure = /** @type {{ code: number, stdout: string, stderr: string }} */ (err);
    return { code: failure.code, stdout: failure.stdout, stderr: failure.stderr };
  }
}

test('CLI prints one GUARD line per issue and the count, and exits 1', async () => {
  const run = await cli(await copyFixture('content-valid'));
  assert.equal(run.code, 1);
  assert.match(run.stdout, /^GUARD u01-l01 u01-l01-i01: accepted without a recorded review\n/);
  assert.match(run.stdout, /\n\d+ issues\n$/);
  const clean = await cli(await copyFixture('content-valid', acceptedReview));
  assert.equal(clean.code, 0, clean.stderr);
  assert.equal(clean.stdout, '0 issues\n');
});
