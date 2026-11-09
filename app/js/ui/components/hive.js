// The hive (concept section 3, Ruling 101): the course as a honeycomb, one strip per unit and one
// cell per lesson. A cell is a regular pointy-top hexagon in a honey outline, filled with honey
// from the bottom in proportion to the lesson's fill (hiveFill, engine/progress.js), the one bold
// element on the page; a learned cell has a thicker rim, and a cell the bundle does not carry yet
// is a dashed placeholder. Every other strip sits half a cell over, so the rows read as comb, and
// the unit's Slovenian title is the caption under its cells. A unit has as many cells as its
// lessonCount, and the levels of the course (levelGroups, engine/course.js) each get a heading
// and an SVG of their own when there is more than one, so no constant here knows the course's
// shape. A sealed unit (its checkpoint passed, meta.sealed) is painted over (Ruling 102): a
// translucent board around its cells with the unit's motif (motifs.js) on every cell, the honey
// still visible under it. renderStrip draws one unit's strip large, for the Today screen, the
// unit page and the checkpoint's end card.
// Motion only answers an action: the module remembers the fill each lesson's cell showed and the
// seal each unit showed, so the next draw starts a cell where it was and lets CSS move it to the
// new fill (300 ms), and a seal new since the unit was shown unsealed paints in (600 ms); nothing
// moves under reduced motion. resetHiveMemory forgets what was shown, for the tests.

import { h, svg } from '../../util/dom.js';
import { levelGroups } from '../../engine/course.js';
import { motifName, motifSymbol } from './motifs.js';

/** @typedef {import('../../engine/progress.js').HiveFill} HiveFill */
/** @typedef {import('../../engine/progress.js').CellState} CellState */
/** @typedef {import('../../content/types.js').Unit} Unit */
/** @typedef {import('../../store/state.js').Meta} Meta */
/** @typedef {{ position: number, lessonId: string|null, fill: number, state: CellState }} StripCell a cell of a unit's strip, a placeholder when lessonId is null */
/** @typedef {{ cx: number, cy: number }} Center */
/**
 * One SVG being drawn: the prefix that makes its ids its own, its defs (the cells' clips and the
 * motif symbols), the motifs already in the defs and the cells to move once it has painted.
 * @typedef {{ prefix: string, defs: SVGElement[], motifs: Set<string>, moving: { rect: SVGElement, to: number }[] }} Canvas
 */

/** The hive's width in user units: the main column at a 390 px screen, 390 minus two 16 px gutters. The SVG scales to its column. */
export const HIVE_WIDTH = 358;
/** A cell's width at full size. */
export const CELL_W = 52;
/** A cell's height at full size: a regular pointy-top hexagon 52 wide is 60 tall. */
export const CELL_H = 60;
/** The caption band under a strip's cells. */
export const CAPTION_H = 18;
/** From one strip to the next: the cell band and the caption band. */
export const STRIP_PITCH = CELL_H + CAPTION_H;
/** From the cell band's top to the caption's baseline, below the cells. */
const CAPTION_DROP = 13;
const CAPTION_SIZE = 12;
/** The corner radius of the tap target and of the seal's board. */
const CORNER = 10;
/** How far the seal's board reaches out around the cells. */
const SEAL_OUT = 3;
/** A motif's side over the cell's width. */
const MOTIF_SHARE = 0.7;
/** The margin around a large strip's cells, so their outline is not cut at the edge. */
const LARGE_MARGIN = 2;

/** @param {number} n @returns {number} to two decimals, so attributes stay short */
const round = (n) => Math.round(n * 100) / 100;

/**
 * The hive's one cell width: full size, smaller only when the widest strip, half a cell offset,
 * would not fit the column.
 * @param {number} maxCells the most cells a strip of the hive has
 * @returns {number}
 */
export function cellWidth(maxCells) {
  return Math.min(CELL_W, HIVE_WIDTH / (Math.max(1, maxCells) + 0.5));
}

/** @param {number} width a cell's width @returns {number} its height, in a regular cell's proportion */
const cellHeightOf = (width) => (CELL_H * width) / CELL_W;

/**
 * A unit's strip: positions 1 to the unit's lessonCount (or, without one, to the highest order the
 * bundle carries); a bundled lesson sits at its order, every other position is a placeholder.
 * @param {Unit} unit
 * @param {HiveFill|undefined} fill the unit's cells, when the bundle carries any of its lessons
 * @returns {StripCell[]}
 */
export function stripCells(unit, fill) {
  const bundled = fill?.cells ?? [];
  const count = Math.max(unit.lessonCount ?? 0, ...bundled.map((cell) => cell.order), 0);
  const byOrder = new Map(bundled.map((cell) => [cell.order, cell]));
  /** @type {StripCell[]} */
  const cells = [];
  for (let position = 1; position <= count; position += 1) {
    const cell = byOrder.get(position);
    cells.push(cell
      ? { position, lessonId: cell.lessonId, fill: cell.fill, state: cell.state }
      : { position, lessonId: null, fill: 0, state: 'not-started' });
  }
  return cells;
}

/**
 * The centres of a strip's cells in the hive: the comb (the widest strip and its half-cell
 * offset) is centred in the hive's width, and every odd row sits half a cell to the right.
 * @param {number} count the strip's cells
 * @param {number} width the hive's cell width
 * @param {number} row the strip's row in its SVG
 * @param {number} maxCells the most cells a strip of the hive has
 * @returns {Center[]}
 */
export function cellCenters(count, width, row, maxCells) {
  const left = (HIVE_WIDTH - (maxCells * width + width / 2)) / 2;
  const shift = row % 2 === 1 ? width / 2 : 0;
  const cy = row * STRIP_PITCH + cellHeightOf(width) / 2;
  return Array.from({ length: count }, (_, i) => ({ cx: left + width / 2 + shift + i * width, cy }));
}

/**
 * A regular pointy-top hexagon inset one unit in a cell `width` wide, its roof at 30 degrees.
 * @param {number} cx
 * @param {number} cy
 * @param {number} width
 * @returns {string} the points top, upper right, lower right, bottom, lower left, upper left
 */
export function hexPoints(cx, cy, width) {
  const a = (width - 2) / 2;
  const t = a / Math.sqrt(3);
  const b = 2 * t;
  return [[cx, cy - b], [cx + a, cy - b + t], [cx + a, cy + b - t], [cx, cy + b], [cx - a, cy + b - t], [cx - a, cy - b + t]]
    .map(([x, y]) => `${round(x)},${round(y)}`).join(' ');
}

/**
 * The hive's flags from the meta record: a unit is sealed when its checkpoint date is recorded.
 * @param {Meta} meta
 * @returns {Record<string, boolean>}
 */
export function sealedUnits(meta) {
  return Object.fromEntries(Object.keys(meta.sealed ?? {}).map((id) => [id, true]));
}

/** SVGs drawn so far, so each one's ids are its own. */
let canvases = 0;
/** The fill each lesson's cell showed last: where the next draw starts it. @type {Map<string, number>} */
const shownFills = new Map();
/** Whether each unit showed its seal last: a seal is new when the unit showed none. @type {Map<string, boolean>} */
const shownSeals = new Map();

/** Forgets the fills and seals shown, so the next draw shows each at its value with nothing to move. */
export function resetHiveMemory() {
  shownFills.clear();
  shownSeals.clear();
}

/**
 * Runs `fn` on a later frame, once the current one has painted (so a transition has a start value).
 * @param {() => void} fn
 */
function nextFrame(fn) {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(fn));
  else setTimeout(fn, 0);
}

/** @returns {Canvas} a fresh SVG's drawing state */
function newCanvas() {
  canvases += 1;
  return { prefix: `hive${canvases}`, defs: [], motifs: new Set(), moving: [] };
}

/**
 * Moves the canvas's changed cells to their new fill on a later frame.
 * @param {Canvas} canvas
 */
function settle(canvas) {
  const { moving } = canvas;
  if (moving.length === 0) return;
  nextFrame(() => {
    for (const { rect, to } of moving) rect.style.setProperty('transform', `scaleY(${to})`);
  });
}

/**
 * Records the seal a unit shows now.
 * @param {string} unitId
 * @param {boolean} sealed
 * @returns {boolean} whether the seal is new: the unit showed none earlier in this page's life
 */
function noteSeal(unitId, sealed) {
  const before = shownSeals.get(unitId);
  shownSeals.set(unitId, sealed);
  return sealed && before === false;
}

/**
 * One cell: its hexagon and, for a bundled lesson, the honey clipped to it, starting at the fill
 * the lesson showed last.
 * @param {StripCell} cell
 * @param {Center} center
 * @param {number} width
 * @param {Canvas} canvas
 * @param {{ currentLessonId?: string|null, onCell?: (lessonId: string) => void }} [opts]
 * @returns {SVGElement}
 */
function renderCell(cell, { cx, cy }, width, canvas, { currentLessonId = null, onCell } = {}) {
  const { lessonId } = cell;
  const points = hexPoints(cx, cy, width);
  const classes = ['hive-cell', `is-${cell.state}`];
  if (lessonId === null) classes.push('is-placeholder');
  else if (lessonId === currentLessonId) classes.push('is-current');
  /** @type {SVGElement|null} */
  let honey = null;
  if (lessonId !== null) {
    const clipId = `${canvas.prefix}-${lessonId}`;
    canvas.defs.push(svg('clipPath', { id: clipId }, svg('polygon', { points })));
    const height = cellHeightOf(width);
    const from = shownFills.get(lessonId);
    const rect = svg('rect', {
      class: 'hive-fill', x: round(cx - width / 2), y: round(cy - height / 2), width: round(width), height: round(height),
      style: { transform: `scaleY(${from ?? cell.fill})` },
    });
    if (from !== undefined && from !== cell.fill) canvas.moving.push({ rect, to: cell.fill });
    shownFills.set(lessonId, cell.fill);
    honey = svg('g', { 'clip-path': `url(#${clipId})` }, rect);
  }
  return svg('g', { class: classes.join(' '), onclick: lessonId !== null && onCell ? () => onCell(lessonId) : null },
    honey,
    svg('polygon', { class: 'hive-comb', points }));
}

/**
 * The unit's title under its cells.
 * @param {Unit} unit
 * @param {number} x
 * @param {number} y the baseline
 * @returns {SVGElement}
 */
function renderCaption(unit, x, y) {
  return svg('text', { class: 'hive-caption', x: round(x), y: round(y), lang: 'sl', 'font-size': CAPTION_SIZE }, unit.title_sl);
}

/**
 * The paint over a sealed strip: a translucent board around its cells and the unit's motif on
 * each, the symbol placed once in the canvas's defs.
 * @param {Unit} unit
 * @param {Center[]} centers the strip's cells, at least one, left to right
 * @param {number} width
 * @param {Canvas} canvas
 * @param {boolean} sealing whether the seal is new and paints in
 * @returns {SVGElement}
 */
function renderSeal(unit, centers, width, canvas, sealing) {
  const name = motifName(unit.motif);
  const symbolId = `${canvas.prefix}-motif-${name}`;
  if (!canvas.motifs.has(name)) {
    canvas.motifs.add(name);
    canvas.defs.push(motifSymbol(unit.motif, symbolId));
  }
  const height = cellHeightOf(width);
  const left = centers[0].cx - width / 2 - SEAL_OUT;
  const right = centers[centers.length - 1].cx + width / 2 + SEAL_OUT;
  const top = centers[0].cy - height / 2 - SEAL_OUT;
  const side = MOTIF_SHARE * width;
  return svg('g', { class: sealing ? 'hive-seal is-sealing' : 'hive-seal' },
    svg('rect', { class: 'hive-seal-board', x: round(left), y: round(top), width: round(right - left), height: round(height + 2 * SEAL_OUT), rx: CORNER }),
    centers.map(({ cx, cy }) => svg('use', {
      class: `hive-motif motif-${name}`, href: `#${symbolId}`, x: round(cx - side / 2), y: round(cy - side / 2), width: round(side), height: round(side),
    })));
}

/**
 * The hive. One strip per unit of `units`, in that order, grouped by level: one SVG per level,
 * with the level as a heading when the course has more than one. `fills` carry the cells of the
 * units the bundle has lessons for; every other cell of a unit's lessonCount is a placeholder.
 * `sealed[unitId]` paints the strip with the unit's motif. A strip is a button: a tap, Enter or
 * Space calls `onUnit` with the unit id. Each SVG scales to its column and is as tall as its
 * strips.
 * @param {HiveFill[]} fills
 * @param {Unit[]} units
 * @param {{ onUnit: (unitId: string) => void, sealed: Record<string, boolean> }} opts
 * @returns {HTMLElement}
 */
export function renderHive(fills, units, { onUnit, sealed }) {
  const byUnit = new Map(fills.map((fill) => [fill.unitId, fill]));
  const strips = new Map(units.map((unit) => [unit.id, stripCells(unit, byUnit.get(unit.id))]));
  const maxCells = Math.max(0, ...[...strips.values()].map((cells) => cells.length));
  const width = cellWidth(maxCells);
  const groups = levelGroups(units);

  /**
   * One strip of the hive, at row `row` of its SVG.
   * @param {Unit} unit
   * @param {number} row
   * @param {Canvas} canvas
   * @returns {SVGElement}
   */
  const renderRow = (unit, row, canvas) => {
    const cells = strips.get(unit.id) ?? [];
    const centers = cellCenters(cells.length, width, row, maxCells);
    const isSealed = sealed[unit.id] === true;
    const sealing = noteSeal(unit.id, isSealed);
    const percent = Math.round((byUnit.get(unit.id)?.fill ?? 0) * 100);
    const status = cells.some((cell) => cell.lessonId !== null) ? `${percent} percent recalled now` : 'no lessons yet';
    const firstLeft = cellCenters(1, width, row, maxCells)[0].cx - width / 2;
    const open = () => onUnit(unit.id);
    return svg('g', {
      class: 'hive-strip', role: 'button', tabindex: '0', 'data-unit': unit.id,
      'aria-label': `Unit ${unit.order}, ${unit.title_sl}, ${unit.title_en}: ${status}${isSealed ? ', sealed' : ''}`,
      onclick: open,
      onkeydown: (/** @type {KeyboardEvent} */ event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        open();
      },
    },
      svg('rect', { class: 'hive-hit', x: 0, y: row * STRIP_PITCH, width: HIVE_WIDTH, height: STRIP_PITCH, rx: CORNER }),
      cells.map((cell, i) => renderCell(cell, centers[i], width, canvas)),
      renderCaption(unit, firstLeft, row * STRIP_PITCH + cellHeightOf(width) + CAPTION_DROP),
      isSealed && centers.length > 0 ? renderSeal(unit, centers, width, canvas, sealing) : null);
  };

  return h('div', { class: 'hive-wrap' }, groups.map((group) => {
    const canvas = newCanvas();
    const rows = group.units.map((unit, row) => renderRow(unit, row, canvas));
    const comb = svg('svg', {
      class: 'hive', viewBox: `0 0 ${HIVE_WIDTH} ${group.units.length * STRIP_PITCH}`, role: 'group', 'aria-label': 'Hive, one row per unit',
    }, svg('defs', null, canvas.defs), rows);
    settle(canvas);
    return [groups.length > 1 && group.level !== null ? h('h2', { class: 'hive-level' }, group.level) : null, comb];
  }));
}

/**
 * One unit's strip at full size, its cells 52 wide in a row from the left, with the caption under
 * them when `caption` is set. Decorative for assistive technology: the control around it names
 * it. `currentLessonId` rims that lesson's cell; `onCell` makes a tap on a bundled lesson's cell
 * report it (a placeholder does nothing); `sealed` paints the strip as a sealed strip of the hive.
 * @param {HiveFill|undefined} fill
 * @param {Unit} unit
 * @param {{ sealed: boolean, currentLessonId?: string|null, caption?: boolean, onCell?: (lessonId: string) => void }} opts
 * @returns {SVGElement}
 */
export function renderStrip(fill, unit, { sealed, currentLessonId = null, caption = false, onCell }) {
  const cells = stripCells(unit, fill);
  const canvas = newCanvas();
  const centers = cells.map((_, i) => ({ cx: LARGE_MARGIN + CELL_W / 2 + i * CELL_W, cy: LARGE_MARGIN + CELL_H / 2 }));
  const sealing = noteSeal(unit.id, sealed);
  const body = [
    cells.map((cell, i) => renderCell(cell, centers[i], CELL_W, canvas, { currentLessonId, onCell })),
    caption ? renderCaption(unit, LARGE_MARGIN, LARGE_MARGIN + CELL_H + CAPTION_DROP) : null,
    sealed && centers.length > 0 ? renderSeal(unit, centers, CELL_W, canvas, sealing) : null,
  ];
  const height = CELL_H + 2 * LARGE_MARGIN + (caption ? CAPTION_H : 0);
  const strip = svg('svg', {
    class: 'hive hive-strip-large', 'aria-hidden': 'true', viewBox: `0 0 ${cells.length * CELL_W + 2 * LARGE_MARGIN} ${height}`,
  }, svg('defs', null, canvas.defs), body);
  settle(canvas);
  return strip;
}
