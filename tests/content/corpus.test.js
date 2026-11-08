// tests/content/corpus.test.js
// The real content under content/ against the linter: the two gate behaviours
// the content plan relies on, and the unit list the hive draws.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { lintContent } from '../../tools/lint-content.js';

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
