// Enters a native speaker's answers. Each line of content/native-confirmations.tsv
// (`id<TAB>verdict<TAB>correction`, header first) confirms an item or corrects its Slovenian:
//
// - `confirmed` sets the item's native verdict and accepts it.
// - `corrected` does the same, sets the item's `sl` to the correction, and replaces the old text
//   (the old `sl` without its final `.`, `!` or `?`, as a whole word, ignoring case, keeping the
//   case of the first letter) wherever a learner types or reads it as running text: item examples,
//   production answers and accepted variants, dialogue lines, and rule card and toggle examples,
//   in every lesson and rule. The review fingerprint of every entry it changed is refreshed in the
//   latest round that judged it, so the review guard keeps accepting it. Occurrences in other
//   Slovenian fields (another item's text, any item's colloquial form, forms or accepted variants,
//   structured exercises, production fillers, rule tables and quick checks) are left for a person
//   to judge and reported as untouched.
//
// An applied line leaves the tsv and its item's row leaves NATIVE_LIST.md. A line that cannot be
// applied stays in the tsv and is reported as unmatched. The tsv is read through a byte-order mark,
// CRLF line ends, spaces around fields, blank lines and capitalised verdicts, with corrections
// normalised to NFC, and rewritten with LF line ends and no byte-order mark.
//
// Library: nativeConfirm({ contentDir, tsvPath, nativeListPath }).
// CLI: node tools/native-confirm.js [contentDir] (default content/, with native-confirmations.tsv
// and NATIVE_LIST.md in it). Prints `confirmed=<n> corrected=<n> replaced=<n> unmatched=<n>`, then
// `UNMATCHED <id>: <reason>` and `UNTOUCHED <file> <path>` lines, and exits 0: unmatched and
// untouched entries are handled by hand, not failures. Exit 1 only when a file cannot be read or
// written, 2 on a bad argument.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRowOf, jsonText } from './apply-review.js';
import { latestJudging, readJson, reviewFilesFor, slFingerprint } from './review-guard.js';

/** @typedef {import('../app/js/content/types.js').Item} Item */
/** @typedef {import('../app/js/content/types.js').Lesson} Lesson */
/** @typedef {import('../app/js/content/types.js').Rule} Rule */
/**
 * @typedef {object} ConfirmResult
 * @property {number} confirmed
 * @property {number} corrected
 * @property {number} replaced strings changed by the corrections, the corrected items' own `sl` aside
 * @property {{ id: string, reason: string }[]} unmatched the lines left in the tsv, in its order
 * @property {string[]} untouched `<file> <path>` of each occurrence of a corrected text that was not replaced
 */
/** @template T @typedef {{ file: string, doc: T, dirty: boolean }} Loaded */

const DEFAULT_CONTENT_DIR = fileURLToPath(new URL('../content/', import.meta.url));
const USAGE = 'Usage: node tools/native-confirm.js [contentDir]';
const TSV_HEADER = 'id\tverdict\tcorrection';
const NOT_LESSON_ITEMS = ['drill:', 'audio:'];

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
/** @param {unknown} err */
const errorMessage = (err) => (err instanceof Error ? err.message : String(err));
/** @param {string} s */
const withoutFinalMark = (s) => s.trim().replace(/[.!?]$/, '');
/** @param {string} s */
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** @param {string} dialogueId @param {number} i */
const lineKey = (dialogueId, i) => `${dialogueId}-${String(i + 1).padStart(2, '0')}`;

/**
 * The replacement for one match: `text` with its first letter upper-cased when the match's first
 * letter is upper case, lower-cased otherwise.
 * @param {string} text @param {string} match
 */
function cased(text, match) {
  const [first = ''] = [...match];
  const [head = ''] = [...text];
  const upper = first !== first.toLowerCase();
  return (upper ? head.toUpperCase() : head.toLowerCase()) + text.slice(head.length);
}

/**
 * Every *.json file of a content folder, parsed, in name order.
 * @template T
 * @param {string} contentDir @param {string} folder
 * @returns {Promise<Loaded<T>[]>}
 */
async function readFolder(contentDir, folder) {
  const names = (await readdir(path.join(contentDir, folder))).filter((name) => name.endsWith('.json') && !name.startsWith('.')).sort();
  const loaded = [];
  for (const name of names) loaded.push({ file: `${folder}/${name}`, doc: await readJson(path.join(contentDir, folder, name)), dirty: false });
  return loaded;
}

/**
 * Applies native-confirmations.tsv; see the header.
 * @param {{ contentDir: string, tsvPath: string, nativeListPath: string }} options
 * @returns {Promise<ConfirmResult>}
 */
export async function nativeConfirm({ contentDir, tsvPath, nativeListPath }) {
  const tsvText = await readFile(tsvPath, 'utf8');
  const listText = await readFile(nativeListPath, 'utf8');
  /** @type {Loaded<Lesson>[]} */
  const lessons = await readFolder(contentDir, 'lessons');
  /** @type {Loaded<Rule>[]} */
  const rules = await readFolder(contentDir, 'rules');
  /** @type {Map<string, { item: Item, lesson: Loaded<Lesson> }>} */
  const items = new Map();
  for (const lesson of lessons) for (const item of lesson.doc.items ?? []) items.set(item.id, { item, lesson });

  /** @type {ConfirmResult} */
  const result = { confirmed: 0, corrected: 0, replaced: 0, unmatched: [], untouched: [] };
  /** @type {Set<string>} */
  const untouched = new Set();
  /** The entries whose Slovenian changed, by lesson id and key, for the fingerprint refresh. @type {Map<string, Map<string, unknown>>} */
  const changed = new Map();
  /** @param {string} lessonId @param {string} key @param {unknown} entry */
  const record = (lessonId, key, entry) => {
    const entries = changed.get(lessonId) ?? new Map();
    entries.set(key, entry);
    changed.set(lessonId, entries);
  };
  /** A lesson entry changed: the lesson file is written and the entry's fingerprint refreshed. @param {Loaded<Lesson>} lesson @param {string} key @param {unknown} entry */
  const touch = (lesson, key, entry) => {
    lesson.dirty = true;
    record(lesson.doc.id, key, entry);
  };

  /**
   * Sets the item's native verdict and status; for a correction, replaces its text across the corpus.
   * @param {Item} item @param {Loaded<Lesson>} owner @param {'confirmed'|'corrected'} verdict @param {string} correction
   */
  const apply = (item, owner, verdict, correction) => {
    item.verification = { ...item.verification, native: verdict, status: 'accepted' };
    if (verdict === 'confirmed') {
      owner.dirty = true;
      return;
    }
    const old = withoutFinalMark(item.sl);
    const replacement = withoutFinalMark(correction);
    item.sl = correction;
    touch(owner, item.id, item);
    if (old === '') return;
    const whole = `(?<![\\p{L}\\p{N}])${escapeRegExp(old)}(?![\\p{L}\\p{N}])`;
    const found = new RegExp(whole, 'iu');
    const every = new RegExp(whole, 'giu');
    /** Replaces in one string field; true when it changed. @param {any} holder @param {string|number} field */
    const swap = (holder, field) => {
      const before = holder[field];
      if (typeof before !== 'string') return false;
      const after = before.replace(every, (match) => cased(replacement, match));
      if (after === before) return false;
      holder[field] = after;
      result.replaced += 1;
      return true;
    };
    /** Reports a field holding the old text that is left as it is. @param {string} file @param {string} at @param {unknown} text */
    const leave = (file, at, text) => {
      if (typeof text === 'string' && found.test(text)) untouched.add(`${file} ${at}`);
    };

    for (const lesson of lessons) {
      const { file, doc } = lesson;
      for (const other of doc.items ?? []) {
        let changedHere = false;
        for (const example of other.examples ?? []) if (swap(example, 'sl')) changedHere = true;
        if (changedHere) touch(lesson, other.id, other);
        if (other !== item) leave(file, `items/${other.id}/sl`, other.sl);
        leave(file, `items/${other.id}/sl_colloquial`, other.sl_colloquial);
        for (const [label, form] of Object.entries(other.forms ?? {})) leave(file, `items/${other.id}/forms/${label}`, form);
        (other.accept ?? []).forEach((variant, i) => leave(file, `items/${other.id}/accept/${i}`, variant));
      }
      for (const exercise of doc.structured ?? []) {
        leave(file, `structured/${exercise.id}/prompt_sl`, exercise.prompt_sl);
        (exercise.options ?? []).forEach((option, i) => leave(file, `structured/${exercise.id}/options/${i}`, option));
        leave(file, `structured/${exercise.id}/answer`, exercise.answer);
      }
      for (const exercise of doc.production ?? []) {
        let changedHere = swap(exercise, 'answer');
        if (Array.isArray(exercise.accept)) exercise.accept.forEach((_, i) => { if (swap(exercise.accept, i)) changedHere = true; });
        if (changedHere) touch(lesson, exercise.id, exercise);
        leave(file, `production/${exercise.id}/filler`, exercise.filler);
      }
      if (doc.dialogue) {
        const { id, lines } = doc.dialogue;
        lines.forEach((line, i) => { if (swap(line, 'sl')) touch(lesson, lineKey(id, i), line); });
      }
    }

    for (const rule of rules) {
      const { file, doc } = rule;
      let changedHere = isObject(doc.example) && swap(doc.example, 'sl');
      for (const toggle of doc.toggles ?? []) {
        for (const example of Object.values(toggle.examples ?? {})) if (isObject(example) && swap(example, 'sl')) changedHere = true;
      }
      if (changedHere) {
        rule.dirty = true;
        for (const lesson of lessons) if ((lesson.doc.rules ?? []).includes(doc.id)) record(lesson.doc.id, doc.id, doc);
      }
      for (const [key, tableCell] of Object.entries(doc.table?.cells ?? {})) {
        leave(file, `table/cells/${key}/form`, tableCell.form);
        leave(file, `table/cells/${key}/pronoun`, tableCell.pronoun);
      }
      if (doc.quick_check) {
        leave(file, 'quick_check/prompt_sl', doc.quick_check.prompt_sl);
        (doc.quick_check.options ?? []).forEach((option, i) => leave(file, `quick_check/options/${i}`, option));
        leave(file, 'quick_check/answer', doc.quick_check.answer);
      }
    }
  };

  /** @type {string[]} */
  const kept = [];
  /** @type {string[]} */
  const done = [];
  let first = true;
  for (const line of tsvText.replace(/^﻿/, '').split(/\r\n|\r|\n/)) {
    if (line.trim() === '') continue;
    const [id = '', verdictField = '', correctionField = ''] = line.split('\t').map((field) => field.trim());
    const header = first && id.toLowerCase() === 'id';
    first = false;
    if (header) continue;
    const verdict = verdictField.toLowerCase();
    const correction = correctionField.normalize('NFC');
    const found = items.get(id);
    const reason = NOT_LESSON_ITEMS.some((prefix) => id.startsWith(prefix)) ? 'not a lesson item'
      : !found ? 'no such item'
      : verdict !== 'confirmed' && verdict !== 'corrected' ? 'verdict must be confirmed or corrected'
      : verdict === 'corrected' && correction === '' ? 'a correction needs the corrected Slovenian'
      : null;
    if (reason !== null || !found) {
      result.unmatched.push({ id, reason: reason ?? 'no such item' });
      kept.push(line);
      continue;
    }
    apply(found.item, found.lesson, verdict === 'confirmed' ? 'confirmed' : 'corrected', correction);
    result[verdict === 'confirmed' ? 'confirmed' : 'corrected'] += 1;
    done.push(id);
  }
  result.untouched = [...untouched];

  // Refresh the recorded fingerprint of every changed entry in the latest round that judged it.
  /** @type {Set<{ path: string, doc: import('./review-guard.js').ReviewDoc }>} */
  const reviews = new Set();
  for (const [lessonId, entries] of changed) {
    const files = await reviewFilesFor(contentDir, lessonId);
    for (const [key, entry] of entries) {
      const round = latestJudging(files, items.has(key) ? 'items' : 'lines', key);
      if (!round || !isObject(round.doc.applied) || !Object.hasOwn(round.doc.applied, key)) continue;
      round.doc.applied[key] = slFingerprint(entry);
      reviews.add(round);
    }
  }

  for (const loaded of [...lessons, ...rules]) if (loaded.dirty) await writeFile(path.join(contentDir, loaded.file), jsonText(loaded.doc));
  for (const review of reviews) await writeFile(review.path, jsonText(review.doc));
  const list = listText.split('\n').filter((line) => !done.some((id) => isRowOf(line, id))).join('\n');
  if (list !== listText) await writeFile(nativeListPath, list);
  await writeFile(tsvPath, [TSV_HEADER, ...kept].join('\n') + '\n');
  return result;
}

/** @param {string[]} argv @returns {Promise<number>} the exit code */
async function main(argv) {
  /** @type {string|null} */
  let contentDir = null;
  for (const arg of argv) {
    if (arg.startsWith('-') || contentDir !== null) {
      console.error(`Unexpected argument ${arg}\n${USAGE}`);
      return 2;
    }
    contentDir = arg;
  }
  const dir = contentDir ?? DEFAULT_CONTENT_DIR;
  let result;
  try {
    result = await nativeConfirm({ contentDir: dir, tsvPath: path.join(dir, 'native-confirmations.tsv'), nativeListPath: path.join(dir, 'NATIVE_LIST.md') });
  } catch (err) {
    console.error(`ERROR ${errorMessage(err)}`);
    return 1;
  }
  console.log(`confirmed=${result.confirmed} corrected=${result.corrected} replaced=${result.replaced} unmatched=${result.unmatched.length}`);
  for (const { id, reason } of result.unmatched) console.log(`UNMATCHED ${id}: ${reason}`);
  for (const where of result.untouched) console.log(`UNTOUCHED ${where}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
