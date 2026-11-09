// Review guard: accepted Slovenian text must be the text its two reviewers saw. When
// tools/apply-review.js applies a review it records, per judged entry, a fingerprint of the
// entry's Slovenian (slFingerprint); the guard recomputes the fingerprints and reports every
// accepted item, and every line of a lesson that ships an accepted item, whose review is missing,
// not an acceptance by both halves, or recorded for other text.
//
// Library: SL_KEYS, slFingerprint(entry), entriesOf(lesson, rules), reviewFilesFor(contentDir,
// lessonId), reviewGuard({ contentDir }), and the course readers the other review tools share,
// readCourse(contentDir) and readRules(contentDir).
// CLI: node tools/review-guard.js [contentDir]; prints `GUARD <lesson> <key>: <message>` per
// issue and `<n> issues`, exit 1 when there is any, 2 on a bad argument.
// No dependencies: node:crypto, node:fs, node:path and node:url.
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @typedef {import('../app/js/content/types.js').Lesson} Lesson */
/** @typedef {import('../app/js/content/types.js').Rule} Rule */
/** @typedef {import('../app/js/content/types.js').Unit} Unit */
/** @typedef {'accepted'|'doubtful'|'rejected'} Verdict */
/** @typedef {{ verdict: Verdict, reason: string, fix?: string|null, source?: string|null }} VerdictEntry */
/**
 * One review half: the verdicts of one blind reviewer on a lesson, item ids under `items`, every
 * other key of entriesOf under `lines`.
 * @typedef {{ reviewer: 'review1'|'review2', lookups?: number, items: Record<string, VerdictEntry>, lines: Record<string, VerdictEntry> }} ReviewHalf
 */
/**
 * A review file: round 1 at reviews/<lesson>.review.json, round N at reviews/<lesson>.rN.review.json.
 * `applied` maps every key the applied round judged to its slFingerprint at the time.
 * @typedef {{ lesson: string, reviews: ReviewHalf[], applied?: Record<string, string> }} ReviewDoc
 */
/** @typedef {{ lesson: string, key: string, message: string }} GuardIssue */

const DEFAULT_CONTENT_DIR = fileURLToPath(new URL('../content/', import.meta.url));
const USAGE = 'Usage: node tools/review-guard.js [contentDir]';
const FINGERPRINT_LENGTH = 16;

/** The keys whose strings are Slovenian text: every string reached through one of them is fingerprinted. */
export const SL_KEYS = ['sl', 'sl_colloquial', 'forms', 'accept', 'prompt_sl', 'options', 'answer', 'filler', 'form', 'pronoun'];

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
/** @param {string} a @param {string} b */
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/** @param {unknown} err */
const errorMessage = (err) => (err instanceof Error ? err.message : String(err));

/**
 * The fingerprint of an entry's Slovenian text: the first 16 hex characters of the SHA-256 over
 * the JSON of the sorted `[path, value]` pairs of every string reached through a key in SL_KEYS,
 * paths joining keys and array indexes with `/` (`examples/0/sl`, `forms/acc`). English, helpers,
 * ids, verification and key order never change it.
 * @param {unknown} entry
 * @returns {string}
 */
export function slFingerprint(entry) {
  /** @type {[string, string][]} */
  const pairs = [];
  /** @param {unknown} value @param {string} at @param {boolean} slovenian */
  const visit = (value, at, slovenian) => {
    if (typeof value === 'string') {
      if (slovenian) pairs.push([at, value]);
    } else if (Array.isArray(value)) {
      value.forEach((x, i) => visit(x, at === '' ? String(i) : `${at}/${i}`, slovenian));
    } else if (isObject(value)) {
      for (const [key, x] of Object.entries(value)) visit(x, at === '' ? key : `${at}/${key}`, slovenian || SL_KEYS.includes(key));
    }
  };
  visit(entry, '', false);
  pairs.sort((a, b) => byCodeUnit(a[0], b[0]));
  return createHash('sha256').update(JSON.stringify(pairs)).digest('hex').slice(0, FINGERPRINT_LENGTH);
}

/**
 * A lesson's reviewable entries by key, in this order: every item id, every structured id, every
 * production id, every dialogue line as `<dialogue id>-NN` (1-based, two digits) and every rule
 * id the lesson lists in `rules`. Item ids are a review's "items", every other key its "lines".
 * @param {Lesson} lesson
 * @param {Map<string, Rule>} rules every rule of the corpus by id
 * @returns {Map<string, unknown>}
 */
export function entriesOf(lesson, rules) {
  /** @type {Map<string, unknown>} */
  const entries = new Map();
  for (const item of lesson.items) entries.set(item.id, item);
  for (const exercise of lesson.structured) entries.set(exercise.id, exercise);
  for (const exercise of lesson.production) entries.set(exercise.id, exercise);
  if (lesson.dialogue) {
    const { id, lines } = lesson.dialogue;
    lines.forEach((line, i) => entries.set(`${id}-${String(i + 1).padStart(2, '0')}`, line));
  }
  for (const id of lesson.rules) {
    const rule = rules.get(id);
    if (!rule) throw new Error(`lesson ${lesson.id} lists the unknown rule "${id}"`);
    entries.set(id, rule);
  }
  return entries;
}

/**
 * The round a review file name holds for a lesson: 1 for `<lesson>.review.json`, N for
 * `<lesson>.rN.review.json` with N of 2 or more, null for any other name.
 * @param {string} name @param {string} lessonId
 * @returns {number|null}
 */
export function reviewRound(name, lessonId) {
  if (name === `${lessonId}.review.json`) return 1;
  const prefix = `${lessonId}.r`;
  const suffix = '.review.json';
  if (!name.startsWith(prefix) || !name.endsWith(suffix)) return null;
  const digits = name.slice(prefix.length, -suffix.length);
  return /^[1-9]\d*$/.test(digits) && Number(digits) >= 2 ? Number(digits) : null;
}

/**
 * Parses a JSON file, naming the file when it cannot.
 * @param {string} file
 * @returns {Promise<any>}
 */
export async function readJson(file) {
  const text = await readFile(file, 'utf8');
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${file}: ${errorMessage(err)}`);
  }
}

/**
 * The review files of a lesson under `<contentDir>/reviews/`, ascending by round; none when the
 * folder does not exist.
 * @param {string} contentDir @param {string} lessonId
 * @returns {Promise<{ round: number, path: string, doc: ReviewDoc }[]>}
 */
export async function reviewFilesFor(contentDir, lessonId) {
  const dir = path.join(contentDir, 'reviews');
  let names;
  try {
    names = await readdir(dir);
  } catch (err) {
    if (isObject(err) && err.code === 'ENOENT') return [];
    throw err;
  }
  const files = [];
  for (const name of names) {
    const round = reviewRound(name, lessonId);
    if (round === null) continue;
    const file = path.join(dir, name);
    files.push({ round, path: file, doc: /** @type {ReviewDoc} */ (await readJson(file)) });
  }
  return files.sort((a, b) => a.round - b.round);
}

/**
 * Every rule card under `<contentDir>/rules/`, by id.
 * @param {string} contentDir
 * @returns {Promise<Map<string, Rule>>}
 */
export async function readRules(contentDir) {
  const dir = path.join(contentDir, 'rules');
  const names = (await readdir(dir)).filter((name) => name.endsWith('.json') && !name.startsWith('.')).sort(byCodeUnit);
  /** @type {Map<string, Rule>} */
  const rules = new Map();
  for (const name of names) {
    const rule = await readJson(path.join(dir, name));
    rules.set(rule.id, rule);
  }
  return rules;
}

/**
 * The course in order: units by `order`, each unit's lessons as units.json lists them, and every
 * rule card by id.
 * @param {string} contentDir
 * @returns {Promise<{ lessons: { id: string, unit: string, file: string, doc: Lesson }[], rules: Map<string, Rule> }>}
 */
export async function readCourse(contentDir) {
  /** @type {Unit[]} */
  const units = await readJson(path.join(contentDir, 'units.json'));
  const lessons = [];
  for (const unit of [...units].sort((a, b) => a.order - b.order)) {
    for (const id of unit.lessons) {
      const file = `lessons/${id}.json`;
      lessons.push({ id, unit: unit.id, file, doc: /** @type {Lesson} */ (await readJson(path.join(contentDir, file))) });
    }
  }
  return { lessons, rules: await readRules(contentDir) };
}

/**
 * The half of a review document by its reviewer, if there is one.
 * @param {ReviewDoc} doc @param {'review1'|'review2'} reviewer
 */
const halfOf = (doc, reviewer) => (Array.isArray(doc.reviews) ? doc.reviews.find((half) => isObject(half) && half.reviewer === reviewer) : undefined);

/**
 * Whether a review document judges `key` in the given section of either half.
 * @param {ReviewDoc} doc @param {'items'|'lines'} section @param {string} key
 */
function judges(doc, section, key) {
  return ['review1', 'review2'].some((reviewer) => {
    const record = halfOf(doc, /** @type {'review1'|'review2'} */ (reviewer))?.[section];
    return isObject(record) && Object.hasOwn(record, key);
  });
}

/**
 * The latest round that judged `key`, or undefined when no round did.
 * @template {{ doc: ReviewDoc }} F
 * @param {F[]} files ascending by round, as reviewFilesFor returns them
 * @param {'items'|'lines'} section @param {string} key
 * @returns {F|undefined}
 */
export function latestJudging(files, section, key) {
  return files.findLast((file) => judges(file.doc, section, key));
}

/** @param {ReviewDoc} doc @param {string} key */
const bothAccept = (doc, key) => ['review1', 'review2'].every((reviewer) => halfOf(doc, /** @type {'review1'|'review2'} */ (reviewer))?.lines?.[key]?.verdict === 'accepted');

/**
 * Reports, in course order and then entriesOf order: every item with status `accepted` and no
 * native verdict whose latest judging round recorded no fingerprint for it, or one for other
 * text; and, in a lesson with at least one accepted item, every line whose latest judging round
 * is missing, not an acceptance by both halves, or recorded for other text.
 * @param {{ contentDir: string }} options
 * @returns {Promise<GuardIssue[]>}
 */
export async function reviewGuard({ contentDir }) {
  const { lessons, rules } = await readCourse(contentDir);
  /** @type {GuardIssue[]} */
  const issues = [];
  for (const { id: lesson, doc } of lessons) {
    const files = await reviewFilesFor(contentDir, lesson);
    const itemIds = new Set(doc.items.map((item) => item.id));
    const shipsAccepted = doc.items.some((item) => item.verification?.status === 'accepted');
    for (const [key, entry] of entriesOf(doc, rules)) {
      /** @param {string} message */
      const report = (message) => issues.push({ lesson, key, message });
      if (itemIds.has(key)) {
        const verification = /** @type {import('../app/js/content/types.js').Item} */ (entry).verification;
        if (verification?.status !== 'accepted' || verification.native) continue;
        const recorded = latestJudging(files, 'items', key)?.doc.applied?.[key];
        if (recorded === undefined) report('accepted without a recorded review');
        else if (recorded !== slFingerprint(entry)) report('accepted, but its Slovenian text changed after the review');
      } else if (shipsAccepted) {
        const round = latestJudging(files, 'lines', key);
        if (round && !bothAccept(round.doc, key)) report('not accepted by both reviews');
        else if (round?.doc.applied?.[key] !== slFingerprint(entry)) report('not reviewed in its current form');
      }
    }
  }
  return issues;
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
  let issues;
  try {
    issues = await reviewGuard({ contentDir: contentDir ?? DEFAULT_CONTENT_DIR });
  } catch (err) {
    console.error(`ERROR ${errorMessage(err)}`);
    return 1;
  }
  for (const issue of issues) console.log(`GUARD ${issue.lesson} ${issue.key}: ${issue.message}`);
  console.log(`${issues.length} ${issues.length === 1 ? 'issue' : 'issues'}`);
  return issues.length > 0 ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
