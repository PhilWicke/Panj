// tests/ui/hive-screen.test.js
// The Hive screen through tests/helpers/fake-dom.js, on an inline course of three units of five
// lessons with one bundled lesson in the first: the intro line, one strip per unit with a cell per
// lesson of its lessonCount (placeholders where the bundle carries none), the three counters as
// v1, and a tap on a strip that opens its unit page. router.navigate writes location.hash, so each
// test starts from an empty hash.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../helpers/fake-dom.js';
import { elements, withClass } from '../helpers/dom-query.js';
import { DEFAULT_APP_SETTINGS } from '../../app/js/store/state.js';
import { renderHiveScreen } from '../../app/js/ui/screens/hive.js';

before(() => {
  installFakeDom();
});

/** @type {any} */
let container;

beforeEach(() => {
  globalThis.location = { hash: '', replace() {} };
  container = document.createElement('main');
});

/** @param {string} id @param {string} sl @param {string} en */
const item = (id, sl, en) => ({
  id, type: 'chunk', sl, en, register: 'neutral', examples: [],
  verification: { review1: 'accepted', review2: 'accepted', native: null, status: 'accepted' },
});

const LESSON = {
  id: 'u01-l01', unit: 'u01', order: 1, title_sl: 'Prvi pozdrav', title_en: 'First hello', rules: [], structured: [], production: [],
  items: [item('u01-l01-i01', 'Dober dan.', 'Good day.'), item('u01-l01-i02', 'Hvala.', 'Thank you.')],
};
const UNITS = [
  { id: 'u01', order: 1, title_sl: 'Prvi stik', title_en: 'First contact', motif: 'flower', lessonCount: 5, lessons: ['u01-l01'] },
  { id: 'u02', order: 2, title_sl: 'Družina in ljudje', title_en: 'Family and people', motif: 'heart', lessonCount: 5, lessons: [] },
  { id: 'u03', order: 3, title_sl: 'Pri mizi', title_en: 'At the table', motif: 'wheat', lessonCount: 5, lessons: [] },
];

/** The app the screen is drawn from: the three units, the one lesson, no states and no sessions. */
const app = /** @type {any} */ ({
  index: {
    units: UNITS, rules: [], counts: { scheduledItems: 2, lemmasMet: 3 },
    lessonIndex: [{ id: LESSON.id, unit: 'u01', order: 1, title_sl: LESSON.title_sl, title_en: LESSON.title_en, itemCount: 2 }],
  },
  units: UNITS.map((unit) => ({ unit, lessons: unit.id === 'u01' ? [LESSON] : [] })),
  known: new Set(LESSON.items.map((entry) => entry.id)),
  allowPending: false,
  state: { items: {}, sessions: [], settings: { ...DEFAULT_APP_SETTINGS }, meta: { schemaVersion: 1, createdAt: 0 } },
});

test('the Hive screen draws a strip per unit, keeps the three counters and opens a unit on tap', () => {
  renderHiveScreen(container, app);
  assert.ok(elements(container).some((e) => e.tagName === 'P' && e.textContent === 'One row per unit, one cell per lesson. A cell fills with what you can recall now, and a passed checkpoint paints its row. Tap a row to open the unit.'));
  assert.equal(withClass(container, 'hive-strip').length, 3);
  assert.equal(withClass(container, 'hive-cell').length, 15);
  assert.deepEqual(elements(container).filter((e) => e.tagName === 'DT').map((e) => e.textContent), ['Can recall now', 'Words met', 'Hours practised']);
  withClass(container, 'hive-strip')[1].dispatch('click');
  assert.equal(globalThis.location.hash, '#/unit?id=u02');
});
