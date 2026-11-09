// The motifs (concept section 2): each unit's theme as a flat folk-art shape, drawn once as an SVG
// <symbol> and reused by <use> at every size. A drawing is a list of parts in a 24 by 24 box, each
// part with one class that colours it (components.css): m-main poppy, m-second leaf, m-third honey
// and m-cut warm white, all four outlined in --motif-line, and m-line, a stroke alone. The
// drawings live in a registry by name: v1's ten with their geometry, now in colour, and the cup
// and the hand; a new unit adds its drawing with registerMotif and needs no code path of its own.
// An unknown name draws the hexagon.

import { svg } from '../../util/dom.js';

/** @typedef {() => SVGElement[]} Draw a motif's parts, fresh on every call */

/** @param {number} n @returns {number} to two decimals, so attributes stay short */
const round = (n) => Math.round(n * 100) / 100;

/**
 * @param {number} cx
 * @param {number} cy
 * @param {number} radius
 * @param {number} degrees clockwise from three o'clock, as SVG turns
 * @returns {{ x: number, y: number }}
 */
function polar(cx, cy, radius, degrees) {
  const angle = (Math.PI / 180) * degrees;
  return { x: round(cx + radius * Math.cos(angle)), y: round(cy + radius * Math.sin(angle)) };
}

/**
 * @param {number} cx
 * @param {number} cy
 * @param {number} r circumradius
 * @returns {string} the points of a pointy-top hexagon
 */
function hexPoints(cx, cy, r) {
  return [30, 90, 150, 210, 270, 330].map((deg) => polar(cx, cy, r, deg)).map(({ x, y }) => `${x},${y}`).join(' ');
}

/**
 * @param {number} cx
 * @param {number} cy
 * @param {number} outer
 * @param {number} inner
 * @returns {string} the points of a five-pointed star, a point up
 */
function starPoints(cx, cy, outer, inner) {
  const points = [];
  for (let k = 0; k < 10; k += 1) {
    const { x, y } = polar(cx, cy, k % 2 === 0 ? outer : inner, -90 + 36 * k);
    points.push(`${x},${y}`);
  }
  return points.join(' ');
}

/**
 * The twelve drawings, in the order MOTIF_NAMES lists them: the units' motifs in course order, with
 * v1's star and hexagon kept before the bee (the hand and the cup took their units; the hexagon
 * stays the fallback).
 * @type {Readonly<Record<string, Draw>>}
 */
const BUILT_IN = Object.freeze({
  flower: () => [
    ...[0, 60, 120, 180, 240, 300].map((deg) => {
      const { x, y } = polar(12, 12, 6.2, deg);
      return svg('circle', { class: 'm-main', cx: x, cy: y, r: 3.6 });
    }),
    svg('circle', { class: 'm-third', cx: 12, cy: 12, r: 2.8 }),
  ],
  heart: () => [
    svg('path', { class: 'm-main', d: 'M12 20.5C6.5 16 3 12.6 3 8.8A4.6 4.6 0 0 1 12 6.6A4.6 4.6 0 0 1 21 8.8C21 12.6 17.5 16 12 20.5Z' }),
    // The same heart at 0.42 around (12, 12).
    svg('path', { class: 'm-third', d: 'M12 15.57C9.69 13.68 8.22 12.25 8.22 10.66A1.93 1.93 0 0 1 12 9.73A1.93 1.93 0 0 1 15.78 10.66C15.78 12.25 14.31 13.68 12 15.57Z' }),
  ],
  wheat: () => [
    svg('path', { class: 'm-second', d: 'M12 22C10.6 19.2 7 18.4 3.8 19.6C6 22.2 9.4 23.2 12 22Z' }),
    svg('path', { class: 'm-second', d: 'M12 22C13.4 19.2 17 18.4 20.2 19.6C18 22.2 14.6 23.2 12 22Z' }),
    svg('path', { class: 'm-line', d: 'M12 22V5' }),
    svg('ellipse', { class: 'm-third', cx: 12, cy: 4.2, rx: 1.8, ry: 3 }),
    ...[7.5, 12, 16.5].flatMap((y) => [
      svg('ellipse', { class: 'm-third', cx: 9.2, cy: y, rx: 1.8, ry: 3.2, transform: `rotate(38 9.2 ${y})` }),
      svg('ellipse', { class: 'm-third', cx: 14.8, cy: y, rx: 1.8, ry: 3.2, transform: `rotate(-38 14.8 ${y})` }),
    ]),
  ],
  cup: () => [
    svg('path', { class: 'm-second', d: 'M3.5 19.5H20.5C19.8 21.2 17.4 22 12 22C6.6 22 4.2 21.2 3.5 19.5Z' }),
    // The handle, its inner side under the body.
    svg('circle', { class: 'm-line', cx: 18.4, cy: 13.6, r: 2.7 }),
    svg('polygon', { class: 'm-main', points: '6,9.5 18,9.5 15.5,19.5 8.5,19.5' }),
    // The band, its ends on the body's sides.
    svg('polygon', { class: 'm-cut', points: '6.63,12 17.38,12 16.78,14.4 7.23,14.4' }),
    svg('path', { class: 'm-line', d: 'M10 7.5C9 6.2 11 5 10 3.2' }),
    svg('path', { class: 'm-line', d: 'M14 7.5C13 6.2 15 5 14 3.2' }),
  ],
  sun: () => [
    svg('circle', { class: 'm-third', cx: 12, cy: 12, r: 4.6 }),
    svg('circle', { class: 'm-main', cx: 12, cy: 12, r: 2.2 }),
    ...[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
      const from = polar(12, 12, 7, deg);
      const to = polar(12, 12, 10.5, deg);
      return svg('line', { class: 'm-line', x1: from.x, y1: from.y, x2: to.x, y2: to.y });
    }),
  ],
  house: () => [
    svg('rect', { class: 'm-third', x: 5, y: 11.5, width: 14, height: 9 }),
    svg('path', { class: 'm-main', d: 'M3.5 12.5L12 4.5L20.5 12.5Z' }),
    svg('rect', { class: 'm-cut', x: 10, y: 14.5, width: 4, height: 6, rx: 1 }),
  ],
  bird: () => [
    svg('path', { class: 'm-main', d: 'M3 13.5C5 9.5 10 8.5 14 10.5L16.5 7.5L18 8L17.2 11L21.5 12.5L17 13.2C15.5 17 10 18.5 6 16.5L2.5 18.5L4.5 15Z' }),
    svg('path', { class: 'm-second', d: 'M6.8 13.4C8.6 11.2 12 10.9 14 12.6C12.4 15 9.2 15.6 6.8 13.4Z' }),
    svg('circle', { class: 'm-cut', cx: 16, cy: 10.2, r: 1.1 }),
  ],
  leaf: () => [
    // The stalk, from under the blade's tip out to the side.
    svg('path', { class: 'm-third', d: 'M10.8 17C11 20.2 13.2 22.6 16.8 23.2L17.6 21C15.2 20.6 13.6 19.4 13.4 17Z' }),
    svg('path', { class: 'm-second', d: 'M12 3C5.5 7.5 4.5 15 12 21C19.5 15 18.5 7.5 12 3Z' }),
    svg('path', { class: 'm-line', d: 'M12 6.5V18.5' }),
  ],
  hand: () => [
    // Wrist, palm, the four fingers from the little one, each parted by a slit, then the thumb.
    svg('path', {
      class: 'm-main',
      d: 'M10.6 21.6H17.8C19 19.8 19.2 18 19.2 16V8.35A1.15 1.15 0 0 0 16.9 8.35V11.4V6.05A1.35 1.35 0 0 0 14.2 6.05'
        + 'V11.4V5.35A1.35 1.35 0 0 0 11.5 5.35V11.4V6.95A1.35 1.35 0 0 0 8.8 6.95V14.96L6.65 11.03'
        + 'A1.2 1.2 0 0 0 4.55 12.17L6.95 16.57C7.6 18.6 9 20.4 10.6 21.6Z',
    }),
    svg('circle', { class: 'm-third', cx: 13.9, cy: 16, r: 2.4 }),
  ],
  star: () => [
    svg('polygon', { class: 'm-main', points: starPoints(12, 12.6, 9.8, 4.2) }),
    svg('circle', { class: 'm-third', cx: 12, cy: 12.6, r: 2.2 }),
  ],
  hexagon: () => [
    svg('polygon', { class: 'm-line', points: hexPoints(12, 12, 9.5) }),
    svg('polygon', { class: 'm-third', points: hexPoints(12, 12, 4.2) }),
  ],
  bee: () => [
    svg('ellipse', { class: 'm-cut', cx: 9, cy: 8.2, rx: 3.4, ry: 2, transform: 'rotate(-25 9 8.2)' }),
    svg('ellipse', { class: 'm-cut', cx: 13.8, cy: 8.2, rx: 3.4, ry: 2, transform: 'rotate(25 13.8 8.2)' }),
    svg('ellipse', { class: 'm-third', cx: 11.5, cy: 14.2, rx: 6.2, ry: 4.1 }),
    svg('circle', { class: 'm-main', cx: 18.7, cy: 13.2, r: 2.6 }),
    svg('line', { class: 'm-line', x1: 10, y1: 10.6, x2: 10, y2: 17.8 }),
    svg('line', { class: 'm-line', x1: 13.2, y1: 10.6, x2: 13.2, y2: 17.8 }),
  ],
});

/** The motifs the app draws itself. */
export const MOTIF_NAMES = Object.freeze(Object.keys(BUILT_IN));

/** Every motif by name: the built-in twelve and whatever registerMotif added. @type {Map<string, Draw>} */
const drawings = new Map(Object.entries(BUILT_IN));

/**
 * Adds a motif, or replaces the one of that name.
 * @param {string} name
 * @param {Draw} draw
 */
export function registerMotif(name, draw) {
  drawings.set(name, draw);
}

/**
 * @param {string} name a unit's motif
 * @returns {string} the name when a drawing is registered for it, else 'hexagon'
 */
export function motifName(name) {
  return drawings.has(name) ? name : 'hexagon';
}

/**
 * The motif as a symbol for an SVG's defs, to be placed with <use href="#id">.
 * @param {string} name a unit's motif; an unknown one draws the hexagon
 * @param {string} id
 * @returns {SVGElement}
 */
export function motifSymbol(name, id) {
  const known = motifName(name);
  const draw = /** @type {Draw} */ (drawings.get(known));
  return svg('symbol', { id, viewBox: '0 0 24 24', class: `motif motif-${known}` }, draw());
}
