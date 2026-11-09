// The Hive screen (spec 6, concept section 3): the course as honeycomb, one strip per unit of the
// index with a cell per lesson (components/hive.js), a tap on a strip opens its unit page; under
// the comb the honest counts of spec 4.7, each against the course's own total: items recallable
// now against the scheduled items, words met against the course's words, hours practised against
// the hours A1 courses budget. Counts, not scores.

import { h, mount } from '../../util/dom.js';
import { onlyKnown } from '../../content/loader.js';
import { navigate } from '../../router.js';
import { a1Hours, hiveFill, hoursPracticed, recallNow, wordsMet } from '../../engine/progress.js';
import { renderHive, sealedUnits } from '../components/hive.js';

/** @typedef {import('../../app-types.js').App} App */

/**
 * One count of the glance list.
 * @param {string} term
 * @param {string} value
 * @param {string} [note]
 * @returns {HTMLElement}
 */
function glance(term, value, note) {
  return h('div', { class: 'glance-item' },
    h('dt', { class: 'glance-term' }, term),
    h('dd', { class: 'glance-value' }, value),
    note ? h('dd', { class: 'glance-note' }, note) : null);
}

/**
 * @param {HTMLElement} container
 * @param {App} app
 */
export function renderHiveScreen(container, app) {
  const now = Date.now();
  const retention = app.state.settings.desiredRetention;
  const states = onlyKnown(app.state.items, app.known);
  const fills = app.units.map((content) => hiveFill(states, content, now, retention, { allowPending: app.allowPending }));
  mount(container, h('section', { class: 'screen screen-hive' },
    h('h1', { class: 'screen-title' }, 'Hive'),
    h('p', { class: 'en-text' }, 'One row per unit, one cell per lesson. A cell fills with what you can recall now, and a passed checkpoint paints its row. Tap a row to open the unit.'),
    renderHive(fills, app.index.units, { onUnit: (id) => navigate(`/unit?id=${id}`), sealed: sealedUnits(app.state.meta) }),
    h('dl', { class: 'glance' },
      glance('Can recall now', `${recallNow(states, now, retention)} of ${app.index.counts.scheduledItems} items`),
      glance('Words met', `${wordsMet(states, app.units)} of ${app.index.counts.lemmasMet}`),
      glance('Hours practised', String(hoursPracticed(app.state.sessions)), `A1 courses budget ${a1Hours.min} to ${a1Hours.max} hours.`))));
}
