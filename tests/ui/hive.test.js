// tests/ui/hive.test.js
// The hive: hiveLayout puts the unit panels in two columns and sizes each grid row by its taller
// panel; cellSize is one hexagon size for the whole hive; cellCenters places a panel's cells in rows
// of six. Through tests/helpers/fake-dom.js, renderHive draws one panel per unit with a hexagon
// per lesson filled in proportion, the caption, the seal with the unit's motif, and a tap or Enter
// on a panel reports the unit; a second render starts each cell where it was and moves it to the
// new fill (motion in answer to a session). sealedUnits turns meta.sealed into the hive's flags.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../helpers/fake-dom.js';
import { HIVE_WIDTH, hiveLayout, cellSize, cellCenters, renderHive, sealedUnits } from '../../app/js/ui/components/hive.js';

before(() => {
  installFakeDom();
});

/** Every element under `root`, depth first. @param {any} root @returns {any[]} */
function elements(root) {
  /** @type {any[]} */
  const found = [];
  /** @param {any} node */
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (!child.tagName) continue;
      found.push(child);
      walk(child);
    }
  };
  walk(root);
  return found;
}

/** @param {any} root @param {string} className */
const withClass = (root, className) => elements(root).filter((e) => e.classList.contains(className));

/** @param {string} id @param {string} title_sl @param {string} title_en @param {string} motif @param {string[]} lessons */
const unit = (id, title_sl, title_en, motif, lessons) => ({ id, order: Number(id.slice(1)), title_sl, title_en, motif, lessons });
const UNITS = [
  unit('u01', 'Prvi stik', 'First contact', 'flower', ['u01-l01', 'u01-l02']),
  unit('u02', 'Družina in ljudje', 'Family and people', 'heart', []),
  unit('u03', 'Pri mizi', 'At the table', 'wheat', ['u03-l01']),
];

test('hiveLayout puts the panels in two columns of one width, each grid row as tall as its taller panel', () => {
  const boxes = hiveLayout(10, [1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(boxes.length, 10);
  const { w, h } = boxes[0];
  assert.ok(w > 0 && h > 0);
  assert.ok(boxes.every((b) => b.w === w && b.h === h), 'one lesson or none: every panel has the same size');
  const gap = boxes[1].x - w;
  assert.ok(gap > 0, 'a gap between the columns');
  assert.equal(boxes[1].x + w, HIVE_WIDTH, 'the second column ends at the hive width');
  assert.ok(boxes.filter((_, i) => i % 2 === 0).every((b) => b.x === 0), 'odd units in the left column');
  assert.ok(boxes.filter((_, i) => i % 2 === 1).every((b) => b.x === w + gap), 'even units in the right column');
  for (let i = 0; i < 10; i += 1) assert.equal(boxes[i].y, Math.floor(i / 2) * (h + gap), `row of panel ${i + 1}`);

  const uneven = hiveLayout(3, [7, 1, 0]);
  assert.equal(uneven.length, 3);
  assert.equal(uneven[0].h, uneven[1].h, 'the panels of a row share its height');
  assert.ok(uneven[0].h > uneven[2].h, 'seven lessons wrap into a second row of cells, so the first row is taller');
  assert.deepEqual([uneven[2].x, uneven[2].y], [0, uneven[0].h + gap]);

  assert.deepEqual(hiveLayout(0, []), []);
  assert.deepEqual(hiveLayout(1, [5]).map((b) => [b.x, b.y, b.w]), [[0, 0, w]]);
});

test('cellSize is one hexagon width for the whole hive, capped, and never below the smallest readable size', () => {
  assert.equal(cellSize([]), 28);
  assert.equal(cellSize([1, 0, 0]), 28, 'few cells: the cap');
  assert.equal(cellSize([4]), 28);
  const five = cellSize([5]);
  assert.ok(five < 28 && five > 20, `five per row fit the panel: ${five}`);
  assert.ok(cellSize([6]) < five, 'six per row are smaller');
  assert.equal(cellSize([12]), cellSize([6]), 'more than six wrap, the size stays');
  assert.equal(cellSize([5, 1, 0]), five, 'the widest row decides');
});

test("cellCenters lays out a panel's cells in rows of six, the second row staggered by half a cell", () => {
  const box = { x: 0, y: 0, w: 158, h: 80 };
  const three = cellCenters(box, 3, 28);
  assert.equal(three.length, 3);
  assert.ok(three.every((c) => c.cy === three[0].cy), 'one row');
  assert.ok(three.every((c) => c.r > 0));
  assert.equal(three[1].cx - three[0].cx, three[2].cx - three[1].cx, 'even spacing');
  assert.ok(three[0].cx - 14 >= box.x && three[2].cx + 14 <= box.x + box.w, 'inside the panel');
  const offset = cellCenters({ x: 170, y: 90, w: 158, h: 80 }, 1, 28)[0];
  assert.deepEqual([offset.cx - three[0].cx, offset.cy - three[0].cy], [170, 90], 'the panel position moves the cells');
  const seven = cellCenters(box, 7, 20);
  assert.equal(seven.length, 7);
  assert.equal(new Set(seven.map((c) => c.cy)).size, 2, 'two rows');
  assert.ok(seven[6].cy > seven[0].cy);
  assert.equal(seven[6].cx - seven[0].cx, (seven[1].cx - seven[0].cx) / 2, 'the second row starts half a pitch in');
  assert.deepEqual(cellCenters(box, 0, 28), []);
});

test('renderHive draws one panel per unit with cells filled in proportion, captions, a seal with the motif, and taps', async () => {
  /** @type {string[]} */
  const taps = [];
  const fills = [
    { unitId: 'u01', cells: [{ lessonId: 'u01-l01', fill: 1 }, { lessonId: 'u01-l02', fill: 0.4 }], fill: 0.7 },
    { unitId: 'u02', cells: [], fill: 0 },
    { unitId: 'u03', cells: [{ lessonId: 'u03-l01', fill: 0 }], fill: 0 },
  ];
  const el = renderHive(fills, /** @type {any} */ (UNITS), { onUnit: (id) => { taps.push(id); }, sealed: { u01: true } });
  assert.equal(el.tagName, 'svg');
  assert.equal(el.namespaceURI, 'http://www.w3.org/2000/svg');
  assert.ok(String(el.getAttribute('viewBox')).includes(` ${HIVE_WIDTH} `), 'the viewBox is the hive width');

  const panels = withClass(el, 'hive-panel');
  assert.equal(panels.length, 3);
  assert.ok(panels.every((p) => p.getAttribute('role') === 'button' && p.getAttribute('tabindex') === '0'));
  assert.equal(panels[0].getAttribute('aria-label'), 'Unit 1, Prvi stik, First contact: 70 percent recalled now, sealed');
  assert.equal(panels[1].getAttribute('aria-label'), 'Unit 2, Družina in ljudje, Family and people: no lessons yet');
  assert.equal(panels[2].getAttribute('aria-label'), 'Unit 3, Pri mizi, At the table: 0 percent recalled now');

  assert.deepEqual(panels.map((p) => withClass(p, 'hive-cell').length), [2, 0, 1]);
  const rects = withClass(panels[0], 'hive-fill');
  assert.deepEqual(rects.map((r) => r.style.getPropertyValue('transform')), ['scaleY(1)', 'scaleY(0.4)'], 'honey fills in proportion, from the bottom');
  assert.ok(withClass(panels[0], 'hive-comb').length === 2, 'each cell has its hexagon');
  assert.ok(elements(el).some((e) => e.tagName === 'clipPath'), 'the fill is clipped to the hexagon');

  const captions = elements(el).filter((e) => e.tagName === 'text');
  assert.deepEqual(captions.map((c) => c.textContent), ['Prvi stik', 'Družina in ljudje', 'Pri mizi']);
  assert.ok(captions.every((c) => c.getAttribute('lang') === 'sl'));

  assert.equal(withClass(panels[0], 'hive-seal').length, 1, 'the sealed panel carries its seal');
  assert.equal(withClass(panels[0], 'motif-flower').length, 1, "with the unit's motif");
  assert.equal(withClass(panels[1], 'hive-seal').length, 0);
  assert.equal(withClass(panels[2], 'hive-seal').length, 0);

  panels[0].dispatch('click');
  panels[2].dispatch('keydown', { key: 'Enter' });
  panels[1].dispatch('keydown', { key: 'a' });
  panels[1].dispatch('keydown', { key: ' ' });
  assert.deepEqual(taps, ['u01', 'u03', 'u02']);

  // A second render after a session: the changed cell starts where it was and moves to its new fill.
  const later = [{ ...fills[0], cells: [{ lessonId: 'u01-l01', fill: 1 }, { lessonId: 'u01-l02', fill: 0.8 }], fill: 0.9 }, fills[1], fills[2]];
  const again = renderHive(later, /** @type {any} */ (UNITS), { onUnit: () => {}, sealed: {} });
  const moved = withClass(again, 'hive-fill');
  assert.deepEqual(moved.map((r) => r.style.getPropertyValue('transform')), ['scaleY(1)', 'scaleY(0.4)', 'scaleY(0)'], 'starts where it was');
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(moved.map((r) => r.style.getPropertyValue('transform')), ['scaleY(1)', 'scaleY(0.8)', 'scaleY(0)'], 'then fills');
  assert.equal(withClass(again, 'hive-seal').length, 0, 'unsealed draws no seal');
});

test('renderHive draws every motif the units name', () => {
  const motifs = ['flower', 'heart', 'wheat', 'hexagon', 'sun', 'house', 'bird', 'leaf', 'star', 'bee'];
  const units = motifs.map((motif, i) => unit(`u${String(i + 1).padStart(2, '0')}`, `U ${i + 1}`, `Unit ${i + 1}`, motif, []));
  const sealed = Object.fromEntries(units.map((u) => [u.id, true]));
  const el = renderHive([], /** @type {any} */ (units), { onUnit: () => {}, sealed });
  assert.equal(withClass(el, 'hive-panel').length, 10);
  assert.equal(withClass(el, 'hive-seal').length, 10);
  for (const motif of motifs) assert.equal(withClass(el, `motif-${motif}`).length, 1, motif);
  assert.equal(withClass(el, 'hive-cell').length, 0, 'units without loaded lessons draw no cells');
});

test('sealedUnits turns the dates of meta.sealed into flags by unit id', () => {
  assert.deepEqual(sealedUnits({ schemaVersion: 1, createdAt: 0 }), {});
  assert.deepEqual(sealedUnits({ schemaVersion: 1, createdAt: 0, sealed: {} }), {});
  assert.deepEqual(sealedUnits({ schemaVersion: 1, createdAt: 0, sealed: { u01: '2026-11-02', u02: '2026-11-08' } }), { u01: true, u02: true });
});
