// tests/content/cast.test.js
// The real content under content/ and the dialogues' casts: every dialogue passes the cast lint
// rule, and over the whole course each voice has between 40 and 60 percent of the lines spoken by
// speakers other than the learner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { lintContent } from '../../tools/lint-content.js';

const CONTENT_URL = new URL('../../content/', import.meta.url);
const contentDir = fileURLToPath(CONTENT_URL);
const LESSONS_URL = new URL('lessons/', CONTENT_URL);
const LEARNER = 'you';
const MIN_SHARE = 0.4;
const MAX_SHARE = 0.6;

/** The dialogues of every lesson of the real content. */
async function dialogues() {
  const names = (await readdir(LESSONS_URL)).filter((name) => name.endsWith('.json')).sort();
  const lessons = await Promise.all(names.map(async (name) => JSON.parse(await readFile(new URL(name, LESSONS_URL), 'utf8'))));
  return lessons.flatMap((lesson) => (lesson.dialogue ? [lesson.dialogue] : []));
}

test('every dialogue of the real content passes the cast rule', async () => {
  const r = await lintContent({ contentDir, allowPending: true });
  assert.deepEqual(r.errors.filter((e) => e.rule === 'cast'), []);
  for (const dialogue of await dialogues()) {
    const speakers = new Set(dialogue.lines.map((line) => line.speaker).filter((speaker) => speaker !== LEARNER));
    assert.deepEqual(new Set(Object.keys(dialogue.cast ?? {})), speakers, dialogue.id);
  }
});

test('over the course each voice has between 40 and 60 percent of the other speakers\' lines', async () => {
  const counts = { female: 0, male: 0 };
  for (const dialogue of await dialogues()) {
    for (const line of dialogue.lines) if (line.speaker !== LEARNER) counts[dialogue.cast[line.speaker]] += 1;
  }
  const total = counts.female + counts.male;
  assert.ok(total > 0, 'the course has lines by speakers other than the learner');
  for (const [voice, lines] of Object.entries(counts)) {
    const share = lines / total;
    assert.ok(share >= MIN_SHARE && share <= MAX_SHARE, `${voice}: ${lines} of ${total} lines is ${(share * 100).toFixed(1)} percent`);
  }
});
