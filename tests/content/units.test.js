// tests/content/units.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readSyllabus } from '../../tools/syllabus.js';
import { normalizeSl } from '../../tools/lint-content.js';
import { reviewGuard } from '../../tools/review-guard.js';
import { SHAPES } from './shapes.js';

const CONTENT = new URL('../../content/', import.meta.url);
const contentDir = fileURLToPath(CONTENT);
/** @param {string} file a path under content/ */
const json = async (file) => JSON.parse(await readFile(new URL(file, CONTENT), 'utf8'));
/** The lesson an item belongs to: `u01-l02-i03` gives `u01-l02`. @param {string} itemId */
const lessonOf = (itemId) => itemId.slice(0, itemId.lastIndexOf('-'));
/** @param {number} n @param {number[]} range inclusive, [min, max] */
const within = (n, [min, max]) => n >= min && n <= max;

const READY = ['u01', 'u02', 'u03', 'u04']; // each unit task appends its id, in course order

for (const id of READY) {
  /** The unit as units.json lists it, its syllabus section, its lesson files in that order, and its level's shape. */
  const load = async () => {
    const unit = (await json('units.json')).find((u) => u.id === id);
    const planned = (await readSyllabus(contentDir)).find((u) => u.id === id);
    const lessons = await Promise.all(unit.lessons.map((lessonId) => json(`lessons/${lessonId}.json`)));
    return { unit, planned, lessons, shape: SHAPES[unit.level] };
  };

  test(`${id}: the lessons the syllabus lists, theme lessons then one consolidation lesson`, async () => {
    const { unit, planned, lessons, shape } = await load();
    assert.ok(shape, `SHAPES has no row for level ${unit.level}`);
    assert.deepEqual(unit.lessons, planned.lessons.map((l) => l.id));
    assert.equal(unit.lessons.length, unit.lessonCount);
    assert.deepEqual(lessons.map((l) => [l.id, l.role, l.order, l.title_sl, l.title_en]),
      planned.lessons.map((l, i) => [l.id, l.role, i + 1, l.title_sl, l.title_en]));
  });

  test(`${id}: the items the syllabus plans, 8 per theme lesson and 6 in the consolidation lesson`, async () => {
    const { planned, lessons, shape } = await load();
    for (const [i, lesson] of lessons.entries()) {
      assert.deepEqual(lesson.items.map((item) => normalizeSl(item.sl)), planned.lessons[i].items.map(normalizeSl), lesson.id);
      assert.equal(lesson.items.length, lesson.role === 'consolidation' ? shape.consolidationItems : shape.themeItems, lesson.id);
    }
  });

  test(`${id}: rule cards where the syllabus places them, each in content/rules for this unit`, async () => {
    const { planned, lessons } = await load();
    for (const [i, lesson] of lessons.entries()) {
      assert.deepEqual(lesson.rules, planned.lessons[i].rules, lesson.id);
      for (const ruleId of lesson.rules) assert.equal((await json(`rules/${ruleId}.json`)).unit, id, ruleId);
    }
  });

  test(`${id}: exercise and dialogue sizes, and the consolidation lesson draws on every earlier lesson`, async () => {
    const { lessons, shape } = await load();
    for (const lesson of lessons) {
      assert.ok(within(lesson.structured.length, shape.structured), `${lesson.id}: ${lesson.structured.length} structured`);
      assert.ok(within(lesson.production.length, shape.production), `${lesson.id}: ${lesson.production.length} production`);
      const lines = lesson.dialogue?.lines.length ?? 0;
      assert.ok(within(lines, lesson.role === 'consolidation' ? shape.consolidationLines : shape.themeLines), `${lesson.id}: ${lines} dialogue lines`);
    }
    const last = lessons.find((lesson) => lesson.role === 'consolidation');
    assert.ok(last, 'no consolidation lesson');
    const practised = [...last.production.map((p) => p.item), ...(last.dialogue?.lines ?? []).flatMap((line) => line.new_items ?? [])];
    const drawn = new Set(practised.map(lessonOf).filter((l) => l !== last.id));
    assert.ok(drawn.size >= shape.spread, `${last.id} draws on ${[...drawn].join(', ')}`);
  });

  test(`${id}: at least one slot substitution`, async () => {
    const { lessons } = await load();
    const own = new Set(lessons.flatMap((lesson) => lesson.items.map((item) => item.id)));
    const slotted = lessons.flatMap((lesson) => lesson.items)
      .filter((item) => (item.slots ?? []).some((slot) => slot.fillers.length >= 2 && slot.fillers.every((filler) => own.has(filler))));
    assert.ok(slotted.length > 0, 'no item with a slot of two or more fillers from this unit');
    assert.ok(lessons.some((lesson) => lesson.production.some((p) => p.filler !== undefined && slotted.some((item) => item.id === p.item))),
      'no production swaps a filler');
  });

  test(`${id}: every item reviewed twice or confirmed by a native speaker, none rejected, and the review guard clean`, async () => {
    const { unit, lessons } = await load();
    for (const item of lessons.flatMap((lesson) => lesson.items)) {
      const v = item.verification;
      assert.notEqual(v.status, 'rejected', item.id);
      assert.ok((v.review1 !== null && v.review2 !== null) || v.native !== null, `${item.id} has neither two reviews nor a native verdict`);
    }
    assert.deepEqual((await reviewGuard({ contentDir })).filter((issue) => unit.lessons.includes(issue.lesson)), []);
  });
}
