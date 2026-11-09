// tests/ui/tokens.test.js
// The hive's colours as tokens.css and components.css declare them. In the light theme the cells'
// outline is a deeper honey, at least 3:1 on the warm white page (WCAG 1.4.11), while both dark
// blocks keep honey; empty placeholders show at 0.75. A learned cell's rim is one fixed colour for
// every theme, apart from the honey that fills the cell, so full cells keep their walls. A sealed
// strip's board is opaque paint, indigo in the light theme and poppy in both dark blocks, with no
// stroke; the translucent wash and its line are gone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const tokens = readFileSync(new URL('../../app/css/tokens.css', import.meta.url), 'utf8');
const components = readFileSync(new URL('../../app/css/components.css', import.meta.url), 'utf8');

/**
 * The custom properties a block declares, by name.
 * @param {string} selector the block's selector, exactly as written, followed by its opening brace
 * @returns {Record<string, string>}
 */
function block(selector) {
  const start = tokens.indexOf(`${selector} {`);
  assert.ok(start >= 0, `tokens.css has the block ${selector}`);
  const body = tokens.slice(start, tokens.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
}

const LIGHT = block(':root');
const DARK_SYSTEM = block(":root:not([data-theme='light'])");
const DARK_CHOSEN = block(":root[data-theme='dark']");

/** A value with every var() resolved against the light block, where the palette lives. @param {string} value @returns {string} */
function resolve(value) {
  const match = value.match(/^var\((--[\w-]+)\)$/);
  if (!match) return value;
  assert.ok(LIGHT[match[1]] !== undefined, `${match[1]} is declared`);
  return resolve(LIGHT[match[1]]);
}

/** The declarations of a rule of components.css, by its selector at the start of a line. @param {string} selector */
function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found = components.match(new RegExp(`^${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  assert.ok(found, `components.css has a rule ${selector}`);
  return Object.fromEntries([...found[1].matchAll(/([\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
}

/** WCAG relative luminance of a #rrggbb colour. @param {string} hex */
function luminance(hex) {
  const match = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  assert.ok(match, `${hex} is a #rrggbb colour`);
  const [r, g, b] = match.slice(1).map((part) => {
    const c = parseInt(part, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The contrast ratio of two #rrggbb colours. @param {string} a @param {string} b */
function contrast(a, b) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

test("the light theme's cell outline is at least 3:1 on warm white, the dark blocks keep honey, and placeholders show at 0.75", () => {
  const line = resolve(LIGHT['--hive-line']);
  const page = resolve(LIGHT['--warm-white']);
  assert.ok(contrast(line, page) >= 3, `the outline ${line} on ${page} is ${contrast(line, page).toFixed(2)}:1`);
  assert.equal(DARK_SYSTEM['--hive-line'], 'var(--honey)');
  assert.equal(DARK_CHOSEN['--hive-line'], 'var(--honey)');
  assert.equal(rule('.is-placeholder .hive-comb').opacity, '0.75');
});

test("a learned cell's rim is one fixed colour for every theme, apart from the honey that fills it", () => {
  assert.equal(LIGHT['--hive-rim'], '#9B7626');
  assert.equal(DARK_SYSTEM['--hive-rim'], undefined, 'not redefined in the dark theme');
  assert.equal(DARK_CHOSEN['--hive-rim'], undefined, 'not redefined in the chosen dark theme');
  const learned = rule('.is-learned .hive-comb');
  assert.deepEqual([learned.stroke, learned['stroke-width']], ['var(--hive-rim)', '3']);
  const fill = resolve(rule('.hive-fill').fill);
  assert.notEqual(resolve(learned.stroke).toLowerCase(), fill.toLowerCase(), 'the rim shows against the honey');
});

test("a sealed strip's board is opaque paint: indigo in the light theme, poppy in both dark blocks, no stroke", () => {
  assert.equal(LIGHT['--seal-board'], 'var(--indigo)');
  assert.equal(DARK_SYSTEM['--seal-board'], 'var(--poppy)');
  assert.equal(DARK_CHOSEN['--seal-board'], 'var(--poppy)');
  assert.deepEqual(rule('.hive-seal-board'), { fill: 'var(--seal-board)', stroke: 'none' });
  for (const gone of ['--seal-paint', '--seal-line']) {
    assert.ok(!tokens.includes(gone) && !components.includes(gone), `${gone} is gone`);
  }
});
