// tests/content/lint.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { lintContent, statusFor } from '../../tools/lint-content.js';
import { addLesson, addSlot } from './helpers.js';
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
 * @param {{ allowPending?: boolean }} [options] passed to lintContent
 */
async function lintMutated(mutate, { allowPending = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'slovelingo-lint-'));
  try {
    await cp(fx('content-valid'), dir, { recursive: true });
    await mutate(dir);
    return await lintContent({ contentDir: dir, allowPending });
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

test('status must follow from the verdicts', async () => {
  const r = await lintMutated((dir) => editJson(dir, LESSON, (doc) => { doc.items[0].verification = { review1: 'accepted', review2: 'doubtful', native: null, status: 'accepted' }; }));
  assert.deepEqual(byRule(r.errors, 'status-consistency').map(describe), ['lessons/u01-l01.json items/u01-l01-i01/verification/status: is "accepted", but the verdicts give "pending"']);
  assert.equal(statusFor({ review1: 'accepted', review2: 'accepted', native: null }), 'accepted');
  assert.equal(statusFor({ review1: 'rejected', review2: 'accepted', native: null }), 'rejected');
  assert.equal(statusFor({ review1: null, review2: 'accepted', native: null }), 'pending');
  assert.equal(statusFor({ review1: 'rejected', review2: 'doubtful', native: 'corrected' }), 'accepted');
});

test("slot fillers: a production filler must be a slot filler's text or form, and a pending filler is an error unless pending is allowed", async () => {
  const pending = await lintMutated((dir) => addSlot(dir, { fillerStatus: 'pending', filler: 'večer' }));
  assert.deepEqual(byRule(pending.errors, 'pending-filler').map(describe), [
    'lessons/u01-l01.json items/u01-l01-i02/slots/0/fillers/0: uses filler item "u01-l01-i04" whose verification status is "pending"',
    'lessons/u01-l01.json production/u01-l01-p03/filler: uses filler item "u01-l01-i04" whose verification status is "pending"',
  ]);
  const allowed = await lintMutated((dir) => addSlot(dir, { fillerStatus: 'pending', filler: 'večer' }), { allowPending: true });
  assert.deepEqual(byRule(allowed.errors, 'pending-filler'), []);
  const unresolved = await lintMutated((dir) => addSlot(dir, { fillerStatus: 'accepted', filler: 'jutro' }));
  assert.deepEqual(byRule(unresolved.errors, 'reference').map(describe), ['lessons/u01-l01.json production/u01-l01-p03/filler: "jutro" is not the text or a form of a slot filler of "u01-l01-i02"']);
  const resolved = await lintMutated((dir) => addSlot(dir, { fillerStatus: 'accepted', filler: 'Večer.' }));
  assert.deepEqual(resolved.errors, [], 'case and a final full stop are ignored');
});

test('units need a level and a lessonCount, lessons a role', async () => {
  const r = await lintMutated(async (dir) => {
    await editJson(dir, 'units.json', (units) => { delete units[0].level; units[0].lessonCount = 0; });
    await editJson(dir, LESSON, (doc) => { doc.role = 'review'; });
  });
  assert.deepEqual(new Set(byRule(r.errors, 'schema').map(describe)), new Set([
    'units.json u01/level: missing required field',
    'units.json u01/lessonCount: expected a whole number of 1 or more',
    'lessons/u01-l01.json role: expected one of "theme", "consolidation"',
  ]));
});
test('a unit short of its lessonCount warns; one over it, or a complete unit without exactly one consolidation lesson, is an error', async () => {
  const short = await lintContent({ contentDir: fx('content-valid') });
  assert.deepEqual(byRule(short.warnings, 'unit-incomplete').map(describe), ['units.json u01/lessons: lists 1 of 5 lessons']);
  const complete = await lintMutated((dir) => editJson(dir, 'units.json', (units) => { units[0].lessonCount = 1; }));
  assert.deepEqual(byRule(complete.errors, 'lesson-count').map(describe), ['units.json u01/lessons: has all 1 lessons but 0 consolidation lessons; a complete unit has exactly one']);
  const over = await lintMutated(async (dir) => { await addLesson(dir, 'u01-l02', 'consolidation'); await editJson(dir, 'units.json', (units) => { units[0].lessonCount = 1; }); });
  assert.ok(byRule(over.errors, 'lesson-count').map(describe).includes('units.json u01/lessons: lists 2 lessons, more than its lessonCount 1'));
});
test("a consolidation lesson comes last and introduces no rule card, and a lesson's order is its place in the unit", async () => {
  const r = await lintMutated((dir) => editJson(dir, LESSON, (doc) => { doc.role = 'consolidation'; doc.order = 2; }));
  assert.deepEqual(new Set([...byRule(r.errors, 'consolidation'), ...byRule(r.errors, 'lesson-count')].map(describe)), new Set([
    'lessons/u01-l01.json role: a consolidation lesson comes last, at position 5, not 1',
    'lessons/u01-l01.json rules: a consolidation lesson introduces no rule card',
    'lessons/u01-l01.json order: is 2, but the unit lists the lesson at position 1',
  ]));
});
test("standalone: practice draws on the lesson's own items, a consolidation lesson's on its unit's, rules come before use, and lines are short enough to type", async () => {
  const theme = await lintMutated(async (dir) => {
    await addLesson(dir, 'u01-l02', 'theme');
    // rules/r-later.json: a copy of rules/r-biti-present.json with id 'r-later', listed by no lesson
    const later = JSON.parse(await readFile(join(dir, RULE), 'utf8'));
    await writeFile(join(dir, 'rules/r-later.json'), JSON.stringify({ ...later, id: 'r-later' }, null, 2) + '\n');
    await editJson(dir, 'lessons/u01-l02.json', (doc) => {
      doc.production = [{ id: 'u01-l02-p01', en: 'Say good day.', answer: 'Dober dan.', item: 'u01-l01-i02' }];
      doc.structured = [{ id: 'u01-l02-s01', prompt_sl: 'Jaz ___ tukaj.', options: ['sem', 'si'], answer: 'sem', rule: 'r-later', en: 'I am here.' }];
    });
    await editJson(dir, LESSON, (doc) => { doc.dialogue.lines[0].sl = 'Dober dan, dober dan, dober dan, dober dan, dober dan, gospa.'; });
  });
  assert.deepEqual(new Set(byRule(theme.errors, 'standalone').map(describe)), new Set([
    'lessons/u01-l02.json production/u01-l02-p01/item: practises "u01-l01-i02", which is not an item of this lesson',
    'lessons/u01-l02.json structured/u01-l02-s01/rule: uses rule "r-later" before a lesson introduces it',
    'lessons/u01-l01.json dialogue/lines/0/sl: has 61 characters and 11 words; a line to type has at most 60 and 10',
  ]));
  const consolidation = await lintMutated(async (dir) => {
    await addLesson(dir, 'u01-l02', 'consolidation');
    await addLesson(dir, 'u01-l03', 'theme');
    await editJson(dir, 'lessons/u01-l02.json', (doc) => { doc.production = [
      { id: 'u01-l02-p01', en: 'Say good day.', answer: 'Dober dan.', item: 'u01-l01-i02' },
      { id: 'u01-l02-p02', en: 'Say thank you.', answer: 'Hvala.', item: 'u01-l03-i01' },
    ]; });
  });
  assert.deepEqual(byRule(consolidation.errors, 'standalone').map(describe), [
    'lessons/u01-l02.json production/u01-l02-p02/item: practises "u01-l03-i01", which is not an item of this unit up to this lesson',
  ], 'an earlier lesson\'s item is fine, a later lesson\'s is not');
});
test('every item has one or two examples of at most eight words', async () => {
  const r = await lintMutated((dir) => editJson(dir, LESSON, (doc) => {
    doc.items[0].examples = [];
    doc.items[1].examples = [{ sl: 'Dober dan, kako ste danes, gospa, in vi, gospod?', en: 'Good day, how are you today, madam, and you, sir?' }];
  }));
  assert.deepEqual(byRule(r.errors, 'examples').map(describe), [
    'lessons/u01-l01.json items/u01-l01-i01/examples: has 0 examples; an item has one or two',
    'lessons/u01-l01.json items/u01-l01-i02/examples/0/sl: has 9 words; an example has at most 8',
  ]);
});

test('two items with the same English gloss are an error; a note in brackets tells them apart', async () => {
  const same = await lintMutated((dir) => editJson(dir, LESSON, (doc) => { doc.items[1].en = 'hi.'; }));
  assert.deepEqual(byRule(same.errors, 'ambiguous-gloss').map(describe), ['lessons/u01-l01.json items/u01-l01-i02/en: "hi." is also the gloss of "u01-l01-i01"']);
  const noted = await lintMutated((dir) => editJson(dir, LESSON, (doc) => { doc.items[1].en = 'Hi. (polite)'; }));
  assert.deepEqual(byRule(noted.errors, 'ambiguous-gloss'), []);
});

test('an example with an unrecorded form of a word item is a warning', async () => {
  const r = await lintMutated((dir) => editJson(dir, LESSON, (doc) => { doc.items[2].forms = {}; doc.items[2].examples = [{ sl: 'Imam dva brata.', en: 'I have two brothers.' }]; }));
  assert.deepEqual(byRule(r.warnings, 'form-unrecorded').map(describe), ['lessons/u01-l01.json items/u01-l01-i03/examples/0/sl: uses "brata", a form of "brat" missing from forms']);
  assert.deepEqual(r.errors, []);
  const recorded = await lintMutated((dir) => editJson(dir, LESSON, (doc) => { doc.items[2].examples = [{ sl: 'Imam dva brata.', en: 'I have two brothers.' }]; }));
  assert.deepEqual(byRule(recorded.warnings, 'form-unrecorded'), [], 'brata is recorded under du');
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
  assert.ok(lines.includes('WARNING units.json u01/lessons unit-incomplete: lists 1 of 5 lessons'), strict.stdout);
  assert.equal(lines.at(-1), '2 errors, 2 warnings');

  const dev = await cli('--allow-pending', fx('content-invalid-pending'));
  assert.equal(dev.code, 0, dev.stderr);
  assert.ok(!dev.stdout.includes('ERROR'), dev.stdout);
  assert.equal(dev.stdout.trim().split('\n').at(-1), '0 errors, 2 warnings (pending items allowed)');
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
  assert.ok(['level', 'lessonCount'].every((k) => schemas.Units.$defs.Unit.required.includes(k)));
  assert.deepEqual(schemas.Units.$defs.Unit.properties.level.enum, ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
  assert.ok(schemas.Lesson.required.includes('role'));
  assert.deepEqual(schemas.Lesson.properties.role.enum, ['theme', 'consolidation']);
});

// The cast rule: every speaker other than the learner has one recorded voice, and the speakers
// of one scene can be told apart by it.

test('cast: a speaker other than you without a voice is an error, with an empty cast or none at all', async () => {
  const missing = ['lessons/u01-l01.json dialogue/cast/host: speaker "host" has no voice in the cast'];
  const empty = await lintMutated((dir) => editJson(dir, LESSON, (doc) => { doc.dialogue.cast = {}; }));
  assert.deepEqual(byRule(empty.errors, 'cast').map(describe), missing);
  const none = await lintMutated((dir) => editJson(dir, LESSON, (doc) => { delete doc.dialogue.cast; }));
  assert.deepEqual(byRule(none.errors, 'cast').map(describe), missing);
});

test('cast: an entry for someone who does not speak, or for you, is an error', async () => {
  const r = await lintMutated((dir) => editJson(dir, LESSON, (doc) => {
    doc.dialogue.cast = { host: 'female', waiter: 'male', you: 'female' };
  }));
  assert.deepEqual(new Set(byRule(r.errors, 'cast').map(describe)), new Set([
    'lessons/u01-l01.json dialogue/cast/waiter: "waiter" has a voice but does not speak in this dialogue',
    'lessons/u01-l01.json dialogue/cast/you: "you" is the learner and takes no voice in the cast',
  ]));
});

test('cast: speakers other than you must not all share one voice', async () => {
  /** @param {Record<string, string>} cast @param {boolean} [third] */
  const scene = (cast, third = false) => lintMutated((dir) => editJson(dir, LESSON, (doc) => {
    doc.dialogue.lines[3].speaker = 'waiter';
    if (third) doc.dialogue.lines.push({ speaker: 'clerk', sl: 'Dober dan.', en: 'Good day.' });
    doc.dialogue.cast = cast;
  }));
  assert.deepEqual(byRule((await scene({ host: 'male', waiter: 'male' })).errors, 'cast').map(describe), [
    'lessons/u01-l01.json dialogue/cast: "host", "waiter" all share the voice "male"; a scene tells its speakers apart by voice',
  ]);
  assert.deepEqual(byRule((await scene({ host: 'male', waiter: 'female' })).errors, 'cast'), []);
  assert.equal(byRule((await scene({ host: 'female', waiter: 'female', clerk: 'female' }, true)).errors, 'cast').length, 1);
  assert.deepEqual(byRule((await scene({ host: 'female', waiter: 'female', clerk: 'male' }, true)).errors, 'cast'), []);
});

test('cast: the schema names the two voices and does not require the field', async () => {
  const r = await lintMutated((dir) => editJson(dir, LESSON, (doc) => { doc.dialogue.cast = { host: 'robot' }; }));
  assert.deepEqual(byRule(r.errors, 'schema').map(describe), ['lessons/u01-l01.json dialogue/cast/host: expected one of "female", "male"']);
  const schema = JSON.parse(await readFile(fileURLToPath(new URL('../../content/schema/lesson.schema.json', import.meta.url)), 'utf8'));
  assert.deepEqual(schema.$defs.Dialogue.properties.cast.additionalProperties.enum, ['female', 'male']);
  assert.ok(!schema.$defs.Dialogue.required.includes('cast'));
});
