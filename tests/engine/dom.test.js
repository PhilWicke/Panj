// tests/engine/dom.test.js
// h() builds the app's elements and svg() the hive's, in the SVG namespace. Node has no DOM, so
// tests/helpers/fake-dom.js stands in for the document; the real one is exercised by the
// end-to-end check in the browser.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../helpers/fake-dom.js';
import { h, svg } from '../../app/js/util/dom.js';

before(() => {
  installFakeDom();
});

test('h builds elements with class, attributes, handlers and nested children', () => {
  const el = h('button', { class: 'btn', 'data-x': '1', onclick: () => {} }, 'Hi ', h('b', null, 'there'));
  assert.equal(el.tagName, 'BUTTON'); assert.equal(el.className, 'btn'); assert.equal(el.dataset.x, '1');
  assert.equal(el.textContent, 'Hi there');
});

test('h wires on* handlers as listeners, sets aria-* and other props as attributes, and skips empty children', () => {
  let clicks = 0;
  const el = /** @type {any} */ (h('button', {
    onclick: () => { clicks += 1; },
    'aria-label': 'Listen',
    'data-item-id': 'u01-l01-i01',
    type: 'button',
    disabled: true,
    hidden: false,
    title: undefined,
  }, null, false, undefined, ['a', 2, [h('i', null, 'b')]]));
  el.dispatch('click');
  assert.equal(clicks, 1);
  assert.equal(el.getAttribute('onclick'), null, 'a handler is a listener, not an attribute');
  assert.equal(el.getAttribute('aria-label'), 'Listen');
  assert.equal(el.dataset.itemId, 'u01-l01-i01', 'data-* lands in dataset in camel case');
  assert.equal(el.getAttribute('type'), 'button');
  assert.equal(el.getAttribute('disabled'), '', 'true is a bare boolean attribute');
  assert.equal(el.getAttribute('hidden'), null, 'false leaves the attribute out');
  assert.equal(el.getAttribute('title'), null, 'undefined leaves the attribute out');
  assert.equal(el.textContent, 'a2b', 'arrays are flattened, numbers become text, null, false and undefined are skipped');
});

test('svg builds elements in the SVG namespace, class as an attribute, with handlers and nested children', () => {
  let taps = 0;
  const el = /** @type {any} */ (svg('svg', { class: 'hive', viewBox: '0 0 10 10', 'aria-label': 'Hive', onclick: () => { taps += 1; } },
    svg('rect', { x: 0, y: 0, width: 10, height: 10, fill: 'none', hidden: false }), null, [svg('text', { lang: 'sl' }, 'Prvi stik')]));
  assert.equal(el.namespaceURI, 'http://www.w3.org/2000/svg');
  assert.equal(el.tagName, 'svg', 'an SVG tag name keeps its case');
  assert.equal(el.getAttribute('class'), 'hive', 'class is set as an attribute: an SVG className is not a string');
  assert.equal(el.getAttribute('viewBox'), '0 0 10 10');
  assert.equal(el.getAttribute('aria-label'), 'Hive');
  el.dispatch('click');
  assert.equal(taps, 1);
  assert.equal(el.getAttribute('onclick'), null, 'a handler is a listener, not an attribute');
  assert.equal(el.childNodes.length, 2, 'null is skipped and arrays are flattened');
  const rect = el.childNodes[0];
  assert.equal(rect.namespaceURI, 'http://www.w3.org/2000/svg');
  assert.equal(rect.tagName, 'rect');
  assert.equal(rect.getAttribute('width'), '10', 'numbers become attribute strings');
  assert.equal(rect.getAttribute('hidden'), null, 'false leaves the attribute out');
  assert.equal(el.textContent, 'Prvi stik');
  assert.equal(el.childNodes[1].getAttribute('lang'), 'sl');
});
