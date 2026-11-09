// The tab bar at the bottom of the screen (Ruling 37): Today, Hive, Rules, Words, Settings, each a
// 44 px target, the active one marked with honey and aria-current. A tab whose screen does not
// exist yet is a button that looks disabled and does nothing; the task that adds the route gives
// it its path here.

import { h } from '../../util/dom.js';

/** @type {{ label: string, path: string|null }[]} */
const TABS = [
  { label: 'Today', path: '/today' },
  { label: 'Hive', path: null },
  { label: 'Rules', path: '/rules' },
  { label: 'Words', path: null },
  { label: 'Settings', path: null },
];

/**
 * @param {string} activePath the route showing, `/today`
 * @returns {HTMLElement}
 */
export function renderNav(activePath) {
  return h('nav', { class: 'tab-bar', 'aria-label': 'Main' },
    h('ul', { class: 'tab-list' }, TABS.map(({ label, path }) => h('li', null, path === null
      ? h('button', { type: 'button', class: 'tab', 'aria-disabled': 'true' }, label)
      : h('a', { class: 'tab', href: `#${path}`, 'aria-current': path === activePath ? 'page' : null }, label)))));
}
