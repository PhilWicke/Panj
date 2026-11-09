// tests/content/corpus.test.js
// The real content under content/ against the linter: the two gate behaviours
// the content plan relies on, the review guard, the known-word shares, the
// native list, and the unit list the hive draws.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { lintContent } from '../../tools/lint-content.js';
import { reviewGuard } from '../../tools/review-guard.js';
import { DIALOGUE_SHARE, EXAMPLE_SHARE, knownShares } from '../../tools/known-words.js';
import { normalize, stripDiacritics } from '../../app/js/engine/grading.js';
import { SHAPES } from './shapes.js';

const CONTENT_URL = new URL('../../content/', import.meta.url);
const contentDir = fileURLToPath(CONTENT_URL);
const MOTIFS = ['flower', 'heart', 'wheat', 'cup', 'sun', 'house', 'bird', 'leaf', 'hand', 'bee'];

test('the content lints clean in development mode (pending items allowed)', async () => {
  const r = await lintContent({ contentDir, allowPending: true });
  assert.deepEqual(r.errors, []);
});

test('in strict mode the only errors are practised items and slot fillers that are not yet accepted', async () => {
  const r = await lintContent({ contentDir });
  assert.deepEqual(r.errors.filter((e) => e.rule !== 'pending-practised' && e.rule !== 'pending-filler'), []);
});

test('the real content passes the review guard', async () => {
  assert.deepEqual(await reviewGuard({ contentDir }), []);
});

test('every lesson after the first meets the known-word shares', async () => {
  for (const s of await knownShares({ contentDir })) {
    if (s.exempt) continue;
    assert.ok(s.examples >= EXAMPLE_SHARE, `${s.lesson} examples ${s.examples}`);
    if (s.dialogue !== null) assert.ok(s.dialogue >= DIALOGUE_SHARE, `${s.lesson} dialogue ${s.dialogue}`);
  }
});

test('NATIVE_LIST.md has one row per doubted item and no row for an accepted or unknown item', async () => {
  const list = await readFile(new URL('NATIVE_LIST.md', CONTENT_URL), 'utf8');
  // Rows: table lines whose first cell is neither the header nor the rule; drill words and audio
  // checks are rows of their own sections, not lesson items.
  const rowIds = list.split('\n')
    .filter((line) => line.startsWith('| '))
    .map((line) => line.split('|')[1].trim())
    .filter((id) => id !== 'id' && !id.startsWith('---') && !id.startsWith('drill:') && !id.startsWith('audio:'));
  const lessonsDir = new URL('lessons/', CONTENT_URL);
  const doubtedIds = [];
  for (const file of (await readdir(lessonsDir)).filter((f) => f.endsWith('.json'))) {
    const lesson = JSON.parse(await readFile(new URL(file, lessonsDir), 'utf8'));
    for (const { id, verification: v } of lesson.items) {
      if (v.status === 'pending' && (v.review1 === 'doubtful' || v.review2 === 'doubtful')) doubtedIds.push(id);
    }
  }
  assert.deepEqual([...rowIds].sort(), [...doubtedIds].sort());
  assert.equal(new Set(rowIds).size, rowIds.length);
});

test('units.json lists the A1 units in order, each with its motif and the A1 lessonCount; later levels may follow', async () => {
  const units = JSON.parse(await readFile(new URL('units.json', CONTENT_URL), 'utf8'));
  const a1 = units.filter((u) => u.level === 'A1');
  assert.equal(a1.length, SHAPES.A1.courseItems / SHAPES.A1.unitItems);
  assert.deepEqual(a1.map((u) => u.id), ['u01', 'u02', 'u03', 'u04', 'u05', 'u06', 'u07', 'u08', 'u09', 'u10']);
  assert.deepEqual(a1.map((u) => u.order), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(a1.map((u) => u.motif), MOTIFS);
  for (const u of a1) assert.equal(u.lessonCount, SHAPES.A1.lessonCount, u.id);
});

// The grader accepts an answer that differs from its target only by missing diacritics as
// a slip that names the missed letters. An accept entry that is just the target with its
// diacritics stripped would turn that slip into a full correct for one item alone, so no
// lesson lists one. `plain` is the grader's own view of a line without diacritics.
const plain = (s) => stripDiacritics(normalize(s));

test('no accept entry repeats its target without diacritics or punctuation (the grader already takes those)', async () => {
  const lessonsDir = new URL('lessons/', CONTENT_URL);
  const files = (await readdir(lessonsDir)).filter((f) => f.endsWith('.json')).sort();
  assert.ok(files.length > 0, 'no lessons found');
  const offenders = [];
  for (const file of files) {
    const lesson = JSON.parse(await readFile(new URL(file, lessonsDir), 'utf8'));
    const graded = [
      ...lesson.items.map((it) => [it.id, it.sl, it.accept ?? []]),
      ...lesson.production.map((p) => [p.id, p.answer, p.accept ?? []]),
    ];
    for (const [id, target, accept] of graded) {
      for (const variant of accept) {
        if (plain(variant) === plain(target)) {
          offenders.push(`${id}: accept ${JSON.stringify(variant)} is ${JSON.stringify(target)} once case, punctuation and diacritics are ignored`);
        }
      }
    }
  }
  assert.deepEqual(offenders, []);
});
