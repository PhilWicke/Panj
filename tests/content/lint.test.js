// tests/content/lint.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { lintContent } from '../../tools/lint-content.js';
const fx = (name) => fileURLToPath(new URL(`../../tools/fixtures/${name}/`, import.meta.url));

test('valid fixture lints clean', async () => {
  const r = await lintContent({ contentDir: fx('content-valid') });
  assert.deepEqual(r.errors, []);
});
test('non-Slovenian letters are an error', async () => {
  const r = await lintContent({ contentDir: fx('content-invalid-letters') });
  assert.ok(r.errors.some(e => e.rule === 'alphabet' && e.message.includes('á')));
});
test('duplicate headword is an error', async () => {
  const r = await lintContent({ contentDir: fx('content-invalid-duplicate') });
  assert.ok(r.errors.some(e => e.rule === 'duplicate'));
});
test('practising a pending item is an error unless allowed', async () => {
  const strict = await lintContent({ contentDir: fx('content-invalid-pending') });
  assert.ok(strict.errors.some(e => e.rule === 'pending-practised'));
  const dev = await lintContent({ contentDir: fx('content-invalid-pending'), allowPending: true });
  assert.ok(!dev.errors.some(e => e.rule === 'pending-practised'));
});
test('personal framing is an error', async () => {
  const r = await lintContent({ contentDir: fx('content-invalid-personal') });
  assert.ok(r.errors.some(e => e.rule === 'personal'));
});
test('missing helper for a cognate is a warning', async () => {
  const r = await lintContent({ contentDir: fx('content-valid') });
  assert.ok(r.warnings.some(w => w.rule === 'helper-missing' && w.path.includes('u01-l01-i03')));
});

// Beyond the brief: the rules the fixtures above do not reach, checked on a
// copy of the valid fixture with one edit each, plus the CLI contract.

const LESSON = 'lessons/u01-l01.json';
const RULE = 'rules/r-biti-present.json';

/**
 * Lints a temporary copy of the valid fixture after `mutate` has edited it.
 * @param {(dir: string) => Promise<void>} mutate
 */
async function lintMutated(mutate) {
  const dir = await mkdtemp(join(tmpdir(), 'slovelingo-lint-'));
  try {
    await cp(fx('content-valid'), dir, { recursive: true });
    await mutate(dir);
    return await lintContent({ contentDir: dir });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Rewrites one JSON file of a content folder in place.
 * @param {string} dir @param {string} file @param {(doc: any) => void} edit
 */
async function editJson(dir, file, edit) {
  const target = join(dir, file);
  const doc = JSON.parse(await readFile(target, 'utf8'));
  edit(doc);
  await writeFile(target, JSON.stringify(doc, null, 2) + '\n');
}

/** @param {{ rule: string }[]} issues @param {string} rule */
const byRule = (issues, rule) => issues.filter((issue) => issue.rule === rule);
/** @param {{ file: string, path: string, message: string }} issue */
const describe = (issue) => `${issue.file} ${issue.path || '-'}: ${issue.message}`;

test('schema errors name the field: unknown field, wrong type, bad id, missing field, stray id', async () => {
  const r = await lintMutated((dir) => editJson(dir, LESSON, (doc) => {
    doc.items[0].helpr = 'typo';
    doc.order = '1';
    doc.items[1].id = 'u01-l01-x02';
    delete doc.items[2].verification;
    doc.production[0].id = 'u02-l01-p01';
  }));
  const found = byRule(r.errors, 'schema').map(describe);
  assert.deepEqual(new Set(found), new Set([
    'lessons/u01-l01.json items/u01-l01-i01/helpr: unknown field "helpr"',
    'lessons/u01-l01.json order: expected a whole number of 1 or more',
    'lessons/u01-l01.json items/u01-l01-x02/id: expected an item id like u01-l01-i01',
    'lessons/u01-l01.json items/u01-l01-i03/verification: missing required field',
    'lessons/u01-l01.json production/u02-l01-p01/id: id should start with u01-l01-',
  ]));
  assert.equal(found.length, 5);
});

test('dangling references are errors, in both directions between units and lessons', async () => {
  const r = await lintMutated(async (dir) => {
    await editJson(dir, LESSON, (doc) => {
      doc.rules.push('r-nope');
      doc.items[0].rules = ['r-nope'];
      doc.items[0].slots = [{ label: 'greeting', fillers: ['u01-l01-i07'] }];
      doc.structured[0].rule = 'r-missing';
      doc.production[1].item = 'u01-l01-i09';
      doc.dialogue.lines[1].new_items = ['u01-l01-i08'];
    });
    await editJson(dir, RULE, (doc) => { doc.unit = 'u09'; });
    await editJson(dir, 'units.json', (units) => { units[0].lessons = ['u01-l02']; });
  });
  const found = byRule(r.errors, 'reference').map(describe);
  assert.deepEqual(new Set(found), new Set([
    'lessons/u01-l01.json rules/1: unknown rule "r-nope"',
    'lessons/u01-l01.json items/u01-l01-i01/rules/0: unknown rule "r-nope"',
    'lessons/u01-l01.json items/u01-l01-i01/slots/0/fillers/0: unknown item "u01-l01-i07"',
    'lessons/u01-l01.json structured/u01-l01-s01/rule: unknown rule "r-missing"',
    'lessons/u01-l01.json production/u01-l01-p02/item: unknown item "u01-l01-i09"',
    'lessons/u01-l01.json dialogue/lines/1/new_items/0: unknown item "u01-l01-i08"',
    'lessons/u01-l01.json unit: unit "u01" does not list lesson "u01-l01" in units.json',
    'rules/r-biti-present.json unit: unit "u09" is not in units.json',
    'units.json u01/lessons/0: unknown lesson "u01-l02"',
  ]));
  assert.equal(found.length, 9);
});

test('a rule card over 40 words is an error, 40 words are fine', async () => {
  const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
  const long = await lintMutated((dir) => editJson(dir, RULE, (doc) => { doc.card_en = words(41); }));
  assert.deepEqual(byRule(long.errors, 'card-length').map(describe), ['rules/r-biti-present.json card_en: has 41 words, the limit is 40']);
  const fits = await lintMutated((dir) => editJson(dir, RULE, (doc) => { doc.card_en = words(40); }));
  assert.deepEqual(fits.errors, []);
});

test('recognition-only items are never asked for in production or structured exercises', async () => {
  const r = await lintMutated((dir) => editJson(dir, LESSON, (doc) => {
    doc.items[0].register = 'recognition';
    doc.structured[0].options = ['sem', 'Živjo'];
    doc.structured[0].answer = 'Živjo';
    doc.production[1].answer = 'Živjo, dober dan.';
  }));
  assert.deepEqual(new Set(byRule(r.errors, 'register').map(describe)), new Set([
    'lessons/u01-l01.json production/u01-l01-p01/item: item "u01-l01-i01" is recognition-only and is never produced',
    'lessons/u01-l01.json production/u01-l01-p02/answer: answer contains the recognition-only item "Živjo." (u01-l01-i01)',
    'lessons/u01-l01.json structured/u01-l01-s01/answer: answer contains the recognition-only item "Živjo." (u01-l01-i01)',
  ]));
});

test('prompt_sl carries exactly one blank, a run of underscores that may attach to a stem', async () => {
  const r = await lintMutated(async (dir) => {
    await editJson(dir, LESSON, (doc) => {
      doc.structured[0].prompt_sl = 'Jaz sem tukaj.';
      doc.structured.push({ id: 'u01-l01-s02', prompt_sl: 'Pijem kav_', options: ['o', 'a'], answer: 'o', rule: 'r-biti-present', en: 'I drink coffee.' });
    });
    await editJson(dir, RULE, (doc) => { doc.quick_check.prompt_sl = 'M_dva ___ lačna.'; });
  });
  assert.deepEqual(new Set(byRule(r.errors, 'alphabet').map(describe)), new Set([
    'lessons/u01-l01.json structured/u01-l01-s01/prompt_sl: expected exactly one blank marked by underscores, like "Midva ___ lačna." or "Pijem kav_", found none',
    'rules/r-biti-present.json quick_check/prompt_sl: expected exactly one blank marked by underscores, like "Midva ___ lačna." or "Pijem kav_", found 2',
  ]));
  assert.equal(r.errors.length, 2);
});

test('malformed JSON and a missing units.json are schema errors on the file', async () => {
  const r = await lintMutated(async (dir) => {
    await writeFile(join(dir, RULE), '{ "id": "r-biti-present", ');
    await rm(join(dir, 'units.json'));
  });
  const found = byRule(r.errors, 'schema').map(describe);
  assert.ok(found.some((line) => line.startsWith('rules/r-biti-present.json -: invalid JSON: ')), found.join('\n'));
  assert.ok(found.includes('units.json -: file is missing'), found.join('\n'));
});

test('a missing content directory is a clear error, not a crash', async () => {
  await assert.rejects(
    lintContent({ contentDir: join(tmpdir(), 'slovelingo-no-such-dir') }),
    /^Error: Content directory not found: .*slovelingo-no-such-dir$/,
  );
});

const run = promisify(execFile);
const CLI = fileURLToPath(new URL('../../tools/lint-content.js', import.meta.url));

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

test('CLI prints one line per issue as "ERROR file path rule: message" and exits 1 on any error', async () => {
  const strict = await cli(fx('content-invalid-pending'));
  assert.equal(strict.code, 1, strict.stderr);
  const lines = strict.stdout.trim().split('\n');
  assert.ok(lines.includes('ERROR lessons/u01-l01.json production/u01-l01-p03/item pending-practised: practises item "u01-l01-i03" whose verification status is "pending"'), strict.stdout);
  assert.ok(lines.some((line) => line.startsWith('WARNING lessons/u01-l01.json items/u01-l01-i03/helper helper-missing: ')), strict.stdout);
  assert.equal(lines.at(-1), '2 errors, 1 warning');

  const dev = await cli('--allow-pending', fx('content-invalid-pending'));
  assert.equal(dev.code, 0, dev.stderr);
  assert.ok(!dev.stdout.includes('ERROR'), dev.stdout);
  assert.equal(dev.stdout.trim().split('\n').at(-1), '0 errors, 1 warning (pending items allowed)');
});

test('CLI reports a missing content directory and an unknown option without a stack trace', async () => {
  const missing = await cli(join(tmpdir(), 'slovelingo-no-such-dir'));
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /^ERROR Content directory not found: /);
  assert.ok(!missing.stderr.includes('    at '), missing.stderr);
  const bad = await cli('--nope');
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /Unexpected argument --nope/);
});

test('schema files are valid JSON Schema documents that agree with the linter on the alphabet', async () => {
  const dir = fileURLToPath(new URL('../../content/schema/', import.meta.url));
  const schemas = {};
  for (const [file, title] of [['lesson.schema.json', 'Lesson'], ['rule.schema.json', 'Rule'], ['unit.schema.json', 'Units']]) {
    const schema = JSON.parse(await readFile(join(dir, file), 'utf8'));
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema', file);
    assert.equal(schema.title, title, file);
    schemas[title] = schema;
  }
  const sl = new RegExp(schemas.Lesson.$defs.slText.pattern, 'u');
  assert.ok(sl.test(`Živjo, kako si? (Dober dan.) "ČŠŽ" 'ok'; 12:30 - ja!`));
  assert.ok(!sl.test('Dobár dan.'));
  assert.ok(!sl.test('Jaz ___ tukaj.'));
  const prompt = new RegExp(schemas.Lesson.$defs.promptText.pattern, 'u');
  assert.ok(prompt.test('Jaz ___ tukaj.'));
  assert.ok(prompt.test('Pijem kav_'));
  assert.ok(!prompt.test('Jaz sem tukaj.'));
  assert.ok(!prompt.test('M_dva ___ lačna.'));
  assert.equal(schemas.Rule.$defs.promptText.pattern, schemas.Lesson.$defs.promptText.pattern);
  assert.equal(schemas.Rule.$defs.slText.pattern, schemas.Lesson.$defs.slText.pattern);
  assert.equal(schemas.Units.$defs.Unit.properties.title_sl.pattern, schemas.Lesson.$defs.slText.pattern);
});
