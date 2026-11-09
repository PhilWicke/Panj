// tests/ui/hive.test.js
// The hive as honeycomb strips: the geometry constants, cellWidth (one cell width for the whole
// hive, shrinking only when the widest strip would not fit the column), cellCenters (the comb
// centred, every other row offset by half a cell), hexPoints (a regular pointy-top hexagon) and
// stripCells (a unit's lessonCount cells, bundled lessons at their order, placeholders elsewhere).
// Through tests/helpers/fake-dom.js, renderHive draws one strip per unit with its cells, states,
// fills, caption and tap target, a heading per level when the course has more than one, and the
// painted seal over a sealed strip; renderStrip draws one strip large, marks the current lesson,
// reports cell taps and carries the seal too. The fake DOM does no hit testing, so a CSS test pins
// the seal as paint only (pointer-events: none): in a browser a tap on a sealed cell must fall
// through the board and motifs to the cell and the strip. A second render starts each cell where
// it was and moves it to the new fill, a seal new in this page's life paints once, and
// resetHiveMemory forgets what was shown, so each test starts from a hive never drawn. sealedUnits
// turns meta.sealed into the hive's flags.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom } from '../helpers/fake-dom.js';
import { elements, withClass } from '../helpers/dom-query.js';
import { HIVE_WIDTH, CELL_W, CELL_H, CAPTION_H, STRIP_PITCH, cellWidth, stripCells, cellCenters, hexPoints,
  renderHive, renderStrip, resetHiveMemory, sealedUnits } from '../../app/js/ui/components/hive.js';

before(() => {
  installFakeDom();
});

beforeEach(() => {
  resetHiveMemory();
});

const TITLES = ['Prvi stik', 'Družina in ljudje', 'Pri mizi', 'V kavarni in v trgovini', 'Dan in čas', 'Dom', 'Po mestu', 'Prosti čas in vreme', 'Telo in zdravje', 'Delo in študij'];
const MOTIFS = ['flower', 'heart', 'wheat', 'cup', 'sun', 'house', 'bird', 'leaf', 'hand', 'bee'];
const pad = (n) => String(n).padStart(2, '0');
const UNITS = TITLES.map((title_sl, i) => ({ id: `u${pad(i + 1)}`, order: i + 1, title_sl, title_en: `Unit ${i + 1}`, motif: MOTIFS[i], level: 'A1', lessonCount: 5, lessons: [] }));
/** A unit's fill with one cell per spec, in order. @param {string} unitId @param {[number, string][]} specs @param {number} [share] */
const fillOf = (unitId, specs, share = 0) => ({ unitId, fill: share, cells: specs.map(([fill, state], i) => ({ lessonId: `${unitId}-l${pad(i + 1)}`, order: i + 1, fill, state })) });
const FIVE = /** @type {[number, string][]} */ ([[1, 'learned'], [0.4, 'in-progress'], [0, 'not-started'], [0, 'not-started'], [0, 'not-started']]);
const FILLS = UNITS.map((u) => fillOf(u.id, FIVE, 0.28));

test('the geometry: 52 by 60 cells, a 78 unit strip, ten strips in 780, 48 px cells at 360 px', () => {
  assert.deepEqual([HIVE_WIDTH, CELL_W, CELL_H, CAPTION_H, STRIP_PITCH], [358, 52, 60, 18, 78]);
  assert.equal(Math.round(CELL_W * 328 / HIVE_WIDTH), 48);
  assert.equal(cellWidth(5), 52);
  assert.equal(cellWidth(0), 52);
  assert.equal(Math.round(cellWidth(7) * 100) / 100, 47.73, 'seven cells shrink to fit the column');
  assert.equal(hexPoints(26, 30, 52), '26,1.13 51,15.57 51,44.43 26,58.87 1,44.43 1,15.57', 'a regular hexagon: half height twice the roof rise');
});

test('cellCenters centres the comb and offsets every other row by half a cell', () => {
  const row0 = cellCenters(5, 52, 0, 5);
  const row1 = cellCenters(5, 52, 1, 5);
  assert.deepEqual(row0.map((c) => c.cx), [62, 114, 166, 218, 270]);
  assert.ok(row0.every((c) => c.cy === 30));
  assert.deepEqual(row1.map((c) => c.cx), [88, 140, 192, 244, 296]);
  assert.ok(row1.every((c) => c.cy === 108));
  const seven = cellCenters(7, cellWidth(7), 1, 7);
  assert.ok(seven[6].cx + cellWidth(7) / 2 <= HIVE_WIDTH + 1e-9, 'the widest strip fits');
});

test('stripCells draws lessonCount cells, bundled lessons at their order and placeholders elsewhere', () => {
  const u = { ...UNITS[1] };
  const f = { unitId: 'u02', fill: 0.5, cells: [{ lessonId: 'u02-l01', order: 1, fill: 1, state: 'learned' }, { lessonId: 'u02-l03', order: 3, fill: 0, state: 'not-started' }] };
  assert.deepEqual(stripCells(u, f).map((c) => [c.position, c.lessonId, c.state]),
    [[1, 'u02-l01', 'learned'], [2, null, 'not-started'], [3, 'u02-l03', 'not-started'], [4, null, 'not-started'], [5, null, 'not-started']]);
  assert.deepEqual(stripCells({ ...u, lessonCount: undefined }, f).map((c) => c.position), [1, 2, 3], 'no lessonCount: up to the highest bundled order');
  assert.deepEqual(stripCells({ ...u, lessonCount: undefined }, undefined), []);
  assert.equal(stripCells(u, undefined).length, 5, 'a unit with no bundled lesson still draws its cells');
});

test('renderHive draws one strip per unit and one cell per lesson, fifty for ten by five, with states, captions and taps', () => {
  /** @type {string[]} */
  const taps = [];
  const el = renderHive(FILLS, /** @type {any} */ (UNITS), { onUnit: (id) => { taps.push(id); }, sealed: {} });
  assert.equal(el.tagName, 'DIV');
  const svgs = elements(el).filter((e) => e.tagName === 'svg');
  assert.equal(svgs.length, 1);
  assert.equal(svgs[0].getAttribute('viewBox'), '0 0 358 780');
  assert.equal(elements(el).filter((e) => e.tagName === 'H2').length, 0, 'one level, no heading');
  const strips = withClass(el, 'hive-strip');
  assert.equal(strips.length, 10);
  assert.equal(withClass(el, 'hive-cell').length, 50);
  assert.deepEqual(withClass(strips[0], 'hive-cell').map((c) => c.getAttribute('class')),
    ['hive-cell is-learned', 'hive-cell is-in-progress', 'hive-cell is-not-started', 'hive-cell is-not-started', 'hive-cell is-not-started']);
  assert.deepEqual(withClass(strips[0], 'hive-fill').map((r) => r.style.getPropertyValue('transform')), ['scaleY(1)', 'scaleY(0.4)', 'scaleY(0)', 'scaleY(0)', 'scaleY(0)']);
  assert.deepEqual(withClass(el, 'hive-caption').map((t) => t.textContent), TITLES);
  assert.equal(strips[0].getAttribute('aria-label'), 'Unit 1, Prvi stik, Unit 1: 28 percent recalled now');
  const hit = withClass(strips[1], 'hive-hit')[0];
  assert.deepEqual(['x', 'y', 'width', 'height'].map((a) => hit.getAttribute(a)), ['0', '78', '358', '78']);
  assert.ok(Number(hit.getAttribute('height')) * 328 / HIVE_WIDTH >= 44, 'a strip is a 44 px target at 360 px');
  strips[0].dispatch('click');
  strips[3].dispatch('keydown', { key: 'Enter' });
  strips[4].dispatch('keydown', { key: 'a' });
  strips[4].dispatch('keydown', { key: ' ' });
  assert.deepEqual(taps, ['u01', 'u04', 'u05']);
});

test('without bundled lessons every strip draws placeholder cells and says so', () => {
  const el = renderHive([], /** @type {any} */ (UNITS), { onUnit: () => {}, sealed: {} });
  assert.equal(withClass(el, 'is-placeholder').length, 50);
  assert.equal(withClass(el, 'hive-fill').length, 0);
  assert.equal(withClass(el, 'hive-strip')[3].getAttribute('aria-label'), 'Unit 4, V kavarni in v trgovini, Unit 4: no lessons yet');
});

test('a sealed strip paints its motif over every cell and keeps the fills under it', () => {
  const el = renderHive(FILLS, /** @type {any} */ (UNITS), { onUnit: () => {}, sealed: { u01: true } });
  const strip = withClass(el, 'hive-strip')[0];
  const seal = withClass(strip, 'hive-seal')[0];
  assert.equal(strip.childNodes.at(-1), seal, 'painted last, over the cells');
  assert.equal(withClass(seal, 'hive-seal-board').length, 1);
  const uses = elements(seal).filter((e) => e.tagName === 'use');
  assert.equal(uses.length, 5);
  assert.ok(uses.every((u) => u.getAttribute('class') === 'hive-motif motif-flower'));
  const id = uses[0].getAttribute('href').slice(1);
  assert.ok(elements(el).some((e) => e.tagName === 'symbol' && e.getAttribute('id') === id), 'the symbol is in the same SVG');
  assert.equal(withClass(strip, 'hive-fill').length, 5, 'the honey stays under the paint');
  assert.ok(strip.getAttribute('aria-label').endsWith(', sealed'));
  assert.equal(withClass(withClass(el, 'hive-strip')[1], 'hive-seal').length, 0);
  const kite = renderHive([], /** @type {any} */ ([{ ...UNITS[0], motif: 'kite' }]), { onUnit: () => {}, sealed: { u01: true } });
  assert.ok(elements(kite).some((e) => e.tagName === 'use' && e.getAttribute('class') === 'hive-motif motif-hexagon'), 'an unknown motif paints the hexagon');
});

test('one heading per level when the course has two', () => {
  const units = [UNITS[0], UNITS[1], { id: 'u11', order: 11, title_sl: 'Naprej', title_en: 'Onwards', motif: 'bee', level: 'A2', lessonCount: 5, lessons: [] }];
  const el = renderHive([], /** @type {any} */ (units), { onUnit: () => {}, sealed: {} });
  assert.deepEqual(elements(el).filter((e) => e.tagName === 'H2').map((e) => e.textContent), ['A1', 'A2']);
  assert.deepEqual(elements(el).filter((e) => e.tagName === 'svg').map((s) => s.getAttribute('viewBox')), ['0 0 358 156', '0 0 358 78']);
});

test('no constant course shape: strips of seven, five and no lessons draw twelve cells in one width', () => {
  const units = [{ ...UNITS[0], lessonCount: 7 }, UNITS[1], { ...UNITS[2], lessonCount: 0 }];
  const el = renderHive([], /** @type {any} */ (units), { onUnit: () => {}, sealed: {} });
  assert.deepEqual(withClass(el, 'hive-strip').map((s) => withClass(s, 'hive-cell').length), [7, 5, 0]);
});

test('fills move only when they change, and a seal paints once', async () => {
  renderHive(FILLS, /** @type {any} */ (UNITS), { onUnit: () => {}, sealed: {} });
  const later = [fillOf('u01', [[1, 'learned'], [0.8, 'in-progress'], [0, 'not-started'], [0, 'not-started'], [0, 'not-started']]), ...FILLS.slice(1)];
  const moved = renderHive(later, /** @type {any} */ (UNITS), { onUnit: () => {}, sealed: { u01: true } });
  const second = withClass(withClass(moved, 'hive-strip')[0], 'hive-fill')[1];
  assert.equal(second.style.getPropertyValue('transform'), 'scaleY(0.4)', 'starts where it was');
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(second.style.getPropertyValue('transform'), 'scaleY(0.8)', 'then fills');
  assert.equal(withClass(moved, 'hive-seal')[0].getAttribute('class'), 'hive-seal is-sealing', 'a new seal paints');
  const again = renderHive(later, /** @type {any} */ (UNITS), { onUnit: () => {}, sealed: { u01: true } });
  assert.equal(withClass(again, 'hive-seal')[0].getAttribute('class'), 'hive-seal', 'once');
  resetHiveMemory();
  const fresh = renderHive(later, /** @type {any} */ (UNITS), { onUnit: () => {}, sealed: { u01: true } });
  assert.equal(withClass(fresh, 'hive-seal')[0].getAttribute('class'), 'hive-seal', 'a seal there on the first draw does not play');
});

test("renderStrip draws one strip large, marks the current lesson's cell, reports cell taps and paints a seal", () => {
  /** @type {string[]} */
  const taps = [];
  const f = fillOf('u01', [[1, 'learned'], [0.4, 'in-progress']]);
  const strip = renderStrip(f, /** @type {any} */ (UNITS[0]), { sealed: false, currentLessonId: 'u01-l02', caption: true, onCell: (id) => { taps.push(id); } });
  assert.equal(strip.getAttribute('aria-hidden'), 'true');
  assert.equal(strip.getAttribute('viewBox'), '0 0 264 82');
  const cells = withClass(strip, 'hive-cell');
  assert.equal(cells.length, 5);
  assert.equal(cells[1].getAttribute('class'), 'hive-cell is-in-progress is-current');
  cells[1].dispatch('click');
  cells[3].dispatch('click');
  assert.deepEqual(taps, ['u01-l02'], 'a placeholder does nothing');
  assert.deepEqual(withClass(strip, 'hive-caption').map((t) => t.textContent), ['Prvi stik']);
  assert.equal(renderStrip(f, /** @type {any} */ (UNITS[0]), { sealed: false }).getAttribute('viewBox'), '0 0 264 64');
  const sealed = renderStrip(f, /** @type {any} */ (UNITS[0]), { sealed: true });
  assert.equal(withClass(sealed, 'hive-seal').length, 1, 'the large strip carries the seal too');
  const motifs = elements(sealed).filter((e) => e.tagName === 'use' && e.getAttribute('class') === 'hive-motif motif-flower');
  assert.equal(motifs.length, withClass(sealed, 'hive-cell').length, 'one motif per cell');
  assert.equal(motifs.length, 5);
  assert.ok(elements(sealed).some((e) => e.tagName === 'symbol' && e.getAttribute('id') === motifs[0].getAttribute('href').slice(1)), 'the symbol is in the same SVG');
});

test('the seal is paint only, so a tap on a sealed cell reaches the cell and the strip under it', () => {
  const css = readFileSync(new URL('../../app/css/components.css', import.meta.url), 'utf8');
  const rule = css.match(/^\.hive-seal\s*\{([^}]*)\}/m);
  assert.ok(rule, 'components.css has a .hive-seal rule');
  assert.match(rule[1], /pointer-events:\s*none;/, 'the board and motifs take no taps');
});

test('sealedUnits turns the dates of meta.sealed into flags by unit id', () => {
  assert.deepEqual(sealedUnits({ schemaVersion: 1, createdAt: 0 }), {});
  assert.deepEqual(sealedUnits({ schemaVersion: 1, createdAt: 0, sealed: { u01: '2026-11-02' } }), { u01: true });
});
