// tests/ui/motifs.test.js
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../helpers/fake-dom.js';
import { svg } from '../../app/js/util/dom.js';
import { MOTIF_NAMES, motifName, motifSymbol, registerMotif } from '../../app/js/ui/components/motifs.js';

before(() => { installFakeDom(); });
/** @param {any} root @returns {any[]} every element under root */
const parts = (root) => root.childNodes.filter((n) => n.tagName).flatMap((n) => [n, ...parts(n)]);

test('the registry holds the twelve motifs, the v1 names hexagon and star kept', () => {
  assert.deepEqual(MOTIF_NAMES, ['flower', 'heart', 'wheat', 'cup', 'sun', 'house', 'bird', 'leaf', 'hand', 'star', 'hexagon', 'bee']);
  for (const name of MOTIF_NAMES) assert.equal(motifName(name), name);
});

test('motifSymbol draws each motif as a 24 by 24 symbol with its id, in at least two folk part classes and, but for the hexagon, two palette colours', () => {
  for (const name of MOTIF_NAMES) {
    const symbol = motifSymbol(name, `t-motif-${name}`);
    assert.equal(symbol.tagName, 'symbol');
    assert.equal(symbol.getAttribute('id'), `t-motif-${name}`);
    assert.equal(symbol.getAttribute('viewBox'), '0 0 24 24');
    assert.equal(symbol.getAttribute('class'), `motif motif-${name}`);
    const classes = new Set(parts(symbol).map((p) => p.getAttribute('class')).filter(Boolean));
    assert.ok(classes.size >= 2, `${name}: ${[...classes]}`);
    assert.ok([...classes].every((c) => ['m-main', 'm-second', 'm-third', 'm-cut', 'm-line'].includes(c)), name);
    if (name !== 'hexagon') assert.ok([...classes].filter((c) => ['m-main', 'm-second', 'm-third'].includes(c)).length >= 2, name);
  }
});

test('an unknown motif draws the hexagon', () => {
  assert.equal(motifName('kite'), 'hexagon');
  assert.equal(motifSymbol('kite', 'x').getAttribute('class'), 'motif motif-hexagon');
});

test('registerMotif adds a symbol by name, so a new unit adds a drawing and no code path', () => {
  registerMotif('test-drop', () => [svg('circle', { class: 'm-main', cx: 12, cy: 12, r: 6 })]);
  assert.equal(motifName('test-drop'), 'test-drop');
  assert.equal(motifSymbol('test-drop', 'y').getAttribute('class'), 'motif motif-test-drop');
});
