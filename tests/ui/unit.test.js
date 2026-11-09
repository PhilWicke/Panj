// tests/ui/unit.test.js
// The unit page through tests/helpers/fake-dom.js, with a stand-in service worker: the date a
// checkpoint sealed the unit reads in English; "Keep offline" posts its message and listens for
// the reply, which it stops doing when the learner leaves the page (renderUnit's leave function,
// called by main.js) or after 60 seconds, when a still-busy button becomes "Keep offline" again
// with a quiet line; a reply in time ends the wait.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom } from '../helpers/fake-dom.js';
import { DEFAULT_APP_SETTINGS } from '../../app/js/store/state.js';
import { renderUnit } from '../../app/js/ui/screens/unit.js';

/** @typedef {import('../../app/js/content/types.js').Lesson} Lesson */

/** @type {Lesson} */
const lesson = JSON.parse(readFileSync(new URL('../../content/lessons/u01-l01.json', import.meta.url), 'utf8'));
const UNIT = { id: 'u01', order: 1, title_sl: 'Prvi stik', title_en: 'First contact', motif: 'flower', lessons: ['u01-l01'] };

/** A service worker container that records what the page posts and which reply listeners it holds. */
function worker() {
  /** @type {unknown[]} */
  const posted = [];
  /** @type {Set<Function>} */
  const listeners = new Set();
  const container = {
    controller: { postMessage: (/** @type {unknown} */ message) => posted.push(message) },
    addEventListener: (/** @type {string} */ type, /** @type {Function} */ listener) => { if (type === 'message') listeners.add(listener); },
    removeEventListener: (/** @type {string} */ type, /** @type {Function} */ listener) => { if (type === 'message') listeners.delete(listener); },
  };
  /** Sends a message to every listener, as the worker's postMessage does. @param {unknown} data */
  const reply = (data) => { for (const listener of [...listeners]) listener({ data }); };
  return { container, posted, listeners, reply };
}

/** @param {Record<string, string>} [sealed] */
const appWith = (sealed) => /** @type {any} */ ({
  index: { units: [UNIT] },
  units: [{ unit: UNIT, lessons: [lesson] }],
  known: new Set(lesson.items.map((item) => item.id)),
  allowPending: false,
  state: { items: {}, settings: { ...DEFAULT_APP_SETTINGS, voice: 'female' }, meta: { schemaVersion: 1, createdAt: 0, ...(sealed ? { sealed } : {}) } },
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

/** @param {any} root */
const keepButton = (root) => elements(root).find((el) => el.tagName === 'BUTTON' && el.classList.contains('btn-secondary'));
/** The quiet line under the buttons. @param {any} root */
const offlineLine = (root) => elements(root).filter((el) => el.tagName === 'P' && el.classList.contains('quiet')).at(-1);

/** @type {ReturnType<typeof worker>} */
let sw;

before(() => {
  installFakeDom();
});

beforeEach(() => {
  sw = worker();
  Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: sw.container }, configurable: true, writable: true });
});

test('the sealed date reads in English, day, month name and year', () => {
  const container = /** @type {any} */ (document.createElement('main'));
  renderUnit(container, appWith({ u01: '2026-11-02' }), { id: 'u01' });
  assert.ok(elements(container).some((el) => el.textContent === 'Checkpoint passed on 2 November 2026.'));
});

test('Keep offline stops listening for the reply when the learner leaves the page', () => {
  const container = /** @type {any} */ (document.createElement('main'));
  const leave = renderUnit(container, appWith(), { id: 'u01' });
  assert.equal(typeof leave, 'function', 'renderUnit returns its leave function');
  const button = keepButton(container);
  assert.equal(button.textContent, 'Keep offline');
  button.dispatch('click');
  assert.deepEqual(sw.posted, [{ type: 'cache-unit-audio', unitId: 'u01', voice: 'Kore' }]);
  assert.equal(button.getAttribute('aria-busy'), 'true');
  assert.equal(sw.listeners.size, 1);
  leave();
  assert.equal(sw.listeners.size, 0, 'the reply listener goes with the page');
  leave();
  assert.equal(sw.listeners.size, 0, 'leaving twice is nothing');
});

test('Keep offline gives up after 60 seconds: the button is offered again with a quiet line, and a late reply changes nothing', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const container = /** @type {any} */ (document.createElement('main'));
  const leave = renderUnit(container, appWith(), { id: 'u01' });
  const button = keepButton(container);
  button.dispatch('click');
  t.mock.timers.tick(59_999);
  assert.equal(button.textContent, 'Keeping offline…', 'still waiting just before the minute');
  t.mock.timers.tick(1);
  assert.equal(button.textContent, 'Keep offline');
  assert.equal(button.getAttribute('aria-busy'), null);
  assert.equal(offlineLine(container).textContent, 'That took too long. Try again.');
  assert.equal(offlineLine(container).hidden, false);
  assert.equal(sw.listeners.size, 0, 'nothing listens any more');
  sw.reply({ type: 'unit-audio-cached', unitId: 'u01', count: 3, total: 3 });
  assert.equal(button.textContent, 'Keep offline', 'a reply after the timeout is ignored');

  button.dispatch('click');
  assert.equal(sw.posted.length, 2, 'the learner can try again');
  assert.equal(button.textContent, 'Keeping offline…');
  leave();
});

test('Keep offline: a reply in time ends the wait, so the minute passing changes nothing', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const container = /** @type {any} */ (document.createElement('main'));
  renderUnit(container, appWith(), { id: 'u01' });
  const button = keepButton(container);
  button.dispatch('click');
  sw.reply({ type: 'unit-audio-cached', unitId: 'u02', count: 0, total: 0 });
  assert.equal(button.textContent, 'Keeping offline…', 'another unit\'s reply is not this one');
  sw.reply({ type: 'unit-audio-cached', unitId: 'u01', count: 2, total: 3, error: 'assets/audio/x.mp3 answered 500' });
  assert.equal(button.textContent, 'Keep offline');
  assert.equal(offlineLine(container).textContent, '2 of 3 clips kept on this phone. The rest could not be fetched; try again later.');
  assert.equal(sw.listeners.size, 0);
  t.mock.timers.tick(60_000);
  assert.equal(offlineLine(container).textContent, '2 of 3 clips kept on this phone. The rest could not be fetched; try again later.');

  button.dispatch('click');
  sw.reply({ type: 'unit-audio-cached', unitId: 'u01', count: 3, total: 3 });
  assert.equal(button.textContent, 'Kept offline');
  assert.equal(offlineLine(container).textContent, '3 of 3 clips kept on this phone.');
});
