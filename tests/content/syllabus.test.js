// tests/content/syllabus.test.js (the A1 shape numbers come from SHAPES.A1)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseSyllabus, readSyllabus } from '../../tools/syllabus.js';
import { normalizeSl } from '../../tools/lint-content.js';
import { RULE_ID } from '../../app/js/util/ids.js';
import { SHAPES } from './shapes.js';

const contentDir = fileURLToPath(new URL('../../content/', import.meta.url));
const A1 = SHAPES.A1;
/** The A1 units of content/SYLLABUS.md; a later level brings its own section and its own tests. */
const a1 = async () => (await readSyllabus(contentDir)).filter((unit) => unit.level === 'A1');

const SAMPLE = [
  '# Level A1',
  '',
  'A prose line between sections is ignored.',
  '## u01 Prvi stik / First contact (motif flower)',
  '### u01-l01 theme: Prvi pozdrav / First hello',
  '- Situations: greeting your hosts at the door',
  '- Items (3): Živjo. | Dober dan. | Hvala.',
  '- Rules: r-biti-present, r-ti-vi',
  '- Table keys: 1, 2, 3, sg, du, pl',
  '- Slot: Sem iz ___. with Slovenija, Avstrija',
  '- Dialogue (4 lines): your hosts greet you at the door',
  '### u01-l02 consolidation: Ponovimo / Once more',
  '- Situations: a short visit from hello to goodbye',
  '- Items (2): Prosim. | Nasvidenje.',
  '- Rules: none',
  '- Table keys: none',
  '- Dialogue (6 lines): a visit from hello to goodbye',
  'Checkpoint: up to 16 of the unit\'s accepted items and 2 to 4 from earlier units, pass mark 80 percent.',
].join('\n');

test('parseSyllabus reads the line shapes and refuses a lesson heading without a role or a wrong item count', () => {
  assert.deepEqual(parseSyllabus(SAMPLE), [{
    level: 'A1', id: 'u01', title_sl: 'Prvi stik', title_en: 'First contact', motif: 'flower',
    checkpoint: "up to 16 of the unit's accepted items and 2 to 4 from earlier units, pass mark 80 percent.",
    lessons: [
      { id: 'u01-l01', role: 'theme', title_sl: 'Prvi pozdrav', title_en: 'First hello', situations: 'greeting your hosts at the door',
        items: ['Živjo.', 'Dober dan.', 'Hvala.'], rules: ['r-biti-present', 'r-ti-vi'], tableKeys: ['1', '2', '3', 'sg', 'du', 'pl'],
        slot: 'Sem iz ___. with Slovenija, Avstrija', dialogueLines: 4, dialogue: 'your hosts greet you at the door' },
      { id: 'u01-l02', role: 'consolidation', title_sl: 'Ponovimo', title_en: 'Once more', situations: 'a short visit from hello to goodbye',
        items: ['Prosim.', 'Nasvidenje.'], rules: [], tableKeys: [], slot: null, dialogueLines: 6, dialogue: 'a visit from hello to goodbye' },
    ],
  }]);
  assert.throws(() => parseSyllabus(SAMPLE.replace('### u01-l01 theme:', '### u01-l01:')),
    { message: 'line 5: "### u01-l01: Prvi pozdrav / First hello" is not a lesson heading' });
  assert.throws(() => parseSyllabus(SAMPLE.replace('Items (3)', 'Items (4)')), { message: 'line 7: Items (4) lists 3 entries' });
});

test('the A1 syllabus is ten units of five lessons, four theme lessons of 8 items then a consolidation lesson of 6, 380 items in all', async () => {
  const course = await a1();
  assert.equal(course.length, A1.courseItems / A1.unitItems);
  const themes = A1.lessonCount - 1;
  for (const unit of course) {
    assert.equal(unit.lessons.length, A1.lessonCount, unit.id);
    assert.deepEqual(unit.lessons.map((l) => l.id), unit.lessons.map((_, i) => `${unit.id}-l${String(i + 1).padStart(2, '0')}`), unit.id);
    assert.deepEqual(unit.lessons.map((l) => l.role), [...Array(themes).fill('theme'), 'consolidation'], unit.id);
    assert.deepEqual(unit.lessons.map((l) => l.items.length), [...Array(themes).fill(A1.themeItems), A1.consolidationItems], unit.id);
    assert.equal(unit.lessons.reduce((n, l) => n + l.items.length, 0), A1.unitItems, unit.id);
  }
  assert.equal(course.reduce((n, unit) => n + unit.lessons.reduce((m, l) => m + l.items.length, 0), 0), A1.courseItems);
});

test('its units match units.json in id, title and motif', async () => {
  const course = await a1();
  const listed = JSON.parse(await readFile(new URL('../../content/units.json', import.meta.url), 'utf8')).filter((u) => u.level === 'A1');
  assert.deepEqual(course.map((u) => [u.id, u.title_sl, u.title_en, u.motif]), listed.map((u) => [u.id, u.title_sl, u.title_en, u.motif]));
  assert.deepEqual(listed.map((u) => u.lessonCount), course.map((u) => u.lessons.length));
});

test('each theme lesson introduces one or two rule cards, a consolidation lesson none, and every rule id once', async () => {
  const lessons = (await a1()).flatMap((unit) => unit.lessons);
  const [min, max] = A1.themeRules;
  for (const l of lessons) {
    if (l.role === 'theme') assert.ok(l.rules.length >= min && l.rules.length <= max, `${l.id}: ${l.rules.length} rule cards`);
    else assert.deepEqual(l.rules, [], l.id);
  }
  const ids = lessons.flatMap((l) => l.rules);
  for (const id of ids) assert.match(id, RULE_ID);
  assert.equal(new Set(ids).size, ids.length, 'a rule card is introduced twice');
});

test('no planned item repeats across the course, and u01-l01 keeps its eight items and two rules', async () => {
  /** @type {Map<string, string>} first lesson by normalised item */
  const seen = new Map();
  for (const l of (await readSyllabus(contentDir)).flatMap((unit) => unit.lessons)) {
    for (const sl of l.items) {
      const key = normalizeSl(sl);
      assert.ok(!seen.has(key), `"${sl}" in ${l.id} repeats ${seen.get(key)}`);
      seen.set(key, l.id);
    }
  }
  const first = (await a1())[0].lessons[0];
  assert.deepEqual([first.id, first.role, first.title_sl, first.title_en], ['u01-l01', 'theme', 'Prvi pozdrav', 'First hello']);
  assert.deepEqual(first.items, ['Živjo.', 'Dober dan.', 'Dober večer.', 'Lahko noč.', 'Adijo.', 'Nasvidenje.', 'Hvala.', 'Prosim.']);
  assert.deepEqual(first.rules, ['r-biti-present', 'r-ti-vi']);
});

test('dialogues plan 4 to 6 lines in a theme lesson and 6 to 8 in a consolidation lesson, and every unit plans a slot substitution', async () => {
  for (const unit of await a1()) {
    for (const l of unit.lessons) {
      const [min, max] = l.role === 'consolidation' ? A1.consolidationLines : A1.themeLines;
      assert.ok(l.dialogueLines >= min && l.dialogueLines <= max, `${l.id}: ${l.dialogueLines} dialogue lines`);
    }
    assert.ok(unit.lessons.some((l) => l.slot !== null), `${unit.id} plans no slot substitution`);
  }
});
