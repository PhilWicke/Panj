// The app's entry point. Boot: open the store (IndexedDB, or memory with a notice), load the state
// and the content bundle, register the exercises, then route: `#/onboarding` until the learner is
// onboarded, `#/today` otherwise, `#/session`, `#/hive`, `#/unit?id=uNN`, `#/rules`, `#/words`,
// `#/settings`, `#/stats` and `#/checkpoint` (a unit's, the weekly check or the placement). Every
// screen gets the one App object (app-types.js), whose state the screens update as they save;
// every screen but onboarding, the session and a checkpoint has the tab bar below it. After boot
// the service worker is registered (sw-client.js); a new version shows a toast and takes effect
// only when the learner taps its Reload (Ruling 58).

import { h, mount } from './util/dom.js';
import { openStore } from './store/db.js';
import { loadState } from './store/state.js';
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
import { renderHiveScreen } from './ui/screens/hive.js';
import { renderUnit } from './ui/screens/unit.js';
import { renderRules } from './ui/screens/rules.js';
import { renderCheckpoint } from './ui/screens/checkpoint.js';
import { renderOnboarding } from './ui/screens/onboarding.js';
import { renderWords } from './ui/screens/words.js';
import { renderSettings } from './ui/screens/settings.js';
import { renderStats } from './ui/screens/stats.js';
import { resetQuiet } from './ui/quiet.js';
import { applyTheme } from './ui/theme.js';
import { showToast, toastRegion } from './ui/components/toast.js';
import { registerWorker } from './sw-client.js';

/** @typedef {import('./app-types.js').App} App */

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
const WITHOUT_NAV = new Set(['/onboarding', '/session', '/checkpoint']);
/** @type {HTMLElement|null} */
let nav = null;

/** Routes shown under another route's tab: the unit page belongs to the Hive tab, Stats to Settings. */
const TAB_OF = new Map([['/unit', '/hive'], ['/stats', '/settings']]);
/** What the toast says when a new version is installed and waiting. */
const UPDATE_TEXT = 'A new version is ready. Reload when you have a moment.';

/**
 * Puts the tab bar below the main column, or takes it away on the routes without one; the column
 * keeps room at the bottom so the bar never covers content.
 * @param {string} path
 */
function showNav(path) {
  nav?.remove();
  nav = WITHOUT_NAV.has(path) ? null : renderNav(TAB_OF.get(path) ?? path);
  if (nav) root.after(nav);
  root.classList.toggle('has-nav', nav !== null);
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
  toastRegion();
  void registerWorker({ onUpdate: ({ reload }) => showToast({ text: UPDATE_TEXT, action: { label: 'Reload', onTap: reload } }) });

  /** @type {(() => void)|null} */
  let leave = null;
  /** @param {string} path @param {Record<string, string>} params */
  const show = (path, params) => {
    leave?.();
    // Leaving the session for any other screen ends the sitting and its quiet choices; a run the
    // closing menu starts (`/session?mode=...`) keeps them.
    if (path !== '/session') resetQuiet();
    leave = null;
    if (!app.state.settings.onboarded && path !== '/onboarding') return navigate('/onboarding', { replace: true });
    if (app.state.settings.onboarded && path === '/onboarding') return navigate('/today', { replace: true });
    window.scrollTo(0, 0);
    if (path === '/onboarding') renderOnboarding(root, app);
    else if (path === '/today') renderToday(root, app);
    else if (path === '/session') leave = renderSession(root, app, params);
    else if (path === '/checkpoint') leave = renderCheckpoint(root, app, params);
    else if (path === '/hive') renderHiveScreen(root, app);
    else if (path === '/unit') leave = renderUnit(root, app, params);
    else if (path === '/rules') renderRules(root, app);
    else if (path === '/words') renderWords(root, app);
    else if (path === '/settings') renderSettings(root, app);
    else if (path === '/stats') renderStats(root, app);
    else return navigate('/today', { replace: true });
    showNav(path);
  };
  onRoute(show);
  show(currentPath(), currentParams());
}

boot().catch(renderBootError);
