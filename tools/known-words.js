// Known-word shares: how much of a lesson's example sentences and dialogue the learner can already
// read. In course order (units by `order`, each unit's lessons as units.json lists them):
//
//   taught(L) = word tokens of every item's sl, sl_colloquial, forms values and accept entries in
//               L, and of every rule card L lists: its example, every toggle example, every table
//               cell form and pronoun
//   met(L)    = word tokens of L's example sentences and dialogue lines
//   before(L) = taught and met over every lesson before L
//   examples share of L = known tokens / all tokens over L's examples, known = before(L) + taught(L)
//   dialogue share of L = the same over L's dialogue lines, also counting L's example tokens
//
// A token of digits only is always known; a share without tokens is 1, and a lesson without a
// dialogue has no dialogue share. The first lesson of the course is exempt. Item status does not
// matter: the check is about the course's design.
//
// Library: EXAMPLE_SHARE, DIALOGUE_SHARE, knownShares({ contentDir }), knownBefore({ contentDir,
// lessonId }) and knownReport(shares), the lines the CLI and build-content.js --known-check print.
// CLI: node tools/known-words.js [--before <lessonId>] [contentDir]; prints one
// `KNOWN <lesson> examples=<x.xx> dialogue=<x.xx or -> [exempt]` line per lesson and an
// `ERROR known-words ...` line on stderr per share missed, exit 1 on any miss; with --before, the
// words known before the lesson, sorted, on one line.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wordTokens } from '../app/js/util/tokens.js';
import { readCourse } from './review-guard.js';

/** @typedef {import('../app/js/content/types.js').Lesson} Lesson */
/** @typedef {import('../app/js/content/types.js').Rule} Rule */
/** @typedef {{ lesson: string, examples: number, dialogue: number|null, exempt: boolean }} KnownShare */

/** The share of known words a lesson's example sentences need. */
export const EXAMPLE_SHARE = 0.95;
/** The share of known words a lesson's dialogue lines need. */
export const DIALOGUE_SHARE = 0.9;

const DEFAULT_CONTENT_DIR = fileURLToPath(new URL('../content/', import.meta.url));
const USAGE = 'Usage: node tools/known-words.js [--before <lessonId>] [contentDir]';
const DIGITS = /^\p{Nd}+$/u;

/** @param {unknown} err */
const errorMessage = (err) => (err instanceof Error ? err.message : String(err));

/** @param {Set<string>} into @param {unknown} text */
const addTokens = (into, text) => {
  if (typeof text === 'string') for (const token of wordTokens(text)) into.add(token);
};

/**
 * The words a lesson teaches: its items' text, colloquial forms, forms and accepted variants, and
 * the Slovenian of the rule cards it lists.
 * @param {Lesson} lesson @param {Map<string, Rule>} rules
 * @returns {Set<string>}
 */
function taught(lesson, rules) {
  /** @type {Set<string>} */
  const words = new Set();
  for (const item of lesson.items ?? []) {
    addTokens(words, item.sl);
    addTokens(words, item.sl_colloquial);
    for (const form of Object.values(item.forms ?? {})) addTokens(words, form);
    for (const variant of item.accept ?? []) addTokens(words, variant);
  }
  for (const id of lesson.rules ?? []) {
    const rule = rules.get(id);
    if (!rule) throw new Error(`lesson ${lesson.id} lists the unknown rule "${id}"`);
    addTokens(words, rule.example?.sl);
    for (const toggle of rule.toggles ?? []) for (const example of Object.values(toggle.examples ?? {})) addTokens(words, example?.sl);
    for (const cell of Object.values(rule.table?.cells ?? {})) {
      addTokens(words, cell?.form);
      addTokens(words, cell?.pronoun);
    }
  }
  return words;
}

/** @param {Lesson} lesson @returns {string[]} */
const exampleTexts = (lesson) => (lesson.items ?? []).flatMap((item) => (item.examples ?? []).map((example) => example.sl));

/**
 * The share of the tokens of `texts` that are known or digits; 1 without tokens.
 * @param {string[]} texts @param {Set<string>} known
 */
function share(texts, known) {
  let all = 0;
  let hits = 0;
  for (const text of texts) {
    for (const token of wordTokens(text)) {
      all += 1;
      if (known.has(token) || DIGITS.test(token)) hits += 1;
    }
  }
  return all === 0 ? 1 : hits / all;
}

/**
 * Walks the course in order and calls `visit` with each lesson and the words known before it.
 * @param {string} contentDir
 * @param {(lesson: { id: string, doc: Lesson }, before: Set<string>, taughtHere: Set<string>, index: number) => void} visit
 */
async function walkCourse(contentDir, visit) {
  const { lessons, rules } = await readCourse(contentDir);
  /** @type {Set<string>} */
  const before = new Set();
  lessons.forEach((lesson, index) => {
    const taughtHere = taught(lesson.doc, rules);
    visit(lesson, before, taughtHere, index);
    for (const word of taughtHere) before.add(word);
    for (const text of exampleTexts(lesson.doc)) addTokens(before, text);
    for (const line of lesson.doc.dialogue?.lines ?? []) addTokens(before, line.sl);
  });
}

/**
 * The known-word shares of every lesson, in course order.
 * @param {{ contentDir: string }} options
 * @returns {Promise<KnownShare[]>}
 */
export async function knownShares({ contentDir }) {
  /** @type {KnownShare[]} */
  const shares = [];
  await walkCourse(contentDir, ({ id, doc }, before, taughtHere, index) => {
    const examples = exampleTexts(doc);
    const known = new Set([...before, ...taughtHere]);
    const exampleShare = share(examples, known);
    let dialogue = null;
    if (doc.dialogue) {
      for (const text of examples) addTokens(known, text);
      dialogue = share(doc.dialogue.lines.map((line) => line.sl), known);
    }
    shares.push({ lesson: id, examples: exampleShare, dialogue, exempt: index === 0 });
  });
  return shares;
}

/**
 * The words known before a lesson (taught or met in every earlier lesson), sorted.
 * @param {{ contentDir: string, lessonId: string }} options
 * @returns {Promise<string[]>}
 */
export async function knownBefore({ contentDir, lessonId }) {
  /** @type {string[]|null} */
  let words = null;
  await walkCourse(contentDir, ({ id }, before) => {
    if (id === lessonId) words = [...before].sort();
  });
  if (words === null) throw new Error(`lesson ${lessonId} is not in units.json`);
  return words;
}

/** A share rounded down to two decimals, so 0.299 prints as 0.29 and 0.29 stays 0.29. @param {number} value */
const twoDecimals = (value) => (Math.floor(value * 100 + 1e-9) / 100).toFixed(2);

/**
 * The lines to print for the shares: one KNOWN line per lesson, and one ERROR line per share of a
 * lesson that is not exempt under its minimum (compared unrounded).
 * @param {KnownShare[]} shares
 * @returns {{ lines: string[], errors: string[] }}
 */
export function knownReport(shares) {
  const lines = [];
  const errors = [];
  for (const { lesson, examples, dialogue, exempt } of shares) {
    lines.push(`KNOWN ${lesson} examples=${twoDecimals(examples)} dialogue=${dialogue === null ? '-' : twoDecimals(dialogue)}${exempt ? ' exempt' : ''}`);
    if (exempt) continue;
    if (examples < EXAMPLE_SHARE) errors.push(`ERROR known-words ${lesson}: examples ${twoDecimals(examples)} is under ${EXAMPLE_SHARE.toFixed(2)}`);
    if (dialogue !== null && dialogue < DIALOGUE_SHARE) errors.push(`ERROR known-words ${lesson}: dialogue ${twoDecimals(dialogue)} is under ${DIALOGUE_SHARE.toFixed(2)}`);
  }
  return { lines, errors };
}

/** @param {string[]} argv @returns {Promise<number>} the exit code */
async function main(argv) {
  /** @type {string|null} */
  let before = null;
  /** @type {string|null} */
  let contentDir = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--before' && before === null && argv[i + 1] !== undefined && !argv[i + 1].startsWith('-')) {
      before = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('-') || contentDir !== null) {
      console.error(`Unexpected argument ${arg}\n${USAGE}`);
      return 2;
    } else contentDir = arg;
  }
  const dir = contentDir ?? DEFAULT_CONTENT_DIR;
  try {
    if (before !== null) {
      console.log((await knownBefore({ contentDir: dir, lessonId: before })).join(' '));
      return 0;
    }
    const { lines, errors } = knownReport(await knownShares({ contentDir: dir }));
    for (const line of lines) console.log(line);
    for (const line of errors) console.error(line);
    return errors.length > 0 ? 1 : 0;
  } catch (err) {
    console.error(`ERROR ${errorMessage(err)}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
