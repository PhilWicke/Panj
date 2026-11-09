// Content bundle compiler: compiles units.json, lessons/*.json and rules/*.json
// under content/ into app/content/dist/ (index.json and units/uNN.json) and
// writes app/version.js, the module the service worker names its cache after,
// and app/precache.json, the list of shell files the worker installs (Task 19).
// With an app folder the version covers the shell as well as the content (every
// file precache.json lists but version.js and the content, plus the worker), so
// a deploy that changes only code installs a new worker too; without one, as in
// --check and the library tests, it covers the content files alone.
//
// The linter runs first and any error stops the build, with one exception: in a
// strict build (no --allow-pending) the linter's pending-practised and
// pending-filler findings are exactly the practice references the compiler
// strips, so they are reported as stripped rather than treated as errors. Items
// that are not accepted stay in the lesson's `items` with their status (the
// session builder never schedules them) but leave `production`, the dialogue's
// `new_items` and every slot's `fillers`, and a production whose `filler` is
// such an item goes too; a lesson without a single accepted item is left out of
// the bundle. Fillers resolve across the whole corpus, as the linter resolves
// them. A dev build keeps everything.
//
// Library: buildContent({ contentDir, outDir, allowPending, versionFile, appDir }).
// CLI: node tools/build-content.js [--allow-pending] [--check] [--known-check] [contentDir];
// exit 1 on lint errors, 2 on a bad argument. --check builds into a temporary
// folder, removes it and prints the summary only (no version.js, no precache.json,
// so its version is the content's). --known-check then prints the known-word shares
// (tools/known-words.js) and exits 1 when a lesson misses one. No dependencies:
// node:crypto, node:fs, node:os, node:path and node:url, plus the app's sha256Hex
// and wordTokens (the tokeniser lemmasMet shares with the progress counters).
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { knownReport, knownShares } from './known-words.js';
import { lintContent, resolveFiller } from './lint-content.js';
import { sha256Hex } from '../app/js/util/hash.js';
import { wordTokens } from '../app/js/util/tokens.js';

/** @typedef {import('./lint-content.js').LintIssue} LintIssue */
/** @typedef {import('../app/js/content/types.js').Item} Item */
/** @typedef {import('../app/js/content/types.js').Lesson} Lesson */
/** @typedef {import('../app/js/content/types.js').Rule} Rule */
/** @typedef {import('../app/js/content/types.js').Unit} Unit */
/** @typedef {import('../app/js/content/types.js').Index} Index */
/** @typedef {import('../app/js/content/types.js').UnitContent} UnitContent */

/**
 * @typedef {object} BuildResult
 * @property {string} version 12 hex characters: with an app folder, of the SHA-256 over the content hash and the shell digest (see buildVersion); without one, of the content hash alone. index.json, version.js and precache.json carry it
 * @property {'dev'|'strict'} mode
 * @property {number} units
 * @property {number} lessons lessons in the index; a strict build leaves out lessons without an accepted item
 * @property {number} scheduledItems
 * @property {number} lemmasMet
 * @property {LintIssue[]} warnings the linter's warnings, for the caller to print
 * @property {LintIssue[]} stripped the practice references a strict build removed (the linter's pending-practised and pending-filler findings); empty in a dev build
 * @property {string[]} omittedLessons ids of the lessons a strict build left out because none of their items is accepted
 */

const DEFAULT_CONTENT_DIR = fileURLToPath(new URL('../content/', import.meta.url));
const DEFAULT_OUT_DIR = fileURLToPath(new URL('../app/content/dist/', import.meta.url));
const DEFAULT_VERSION_FILE = fileURLToPath(new URL('../app/version.js', import.meta.url));
const DEFAULT_APP_DIR = fileURLToPath(new URL('../app/', import.meta.url));
const USAGE = 'Usage: node tools/build-content.js [--allow-pending] [--check] [--known-check] [contentDir]';
/** The lint rules whose findings a strict build strips instead of refusing. */
const STRIPPED_RULES = new Set(['pending-practised', 'pending-filler']);
const VERSION_LENGTH = 12;
const UNIT_FILE = /^u\d{2}\.json$/;
/** The shell files precache.json names one by one, in this order after `./`; each must exist. */
const SHELL_FILES = ['index.html', 'manifest.webmanifest', 'version.js'];
/** The folders under app/ whose every file precache.json lists, in this order. */
const SHELL_FOLDERS = ['css', 'js', 'assets/fonts', 'assets/icons'];
/** Single assets precache.json lists after the folders. */
const SHELL_ASSETS = ['assets/icon.svg', 'assets/audio/manifest.json'];
/** The worker itself is never precached, wherever it sits. */
const NOT_PRECACHED = new Set(['sw.js']);
/** Shell entries whose bytes the version leaves out: the start URL is index.html again, and version.js carries the version itself. */
const NOT_HASHED = new Set(['./', 'version.js']);
/** Deployed files the version covers although precache.json does not list them: the worker, which the browser fetches under its own URL. */
const HASHED_UNLISTED = ['sw.js'];

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
 * Reads the content files in a fixed order and hashes them: SHA-256 over
 * `<path>\n<contents>` of every file, sorted by path (`hash`, 64 hex characters,
 * which buildVersion shortens or combines with the shell). The linter has passed
 * by the time this runs, so every file parses.
 * @param {string} dir
 * @returns {Promise<{ hash: string, units: Unit[], lessons: Lesson[], rules: Rule[] }>}
 */
async function readCorpus(dir) {
  const files = ['units.json', ...(await listJson(dir, 'lessons')), ...(await listJson(dir, 'rules'))].sort();
  const texts = [];
  for (const file of files) texts.push({ file, text: await readFile(path.join(dir, file), 'utf8') });
  const hash = await sha256Hex(texts.map(({ file, text }) => `${file}\n${text}`).join('\n'));
  const parsed = texts.map(({ file, text }) => ({ file, doc: JSON.parse(text) }));
  const inFolder = (/** @type {string} */ folder) => parsed.filter(({ file }) => file.startsWith(`${folder}/`)).map(({ doc }) => doc);
  const units = parsed.find(({ file }) => file === 'units.json');
  if (!units) throw new Error(`units.json is missing in ${dir}`);
  return { hash, units: units.doc, lessons: inFolder('lessons'), rules: inFolder('rules') };
}

/**
 * The lesson as the bundle carries it: without the editor's `$schema` and the
 * internal verification notes, with the practice sets limited to the items that
 * `scheduled` accepts, and with the word tokens `lemmasMet` counts for it.
 * Production `item` and dialogue `new_items` keep only scheduled items of this
 * lesson. Slot fillers and production fillers resolve through `context`, built
 * once over the whole corpus, so a filler in another lesson is judged as the
 * linter judges it: a filler id outside `scheduledIds` leaves its slot, and a
 * production whose `filler` resolves (resolveFiller) to such an item is removed.
 * `removed` counts one per removed filler id, per production removed for its
 * item and per production removed for its filler (twice when both apply), as
 * the linter's pending-practised and pending-filler findings count them.
 * @param {Lesson & { $schema?: string }} doc
 * @param {(item: Item) => boolean} scheduled
 * @param {{ scheduledIds: Set<string>, itemsById: Map<string, Item> }} context
 * @returns {{ lesson: Lesson, itemCount: number, removed: number, tokens: string[] }}
 */
function compileLesson(doc, scheduled, { scheduledIds, itemsById }) {
  const { $schema, ...lesson } = doc;
  let removed = 0;
  const items = lesson.items.map(({ verification: { notes, ...verification }, ...item }) => {
    if (!item.slots) return { ...item, verification };
    const slots = item.slots.map((slot) => {
      const fillers = slot.fillers.filter((id) => scheduledIds.has(id));
      removed += slot.fillers.length - fillers.length;
      return { ...slot, fillers };
    });
    return { ...item, slots, verification };
  });
  const ids = new Set(items.filter(scheduled).map((item) => item.id));
  const production = lesson.production.filter((exercise) => {
    let pending = ids.has(exercise.item) ? 0 : 1;
    if (exercise.filler !== undefined) {
      const filler = resolveFiller(exercise.filler, itemsById.get(exercise.item), (id) => itemsById.get(id));
      if (filler !== null && !scheduledIds.has(filler)) pending += 1;
    }
    removed += pending;
    return pending === 0;
  });
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
 * Every file under `dir`, recursively, as sorted paths relative to `dir` with forward slashes;
 * hidden files are left out.
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function filesUnder(dir) {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
    .sort();
}

/**
 * The shell entries precache.json lists before the content files, relative to the app folder,
 * in order: the start URL `./`, index.html, the web manifest, version.js, every file under css/
 * and js/ (never sw.js), every font and icon, the app icon and the audio manifest.
 * @param {string} appDir
 * @returns {Promise<string[]>}
 */
async function shellList(appDir) {
  const files = ['./', ...SHELL_FILES];
  for (const folder of SHELL_FOLDERS) {
    for (const file of await filesUnder(path.join(appDir, folder))) {
      if (!NOT_PRECACHED.has(path.basename(file))) files.push(`${folder}/${file}`);
    }
  }
  files.push(...SHELL_ASSETS);
  return files;
}

/**
 * SHA-256 over the bytes of the shell: `<path>\n<bytes>\n` for every entry of the shell list but
 * the start URL and version.js, plus the worker, sorted by path. The content files stay out (the
 * content hash covers them, and index.json carries the build time), and so do version.js and
 * precache.json, which carry the result. A file missing from the app folder fails the build by
 * name.
 * @param {string} appDir
 * @param {string[]} shell the shell list
 * @returns {Promise<string>} 64 lowercase hex characters
 */
async function shellDigest(appDir, shell) {
  const files = [...shell.filter((file) => !NOT_HASHED.has(file)), ...HASHED_UNLISTED].sort();
  const digest = createHash('sha256');
  for (const file of files) {
    const bytes = await readFile(path.join(appDir, file)).catch(() => null);
    if (!bytes) throw new Error(`the version covers ${file}, which is missing in ${appDir}`);
    digest.update(`${file}\n`).update(bytes).update('\n');
  }
  return digest.digest('hex');
}

/**
 * The version: the first 12 hex characters of the content hash when the build has no shell, else
 * of the SHA-256 over `<content hash>\n<shell digest>`, so a change to a script, a style, an
 * asset or the worker is a new version (a new cache name and worker URL) as much as a content
 * change is.
 * @param {string} contentHash readCorpus's hash
 * @param {string|null} shell the shell digest, or null without an app folder
 * @returns {Promise<string>}
 */
async function buildVersion(contentHash, shell) {
  const full = shell === null ? contentHash : await sha256Hex(`${contentHash}\n${shell}`);
  return full.slice(0, VERSION_LENGTH);
}

/**
 * Writes `<appDir>/precache.json`, the shell the service worker installs for this version
 * (Task 19): `{ version, files }` with paths relative to the app folder: the shell list, then the
 * content index and every unit file this build wrote. precache.json itself is not listed. A
 * listed file missing from the app folder fails the build, since the worker's install would fail
 * on it later.
 * @param {string} appDir the app folder, with content/dist/ and version.js already written
 * @param {string} version
 * @param {string[]} shell the shell list
 * @param {string[]} unitIds the unit files written, `uNN`
 */
async function writePrecache(appDir, version, shell, unitIds) {
  const files = [...shell, 'content/dist/index.json', ...unitIds.map((id) => `content/dist/units/${id}.json`)];
  for (const file of files) {
    const info = await stat(path.join(appDir, file === './' ? 'index.html' : file)).catch(() => null);
    if (!info?.isFile()) throw new Error(`precache.json needs ${file}, which is missing in ${appDir}`);
  }
  await writeJson(path.join(appDir, 'precache.json'), { version, files });
}

/**
 * Compiles the content directory into `outDir` (index.json and units/uNN.json)
 * and, when `versionFile` is given, writes the version module there; when
 * `appDir` is given, its shell enters the version and its precache.json is
 * written too (outDir is then its content/dist/ and versionFile its version.js).
 * Rejects when the linter finds errors; see the header for what a strict build
 * strips.
 * @param {{ contentDir: string, outDir: string, allowPending?: boolean, versionFile?: string|null, appDir?: string|null }} options
 * @returns {Promise<BuildResult>}
 */
export async function buildContent({ contentDir, outDir, allowPending = false, versionFile = null, appDir = null }) {
  if (typeof contentDir !== 'string' || contentDir === '') throw new Error('buildContent needs a contentDir');
  if (typeof outDir !== 'string' || outDir === '') throw new Error('buildContent needs an outDir');
  const mode = allowPending ? 'dev' : 'strict';

  const lint = await lintContent({ contentDir, allowPending });
  const stripped = lint.errors.filter((issue) => STRIPPED_RULES.has(issue.rule));
  const blocking = lint.errors.filter((issue) => !STRIPPED_RULES.has(issue.rule));
  if (blocking.length > 0) {
    const lines = blocking.map((issue) => `  ${issue.file} ${issue.path || '-'} ${issue.rule}: ${issue.message}`);
    throw new Error(`lint found ${count(blocking.length, 'error')} in ${contentDir}, nothing was built:\n${lines.join('\n')}`);
  }

  const corpus = await readCorpus(contentDir);
  const shell = appDir ? await shellList(appDir) : null;
  const version = await buildVersion(corpus.hash, appDir && shell ? await shellDigest(appDir, shell) : null);
  const scheduled = allowPending ? () => true : (/** @type {Item} */ item) => item.verification.status === 'accepted';
  const lessonsById = new Map(corpus.lessons.map((lesson) => [lesson.id, lesson]));
  // Every item of every lesson, and the ids the build schedules, for fillers that live in another lesson.
  const itemsById = new Map(corpus.lessons.flatMap((lesson) => lesson.items.map((item) => [item.id, item])));
  const context = { itemsById, scheduledIds: new Set([...itemsById.values()].filter(scheduled).map((item) => item.id)) };

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
      const { lesson, itemCount, removed: removedHere, tokens } = compileLesson(source, scheduled, context);
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
    version,
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
    await writeFile(versionFile, versionModule(version));
  }
  if (appDir && shell) await writePrecache(appDir, version, shell, unitFiles.map((unitFile) => unitFile.unit.id));

  return {
    version,
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
  let knownCheck = false;
  /** @type {string|null} */
  let contentDir = null;
  for (const arg of argv) {
    if (arg === '--allow-pending') allowPending = true;
    else if (arg === '--check') check = true;
    else if (arg === '--known-check') knownCheck = true;
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
      result = await buildContent({ contentDir: dir, outDir: DEFAULT_OUT_DIR, allowPending, versionFile: DEFAULT_VERSION_FILE, appDir: DEFAULT_APP_DIR });
    }
  } catch (err) {
    console.error(`ERROR ${errorMessage(err)}`);
    return 1;
  }
  for (const issue of result.warnings) console.error(`WARNING ${issue.file} ${issue.path || '-'} ${issue.rule}: ${issue.message}`);
  for (const issue of result.stripped) console.error(`STRIPPED ${issue.file} ${issue.path}: ${issue.message}`);
  for (const id of result.omittedLessons) console.error(`OMITTED lessons/${id}.json: no item is accepted, so the strict build leaves the lesson out`);
  console.log(summary(result));
  if (!check) console.log(`wrote ${rel(DEFAULT_OUT_DIR)}, ${rel(DEFAULT_VERSION_FILE)} and ${rel(path.join(DEFAULT_APP_DIR, 'precache.json'))}`);
  if (!knownCheck) return 0;
  let known;
  try {
    known = knownReport(await knownShares({ contentDir: dir }));
  } catch (err) {
    console.error(`ERROR ${errorMessage(err)}`);
    return 1;
  }
  for (const line of known.lines) console.log(line);
  for (const line of known.errors) console.error(line);
  return known.errors.length > 0 ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
