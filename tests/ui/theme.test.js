// tests/ui/theme.test.js
// The theme switch (Ruling 83): applyTheme puts the choice on the root element and mirrors it to
// localStorage; as the module loads, a mirrored light or dark theme is applied before the store
// opens, while system or no mirror leaves the media query to decide; a localStorage that throws
// is tolerated at load and on apply. Each case imports the module afresh through a query string,
// since the early read runs once per module instance, over tests/helpers/fake-dom.js.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, fakeStorage } from '../helpers/fake-dom.js';

const THEME_URL = new URL('../../app/js/ui/theme.js', import.meta.url).href;
const KEY = 'slovelingo-theme';

/** @type {ReturnType<typeof installFakeDom>} */
let document;

before(() => {
  document = installFakeDom();
});

/** A fresh instance of theme.js. @param {string} tag */
const freshTheme = (tag) => import(`${THEME_URL}?case=${tag}`);

/** Installs `storage` as the page's localStorage. @param {unknown} storage */
const useStorage = (storage) => { Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true }); };

test('a mirrored dark theme is applied as the module loads, before the store opens', async () => {
  const storage = fakeStorage();
  storage.setItem(KEY, 'dark');
  useStorage(storage);
  delete document.documentElement.dataset.theme;
  const { applyTheme } = await freshTheme('dark');
  assert.equal(document.documentElement.dataset.theme, 'dark');

  applyTheme('light');
  assert.equal(document.documentElement.dataset.theme, 'light');
  assert.equal(storage.getItem(KEY), 'light', 'the choice is mirrored');
  applyTheme('system');
  assert.equal(document.documentElement.dataset.theme, undefined, 'system removes the attribute');
  assert.equal(storage.getItem(KEY), 'system');
});

test('a mirrored light theme is applied as the module loads; system or no mirror applies nothing', async () => {
  const light = fakeStorage();
  light.setItem(KEY, 'light');
  useStorage(light);
  delete document.documentElement.dataset.theme;
  await freshTheme('light');
  assert.equal(document.documentElement.dataset.theme, 'light');

  const system = fakeStorage();
  system.setItem(KEY, 'system');
  useStorage(system);
  delete document.documentElement.dataset.theme;
  await freshTheme('system');
  assert.equal(document.documentElement.dataset.theme, undefined, 'the media query decides');

  useStorage(fakeStorage());
  await freshTheme('none');
  assert.equal(document.documentElement.dataset.theme, undefined, 'no mirror yet');

  const odd = fakeStorage();
  odd.setItem(KEY, 'blue');
  useStorage(odd);
  await freshTheme('odd');
  assert.equal(document.documentElement.dataset.theme, undefined, 'a value that is no theme applies nothing');
});

test('a localStorage that throws is tolerated at load and on apply, and a missing one too', async () => {
  useStorage({ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } });
  delete document.documentElement.dataset.theme;
  const { applyTheme } = await freshTheme('throws');
  assert.equal(document.documentElement.dataset.theme, undefined);
  applyTheme('dark');
  assert.equal(document.documentElement.dataset.theme, 'dark', 'the theme still applies to the page');

  useStorage(undefined);
  const missing = await freshTheme('missing');
  missing.applyTheme('light');
  assert.equal(document.documentElement.dataset.theme, 'light');
  useStorage(fakeStorage());
});
