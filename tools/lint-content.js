// Content linter: checks the JSON under content/ against the shapes in
// app/js/content/types.js and the content rules of the plan.
// Library: lintContent({ contentDir, allowPending }).
// CLI: node tools/lint-content.js [--allow-pending] [contentDir]; exit 1 on any error.
// No dependencies: node:fs, node:path and node:url only.
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULE_ID } from '../app/js/util/ids.js';

/**
 * One finding. `file` is relative to the content directory. `path` locates the
 * value inside the file with `/` between segments; array elements that carry an
 * `id` are addressed by it, other elements by index; the empty path means the
 * whole file. `rule` is one of the lint rule names below.
 * @typedef {{ file: string, path: string, rule: string, message: string }} LintIssue
 */

/** @typedef {(at: string, message: string) => void} Report */
/** @typedef {(value: unknown, at: string, report: Report) => void} Check */
/** @typedef {{ check: Check, required: boolean }} Field */
/** @typedef {Record<string, unknown>} Doc */

const DEFAULT_CONTENT_DIR = fileURLToPath(new URL('../content/', import.meta.url));
const COGNATES_FILE = fileURLToPath(new URL('./fixtures/cognates.txt', import.meta.url));
const USAGE = 'Usage: node tools/lint-content.js [--allow-pending] [contentDir]';

// Rules that produce warnings; every other rule produces errors.
const WARNING_RULES = new Set(['helper-missing']);

const UNIT_ID = /^u\d{2}$/;
const LESSON_ID = /^u\d{2}-l\d{2}$/;
const ITEM_ID = /^u\d{2}-l\d{2}-i\d{2}$/;
const STRUCTURED_ID = /^u\d{2}-l\d{2}-s\d{2}$/;
const PRODUCTION_ID = /^u\d{2}-l\d{2}-p\d{2}$/;
const DIALOGUE_ID = /^u\d{2}-l\d{2}-d$/;

// Anything outside the Slovenian alphabet (no q, w, x, y), digits, space and the punctuation .,;:!?'"()-
const NOT_SLOVENIAN = /[^abcčdefghijklmnoprsštuvzžABCČDEFGHIJKLMNOPRSŠTUVZŽ0-9 .,;:!?'"()-]/gu;
// The blank marker contract for prompt_sl (structured exercises and quick checks),
// shared by the content authors, the bundle compiler and the structured
// exercise's blankify: the blank is one run of one or more underscores, exactly
// one per prompt, and it may attach to a stem ("Midva ___ lačna.", "Pijem kav_").
// The underscore is allowed nowhere else in Slovenian text.
const BLANK = /_+/g;
const NOT_SLOVENIAN_PROMPT = /[^abcčdefghijklmnoprsštuvzžABCČDEFGHIJKLMNOPRSŠTUVZŽ0-9 .,;:!?'"()_-]/gu;

const PERSONAL_PHRASES = ['girlfriend', 'boyfriend', 'my partner', 'her parents', 'his parents'];
// English copy the learner sees. Verification notes are internal and not checked.
const PERSONAL_FIELDS = new Set(['en', 'title_en', 'setting_en', 'card_en', 'explain_en', 'note_en', 'helper', 'helper_en', 'helper_de', 'label']);
const CARD_WORD_LIMIT = 40;

const REVIEW_VERDICTS = ['accepted', 'doubtful', 'rejected'];
const NATIVE_VERDICTS = ['confirmed', 'corrected'];
const STATUSES = ['accepted', 'pending', 'rejected'];
const REGISTERS = ['neutral', 'colloquial', 'formal', 'recognition'];
const ITEM_TYPES = ['chunk', 'word', 'form'];
const GENDERS = ['m', 'f', 'n'];

// ---------------------------------------------------------------------------
// Small helpers

/** @param {unknown} v @returns {v is Doc} */
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
/** @param {unknown} v */
const quote = (v) => JSON.stringify(v);
/** @param {string} at @param {string|number} key */
const sub = (at, key) => (at === '' ? String(key) : `${at}/${key}`);
/** Array elements with a string id are addressed by it, the others by index. @param {unknown} x @param {number} i */
const elementKey = (x, i) => (isObject(x) && typeof x.id === 'string' && x.id !== '' ? x.id : String(i));
/** @param {string} a @param {string} b */
const compare = (a, b) => a.localeCompare(b, 'en', { numeric: true });
/** @param {unknown} err */
const errorCode = (err) => (isObject(err) && typeof err.code === 'string' ? err.code : '');
/** @param {unknown} err */
const errorMessage = (err) => (err instanceof Error ? err.message : String(err));

/**
 * Calls `fn` for every element of `list` that is an object, with its path.
 * @param {unknown} list @param {string} base @param {(element: Doc, at: string) => void} fn
 */
function eachObject(list, base, fn) {
  if (!Array.isArray(list)) return;
  list.forEach((x, i) => {
    if (isObject(x)) fn(x, sub(base, elementKey(x, i)));
  });
}

/**
 * Visits every value of a parsed JSON document with its path and its own key.
 * @param {unknown} value @param {string} at @param {string} key
 * @param {(value: unknown, at: string, key: string) => void} visit
 */
function walk(value, at, key, visit) {
  visit(value, at, key);
  if (Array.isArray(value)) value.forEach((x, i) => walk(x, sub(at, elementKey(x, i)), '', visit));
  else if (isObject(value)) for (const [k, x] of Object.entries(value)) walk(x, sub(at, k), k, visit);
}

/** Lowercase, single spaces, no trailing sentence punctuation: "Dober dan." and "dober dan" are the same headword. @param {string} s */
const normalizeSl = (s) => s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '').trim();
/** Lowercase words separated by single spaces, for whole-word containment. @param {string} s */
const wordsOf = (s) => normalizeSl(s).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** The first four letters without diacritics, for the cognate heuristic. @param {string} s */
const firstLetters = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 4);

// ---------------------------------------------------------------------------
// Shape checks (lint rule schema), written against the typedefs by hand

/** @type {Check} */
const text = (v, at, report) => {
  if (typeof v !== 'string' || v.trim() === '') report(at, 'expected a non-empty string');
};
/** @type {Check} */
const anyString = (v, at, report) => {
  if (typeof v !== 'string') report(at, 'expected a string');
};
/** @type {Check} */
const positiveInteger = (v, at, report) => {
  if (!Number.isInteger(v) || /** @type {number} */ (v) < 1) report(at, 'expected a whole number of 1 or more');
};
/** @param {readonly string[]} values @returns {Check} */
const oneOf = (values) => (v, at, report) => {
  if (typeof v !== 'string' || !values.includes(v)) report(at, `expected one of ${values.map(quote).join(', ')}`);
};
/** @param {string} description @param {RegExp} pattern @returns {Check} */
const idLike = (description, pattern) => (v, at, report) => {
  if (typeof v !== 'string' || !pattern.test(v)) report(at, `expected ${description}`);
};
/** @param {Check} check @returns {Check} */
const nullable = (check) => (v, at, report) => {
  if (v !== null) check(v, at, report);
};
/** @param {Check} check @param {{ min?: number }} [options] @returns {Check} */
const arrayOf = (check, { min = 0 } = {}) => (v, at, report) => {
  if (!Array.isArray(v)) return report(at, 'expected an array');
  if (v.length < min) report(at, `expected at least ${min} ${min === 1 ? 'entry' : 'entries'}`);
  v.forEach((x, i) => check(x, sub(at, elementKey(x, i)), report));
};
/** @param {Check} check @returns {Check} */
const recordOf = (check) => (v, at, report) => {
  if (!isObject(v)) return report(at, 'expected an object');
  for (const [k, x] of Object.entries(v)) check(x, sub(at, k), report);
};
/** @param {Check} check @returns {Field} */
const req = (check) => ({ check, required: true });
/** @param {Check} check @returns {Field} */
const opt = (check) => ({ check, required: false });
/** An object with exactly these fields; unknown fields are errors. @param {Record<string, Field>} fields @returns {Check} */
const object = (fields) => (v, at, report) => {
  if (!isObject(v)) return report(at, 'expected an object');
  for (const [name, field] of Object.entries(fields)) {
    if (!Object.hasOwn(v, name)) {
      if (field.required) report(sub(at, name), 'missing required field');
      continue;
    }
    field.check(v[name], sub(at, name), report);
  }
  for (const name of Object.keys(v)) {
    if (!Object.hasOwn(fields, name)) report(sub(at, name), `unknown field ${quote(name)}`);
  }
};

const unitId = idLike('a unit id like u01', UNIT_ID);
const lessonId = idLike('a lesson id like u01-l01', LESSON_ID);
const itemId = idLike('an item id like u01-l01-i01', ITEM_ID);
const ruleId = idLike('a rule id like r-biti-present', RULE_ID);

const example = object({ sl: req(text), en: req(text) });

const verification = object({
  review1: req(nullable(oneOf(REVIEW_VERDICTS))),
  review2: req(nullable(oneOf(REVIEW_VERDICTS))),
  native: req(nullable(oneOf(NATIVE_VERDICTS))),
  status: req(oneOf(STATUSES)),
  notes: opt(anyString),
});

const item = object({
  id: req(itemId),
  type: req(oneOf(ITEM_TYPES)),
  sl: req(text),
  sl_colloquial: opt(nullable(text)),
  en: req(text),
  register: req(oneOf(REGISTERS)),
  pos: opt(text),
  gender: opt(nullable(oneOf(GENDERS))),
  forms: opt(recordOf(text)),
  slots: opt(arrayOf(object({ label: req(text), fillers: req(arrayOf(itemId)) }))),
  examples: req(arrayOf(example)),
  helper: opt(nullable(text)),
  accept: opt(arrayOf(text)),
  rules: opt(arrayOf(ruleId)),
  freq_rank: opt(nullable(positiveInteger)),
  audio: opt(object({ sl: opt(text), examples: opt(arrayOf(text)) })),
  verification: req(verification),
});

const structuredExercise = object({
  id: req(idLike('a structured exercise id like u01-l01-s01', STRUCTURED_ID)),
  prompt_sl: req(text),
  options: req(arrayOf(text, { min: 2 })),
  answer: req(text),
  rule: req(ruleId),
  en: req(text),
});

const productionExercise = object({
  id: req(idLike('a production exercise id like u01-l01-p01', PRODUCTION_ID)),
  en: req(text),
  answer: req(text),
  accept: opt(arrayOf(text)),
  item: req(itemId),
  filler: opt(text),
});

const dialogueLine = object({
  speaker: req(text),
  sl: req(text),
  en: req(text),
  audio: opt(text),
  new_items: opt(arrayOf(itemId)),
});

const dialogue = object({
  id: req(idLike('a dialogue id like u01-l01-d', DIALOGUE_ID)),
  title_sl: req(text),
  title_en: req(text),
  setting_en: req(text),
  lines: req(arrayOf(dialogueLine, { min: 1 })),
});

const lessonShape = object({
  $schema: opt(text),
  id: req(lessonId),
  unit: req(unitId),
  order: req(positiveInteger),
  title_sl: req(text),
  title_en: req(text),
  items: req(arrayOf(item)),
  rules: req(arrayOf(ruleId)),
  structured: req(arrayOf(structuredExercise)),
  production: req(arrayOf(productionExercise)),
  dialogue: opt(dialogue),
});

const ruleCell = object({ form: req(text), pronoun: opt(text), note_en: opt(text) });

const ruleShape = object({
  $schema: opt(text),
  id: req(ruleId),
  unit: req(unitId),
  title_en: req(text),
  card_en: req(text),
  example: req(example),
  table: opt(object({ rows: req(arrayOf(text, { min: 1 })), cols: req(arrayOf(text, { min: 1 })), cells: req(recordOf(ruleCell)) })),
  toggles: opt(arrayOf(object({ label: req(text), options: req(arrayOf(text, { min: 2 })), examples: req(recordOf(example)) }))),
  quick_check: req(object({ prompt_sl: req(text), options: req(arrayOf(text, { min: 2 })), answer: req(text), explain_en: req(text) })),
  helper_de: opt(nullable(text)),
  helper_en: opt(nullable(text)),
});

const unitsShape = arrayOf(
  object({
    id: req(unitId),
    order: req(positiveInteger),
    title_sl: req(text),
    title_en: req(text),
    motif: req(text),
    lessons: req(arrayOf(lessonId)),
  }),
);

// ---------------------------------------------------------------------------
// Per-file checks beyond the plain shape

/** The file is named after its id. @param {Doc} doc @param {string} file @param {string} folder @param {RegExp} pattern @param {Report} report */
function checkFileName(doc, file, folder, pattern, report) {
  if (typeof doc.id === 'string' && pattern.test(doc.id) && file !== `${folder}/${doc.id}.json`) {
    report('id', `file should be named ${doc.id}.json`);
  }
}

/** `answer` is one of `options`, and the options differ. @param {Doc} exercise @param {string} at @param {Report} report */
function checkAnswer(exercise, at, report) {
  const { options, answer } = exercise;
  if (!Array.isArray(options)) return;
  if (new Set(options).size !== options.length) report(sub(at, 'options'), 'options repeat');
  if (typeof answer === 'string' && !options.includes(answer)) report(sub(at, 'answer'), 'answer is not one of the options');
}

/** Ids inside a lesson start with the lesson id; the lesson belongs to the unit in its id. @param {Doc} lesson @param {Report} report */
function checkLessonConsistency(lesson, report) {
  const id = typeof lesson.id === 'string' && LESSON_ID.test(lesson.id) ? lesson.id : null;
  if (id && typeof lesson.unit === 'string' && UNIT_ID.test(lesson.unit) && !id.startsWith(`${lesson.unit}-`)) {
    report('unit', `lesson ${id} belongs to unit ${id.slice(0, 3)}`);
  }
  /** @param {unknown} value @param {string} at */
  const scoped = (value, at) => {
    if (id && typeof value === 'string' && !value.startsWith(`${id}-`)) report(at, `id should start with ${id}-`);
  };
  eachObject(lesson.items, 'items', (x, at) => scoped(x.id, sub(at, 'id')));
  eachObject(lesson.structured, 'structured', (x, at) => {
    scoped(x.id, sub(at, 'id'));
    checkAnswer(x, at, report);
  });
  eachObject(lesson.production, 'production', (x, at) => scoped(x.id, sub(at, 'id')));
  if (isObject(lesson.dialogue)) scoped(lesson.dialogue.id, 'dialogue/id');
}

/** Quick check answer, table cell keys and toggle examples agree with their options. @param {Doc} rule @param {Report} report */
function checkRuleConsistency(rule, report) {
  if (isObject(rule.quick_check)) checkAnswer(rule.quick_check, 'quick_check', report);
  const table = rule.table;
  if (isObject(table) && Array.isArray(table.rows) && Array.isArray(table.cols) && isObject(table.cells)) {
    const keys = new Set();
    for (const row of table.rows) for (const col of table.cols) keys.add(`${row}.${col}`);
    for (const key of Object.keys(table.cells)) {
      if (!keys.has(key)) report(`table/cells/${key}`, 'cell key should be "<row>.<col>" with a row from rows and a col from cols');
    }
  }
  eachObject(rule.toggles, 'toggles', (toggle, at) => {
    const { options, examples } = toggle;
    if (!Array.isArray(options) || !isObject(examples)) return;
    for (const option of options) {
      if (typeof option === 'string' && !Object.hasOwn(examples, option)) report(sub(at, 'examples'), `missing the example for option ${quote(option)}`);
    }
    for (const key of Object.keys(examples)) {
      if (!options.includes(key)) report(`${at}/examples/${key}`, 'not one of the options');
    }
  });
}

/**
 * Lint rule alphabet: Slovenian text uses only the Slovenian alphabet, digits, spaces and .,;:!?'"()-
 * A prompt (`blank`) additionally carries exactly one blank marked by underscores, see BLANK.
 * @param {unknown} value @param {string} at @param {Report} report @param {boolean} [blank] the value is a prompt_sl
 */
function checkAlphabet(value, at, report, blank = false) {
  if (typeof value !== 'string') return;
  const found = new Set();
  for (const match of value.matchAll(blank ? NOT_SLOVENIAN_PROMPT : NOT_SLOVENIAN)) found.add(match[0]);
  if (found.size > 0) {
    const list = [...found]
      .map((ch) => `${quote(ch)} (U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')})`)
      .join(', ');
    report(at, `contains characters outside the Slovenian alphabet: ${list}`);
  }
  if (!blank) return;
  const blanks = value.match(BLANK)?.length ?? 0;
  if (blanks !== 1) {
    report(at, `expected exactly one blank marked by underscores, like "Midva ___ lačna." or "Pijem kav_", found ${blanks === 0 ? 'none' : blanks}`);
  }
}

/** @param {Doc} lesson @param {Report} report */
function checkLessonAlphabet(lesson, report) {
  checkAlphabet(lesson.title_sl, 'title_sl', report);
  eachObject(lesson.items, 'items', (x, at) => {
    checkAlphabet(x.sl, sub(at, 'sl'), report);
    checkAlphabet(x.sl_colloquial, sub(at, 'sl_colloquial'), report);
    eachObject(x.examples, sub(at, 'examples'), (ex, exAt) => checkAlphabet(ex.sl, sub(exAt, 'sl'), report));
  });
  eachObject(lesson.structured, 'structured', (x, at) => checkAlphabet(x.prompt_sl, sub(at, 'prompt_sl'), report, true));
  if (isObject(lesson.dialogue)) {
    checkAlphabet(lesson.dialogue.title_sl, 'dialogue/title_sl', report);
    eachObject(lesson.dialogue.lines, 'dialogue/lines', (line, at) => checkAlphabet(line.sl, sub(at, 'sl'), report));
  }
}

/** @param {Doc} rule @param {Report} report */
function checkRuleAlphabet(rule, report) {
  if (isObject(rule.example)) checkAlphabet(rule.example.sl, 'example/sl', report);
  eachObject(rule.toggles, 'toggles', (toggle, at) => {
    if (!isObject(toggle.examples)) return;
    for (const [key, ex] of Object.entries(toggle.examples)) {
      if (isObject(ex)) checkAlphabet(ex.sl, `${at}/examples/${key}/sl`, report);
    }
  });
  if (isObject(rule.quick_check)) checkAlphabet(rule.quick_check.prompt_sl, 'quick_check/prompt_sl', report, true);
}

/** Lint rule personal: English copy never names a relationship or the learner. @param {unknown} doc @param {Report} report */
function checkPersonal(doc, report) {
  walk(doc, '', '', (value, at, key) => {
    if (!PERSONAL_FIELDS.has(key) || typeof value !== 'string') return;
    const lower = value.toLowerCase();
    const found = PERSONAL_PHRASES.filter((phrase) => lower.includes(phrase));
    if (found.length > 0) report(at, `personal framing is not allowed: ${found.map(quote).join(', ')}`);
  });
}

/** Lint rule card-length: a rule card says one thing in at most 40 words. @param {Doc} rule @param {Report} report */
function checkCardLength(rule, report) {
  if (typeof rule.card_en !== 'string') return;
  const words = rule.card_en.trim().split(/\s+/).filter(Boolean).length;
  if (words > CARD_WORD_LIMIT) report('card_en', `has ${words} words, the limit is ${CARD_WORD_LIMIT}`);
}

// ---------------------------------------------------------------------------
// Corpus checks: duplicate, reference, pending-practised, register, helper-missing

/**
 * @param {{ units: unknown, lessons: { file: string, doc: unknown }[], rules: { file: string, doc: unknown }[] }} corpus
 * @param {boolean} allowPending
 * @param {{ sl: string, de: string }[]} cognates
 * @param {LintIssue[]} issues
 */
function checkCorpus(corpus, allowPending, cognates, issues) {
  /** @param {string} file @param {string} rule @param {string} at @param {string} message */
  const add = (file, rule, at, message) => {
    issues.push({ file, path: at, rule, message });
  };

  // Ids are unique across the corpus; rule ids and item ids share the scheduler's namespace.
  /** @type {Map<string, string>} */
  const seen = new Map();
  /** @param {unknown} id @param {string} file @param {string} at @returns {id is string} */
  const claim = (id, file, at) => {
    if (typeof id !== 'string' || id === '') return false;
    const previous = seen.get(id);
    if (previous) {
      add(file, 'schema', at, `id ${quote(id)} is already used in ${previous}`);
      return false;
    }
    seen.set(id, file);
    return true;
  };

  /** @type {Map<string, Doc>} */
  const units = new Map();
  const unitsLoaded = Array.isArray(corpus.units);
  eachObject(corpus.units, '', (unit, at) => {
    if (claim(unit.id, 'units.json', sub(at, 'id'))) units.set(unit.id, unit);
  });
  /** @type {Set<string>} */
  const ruleIds = new Set();
  for (const { file, doc } of corpus.rules) {
    if (isObject(doc) && claim(doc.id, file, 'id')) ruleIds.add(doc.id);
  }
  /** @type {Set<string>} */
  const lessonIds = new Set();
  /** @type {Map<string, { item: Doc, file: string }>} */
  const items = new Map();
  for (const { file, doc } of corpus.lessons) {
    if (!isObject(doc)) continue;
    if (claim(doc.id, file, 'id')) lessonIds.add(doc.id);
    eachObject(doc.items, 'items', (x, at) => {
      if (claim(x.id, file, sub(at, 'id'))) items.set(x.id, { item: x, file });
    });
    eachObject(doc.structured, 'structured', (x, at) => claim(x.id, file, sub(at, 'id')));
    eachObject(doc.production, 'production', (x, at) => claim(x.id, file, sub(at, 'id')));
    if (isObject(doc.dialogue)) claim(doc.dialogue.id, file, 'dialogue/id');
  }

  // duplicate: no two items in the corpus share sl (normalised) and type.
  /** @type {Map<string, { at: string, file: string }>} */
  const headwords = new Map();
  for (const { file, doc } of corpus.lessons) {
    if (!isObject(doc)) continue;
    eachObject(doc.items, 'items', (x, at) => {
      if (typeof x.sl !== 'string' || typeof x.type !== 'string') return;
      const key = `${x.type}\n${normalizeSl(x.sl)}`;
      const first = headwords.get(key);
      if (first) add(file, 'duplicate', sub(at, 'sl'), `${quote(x.sl)} (${x.type}) repeats ${first.at} in ${first.file}`);
      else headwords.set(key, { at, file });
    });
  }

  // reference: every id that points somewhere exists, and units and lessons list each other.
  eachObject(corpus.units, '', (unit, at) => {
    if (!Array.isArray(unit.lessons)) return;
    unit.lessons.forEach((id, i) => {
      if (typeof id === 'string' && !lessonIds.has(id)) add('units.json', 'reference', `${at}/lessons/${i}`, `unknown lesson ${quote(id)}`);
    });
  });
  for (const { file, doc } of corpus.rules) {
    if (unitsLoaded && isObject(doc) && typeof doc.unit === 'string' && !units.has(doc.unit)) add(file, 'reference', 'unit', `unit ${quote(doc.unit)} is not in units.json`);
  }

  // Recognition-only items, as whole words, for the register rule.
  const recognition = [...items.values()]
    .filter(({ item: x }) => x.register === 'recognition' && typeof x.sl === 'string')
    .map(({ item: x }) => ({ id: /** @type {string} */ (x.id), sl: /** @type {string} */ (x.sl), key: ` ${wordsOf(/** @type {string} */ (x.sl))} ` }))
    .filter((r) => r.key.trim() !== '');

  for (const { file, doc } of corpus.lessons) {
    if (!isObject(doc)) continue;
    /** @param {unknown} id @param {string} at */
    const knownRule = (id, at) => {
      if (typeof id === 'string' && !ruleIds.has(id)) add(file, 'reference', at, `unknown rule ${quote(id)}`);
    };
    /** @param {unknown} id @param {string} at */
    const knownItem = (id, at) => {
      if (typeof id === 'string' && !items.has(id)) add(file, 'reference', at, `unknown item ${quote(id)}`);
    };
    /** pending-practised: a practised item must be accepted, unless allowPending. @param {unknown} id @param {string} at */
    const practised = (id, at) => {
      if (allowPending || typeof id !== 'string') return;
      const target = items.get(id);
      if (!target) return;
      const status = isObject(target.item.verification) ? target.item.verification.status : undefined;
      if (status !== 'accepted') {
        add(file, 'pending-practised', at, `practises item ${quote(id)} whose verification status is ${status === undefined ? 'missing' : quote(status)}`);
      }
    };
    /** register: a typed answer never contains a recognition-only item. @param {unknown} answer @param {string} at */
    const producible = (answer, at) => {
      if (typeof answer !== 'string') return;
      const words = ` ${wordsOf(answer)} `;
      for (const r of recognition) {
        if (words.includes(r.key)) add(file, 'register', at, `answer contains the recognition-only item ${quote(r.sl)} (${r.id})`);
      }
    };

    if (unitsLoaded && typeof doc.unit === 'string') {
      const unit = units.get(doc.unit);
      if (!unit) add(file, 'reference', 'unit', `unit ${quote(doc.unit)} is not in units.json`);
      else if (typeof doc.id === 'string' && !(Array.isArray(unit.lessons) && unit.lessons.includes(doc.id))) {
        add(file, 'reference', 'unit', `unit ${quote(doc.unit)} does not list lesson ${quote(doc.id)} in units.json`);
      }
    }
    if (Array.isArray(doc.rules)) doc.rules.forEach((id, i) => knownRule(id, `rules/${i}`));
    eachObject(doc.items, 'items', (x, at) => {
      if (Array.isArray(x.rules)) x.rules.forEach((id, i) => knownRule(id, `${at}/rules/${i}`));
      eachObject(x.slots, sub(at, 'slots'), (slot, slotAt) => {
        if (Array.isArray(slot.fillers)) slot.fillers.forEach((id, i) => knownItem(id, `${slotAt}/fillers/${i}`));
      });
    });
    eachObject(doc.structured, 'structured', (x, at) => {
      knownRule(x.rule, sub(at, 'rule'));
      producible(x.answer, sub(at, 'answer'));
    });
    eachObject(doc.production, 'production', (x, at) => {
      knownItem(x.item, sub(at, 'item'));
      practised(x.item, sub(at, 'item'));
      const target = typeof x.item === 'string' ? items.get(x.item) : undefined;
      if (target && target.item.register === 'recognition') {
        add(file, 'register', sub(at, 'item'), `item ${quote(x.item)} is recognition-only and is never produced`);
      } else {
        producible(x.answer, sub(at, 'answer'));
      }
    });
    if (isObject(doc.dialogue)) {
      eachObject(doc.dialogue.lines, 'dialogue/lines', (line, at) => {
        if (!Array.isArray(line.new_items)) return;
        line.new_items.forEach((id, i) => {
          knownItem(id, `${at}/new_items/${i}`);
          practised(id, `${at}/new_items/${i}`);
        });
      });
    }
  }

  // helper-missing (warning): an item that looks like a cognate should carry a helper line.
  const byHeadword = new Map(cognates.map((c) => [c.sl.toLowerCase(), c.de]));
  for (const { item: x, file } of items.values()) {
    if (typeof x.helper === 'string' && x.helper.trim() !== '') continue;
    if (typeof x.sl !== 'string' || x.sl.trim() === '') continue;
    const at = `items/${x.id}/helper`;
    const german = byHeadword.get(normalizeSl(x.sl));
    if (german) {
      add(file, 'helper-missing', at, `no helper line, but ${quote(x.sl)} has the German cognate ${quote(german)} (cognates.txt)`);
      continue;
    }
    const prefix = firstLetters(x.sl);
    if (prefix.length < 4) continue;
    const cognate = cognates.find((c) => firstLetters(c.de) === prefix);
    if (cognate) {
      add(file, 'helper-missing', at, `no helper line, but ${quote(x.sl)} shares its first letters with German ${quote(cognate.de)} (cognates.txt)`);
    } else if (typeof x.en === 'string' && firstLetters(x.en) === prefix) {
      add(file, 'helper-missing', at, `no helper line, but ${quote(x.sl)} shares its first letters with English ${quote(x.en)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Loading

/** @param {string} dir */
async function assertDirectory(dir) {
  let info;
  try {
    info = await stat(dir);
  } catch {
    throw new Error(`Content directory not found: ${dir}`);
  }
  if (!info.isDirectory()) throw new Error(`Content path is not a directory: ${dir}`);
}

/** @returns {Promise<{ sl: string, de: string }[]>} */
async function loadCognates() {
  let raw;
  try {
    raw = await readFile(COGNATES_FILE, 'utf8');
  } catch {
    throw new Error(`Cognate list not found: ${COGNATES_FILE}`);
  }
  /** @type {{ sl: string, de: string }[]} */
  const pairs = [];
  raw.split('\n').forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) return;
    const parts = trimmed.split('\t').map((s) => s.trim()).filter(Boolean);
    if (parts.length !== 2) throw new Error(`${COGNATES_FILE}:${i + 1}: expected one sl<TAB>de pair`);
    pairs.push({ sl: parts[0], de: parts[1] });
  });
  return pairs;
}

/**
 * Parses one JSON file; a missing or malformed file is a schema error and yields undefined.
 * @param {string} dir @param {string} file relative path, also the issue's file label @param {LintIssue[]} issues
 * @returns {Promise<unknown>}
 */
async function readJson(dir, file, issues) {
  let raw;
  try {
    raw = await readFile(path.join(dir, file), 'utf8');
  } catch (err) {
    const message = errorCode(err) === 'ENOENT' ? 'file is missing' : `cannot read file: ${errorMessage(err)}`;
    issues.push({ file, path: '', rule: 'schema', message });
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    issues.push({ file, path: '', rule: 'schema', message: `invalid JSON: ${errorMessage(err)}` });
    return undefined;
  }
}

/**
 * Parses every *.json file in a folder of the content directory, in name order.
 * @param {string} dir @param {string} folder @param {LintIssue[]} issues
 * @returns {Promise<{ file: string, doc: unknown }[]>}
 */
async function readJsonFolder(dir, folder, issues) {
  let entries;
  try {
    entries = await readdir(path.join(dir, folder), { withFileTypes: true });
  } catch (err) {
    const message = errorCode(err) === 'ENOENT' ? 'directory is missing' : `cannot read directory: ${errorMessage(err)}`;
    issues.push({ file: folder, path: '', rule: 'schema', message });
    return [];
  }
  const names = entries
    .filter((e) => e.isFile() && e.name.endsWith('.json') && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort(compare);
  const docs = [];
  for (const name of names) {
    const file = `${folder}/${name}`;
    const doc = await readJson(dir, file, issues);
    if (doc !== undefined) docs.push({ file, doc });
  }
  return docs;
}

/** @param {LintIssue[]} issues */
const sortIssues = (issues) => [...issues].sort((a, b) => compare(a.file, b.file) || compare(a.path, b.path));

// ---------------------------------------------------------------------------
// Entry points

/**
 * Lints the content directory (`units.json`, `lessons/*.json`, `rules/*.json`).
 * Throws when the directory itself cannot be used; everything else is reported.
 * @param {{ contentDir: string, allowPending?: boolean }} options
 * @returns {Promise<{ errors: LintIssue[], warnings: LintIssue[] }>}
 */
export async function lintContent({ contentDir, allowPending = false }) {
  if (typeof contentDir !== 'string' || contentDir === '') throw new Error('lintContent needs a contentDir');
  const dir = path.resolve(contentDir);
  await assertDirectory(dir);
  const cognates = await loadCognates();

  /** @type {LintIssue[]} */
  const issues = [];
  /** @param {string} file @param {string} rule @returns {Report} */
  const reporter = (file, rule) => (at, message) => {
    issues.push({ file, path: at, rule, message });
  };

  const units = await readJson(dir, 'units.json', issues);
  const lessons = await readJsonFolder(dir, 'lessons', issues);
  const rules = await readJsonFolder(dir, 'rules', issues);

  if (units !== undefined) {
    unitsShape(units, '', reporter('units.json', 'schema'));
    eachObject(units, '', (unit, at) => checkAlphabet(unit.title_sl, sub(at, 'title_sl'), reporter('units.json', 'alphabet')));
    checkPersonal(units, reporter('units.json', 'personal'));
  }
  for (const { file, doc } of lessons) {
    const schema = reporter(file, 'schema');
    lessonShape(doc, '', schema);
    if (!isObject(doc)) continue;
    checkFileName(doc, file, 'lessons', LESSON_ID, schema);
    checkLessonConsistency(doc, schema);
    checkLessonAlphabet(doc, reporter(file, 'alphabet'));
    checkPersonal(doc, reporter(file, 'personal'));
  }
  for (const { file, doc } of rules) {
    const schema = reporter(file, 'schema');
    ruleShape(doc, '', schema);
    if (!isObject(doc)) continue;
    checkFileName(doc, file, 'rules', RULE_ID, schema);
    checkRuleConsistency(doc, schema);
    checkRuleAlphabet(doc, reporter(file, 'alphabet'));
    checkPersonal(doc, reporter(file, 'personal'));
    checkCardLength(doc, reporter(file, 'card-length'));
  }
  checkCorpus({ units, lessons, rules }, allowPending, cognates, issues);

  const sorted = sortIssues(issues);
  return {
    errors: sorted.filter((issue) => !WARNING_RULES.has(issue.rule)),
    warnings: sorted.filter((issue) => WARNING_RULES.has(issue.rule)),
  };
}

/** @param {number} n @param {string} noun */
const count = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** @param {string[]} argv @returns {Promise<number>} the exit code */
async function main(argv) {
  let allowPending = false;
  /** @type {string|null} */
  let contentDir = null;
  for (const arg of argv) {
    if (arg === '--allow-pending') allowPending = true;
    else if (arg.startsWith('-') || contentDir !== null) {
      console.error(`Unexpected argument ${arg}\n${USAGE}`);
      return 2;
    } else contentDir = arg;
  }
  let result;
  try {
    result = await lintContent({ contentDir: contentDir ?? DEFAULT_CONTENT_DIR, allowPending });
  } catch (err) {
    console.error(`ERROR ${errorMessage(err)}`);
    return 1;
  }
  for (const issue of sortIssues([...result.errors, ...result.warnings])) {
    const level = WARNING_RULES.has(issue.rule) ? 'WARNING' : 'ERROR';
    console.log(`${level} ${issue.file} ${issue.path || '-'} ${issue.rule}: ${issue.message}`);
  }
  console.log(`${count(result.errors.length, 'error')}, ${count(result.warnings.length, 'warning')}${allowPending ? ' (pending items allowed)' : ''}`);
  return result.errors.length > 0 ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
