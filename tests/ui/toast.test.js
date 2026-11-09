// tests/ui/toast.test.js
// The toast (Task 19), through tests/helpers/fake-dom.js: one fixed status bar on the body with
// the text, an optional action button and a "Later" button that dismisses; a new toast replaces
// the one showing; showToast returns a dismiss function that is safe to call twice and never
// removes a toast that replaced the one it belongs to.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../helpers/fake-dom.js';
import { showToast } from '../../app/js/ui/components/toast.js';

/** @type {any} */
let document;

before(() => {
  document = installFakeDom();
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

/** The toasts on the body. @returns {any[]} */
const toasts = () => document.body.childNodes.filter((/** @type {any} */ node) => node.classList?.contains('toast'));
/** The button under `root` that reads `text`. @param {any} root @param {string} text */
const button = (root, text) => elements(root).find((el) => el.tagName === 'BUTTON' && el.textContent === text);

test('showToast puts one status bar on the body with the text, the action and a Later button', () => {
  let taps = 0;
  const dismiss = showToast({ text: 'A new version is ready. Reload when you have a moment.', action: { label: 'Reload', onTap: () => { taps += 1; } } });
  assert.equal(typeof dismiss, 'function');
  const [toast] = toasts();
  assert.equal(toasts().length, 1);
  assert.equal(toast.getAttribute('role'), 'status');
  assert.equal(toast.querySelector('.toast-text').textContent, 'A new version is ready. Reload when you have a moment.');
  const reload = button(toast, 'Reload');
  const later = button(toast, 'Later');
  assert.ok(reload && later, 'both buttons');
  assert.equal(reload.getAttribute('type'), 'button');
  assert.equal(later.getAttribute('type'), 'button');
  assert.ok(reload.classList.contains('btn'), 'the action is a button of the app, so it has the 44 px target');
  assert.ok(later.classList.contains('btn'));

  reload.dispatch('click');
  assert.equal(taps, 1);
  assert.equal(toasts().length, 1, 'the action leaves the toast to its caller');

  later.dispatch('click');
  assert.equal(toasts().length, 0, 'Later dismisses');
  dismiss();
  assert.equal(toasts().length, 0, 'dismissing a dismissed toast is nothing');
});

test('a toast without an action has only the Later button', () => {
  const dismiss = showToast({ text: 'Kept offline.' });
  const [toast] = toasts();
  assert.deepEqual(elements(toast).filter((el) => el.tagName === 'BUTTON').map((el) => el.textContent), ['Later']);
  dismiss();
  assert.equal(toasts().length, 0);
});

test('one toast at a time: a new one replaces the old, and the old dismiss function leaves the new one alone', () => {
  const first = showToast({ text: 'First' });
  const second = showToast({ text: 'Second' });
  assert.equal(toasts().length, 1);
  assert.equal(toasts()[0].querySelector('.toast-text').textContent, 'Second');
  first();
  assert.equal(toasts().length, 1, 'the first toast is gone already; its dismiss does not touch the second');
  assert.equal(toasts()[0].querySelector('.toast-text').textContent, 'Second');
  second();
  assert.equal(toasts().length, 0);
});
