// Applies one review round to a lesson: the two blind halves in reviews/<lesson>.review.json
// (round 1) or reviews/<lesson>.rN.review.json (round N) are merged into each judged item's
// verification record by statusFor, every pending item a review doubted gets a row on
// NATIVE_LIST.md under its unit, and every key both halves judged gets its slFingerprint in the
// review file's `applied`, which the review guard checks. Lines the two halves do not both accept
// come back as flagged for a rewrite. From round 2 on a rejection is stored as a doubt, so the
// item waits for a native speaker instead of a third rewrite.
//
// The whole review is validated before anything is written, and applying the same round again
// changes no file.
//
// Library: applyReview({ lessonPath, reviewPath, nativeListPath }).
// CLI: node tools/apply-review.js <lessonPath> [--round <n>]; the content folder is the lesson
// file's grandparent. Prints `<lesson> round <n>: accepted=<a> pending=<p> rejected=<r>
// flagged=<f>` and one `FLAGGED <key>` line per flagged key; exit 1 with `ERROR <message>` on a
// refusal, 2 on a bad argument.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { statusFor } from './lint-content.js';
import { entriesOf, readRules, reviewRound, slFingerprint } from './review-guard.js';

/** @typedef {import('../app/js/content/types.js').Item} Item */
/** @typedef {import('../app/js/content/types.js').Lesson} Lesson */
/** @typedef {import('./review-guard.js').ReviewDoc} ReviewDoc */
/** @typedef {import('./review-guard.js').ReviewHalf} ReviewHalf */
/** @typedef {import('./review-guard.js').VerdictEntry} VerdictEntry */
/** @typedef {import('./review-guard.js').Verdict} Verdict */
/** @typedef {{ accepted: number, pending: number, rejected: number, flagged: string[] }} ApplyResult */

const USAGE = 'Usage: node tools/apply-review.js <lessonPath> [--round <n>]';
const VERDICTS = ['accepted', 'doubtful', 'rejected'];
const REVIEWERS = /** @type {const} */ (['review1', 'review2']);
const SECTIONS = /** @type {const} */ (['items', 'lines']);
/** The table every unit section of NATIVE_LIST.md starts with. */
const LIST_HEADER = '| id | sl | en | doubt | proposed fix |';
const LIST_RULE = '|---|---|---|---|---|';
/** Sections of NATIVE_LIST.md that come after every unit section. */
const AFTER_UNITS = new Set(['## Audio', '## Drill words']);

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
/** @param {unknown} v */
const quote = (v) => JSON.stringify(v);
/** @param {unknown} err */
const errorMessage = (err) => (err instanceof Error ? err.message : String(err));
/** JSON as the content files are written: two-space indentation and a final newline. @param {unknown} doc */
export const jsonText = (doc) => JSON.stringify(doc, null, 2) + '\n';
/** A fix counts as given when it is a non-empty string. @param {unknown} fix */
const given = (fix) => (typeof fix === 'string' && fix.trim() !== '' ? fix.trim() : null);
/** One table cell: a single line, with `|` escaped. @param {string} text */
const cell = (text) => text.replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|');

/**
 * Whether a line of NATIVE_LIST.md is the row of `id`.
 * @param {string} line @param {string} id
 */
export const isRowOf = (line, id) => line.startsWith(`| ${id} |`);

/**
 * Checks one half's verdicts against the lesson's keys.
 * @param {ReviewHalf} half @param {Map<string, unknown>} entries @param {Set<string>} itemIds
 */
function validateHalf(half, entries, itemIds) {
  for (const section of SECTIONS) {
    const record = half[section] ?? {};
    if (!isObject(record)) throw new Error(`${half.reviewer} ${section} is not an object`);
    for (const [key, entry] of Object.entries(record)) {
      if (!entries.has(key)) throw new Error(`unknown key ${quote(key)}`);
      if (itemIds.has(key) !== (section === 'items')) throw new Error(`${quote(key)} belongs under ${itemIds.has(key) ? 'items' : 'lines'}, not ${section}`);
      if (!isObject(entry) || typeof entry.verdict !== 'string' || !VERDICTS.includes(entry.verdict)) {
        throw new Error(`${half.reviewer} gives ${quote(key)} the verdict ${quote(isObject(entry) ? entry.verdict : entry)}; a verdict is accepted, doubtful or rejected`);
      }
      if (typeof entry.reason !== 'string') throw new Error(`${half.reviewer} gives ${quote(key)} no reason`);
      for (const field of ['fix', 'source']) {
        if (entry[field] !== undefined && entry[field] !== null && typeof entry[field] !== 'string') {
          throw new Error(`${half.reviewer} gives ${quote(key)} a ${field} that is not text`);
        }
      }
    }
  }
}

/**
 * Adds rows to the `## Unit <unit>` table of NATIVE_LIST.md, creating the section, heading and
 * table header, in unit order before `## Audio` and `## Drill words` when it is missing.
 * @param {string} text @param {string} unit two digits @param {string[]} rows
 * @returns {string}
 */
function addRows(text, unit, rows) {
  if (rows.length === 0) return text;
  const lines = text.replace(/\n$/, '').split('\n');
  const heading = `## Unit ${unit}`;
  const start = lines.indexOf(heading);
  if (start === -1) {
    const section = [heading, '', LIST_HEADER, LIST_RULE, ...rows];
    const later = lines.findIndex((line) => {
      if (AFTER_UNITS.has(line)) return true;
      const match = /^## Unit (\d+)$/.exec(line);
      return match !== null && Number(match[1]) > Number(unit);
    });
    if (later === -1) {
      while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
      lines.push('', ...section);
    } else {
      lines.splice(later, 0, ...section, '');
    }
  } else {
    let end = lines.findIndex((line, i) => i > start && line.startsWith('## '));
    if (end === -1) end = lines.length;
    let last = start;
    for (let i = start + 1; i < end; i += 1) if (lines[i].startsWith('|')) last = i;
    if (last === start) lines.splice(start + 1, 0, '', LIST_HEADER, LIST_RULE, ...rows);
    else lines.splice(last + 1, 0, ...rows);
  }
  return lines.join('\n') + '\n';
}

/**
 * Applies a review file to its lesson; see the header. Throws, before writing anything, on a
 * `lesson` field that is not the lesson's id, halves other than one review1 and one review2, a
 * key entriesOf does not name, a key judged by one half only, a verdict outside the scale, or a
 * review file of a later round for the lesson.
 * @param {{ lessonPath: string, reviewPath: string, nativeListPath: string }} options
 * @returns {Promise<ApplyResult>} counts over the items this file judges, and the flagged line keys in entriesOf order
 */
export async function applyReview({ lessonPath, reviewPath, nativeListPath }) {
  const lessonText = await readFile(lessonPath, 'utf8');
  /** @type {Lesson} */
  const lesson = JSON.parse(lessonText);
  const reviewText = await readFile(reviewPath, 'utf8');
  /** @type {ReviewDoc} */
  const review = JSON.parse(reviewText);
  const listText = await readFile(nativeListPath, 'utf8');
  const entries = entriesOf(lesson, await readRules(path.dirname(path.dirname(lessonPath))));
  const itemIds = new Set(lesson.items.map((item) => item.id));

  const round = reviewRound(path.basename(reviewPath), lesson.id);
  if (round === null) throw new Error(`${path.basename(reviewPath)} is not a review file of ${lesson.id}; expected ${lesson.id}.review.json or ${lesson.id}.r<n>.review.json`);
  if (review.lesson !== lesson.id) throw new Error(`the review is for lesson ${quote(review.lesson)}, not ${quote(lesson.id)}`);
  const halves = Array.isArray(review.reviews) ? review.reviews : [];
  const byReviewer = REVIEWERS.map((reviewer) => halves.filter((half) => isObject(half) && half.reviewer === reviewer));
  if (halves.length !== 2 || byReviewer.some((found) => found.length !== 1)) {
    throw new Error('a review needs exactly two halves, one by review1 and one by review2');
  }
  const [first, second] = byReviewer.map((found) => found[0]);
  validateHalf(first, entries, itemIds);
  validateHalf(second, entries, itemIds);
  for (const section of SECTIONS) {
    const one = first[section] ?? {};
    const two = second[section] ?? {};
    for (const key of Object.keys(one)) if (!Object.hasOwn(two, key)) throw new Error(`${quote(key)} is judged by review1 only`);
    for (const key of Object.keys(two)) if (!Object.hasOwn(one, key)) throw new Error(`${quote(key)} is judged by review2 only`);
  }
  const rounds = (await readdir(path.dirname(reviewPath))).map((name) => reviewRound(name, lesson.id) ?? 0);
  const latest = Math.max(round, ...rounds);
  if (latest > round) throw new Error(`round ${latest} exists for ${lesson.id}; apply rounds in order`);

  /** @type {ApplyResult} */
  const result = { accepted: 0, pending: 0, rejected: 0, flagged: [] };
  /** @type {string[]} */
  const rows = [];
  /** @type {Record<string, string>} */
  const applied = { ...(isObject(review.applied) ? review.applied : {}) };
  for (const [key, entry] of entries) {
    const section = itemIds.has(key) ? 'items' : 'lines';
    const verdicts = [first[section]?.[key], second[section]?.[key]];
    if (!verdicts[0] || !verdicts[1]) continue;
    applied[key] = slFingerprint(entry);
    if (section === 'lines') {
      if (verdicts.some((v) => v?.verdict !== 'accepted')) result.flagged.push(key);
      continue;
    }
    /** @type {Record<'review1'|'review2', Verdict>} */
    const stored = { review1: 'accepted', review2: 'accepted' };
    /** @type {string[]} */
    const notes = [];
    /** @type {string[]} */
    const fixes = [];
    REVIEWERS.forEach((reviewer, i) => {
      const verdict = /** @type {VerdictEntry} */ (verdicts[i]);
      const fix = given(verdict.fix);
      const withFix = fix ? ` Fix: ${fix}` : '';
      if (verdict.verdict === 'rejected' && round >= 2) {
        stored[reviewer] = 'doubtful';
        notes.push(`${reviewer} rejected in round ${round}: ${verdict.reason}${withFix}`);
      } else {
        stored[reviewer] = verdict.verdict;
        if (verdict.verdict !== 'accepted') notes.push(`${reviewer} ${verdict.verdict}: ${verdict.reason}${withFix}`);
      }
      if (verdict.verdict !== 'accepted' && fix) fixes.push(fix);
    });
    const item = /** @type {Item} */ (entry);
    const native = item.verification?.native ?? null;
    const status = statusFor({ review1: stored.review1, review2: stored.review2, native });
    item.verification = { review1: stored.review1, review2: stored.review2, native, status, ...(notes.length > 0 ? { notes: notes.join('; ') } : {}) };
    result[status] += 1;
    const doubted = stored.review1 === 'doubtful' || stored.review2 === 'doubtful';
    if (status === 'pending' && doubted && !listText.split('\n').some((line) => isRowOf(line, key)) && !rows.some((row) => isRowOf(row, key))) {
      rows.push(`| ${key} | ${cell(item.sl)} | ${cell(item.en)} | ${cell(notes.join('; '))} | ${cell(fixes.join('; '))} |`);
    }
  }

  const writes = [
    { file: lessonPath, before: lessonText, after: jsonText(lesson) },
    { file: reviewPath, before: reviewText, after: jsonText({ ...review, applied }) },
    { file: nativeListPath, before: listText, after: addRows(listText, lesson.unit.slice(1), rows) },
  ];
  for (const { file, before, after } of writes) if (after !== before) await writeFile(file, after);
  return result;
}

/** @param {string[]} argv @returns {Promise<number>} the exit code */
async function main(argv) {
  /** @type {string|null} */
  let lessonPath = null;
  let round = 1;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--round' && /^[1-9]\d*$/.test(argv[i + 1] ?? '')) {
      round = Number(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('-') || lessonPath !== null) {
      console.error(`Unexpected argument ${arg}\n${USAGE}`);
      return 2;
    } else lessonPath = arg;
  }
  if (lessonPath === null) {
    console.error(USAGE);
    return 2;
  }
  const lessonFile = path.resolve(lessonPath);
  const contentDir = path.dirname(path.dirname(lessonFile));
  const lessonId = path.basename(lessonFile, '.json');
  const reviewName = round === 1 ? `${lessonId}.review.json` : `${lessonId}.r${round}.review.json`;
  try {
    const result = await applyReview({
      lessonPath: lessonFile,
      reviewPath: path.join(contentDir, 'reviews', reviewName),
      nativeListPath: path.join(contentDir, 'NATIVE_LIST.md'),
    });
    console.log(`${lessonId} round ${round}: accepted=${result.accepted} pending=${result.pending} rejected=${result.rejected} flagged=${result.flagged.length}`);
    for (const key of result.flagged) console.log(`FLAGGED ${key}`);
    return 0;
  } catch (err) {
    console.error(`ERROR ${errorMessage(err)}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
