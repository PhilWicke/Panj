// tests/content/corpus.test.js
// The real content under content/ against the linter: the two gate behaviours
// the content plan relies on, and the unit list the hive draws.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { lintContent } from '../../tools/lint-content.js';
import { normalize, stripDiacritics } from '../../app/js/engine/grading.js';

const CONTENT_URL = new URL('../../content/', import.meta.url);
const contentDir = fileURLToPath(CONTENT_URL);
const MOTIFS = ['flower', 'bee', 'sun', 'hexagon', 'leaf', 'bird', 'house', 'star', 'heart', 'wheat'];

test('the content lints clean in development mode (pending items allowed)', async () => {
  const r = await lintContent({ contentDir, allowPending: true });
  assert.deepEqual(r.errors, []);
});

test('in strict mode the only errors are practised items that are not yet accepted', async () => {
  const r = await lintContent({ contentDir });
  assert.deepEqual(r.errors.filter((e) => e.rule !== 'pending-practised'), []);
});

test('units.json lists the ten units of the syllabus in order, each with its own motif', async () => {
  const units = JSON.parse(await readFile(new URL('units.json', CONTENT_URL), 'utf8'));
  const ids = Array.from({ length: 10 }, (_, i) => `u${String(i + 1).padStart(2, '0')}`);
  assert.deepEqual(units.map((u) => u.id), ids);
  assert.deepEqual(units.map((u) => u.order), ids.map((_, i) => i + 1));
  for (const u of units) assert.ok(MOTIFS.includes(u.motif), `${u.id} has motif ${JSON.stringify(u.motif)}`);
  assert.equal(new Set(units.map((u) => u.motif)).size, units.length, 'motifs repeat');
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
