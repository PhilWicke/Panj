// The app's entry point. Boot: open the store (IndexedDB, or memory with a notice), load the state
// and the content bundle, register the exercises, then route: `#/onboarding` until the learner is
// onboarded, `#/today` otherwise, `#/session` and `#/rules`. Every screen gets the one App object,
// whose state the screens update as they save; every screen but onboarding and the session has the
// tab bar below it.

import { h, mount } from './util/dom.js';
import { openStore } from './store/db.js';
import { loadState, saveSettings } from './store/state.js';
import { loadIndex, loadUnit, knownIds } from './content/loader.js';
import { createPlayer } from './audio/player.js';
import { currentParams, currentPath, navigate, onRoute } from './router.js';
import { register } from './ui/exercises/registry.js';
import * as meet from './ui/exercises/meet.js';
import * as typed from './ui/exercises/typed.js';
import * as rule from './ui/exercises/rule.js';
import * as structured from './ui/exercises/structured.js';
import * as slot from './ui/exercises/slot.js';
import * as dialogue from './ui/exercises/dialogue.js';
import * as listening from './ui/exercises/listening.js';
import * as speaking from './ui/exercises/speaking.js';
import * as perception from './ui/exercises/perception.js';
import { renderNav } from './ui/components/nav.js';
import { renderToday } from './ui/screens/today.js';
import { renderSession } from './ui/screens/session.js';
import { renderRules } from './ui/screens/rules.js';

/** @typedef {import('./store/memory.js').StoreAdapter} StoreAdapter */
/** @typedef {import('./store/state.js').AppState} AppState */
/** @typedef {import('./content/types.js').Index} Index */
/** @typedef {import('./content/types.js').UnitContent} UnitContent */
/** @typedef {import('./content/types.js').Item} Item */
/** @typedef {import('./content/types.js').Lesson} Lesson */
/** @typedef {import('./content/types.js').Rule} Rule */
/** @typedef {import('./audio/player.js').Player} Player */

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
 * @property {Player} player the one audio player: recordings, else the device's Slovenian voice
 */

register('meet', meet.render);
register('typed_en_sl', typed.render);
register('rule', rule.render);
register('structured', structured.render);
register('slot', slot.render);
register('dialogue', dialogue.render);
register('listening', listening.render);
register('speaking', speaking.render);
register('perception', perception.render);

const root = /** @type {HTMLElement} */ (document.getElementById('app'));
/** Routes that hide the tab bar. */
const WITHOUT_NAV = new Set(['/onboarding', '/session']);
/** @type {HTMLElement|null} */
let nav = null;

/**
 * Puts the tab bar below the main column, or takes it away on the routes without one; the column
 * keeps room at the bottom so the bar never covers content.
 * @param {string} path
 */
function showNav(path) {
  nav?.remove();
  nav = WITHOUT_NAV.has(path) ? null : renderNav(path);
  if (nav) root.after(nav);
  root.classList.toggle('has-nav', nav !== null);
}

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
    player: createPlayer({ manifestUrl: 'assets/audio/manifest.json', voicePref: state.settings.voice, mute: state.settings.mute }),
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
    else if (path === '/rules') renderRules(root, app);
    else return navigate('/today', { replace: true });
    showNav(path);
  };
  onRoute(show);
  show(currentPath(), currentParams());
}

boot().catch(renderBootError);
