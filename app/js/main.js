// The app's entry point. Boot: open the store (IndexedDB, or memory with a notice), load the state
// and the content bundle, register the exercises, then route: `#/onboarding` until the learner is
// onboarded, `#/today` otherwise. Every screen gets the one App object, whose state the screens
// update as they save.

import { h, mount } from './util/dom.js';
import { openStore } from './store/db.js';
import { loadState, saveSettings } from './store/state.js';
import { loadIndex, loadUnit, knownIds } from './content/loader.js';
import { currentParams, currentPath, navigate, onRoute } from './router.js';
import { register } from './ui/exercises/registry.js';
import * as meet from './ui/exercises/meet.js';
import * as typed from './ui/exercises/typed.js';
import { renderToday } from './ui/screens/today.js';
import { renderSession } from './ui/screens/session.js';

/** @typedef {import('./store/memory.js').StoreAdapter} StoreAdapter */
/** @typedef {import('./store/state.js').AppState} AppState */
/** @typedef {import('./content/types.js').Index} Index */
/** @typedef {import('./content/types.js').UnitContent} UnitContent */
/** @typedef {import('./content/types.js').Item} Item */
/** @typedef {import('./content/types.js').Lesson} Lesson */
/** @typedef {import('./content/types.js').Rule} Rule */

/**
 * Everything the screens work with.
 * @typedef {object} App
 * @property {StoreAdapter} adapter
 * @property {boolean} persistent false when the store fell back to memory
 * @property {AppState} state loaded once; screens update it as they save
 * @property {Index} index
 * @property {UnitContent[]} units every unit file, in course order
 * @property {Set<string>} known the item and rule ids the bundle carries (Ruling 23)
 * @property {Map<string, { item: Item, lesson: Lesson }>} items item content by id
 * @property {Map<string, Lesson>} lessons by id
 * @property {Map<string, Rule>} rules by id
 * @property {boolean} allowPending a dev build practises pending items (Ruling 20)
 */

register('meet', meet.render);
register('typed_en_sl', typed.render);

const root = /** @type {HTMLElement} */ (document.getElementById('app'));

/** @param {AppState['settings']['theme']} theme */
function applyTheme(theme) {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

/**
 * The onboarding placeholder until Task 16's screen: one button that marks the learner onboarded.
 * @param {App} app
 */
function renderOnboarding(app) {
  mount(root, h('section', { class: 'screen screen-onboarding' },
    h('h1', { class: 'greeting', lang: 'sl' }, 'Dobrodošli'),
    h('p', { class: 'en-text' }, 'Welcome. Slovelingo teaches Slovenian a few minutes a day, starting with your first hello.'),
    h('div', { class: 'actions' }, h('button', {
      type: 'button', class: 'btn btn-primary btn-large',
      onclick: async () => {
        app.state.settings = { ...app.state.settings, onboarded: true };
        await saveSettings(app.adapter, app.state.settings);
        navigate('/today', { replace: true });
      },
    }, 'Continue'))));
}

/** @param {unknown} error */
function renderBootError(error) {
  console.error(error);
  mount(root, h('section', { class: 'screen' },
    h('h1', { class: 'prompt' }, 'Slovelingo could not start.'),
    h('p', { class: 'en-text' }, 'The course could not be loaded. Check the connection and reload the page.'),
    h('p', { class: 'quiet' }, error instanceof Error ? error.message : String(error))));
}

async function boot() {
  const [{ adapter, persistent }, index] = await Promise.all([openStore(), loadIndex()]);
  const [state, units] = await Promise.all([loadState(adapter), Promise.all(index.units.map((unit) => loadUnit(unit.id)))]);

  /** @type {App} */
  const app = {
    adapter, persistent, state, index, units,
    known: knownIds(index, units),
    items: new Map(), lessons: new Map(), rules: new Map(index.rules.map((rule) => [rule.id, rule])),
    allowPending: index.mode === 'dev',
  };
  for (const unit of units) {
    for (const lesson of unit.lessons) {
      app.lessons.set(lesson.id, lesson);
      for (const item of lesson.items) app.items.set(item.id, { item, lesson });
    }
  }

  applyTheme(state.settings.theme);
  if (app.allowPending) document.querySelector('.app-header')?.append(h('span', { class: 'badge' }, 'Development build'));
  // Task 19 registers the service worker here.

  /** @type {(() => void)|null} */
  let leave = null;
  /** @param {string} path @param {Record<string, string>} params */
  const show = (path, params) => {
    leave?.();
    leave = null;
    if (!app.state.settings.onboarded && path !== '/onboarding') return navigate('/onboarding', { replace: true });
    if (app.state.settings.onboarded && path === '/onboarding') return navigate('/today', { replace: true });
    window.scrollTo(0, 0);
    if (path === '/onboarding') renderOnboarding(app);
    else if (path === '/today') renderToday(root, app);
    else if (path === '/session') leave = renderSession(root, app, params);
    else navigate('/today', { replace: true });
  };
  onRoute(show);
  show(currentPath(), currentParams());
}

boot().catch(renderBootError);
