// tests/engine/dom.test.js
// h() builds the app's elements. Node has no DOM, so tests/helpers/fake-dom.js stands in for the
// document; the real one is exercised by the end-to-end check in the browser.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../helpers/fake-dom.js';
import { h } from '../../app/js/util/dom.js';

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
