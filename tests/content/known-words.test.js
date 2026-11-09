// tests/content/known-words.test.js
// Known-word shares: the words of a lesson's examples and dialogue that earlier lessons, or the
// lesson's own items and rule cards, have already taught or shown.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { knownBefore, knownShares } from '../../tools/known-words.js';
import { addLesson, copyFixture, editJson, removeCopies } from './helpers.js';

after(removeCopies);

/** @type {string[]} */
const written = [];
after(() => Promise.all(written.map((dir) => rm(dir, { recursive: true, force: true }))));

/** @param {string} file @param {unknown} doc */
const writeJson = (file, doc) => writeFile(file, JSON.stringify(doc, null, 2) + '\n');

/**
 * Writes the two-lesson fixture: knownShares reads only the fields it counts.
 * @returns {Promise<string>} the content folder
 */
async function twoLessons() {
  const root = await mkdtemp(join(tmpdir(), 'slovelingo-known-test-'));
  written.push(root);
  await mkdir(join(root, 'lessons'));
  await mkdir(join(root, 'rules'));
  await writeJson(join(root, 'units.json'), [{ id: 'u01', order: 1, lessons: ['u01-l01', 'u01-l02'] }]);
  await writeJson(join(root, 'lessons/u01-l01.json'), {
    id: 'u01-l01',
    items: [{ id: 'u01-l01-i01', sl: 'Dober dan.', examples: [{ sl: 'Dober dan, gospa.' }] }],
    rules: [],
    dialogue: { lines: [{ sl: 'Dober dan.' }, { sl: 'Dober dan, gospa.' }] },
  });
  await writeJson(join(root, 'lessons/u01-l02.json'), {
    id: 'u01-l02',
    items: [{ id: 'u01-l02-i01', sl: 'Hvala.', examples: [{ sl: 'Hvala, gospa.' }, { sl: 'Hvala za kavo.' }] }],
    rules: [],
    dialogue: { lines: [{ sl: 'Dober dan.' }, { sl: 'Hvala za kavo, gospa.' }] },
  });
  return root;
}

test('the first lesson of the course is exempt; a later lesson counts the earlier lessons as known', async () => {
  const contentDir = await twoLessons();
  assert.deepEqual(await knownShares({ contentDir }), [
    { lesson: 'u01-l01', examples: 2 / 3, dialogue: 1, exempt: true },
    { lesson: 'u01-l02', examples: 3 / 5, dialogue: 1, exempt: false },
  ]);
  assert.deepEqual(await knownBefore({ contentDir, lessonId: 'u01-l02' }), ['dan', 'dober', 'gospa']);
  assert.deepEqual(await knownBefore({ contentDir, lessonId: 'u01-l01' }), []);
});

test('the rule cards a lesson introduces and digits count as known', async () => {
  const contentDir = await twoLessons();
  await editJson(contentDir, 'lessons/u01-l02.json', (doc) => {
    doc.rules = ['r-za'];
    doc.dialogue.lines[1].sl = 'Hvala za 2 kavi, gospa.';
  });
  await writeJson(join(contentDir, 'rules/r-za.json'), { id: 'r-za', example: { sl: 'Za kavo.' } });
  const [, second] = await knownShares({ contentDir });
  assert.deepEqual([second.examples, second.dialogue], [1, 6 / 7]);
});

const run = promisify(execFile);
const CLI = fileURLToPath(new URL('../../tools/known-words.js', import.meta.url));
const BUILD = fileURLToPath(new URL('../../tools/build-content.js', import.meta.url));

/** Runs a tool and resolves with its exit code and output, whatever the code. @param {string} tool @param {string[]} args */
async function cli(tool, ...args) {
  try {
    const { stdout, stderr } = await run(process.execPath, [tool, ...args]);
    return { code: 0, stdout, stderr };
  } catch (err) {
    const failure = /** @type {{ code: number, stdout: string, stderr: string }} */ (err);
    return { code: failure.code, stdout: failure.stdout, stderr: failure.stderr };
  }
}

test('the CLI prints one KNOWN line per lesson rounded down, exits 1 under a share, and --before lists the known words', async () => {
  const contentDir = await twoLessons();
  const shares = await cli(CLI, contentDir);
  assert.equal(shares.code, 1);
  assert.equal(shares.stdout, 'KNOWN u01-l01 examples=0.66 dialogue=1.00 exempt\nKNOWN u01-l02 examples=0.60 dialogue=1.00\n');
  assert.equal(shares.stderr, 'ERROR known-words u01-l02: examples 0.60 is under 0.95\n');
  const before = await cli(CLI, '--before', 'u01-l02', contentDir);
  assert.equal(before.code, 0, before.stderr);
  assert.equal(before.stdout, 'dan dober gospa\n');
});

test('build --known-check prints the shares after the summary and exits 0 when they hold', async () => {
  const valid = await copyFixture('content-valid');
  const held = await cli(BUILD, '--check', '--allow-pending', '--known-check', valid);
  assert.equal(held.code, 0, held.stderr);
  assert.match(held.stdout, /^units=1 lessons=1 .*\nKNOWN u01-l01 examples=\d\.\d\d dialogue=\d\.\d\d exempt\n$/);
  // A second lesson whose example uses a word no lesson has taught (gospa), and no dialogue.
  const short = await copyFixture('content-valid', (dir) => addLesson(dir, 'u01-l02'));
  const missed = await cli(BUILD, '--check', '--allow-pending', '--known-check', short);
  assert.equal(missed.code, 1);
  assert.match(missed.stdout, /\nKNOWN u01-l02 examples=0\.50 dialogue=-\n$/);
  assert.ok(missed.stderr.endsWith('ERROR known-words u01-l02: examples 0.50 is under 0.95\n'), missed.stderr);
});
