// Content bundle compiler: compiles units.json, lessons/*.json and rules/*.json
// under content/ into app/content/dist/ (index.json and units/uNN.json) and
// writes app/version.js, the module the service worker names its cache after.
//
// The linter runs first and any error stops the build, with one exception: in a
// strict build (no --allow-pending) the linter's pending-practised findings are
// exactly the practice references the compiler strips, so they are reported as
// stripped rather than treated as errors. Items that are not accepted stay in
// the lesson's `items` with their status (the session builder never schedules
// them) but leave `production` and the dialogue's `new_items`; a lesson without
// a single accepted item is left out of the bundle. A dev build keeps everything.
//
// Library: buildContent({ contentDir, outDir, allowPending, versionFile }).
// CLI: node tools/build-content.js [--allow-pending] [--check] [contentDir];
// exit 1 on lint errors, 2 on a bad argument. --check builds into a temporary
// folder, removes it and prints the summary only.
// No dependencies: node:fs, node:os, node:path and node:url, plus the app's sha256Hex.
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintContent } from './lint-content.js';
import { sha256Hex } from '../app/js/util/hash.js';

/** @typedef {import('./lint-content.js').LintIssue} LintIssue */
/** @typedef {import('../app/js/content/types.js').Item} Item */
/** @typedef {import('../app/js/content/types.js').Lesson} Lesson */
/** @typedef {import('../app/js/content/types.js').Rule} Rule */
/** @typedef {import('../app/js/content/types.js').Unit} Unit */
/** @typedef {import('../app/js/content/types.js').Index} Index */
/** @typedef {import('../app/js/content/types.js').UnitContent} UnitContent */

/**
 * @typedef {object} BuildResult
 * @property {string} version the first 12 hex characters of the SHA-256 over the content files
 * @property {'dev'|'strict'} mode
 * @property {number} units
 * @property {number} lessons lessons in the index; a strict build leaves out lessons without an accepted item
 * @property {number} scheduledItems
 * @property {number} lemmasMet
 * @property {LintIssue[]} warnings the linter's warnings, for the caller to print
 * @property {LintIssue[]} stripped the practice references a strict build removed (the linter's pending-practised findings); empty in a dev build
 * @property {string[]} omittedLessons ids of the lessons a strict build left out because none of their items is accepted
 */

const DEFAULT_CONTENT_DIR = fileURLToPath(new URL('../content/', import.meta.url));
const DEFAULT_OUT_DIR = fileURLToPath(new URL('../app/content/dist/', import.meta.url));
const DEFAULT_VERSION_FILE = fileURLToPath(new URL('../app/version.js', import.meta.url));
const USAGE = 'Usage: node tools/build-content.js [--allow-pending] [--check] [contentDir]';
const VERSION_LENGTH = 12;
const UNIT_FILE = /^u\d{2}\.json$/;

/**
 * Lowercase word tokens: runs of letters and digits, everything else separates.
 * `lemmasMet` counts the distinct tokens of the scheduled items' `sl`, their
 * examples and the dialogue lines; a progress counter that wants to be measured
 * against it tokenises the same way.
 * @param {string} text
 * @returns {string[]}
 */
export const wordTokens = (text) => text.normalize('NFC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** @param {unknown} err */
const errorMessage = (err) => (err instanceof Error ? err.message : String(err));
/** @param {number} n @param {string} noun */
const count = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;
/** @param {string} file @param {unknown} doc */
const writeJson = (file, doc) => writeFile(file, JSON.stringify(doc, null, 2) + '\n');
/** The ES module app/version.js: the service worker imports the export, anything else may read the global. @param {string} version */
const versionModule = (version) => `export const SLOVELINGO_VERSION = ${JSON.stringify(version)};\nglobalThis.SLOVELINGO_VERSION = SLOVELINGO_VERSION;\n`;

/** The *.json files of one folder of the content directory, as paths relative to it. @param {string} dir @param {string} folder */
async function listJson(dir, folder) {
  const entries = await readdir(path.join(dir, folder), { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.json') && !e.name.startsWith('.'))
    .map((e) => `${folder}/${e.name}`);
}

/**
 * Reads the content files in a fixed order and derives the version from them:
 * SHA-256 over `<path>\n<contents>` of every file, sorted by path. The linter
 * has passed by the time this runs, so every file parses.
 * @param {string} dir
 * @returns {Promise<{ version: string, units: Unit[], lessons: Lesson[], rules: Rule[] }>}
 */
async function readCorpus(dir) {
  const files = ['units.json', ...(await listJson(dir, 'lessons')), ...(await listJson(dir, 'rules'))].sort();
  const texts = [];
  for (const file of files) texts.push({ file, text: await readFile(path.join(dir, file), 'utf8') });
  const version = (await sha256Hex(texts.map(({ file, text }) => `${file}\n${text}`).join('\n'))).slice(0, VERSION_LENGTH);
  const parsed = texts.map(({ file, text }) => ({ file, doc: JSON.parse(text) }));
  const inFolder = (/** @type {string} */ folder) => parsed.filter(({ file }) => file.startsWith(`${folder}/`)).map(({ doc }) => doc);
  const units = parsed.find(({ file }) => file === 'units.json');
  if (!units) throw new Error(`units.json is missing in ${dir}`);
  return { version, units: units.doc, lessons: inFolder('lessons'), rules: inFolder('rules') };
}

/**
 * The lesson as the bundle carries it: without the editor's `$schema` and the
 * internal verification notes, with the practice sets limited to the items that
 * `scheduled` accepts, and with the word tokens `lemmasMet` counts for it.
 * @param {Lesson & { $schema?: string }} doc
 * @param {(item: Item) => boolean} scheduled
 * @returns {{ lesson: Lesson, itemCount: number, removed: number, tokens: string[] }}
 */
function compileLesson(doc, scheduled) {
  const { $schema, ...lesson } = doc;
  const items = lesson.items.map(({ verification: { notes, ...verification }, ...item }) => ({ ...item, verification }));
  const ids = new Set(items.filter(scheduled).map((item) => item.id));
  const production = lesson.production.filter((exercise) => ids.has(exercise.item));
  let removed = lesson.production.length - production.length;
  const dialogue = lesson.dialogue && {
    ...lesson.dialogue,
    lines: lesson.dialogue.lines.map((line) => {
      if (!line.new_items) return line;
      const kept = line.new_items.filter((id) => ids.has(id));
      removed += line.new_items.length - kept.length;
      return { ...line, new_items: kept };
    }),
  };
  const tokens = [];
  for (const item of items) {
    if (!ids.has(item.id)) continue;
    tokens.push(...wordTokens(item.sl));
    for (const example of item.examples) tokens.push(...wordTokens(example.sl));
  }
  if (dialogue) for (const line of dialogue.lines) tokens.push(...wordTokens(line.sl));
  const compiled = { ...lesson, items, production };
  if (dialogue) compiled.dialogue = dialogue;
  return { lesson: compiled, itemCount: ids.size, removed, tokens };
}

/**
 * Compiles the content directory into `outDir` (index.json and units/uNN.json)
 * and, when `versionFile` is given, writes the version module there. Rejects
 * when the linter finds errors; see the header for what a strict build strips.
 * @param {{ contentDir: string, outDir: string, allowPending?: boolean, versionFile?: string|null }} options
 * @returns {Promise<BuildResult>}
 */
export async function buildContent({ contentDir, outDir, allowPending = false, versionFile = null }) {
  if (typeof contentDir !== 'string' || contentDir === '') throw new Error('buildContent needs a contentDir');
  if (typeof outDir !== 'string' || outDir === '') throw new Error('buildContent needs an outDir');
  const mode = allowPending ? 'dev' : 'strict';

  const lint = await lintContent({ contentDir, allowPending });
  const stripped = lint.errors.filter((issue) => issue.rule === 'pending-practised');
  const blocking = lint.errors.filter((issue) => issue.rule !== 'pending-practised');
  if (blocking.length > 0) {
    const lines = blocking.map((issue) => `  ${issue.file} ${issue.path || '-'} ${issue.rule}: ${issue.message}`);
    throw new Error(`lint found ${count(blocking.length, 'error')} in ${contentDir}, nothing was built:\n${lines.join('\n')}`);
  }

  const corpus = await readCorpus(contentDir);
  const scheduled = allowPending ? () => true : (/** @type {Item} */ item) => item.verification.status === 'accepted';
  const lessonsById = new Map(corpus.lessons.map((lesson) => [lesson.id, lesson]));

  /** @type {Unit[]} */
  const units = [];
  /** @type {UnitContent[]} */
  const unitFiles = [];
  /** @type {Index['lessonIndex']} */
  const lessonIndex = [];
  /** @type {string[]} */
  const omittedLessons = [];
  const lemmas = new Set();
  let scheduledItems = 0;
  let removed = 0;
  for (const unit of corpus.units) {
    /** @type {Lesson[]} */
    const lessons = [];
    for (const id of unit.lessons) {
      const source = lessonsById.get(id);
      if (!source) throw new Error(`unit ${unit.id} lists the unknown lesson ${id}`);
      const { lesson, itemCount, removed: removedHere, tokens } = compileLesson(source, scheduled);
      removed += removedHere;
      if (!allowPending && itemCount === 0) {
        omittedLessons.push(id);
        continue;
      }
      lessons.push(lesson);
      lessonIndex.push({ id, unit: unit.id, order: lesson.order, title_sl: lesson.title_sl, title_en: lesson.title_en, itemCount });
      scheduledItems += itemCount;
      for (const token of tokens) lemmas.add(token);
    }
    const bundled = { ...unit, lessons: lessons.map((lesson) => lesson.id) };
    units.push(bundled);
    unitFiles.push({ unit: bundled, lessons });
  }
  // The linter and the compiler must agree on what a strict build practises; a
  // difference means one of them changed its rule without the other.
  if (removed !== stripped.length) {
    throw new Error(`compiler and linter disagree on the pending references in ${contentDir}: ${removed} stripped, ${stripped.length} reported by lint`);
  }

  /** @type {Index} */
  const index = {
    version: corpus.version,
    mode,
    generated: new Date().toISOString(),
    units,
    rules: corpus.rules.map(({ $schema, ...rule }) => rule),
    lessonIndex,
    counts: { scheduledItems, lemmasMet: lemmas.size },
  };

  const unitsDir = path.join(outDir, 'units');
  await mkdir(unitsDir, { recursive: true });
  for (const unitFile of unitFiles) await writeJson(path.join(unitsDir, `${unitFile.unit.id}.json`), unitFile);
  const current = new Set(unitFiles.map((unitFile) => `${unitFile.unit.id}.json`));
  for (const name of await readdir(unitsDir)) {
    if (UNIT_FILE.test(name) && !current.has(name)) await rm(path.join(unitsDir, name));
  }
  await writeJson(path.join(outDir, 'index.json'), index);
  if (versionFile) {
    await mkdir(path.dirname(versionFile), { recursive: true });
    await writeFile(versionFile, versionModule(corpus.version));
  }

  return {
    version: corpus.version,
    mode,
    units: units.length,
    lessons: lessonIndex.length,
    scheduledItems,
    lemmasMet: lemmas.size,
    warnings: lint.warnings,
    stripped,
    omittedLessons,
  };
}

/** @param {BuildResult} r */
const summary = (r) => `units=${r.units} lessons=${r.lessons} scheduledItems=${r.scheduledItems} lemmasMet=${r.lemmasMet} version=${r.version} mode=${r.mode}`;
/** @param {string} p */
const rel = (p) => path.relative(process.cwd(), p) || '.';

/** @param {string[]} argv @returns {Promise<number>} the exit code */
async function main(argv) {
  let allowPending = false;
  let check = false;
  /** @type {string|null} */
  let contentDir = null;
  for (const arg of argv) {
    if (arg === '--allow-pending') allowPending = true;
    else if (arg === '--check') check = true;
    else if (arg.startsWith('-') || contentDir !== null) {
      console.error(`Unexpected argument ${arg}\n${USAGE}`);
      return 2;
    } else contentDir = arg;
  }
  const dir = contentDir ?? DEFAULT_CONTENT_DIR;
  let result;
  try {
    if (check) {
      const scratch = await mkdtemp(path.join(tmpdir(), 'slovelingo-build-'));
      try {
        result = await buildContent({ contentDir: dir, outDir: scratch, allowPending });
      } finally {
        await rm(scratch, { recursive: true, force: true });
      }
    } else {
      result = await buildContent({ contentDir: dir, outDir: DEFAULT_OUT_DIR, allowPending, versionFile: DEFAULT_VERSION_FILE });
    }
  } catch (err) {
    console.error(`ERROR ${errorMessage(err)}`);
    return 1;
  }
  for (const issue of result.warnings) console.error(`WARNING ${issue.file} ${issue.path || '-'} ${issue.rule}: ${issue.message}`);
  for (const issue of result.stripped) console.error(`STRIPPED ${issue.file} ${issue.path}: ${issue.message}`);
  for (const id of result.omittedLessons) console.error(`OMITTED lessons/${id}.json: no item is accepted, so the strict build leaves the lesson out`);
  console.log(summary(result));
  if (!check) console.log(`wrote ${rel(DEFAULT_OUT_DIR)} and ${rel(DEFAULT_VERSION_FILE)}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
