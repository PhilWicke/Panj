// tests/content/apply-review.test.js
// applyReview merges two blind review halves into a lesson: the item verdicts by rule, doubted
// items onto NATIVE_LIST.md, the fingerprint of every judged entry into the review file, and the
// lines the halves do not both accept back as flagged. It refuses a review it cannot apply as a
// whole before writing anything.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { applyReview } from '../../tools/apply-review.js';
import { slFingerprint } from '../../tools/review-guard.js';
import { NATIVE_LIST_TEMPLATE, copyFixture, editJson, removeCopies, reviewDoc } from './helpers.js';

after(removeCopies);

const LESSON = 'lessons/u01-l01.json';

/** @param {string} file */
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
/** @param {any} doc @param {string} file */
const writeJson = (doc, file) => writeFile(file, JSON.stringify(doc, null, 2) + '\n');

/** content-valid with every item unreviewed, the empty native list and an empty reviews folder. */
const fixture = () => copyFixture('content-valid', async (dir) => {
  await editJson(dir, LESSON, (doc) => {
    for (const item of doc.items) item.verification = { review1: null, review2: null, native: null, status: 'pending' };
  });
  await writeFile(join(dir, 'NATIVE_LIST.md'), NATIVE_LIST_TEMPLATE);
  await mkdir(join(dir, 'reviews'));
});

/** @param {string} dir @param {string} [file] */
const paths = (dir, file = 'u01-l01.review.json') => ({
  lessonPath: join(dir, LESSON),
  reviewPath: join(dir, 'reviews', file),
  nativeListPath: join(dir, 'NATIVE_LIST.md'),
});

/** The verdicts of the first test: review1 rejects u01-l01-i03, review2 doubts u01-l01-i02. */
const FIRST = {
  review1: { 'u01-l01-i03': { verdict: 'rejected', reason: 'Wrong form.', fix: 'brata' } },
  review2: { 'u01-l01-i02': { verdict: 'doubtful', reason: 'Is the comma right?' } },
};

/** Writes the review document for u01-l01 under reviews/<file>. @param {string} dir @param {any} [options] @param {string} [file] */
async function writeReview(dir, options, file = 'u01-l01.review.json') {
  await writeJson(await reviewDoc(dir, 'u01-l01', options), join(dir, 'reviews', file));
}

/** @param {string} dir @param {string} id */
const itemOf = async (dir, id) => (await readJson(join(dir, LESSON))).items.find((/** @type {any} */ item) => item.id === id);

/** The lesson, every review file and the native list, as text. @param {string} dir */
async function snapshot(dir) {
  const files = [LESSON, 'NATIVE_LIST.md', ...(await readdir(join(dir, 'reviews'))).sort().map((name) => `reviews/${name}`)];
  return Object.fromEntries(await Promise.all(files.map(async (file) => [file, await readFile(join(dir, file), 'utf8')])));
}

test('verdicts merge by rule: two accepts accept, a doubt holds pending with its reason, a reject rejects', async () => {
  const dir = await fixture();
  await writeReview(dir, FIRST);
  const result = await applyReview(paths(dir));
  assert.deepEqual(result, { accepted: 1, pending: 1, rejected: 1, flagged: [] });
  assert.deepEqual((await itemOf(dir, 'u01-l01-i01')).verification, { review1: 'accepted', review2: 'accepted', native: null, status: 'accepted' });
  assert.deepEqual((await itemOf(dir, 'u01-l01-i02')).verification, { review1: 'accepted', review2: 'doubtful', native: null, status: 'pending', notes: 'review2 doubtful: Is the comma right?' });
  assert.deepEqual((await itemOf(dir, 'u01-l01-i03')).verification, { review1: 'rejected', review2: 'accepted', native: null, status: 'rejected', notes: 'review1 rejected: Wrong form. Fix: brata' });
});

test('a pending item gets one row under its unit, and applying the same review again changes no file', async () => {
  const dir = await fixture();
  await writeReview(dir, FIRST);
  await applyReview(paths(dir));
  const list = await readFile(join(dir, 'NATIVE_LIST.md'), 'utf8');
  assert.ok(list.includes('## Unit 01\n\n| id | sl | en | doubt | proposed fix |\n|---|---|---|---|---|\n| u01-l01-i02 | Dober dan. | Good day. | review2 doubtful: Is the comma right? |  |\n'), list);
  assert.ok(!list.includes('| u01-l01-i03 |'), 'a rejected item waits for its rewrite, not for a native speaker');
  const first = await snapshot(dir);
  await applyReview(paths(dir));
  assert.deepEqual(await snapshot(dir), first);
});

test('a review naming an unknown key, a key judged by one reviewer only, or an earlier round after a later one is refused and nothing is written', async () => {
  const dir = await fixture();
  const before = await snapshot(dir);

  const unknown = await reviewDoc(dir, 'u01-l01');
  for (const half of unknown.reviews) half.items['u01-l01-i09'] = { verdict: 'accepted', reason: 'Fine.' };
  await writeJson(unknown, paths(dir).reviewPath);
  const withUnknown = await snapshot(dir);
  await assert.rejects(applyReview(paths(dir)), /unknown key "u01-l01-i09"/);
  assert.deepEqual(await snapshot(dir), withUnknown);

  const oneSided = await reviewDoc(dir, 'u01-l01');
  delete oneSided.reviews[1].items['u01-l01-i02'];
  await writeJson(oneSided, paths(dir).reviewPath);
  const withOneSided = await snapshot(dir);
  await assert.rejects(applyReview(paths(dir)), /"u01-l01-i02" is judged by review1 only/);
  assert.deepEqual(await snapshot(dir), withOneSided);

  await writeReview(dir);
  await writeReview(dir, { only: ['u01-l01-i03'] }, 'u01-l01.r2.review.json');
  const withRound2 = await snapshot(dir);
  await assert.rejects(applyReview(paths(dir)), /round 2 exists for u01-l01; apply rounds in order/);
  assert.deepEqual(await snapshot(dir), withRound2);
  assert.equal(withRound2[LESSON], before[LESSON]);
  assert.equal(withRound2['NATIVE_LIST.md'], before['NATIVE_LIST.md']);
});

test('lines not accepted by both halves come back flagged, and every key judged by both gets its fingerprint', async () => {
  const dir = await fixture();
  await writeReview(dir, { review2: { 'u01-l01-d-03': { verdict: 'doubtful', reason: 'Unnatural.' } } });
  const result = await applyReview(paths(dir));
  assert.deepEqual(result.flagged, ['u01-l01-d-03']);
  const lesson = await readJson(join(dir, LESSON));
  const rule = await readJson(join(dir, 'rules/r-biti-present.json'));
  const review = await readJson(paths(dir).reviewPath);
  assert.equal(review.applied['u01-l01-i01'], slFingerprint(lesson.items[0]));
  assert.equal(review.applied['u01-l01-s01'], slFingerprint(lesson.structured[0]));
  assert.equal(review.applied['u01-l01-d-03'], slFingerprint(lesson.dialogue.lines[2]));
  assert.equal(review.applied['r-biti-present'], slFingerprint(rule));
});

test('from round 2 a rejection is held as a doubt with its fix in notes and on the native list', async () => {
  const dir = await fixture();
  await writeReview(dir, FIRST);
  await applyReview(paths(dir));
  await writeReview(dir, { only: ['u01-l01-i03'], review1: { 'u01-l01-i03': { verdict: 'rejected', reason: 'Still wrong.', fix: 'brata' } } }, 'u01-l01.r2.review.json');
  const result = await applyReview(paths(dir, 'u01-l01.r2.review.json'));
  assert.deepEqual(result, { accepted: 0, pending: 1, rejected: 0, flagged: [] });
  assert.deepEqual((await itemOf(dir, 'u01-l01-i03')).verification, { review1: 'doubtful', review2: 'accepted', native: null, status: 'pending', notes: 'review1 rejected in round 2: Still wrong. Fix: brata' });
  const list = await readFile(join(dir, 'NATIVE_LIST.md'), 'utf8');
  assert.ok(list.includes('| u01-l01-i03 | brat | brother | review1 rejected in round 2: Still wrong. Fix: brata | brata |'), list);
  assert.ok(list.includes('| u01-l01-i02 | Dober dan. | Good day. | review2 doubtful: Is the comma right? |  |'), 'a row the round does not judge stays');
  assert.equal(list.split('## Unit 01').length, 2, 'one section per unit');
});

test('a later round rewrites the row of an item it doubts again and removes the row of an item it no longer doubts', async () => {
  const dir = await fixture();
  await writeReview(dir, FIRST);
  await applyReview(paths(dir));
  // The consistency pass changes the doubted item's Slovenian, which resets it for the next round.
  await editJson(dir, LESSON, (doc) => {
    const item = doc.items.find((/** @type {any} */ i) => i.id === 'u01-l01-i02');
    item.sl = 'Dober dan vam.';
    item.verification = { review1: null, review2: null, native: null, status: 'pending' };
  });
  await writeReview(dir, { only: ['u01-l01-i02'], review1: { 'u01-l01-i02': { verdict: 'doubtful', reason: 'Is vam needed?', fix: 'Dober dan.' } } }, 'u01-l01.r2.review.json');
  assert.deepEqual(await applyReview(paths(dir, 'u01-l01.r2.review.json')), { accepted: 0, pending: 1, rejected: 0, flagged: [] });
  const doubted = await readFile(join(dir, 'NATIVE_LIST.md'), 'utf8');
  assert.ok(doubted.includes('|---|---|---|---|---|\n| u01-l01-i02 | Dober dan vam. | Good day. | review1 doubtful: Is vam needed? Fix: Dober dan. | Dober dan. |\n'), doubted);
  assert.equal(doubted.split('| u01-l01-i02 |').length, 2, 'one row per item');
  const first = await snapshot(dir);
  await applyReview(paths(dir, 'u01-l01.r2.review.json'));
  assert.deepEqual(await snapshot(dir), first, 'applying the round again changes no file');

  await writeReview(dir, { only: ['u01-l01-i02'] }, 'u01-l01.r3.review.json');
  assert.deepEqual(await applyReview(paths(dir, 'u01-l01.r3.review.json')), { accepted: 1, pending: 0, rejected: 0, flagged: [] });
  const accepted = await readFile(join(dir, 'NATIVE_LIST.md'), 'utf8');
  assert.ok(!accepted.includes('| u01-l01-i02 |'), accepted);
  assert.ok(accepted.endsWith('## Unit 01\n\n| id | sl | en | doubt | proposed fix |\n|---|---|---|---|---|\n'), 'the unit section keeps its heading and table header');
});

const run = promisify(execFile);
const CLI = fileURLToPath(new URL('../../tools/apply-review.js', import.meta.url));

/** Runs the CLI and resolves with its exit code and output, whatever the code. @param {string[]} args */
async function cli(...args) {
  try {
    const { stdout, stderr } = await run(process.execPath, [CLI, ...args]);
    return { code: 0, stdout, stderr };
  } catch (err) {
    const failure = /** @type {{ code: number, stdout: string, stderr: string }} */ (err);
    return { code: failure.code, stdout: failure.stdout, stderr: failure.stderr };
  }
}

test('CLI prints the counts and one FLAGGED line per flagged key', async () => {
  const dir = await fixture();
  await writeReview(dir, { review1: FIRST.review1, review2: { ...FIRST.review2, 'u01-l01-d-03': { verdict: 'doubtful', reason: 'Unnatural.' } } });
  const done = await cli(join(dir, LESSON));
  assert.equal(done.code, 0, done.stderr);
  assert.equal(done.stdout, 'u01-l01 round 1: accepted=1 pending=1 rejected=1 flagged=1\nFLAGGED u01-l01-d-03\n');
  const refused = await cli(join(dir, LESSON), '--round', '2');
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /^ERROR .*u01-l01\.r2\.review\.json/);
});
