// tests/content/helpers.js
// Shared setup for the content tool tests: temporary copies of the fixtures under
// tools/fixtures/, in-place JSON edits, the slot and the extra lessons several tests add, a
// review document that judges a lesson, and the empty native list. Each test file that copies a
// fixture calls after(removeCopies).
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { entriesOf } from '../../tools/review-guard.js';

/** @typedef {{ verdict: string, reason: string, fix?: string, source?: string }} VerdictEntry */

/** @type {string[]} */
const copies = [];

/**
 * NATIVE_LIST.md as Task 1 Step 4 writes it, with no unit section yet: the start of every test's
 * native list. Tests never read content/NATIVE_LIST.md, which the unit tasks fill with real rows.
 */
export const NATIVE_LIST_TEMPLATE = [
  '# Ask a native speaker',
  '',
  'Each row is a word or phrase that one of the two reviews doubted. It is not practised until a native speaker has looked at it.',
  '',
  'For each row, add one line to native-confirmations.tsv: the id, a tab, then `confirmed`, or `corrected`, a tab and the corrected Slovenian. Answers given in a chat are entered the same way. Once `node tools/native-confirm.js` has applied a line, its row leaves this list.',
  '',
].join('\n');

/**
 * A temporary copy of tools/fixtures/<name>/, edited by `mutate` when given.
 * @param {string} name
 * @param {(dir: string) => Promise<void>} [mutate]
 * @returns {Promise<string>} the copy's folder
 */
export async function copyFixture(name, mutate) {
  const root = await mkdtemp(join(tmpdir(), 'slovelingo-content-test-'));
  copies.push(root);
  const dir = join(root, 'content');
  await cp(fileURLToPath(new URL(`../../tools/fixtures/${name}/`, import.meta.url)), dir, { recursive: true });
  if (mutate) await mutate(dir);
  return dir;
}

/** Removes every copy copyFixture made. */
export async function removeCopies() {
  await Promise.all(copies.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
}

/**
 * Rewrites one JSON file of a content folder in place, as the content files are written.
 * @param {string} dir @param {string} file @param {(doc: any) => void} edit
 */
export async function editJson(dir, file, edit) {
  const target = join(dir, file);
  const doc = JSON.parse(await readFile(target, 'utf8'));
  edit(doc);
  await writeFile(target, JSON.stringify(doc, null, 2) + '\n');
}

/**
 * Gives u01-l01-i02 of the valid fixture a slot filled by a new word item u01-l01-i04 (večer),
 * accepted or held pending by a doubt, and adds production u01-l01-p03 that swaps the filler in.
 * @param {string} dir
 * @param {{ fillerStatus: 'accepted'|'pending', filler: string }} options
 */
export async function addSlot(dir, { fillerStatus, filler }) {
  const pending = fillerStatus === 'pending';
  await editJson(dir, 'lessons/u01-l01.json', (doc) => {
    doc.items.find((/** @type {any} */ item) => item.id === 'u01-l01-i02').slots = [{ label: 'time of day', fillers: ['u01-l01-i04'] }];
    doc.items.push({
      id: 'u01-l01-i04',
      type: 'word',
      sl: 'večer',
      en: 'evening',
      register: 'neutral',
      forms: {},
      examples: [{ sl: 'Dober večer.', en: 'Good evening.' }],
      verification: { review1: 'accepted', review2: pending ? 'doubtful' : 'accepted', native: null, status: pending ? 'pending' : 'accepted' },
    });
    doc.production.push({ id: 'u01-l01-p03', en: 'Greet someone in the evening instead.', answer: 'Dober večer.', item: 'u01-l01-i02', filler });
  });
}

/** The one accepted word item of a lesson addLesson adds, by its position in unit u01. */
const ADDED_ITEMS = {
  2: { sl: 'nasvidenje', en: 'goodbye', example: { sl: 'Nasvidenje, gospa.', en: 'Goodbye, madam.' } },
  3: { sl: 'hvala', en: 'thank you', example: { sl: 'Hvala, gospa.', en: 'Thank you, madam.' } },
  4: { sl: 'prosim', en: 'please', example: { sl: 'Prosim, gospa.', en: 'Please, madam.' } },
  5: { sl: 'adijo', en: 'bye', example: { sl: 'Adijo, gospa.', en: 'Bye, madam.' } },
};

/**
 * Adds lesson `id` to unit u01 at the next position, with one accepted word item chosen by that
 * position, so lessons added in a row repeat no item and no gloss, and with the given role.
 * @param {string} dir @param {string} id @param {'theme'|'consolidation'} [role]
 */
export async function addLesson(dir, id, role = 'theme') {
  const units = JSON.parse(await readFile(join(dir, 'units.json'), 'utf8'));
  const position = units.find((/** @type {any} */ unit) => unit.id === 'u01').lessons.length + 1;
  const added = ADDED_ITEMS[/** @type {2|3|4|5} */ (position)];
  if (!added) throw new Error(`addLesson has no item for position ${position}`);
  await editJson(dir, 'units.json', (doc) => {
    doc.find((/** @type {any} */ unit) => unit.id === 'u01').lessons.push(id);
  });
  const lesson = {
    id,
    unit: 'u01',
    order: position,
    role,
    title_sl: 'Slovo',
    title_en: 'Goodbye',
    items: [{
      id: `${id}-i01`,
      type: 'word',
      sl: added.sl,
      en: added.en,
      register: 'neutral',
      examples: [added.example],
      verification: { review1: 'accepted', review2: 'accepted', native: null, status: 'accepted' },
    }],
    rules: [],
    structured: [],
    production: [],
  };
  await writeFile(join(dir, 'lessons', `${id}.json`), JSON.stringify(lesson, null, 2) + '\n');
}

/**
 * A review document for one lesson of a content folder: a review1 and a review2 half that judge
 * every key entriesOf names (or only `only`), each accepted unless `review1` or `review2` gives
 * the entry for a key.
 * @param {string} dir
 * @param {string} lessonId
 * @param {{ review1?: Record<string, VerdictEntry>, review2?: Record<string, VerdictEntry>, only?: string[] }} [options]
 */
export async function reviewDoc(dir, lessonId, { review1 = {}, review2 = {}, only } = {}) {
  const lesson = JSON.parse(await readFile(join(dir, 'lessons', `${lessonId}.json`), 'utf8'));
  const rules = new Map();
  for (const id of lesson.rules) rules.set(id, JSON.parse(await readFile(join(dir, 'rules', `${id}.json`), 'utf8')));
  const itemIds = new Set(lesson.items.map((/** @type {any} */ item) => item.id));
  const keys = [...entriesOf(lesson, rules).keys()].filter((key) => !only || only.includes(key));
  /** @param {string} reviewer @param {Record<string, VerdictEntry>} verdicts */
  const half = (reviewer, verdicts) => {
    /** @param {string[]} list */
    const judge = (list) => Object.fromEntries(list.map((key) => [key, verdicts[key] ?? { verdict: 'accepted', reason: 'Fine.' }]));
    return { reviewer, lookups: 0, items: judge(keys.filter((key) => itemIds.has(key))), lines: judge(keys.filter((key) => !itemIds.has(key))) };
  };
  return { lesson: lessonId, reviews: [half('review1', review1), half('review2', review2)] };
}
