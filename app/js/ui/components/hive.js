// The hive (spec 4.7 and 7, Direction A: panjske končnice, the painted beehive panels): ten boards
// in two columns, one per unit, drawn as one SVG with svg() (util/dom.js). A board is a rounded
// rectangle in a quiet outline; its cells are hexagons, one per lesson the bundle carries, filled
// with honey from the bottom in proportion to the lesson's fill (hiveFill, engine/progress.js), the
// one bold element on the page; the unit's Slovenian title is its caption. A sealed unit (its
// checkpoint passed, meta.sealed) carries a seal on its frame with the unit's motif, a flat
// folk-art shape. Nothing is numbered. Motion only answers an action: a render remembers the fills
// it showed and the next render starts each cell where it was and lets CSS move it to the new fill
// (300 ms, nothing under reduced motion), so cells fill after a session and sit still otherwise.
// The layout is pure and tested: hiveLayout gives the boards, cellSize one hexagon width for the
// whole hive, cellCenters a board's cells in rows of six.

import { svg } from '../../util/dom.js';

/** @typedef {import('../../engine/progress.js').HiveFill} HiveFill */
/** @typedef {import('../../content/types.js').Unit} Unit */
/** @typedef {import('../../store/state.js').Meta} Meta */
/** @typedef {{ x: number, y: number, w: number, h: number }} Box */
/** @typedef {{ cx: number, cy: number, r: number }} Center a hexagon's centre and circumradius */

/** The hive's width in user units: the main column at a 360 px screen. The SVG scales to its box. */
export const HIVE_WIDTH = 328;
const COLUMNS = 2;
/** Between boards, and between the columns. */
const GAP = 12;
/** Inside a board. */
const PAD = 12;
const CELL_GAP = 4;
const CELL_MAX = 28;
const CELL_MIN = 14;
/** Cells per row before they wrap. */
const PER_ROW = 6;
/** The caption line's height and the space above it. */
const CAPTION = 14;
const CAPTION_GAP = 6;
const CAPTION_SIZE = 12;
/** An average glyph of the caption face, in em, for fitting long titles. */
const GLYPH_EM = 0.56;
const CORNER = 10;
const SEAL_R = 11;
const MOTIF_SIZE = 16;
/** A pointy-top hexagon's height over its width. */
const HEX_RATIO = 2 / Math.sqrt(3);
const PANEL_W = (HIVE_WIDTH - GAP * (COLUMNS - 1)) / COLUMNS;
const INNER_W = PANEL_W - 2 * PAD;

/** @param {number} n @returns {number} to two decimals, so attributes stay short */
const round = (n) => Math.round(n * 100) / 100;

/**
 * The hive's one hexagon width: the widest row (six at most) fits a board's inner width, capped
 * at CELL_MAX and never under CELL_MIN.
 * @param {number[]} lessonCounts lessons per unit
 * @returns {number}
 */
export function cellSize(lessonCounts) {
  const perRow = Math.min(PER_ROW, Math.max(1, ...lessonCounts));
  return Math.min(CELL_MAX, Math.max(CELL_MIN, (INNER_W - (perRow - 1) * CELL_GAP) / perRow));
}

/**
 * The rows a board's cells take: how many cells each has, whether it is staggered half a pitch in
 * (a short row under a full one, nested as a honeycomb) and its distance from the first row.
 * @param {number} count
 * @param {number} size
 * @returns {{ cells: number, shift: boolean, dy: number }[]}
 */
function rows(count, size) {
  const cellH = size * HEX_RATIO;
  /** @type {{ cells: number, shift: boolean, dy: number }[]} */
  const list = [];
  let dy = 0;
  for (let first = 0; first < count; first += PER_ROW) {
    const cells = Math.min(PER_ROW, count - first);
    const shift = list.length % 2 === 1 && cells < PER_ROW;
    if (list.length > 0) dy += shift ? cellH * 0.75 + CELL_GAP * 0.87 : cellH + CELL_GAP;
    list.push({ cells, shift, dy });
  }
  return list;
}

/**
 * A board's height: its rows of cells, the caption and the padding, a whole number so the rows of
 * the grid add up exactly.
 * @param {number} count
 * @param {number} size
 * @returns {number}
 */
function panelHeight(count, size) {
  const list = rows(count, size);
  const cellsH = size * HEX_RATIO + (list.length > 0 ? list[list.length - 1].dy : 0);
  return Math.round(PAD + cellsH + CAPTION_GAP + CAPTION + PAD);
}

/**
 * The boards, in two columns of one width, unit by unit in reading order; each grid row is as
 * tall as its taller board, so the two sit flush.
 * @param {number} unitCount
 * @param {number[]} lessonCounts lessons per unit, in the same order
 * @returns {Box[]}
 */
export function hiveLayout(unitCount, lessonCounts) {
  const size = cellSize(lessonCounts);
  /** @type {Box[]} */
  const boxes = [];
  let y = 0;
  for (let first = 0; first < unitCount; first += COLUMNS) {
    const inRow = Math.min(COLUMNS, unitCount - first);
    let h = 0;
    for (let k = 0; k < inRow; k += 1) h = Math.max(h, panelHeight(lessonCounts[first + k] ?? 0, size));
    for (let k = 0; k < inRow; k += 1) boxes.push({ x: k * (PANEL_W + GAP), y, w: PANEL_W, h });
    y += h + GAP;
  }
  return boxes;
}

/**
 * The centres of a board's cells, in rows of six from the top left, a short row under a full one
 * staggered half a pitch in.
 * @param {Box} box the board
 * @param {number} count cells
 * @param {number} size the hive's hexagon width
 * @returns {Center[]}
 */
export function cellCenters(box, count, size) {
  const r = size / Math.sqrt(3);
  const pitch = size + CELL_GAP;
  /** @type {Center[]} */
  const centers = [];
  for (const row of rows(count, size)) {
    for (let col = 0; col < row.cells; col += 1) {
      centers.push({
        cx: box.x + PAD + size / 2 + col * pitch + (row.shift ? pitch / 2 : 0),
        cy: box.y + PAD + r + row.dy,
        r,
      });
    }
  }
  return centers;
}

/**
 * The hive's flags from the meta record: a unit is sealed when its checkpoint date is recorded.
 * @param {Meta} meta
 * @returns {Record<string, boolean>}
 */
export function sealedUnits(meta) {
  return Object.fromEntries(Object.keys(meta.sealed ?? {}).map((id) => [id, true]));
}

/**
 * @param {number} cx
 * @param {number} cy
 * @param {number} r circumradius
 * @returns {string} the points of a pointy-top hexagon
 */
function hexPoints(cx, cy, r) {
  const points = [];
  for (let k = 0; k < 6; k += 1) {
    const angle = (Math.PI / 180) * (60 * k + 30);
    points.push(`${round(cx + r * Math.cos(angle))},${round(cy + r * Math.sin(angle))}`);
  }
  return points.join(' ');
}

/**
 * @param {number} cx
 * @param {number} cy
 * @param {number} outer
 * @param {number} inner
 * @returns {string} the points of a five-pointed star
 */
function starPoints(cx, cy, outer, inner) {
  const points = [];
  for (let k = 0; k < 10; k += 1) {
    const radius = k % 2 === 0 ? outer : inner;
    const angle = (Math.PI / 180) * (-90 + 36 * k);
    points.push(`${round(cx + radius * Math.cos(angle))},${round(cy + radius * Math.sin(angle))}`);
  }
  return points.join(' ');
}

/**
 * A caption's font size: CAPTION_SIZE, smaller when the title would not fit the board's inner
 * width at that size (an estimate from the average glyph width; the face is Bricolage Grotesque).
 * @param {string} title
 * @returns {number}
 */
function captionSize(title) {
  const fit = INNER_W / (Math.max(1, title.length) * GLYPH_EM);
  return Math.round(Math.min(CAPTION_SIZE, fit) * 10) / 10;
}

/**
 * The ten motifs as flat shapes in a 24 by 24 box: filled parts take the outline colour, parts
 * with the class `m-cut` take the board colour (a door, a midrib, the bee's stripes) and stroked
 * parts carry `fill="none"`.
 * @type {Readonly<Record<string, () => SVGElement[]>>}
 */
const MOTIFS = Object.freeze({
  flower: () => [
    ...[0, 60, 120, 180, 240, 300].map((deg) => {
      const angle = (Math.PI / 180) * deg;
      return svg('circle', { cx: round(12 + 6.2 * Math.cos(angle)), cy: round(12 + 6.2 * Math.sin(angle)), r: 3.6 });
    }),
    svg('circle', { class: 'm-cut', cx: 12, cy: 12, r: 2.8 }),
  ],
  heart: () => [svg('path', { d: 'M12 20.5C6.5 16 3 12.6 3 8.8A4.6 4.6 0 0 1 12 6.6A4.6 4.6 0 0 1 21 8.8C21 12.6 17.5 16 12 20.5Z' })],
  wheat: () => [
    svg('path', { d: 'M12 22V5', fill: 'none', 'stroke-width': 1.6, 'stroke-linecap': 'round' }),
    svg('ellipse', { cx: 12, cy: 4.2, rx: 1.8, ry: 3 }),
    ...[7.5, 12, 16.5].flatMap((y) => [
      svg('ellipse', { cx: 9.2, cy: y, rx: 1.8, ry: 3.2, transform: `rotate(38 9.2 ${y})` }),
      svg('ellipse', { cx: 14.8, cy: y, rx: 1.8, ry: 3.2, transform: `rotate(-38 14.8 ${y})` }),
    ]),
  ],
  hexagon: () => [
    svg('polygon', { points: hexPoints(12, 12, 9.5), fill: 'none', 'stroke-width': 1.8, 'stroke-linejoin': 'round' }),
    svg('polygon', { points: hexPoints(12, 12, 4.2) }),
  ],
  sun: () => [
    svg('circle', { cx: 12, cy: 12, r: 4.6 }),
    ...[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
      const angle = (Math.PI / 180) * deg;
      return svg('line', {
        x1: round(12 + 7 * Math.cos(angle)), y1: round(12 + 7 * Math.sin(angle)),
        x2: round(12 + 10.5 * Math.cos(angle)), y2: round(12 + 10.5 * Math.sin(angle)),
        'stroke-width': 1.8, 'stroke-linecap': 'round',
      });
    }),
  ],
  house: () => [
    svg('path', { d: 'M3.5 12.5L12 4.5L20.5 12.5V20.5H3.5Z', 'stroke-width': 1, 'stroke-linejoin': 'round' }),
    svg('rect', { class: 'm-cut', x: 10, y: 14.5, width: 4, height: 6, rx: 1 }),
  ],
  bird: () => [
    svg('path', { d: 'M3 13.5C5 9.5 10 8.5 14 10.5L16.5 7.5L18 8L17.2 11L21.5 12.5L17 13.2C15.5 17 10 18.5 6 16.5L2.5 18.5L4.5 15Z', 'stroke-width': 0.8, 'stroke-linejoin': 'round' }),
    svg('circle', { class: 'm-cut', cx: 16, cy: 10.2, r: 0.9 }),
  ],
  leaf: () => [
    svg('path', { d: 'M12 3C5.5 7.5 4.5 15 12 21C19.5 15 18.5 7.5 12 3Z' }),
    svg('path', { class: 'm-cut-line', d: 'M12 6.5V18.5', 'stroke-width': 1.4, 'stroke-linecap': 'round' }),
  ],
  star: () => [svg('polygon', { points: starPoints(12, 12.6, 9.8, 4.2), 'stroke-width': 1, 'stroke-linejoin': 'round' })],
  bee: () => [
    svg('ellipse', { cx: 9, cy: 8.2, rx: 3.4, ry: 2, fill: 'none', 'stroke-width': 1.3, transform: 'rotate(-25 9 8.2)' }),
    svg('ellipse', { cx: 13.8, cy: 8.2, rx: 3.4, ry: 2, fill: 'none', 'stroke-width': 1.3, transform: 'rotate(25 13.8 8.2)' }),
    svg('ellipse', { cx: 11.5, cy: 14.2, rx: 6.2, ry: 4.1 }),
    svg('circle', { cx: 18.7, cy: 13.2, r: 2.6 }),
    svg('line', { class: 'm-cut-line', x1: 10, y1: 10.6, x2: 10, y2: 17.8, 'stroke-width': 1.3 }),
    svg('line', { class: 'm-cut-line', x1: 13.2, y1: 10.6, x2: 13.2, y2: 17.8, 'stroke-width': 1.3 }),
  ],
});

/**
 * The seal of a sealed board: a disc on the frame with the unit's motif. An unknown motif name
 * draws the hexagon.
 * @param {string} motif
 * @param {number} cx
 * @param {number} cy
 * @returns {SVGElement}
 */
function renderSeal(motif, cx, cy) {
  const draw = MOTIFS[motif] ?? MOTIFS.hexagon;
  const name = MOTIFS[motif] ? motif : 'hexagon';
  const offset = MOTIF_SIZE / 2;
  return svg('g', { class: 'hive-seal' },
    svg('circle', { class: 'hive-seal-disc', cx, cy, r: SEAL_R }),
    svg('g', { class: `hive-motif motif-${name}`, transform: `translate(${round(cx - offset)} ${round(cy - offset)}) scale(${round(MOTIF_SIZE / 24)})` }, draw()));
}

/** Renders so far, so each render's clip ids are its own. */
let renders = 0;
/** The fill each cell showed last, by lesson id: where the next render starts it. @type {Map<string, number>} */
const shown = new Map();

/**
 * Runs `fn` on a later frame, once the current one has painted (so a transition has a start value).
 * @param {() => void} fn
 */
function nextFrame(fn) {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(fn));
  else setTimeout(fn, 0);
}

/**
 * The hive. One board per unit of `units`, in that order; `fills` carry the cells of the units the
 * bundle has lessons for (a unit without one draws an empty board). `sealed[unitId]` draws the
 * seal with the unit's motif. A board is a button: a tap, Enter or Space calls `onUnit` with the
 * unit id. The SVG scales to its box and is as tall as it needs to be.
 * @param {HiveFill[]} fills
 * @param {Unit[]} units
 * @param {{ onUnit: (unitId: string) => void, sealed: Record<string, boolean> }} opts
 * @returns {SVGElement}
 */
export function renderHive(fills, units, { onUnit, sealed }) {
  const byUnit = new Map(fills.map((fill) => [fill.unitId, fill]));
  const counts = units.map((unit) => byUnit.get(unit.id)?.cells.length ?? 0);
  const size = cellSize(counts);
  const boxes = hiveLayout(units.length, counts);
  const height = boxes.reduce((max, box) => Math.max(max, box.y + box.h), 0);
  renders += 1;
  const prefix = `hive${renders}`;
  /** @type {SVGElement[]} */
  const defs = [];
  /** @type {{ rect: SVGElement, to: number }[]} cells that fill after this render */
  const moving = [];

  const panels = units.map((unit, i) => {
    const box = boxes[i];
    const cells = byUnit.get(unit.id)?.cells ?? [];
    const centers = cellCenters(box, cells.length, size);
    const isSealed = sealed[unit.id] === true;
    const percent = Math.round((byUnit.get(unit.id)?.fill ?? 0) * 100);
    const status = cells.length === 0 ? 'no lessons yet' : `${percent} percent recalled now`;
    const open = () => onUnit(unit.id);
    return svg('g', {
      class: 'hive-panel', role: 'button', tabindex: '0', 'data-unit': unit.id,
      'aria-label': `Unit ${unit.order}, ${unit.title_sl}, ${unit.title_en}: ${status}${isSealed ? ', sealed' : ''}`,
      onclick: open,
      onkeydown: (/** @type {KeyboardEvent} */ event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        open();
      },
    },
      svg('rect', { class: 'hive-board', x: box.x, y: box.y, width: box.w, height: box.h, rx: CORNER }),
      cells.map((cell, k) => {
        const { cx, cy, r } = centers[k];
        const clipId = `${prefix}-${cell.lessonId}`;
        defs.push(svg('clipPath', { id: clipId }, svg('polygon', { points: hexPoints(cx, cy, r) })));
        const from = shown.get(cell.lessonId);
        const rect = svg('rect', {
          class: 'hive-fill', x: round(cx - size / 2), y: round(cy - r), width: round(size), height: round(2 * r),
          style: { transform: `scaleY(${from ?? cell.fill})` },
        });
        if (from !== undefined && from !== cell.fill) moving.push({ rect, to: cell.fill });
        shown.set(cell.lessonId, cell.fill);
        return svg('g', { class: 'hive-cell' },
          svg('polygon', { class: 'hive-comb', points: hexPoints(cx, cy, r) }),
          svg('g', { 'clip-path': `url(#${clipId})` }, rect));
      }),
      svg('text', {
        class: 'hive-caption', x: box.x + PAD, y: round(box.y + box.h - PAD - 2), lang: 'sl', 'font-size': captionSize(unit.title_sl),
      }, unit.title_sl),
      isSealed ? renderSeal(unit.motif, box.x + box.w - PAD - SEAL_R, box.y) : null);
  });

  if (moving.length > 0) {
    nextFrame(() => {
      for (const { rect, to } of moving) rect.style.setProperty('transform', `scaleY(${to})`);
    });
  }
  const top = SEAL_R + 2;
  return svg('svg', {
    class: 'hive', viewBox: `0 ${-top} ${HIVE_WIDTH} ${height + top}`, role: 'group', 'aria-label': 'Hive, one board per unit',
  }, svg('defs', null, defs), panels);
}
