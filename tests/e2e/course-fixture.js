// tests/e2e/course-fixture.js
// The courses the end-to-end scenarios serve themselves, each a dev bundle (index.json and one file
// per unit) in the shape tools/build-content.js writes, built here so a scenario serves it with
// page.route and depends neither on the content written so far nor on tools/. tenByFive, for the
// hive scenario, is a course of ten units with five lessons each: the course's Slovenian titles in
// order, the fields of the content interface (level, lessonCount, the last lesson's consolidation
// role) and one pending word per lesson, "beseda 1" to "beseda 50". fourWords, for the quiet
// scenario, is one unit whose one lesson holds four pending words, "beseda 1" to "beseda 4".

/** The units' Slovenian titles, in course order. */
export const COURSE_TITLES = [
  'Prvi stik',
  'Družina in ljudje',
  'Pri mizi',
  'V kavarni in v trgovini',
  'Dan in čas',
  'Dom',
  'Po mestu',
  'Prosti čas in vreme',
  'Telo in zdravje',
  'Delo in študij',
];

/** The units' motifs, in course order. */
const MOTIFS = ['flower', 'heart', 'wheat', 'cup', 'sun', 'house', 'bird', 'leaf', 'hand', 'bee'];
/** Lessons per unit; the last one consolidates. */
const LESSONS = 5;

/** @param {number} n @returns {string} n with two digits */
const two = (n) => String(n).padStart(2, '0');

/**
 * Word n of a course, pending: "beseda n" ("word n"), with no examples.
 * @param {string} id the item id
 * @param {number} n
 * @returns {object}
 */
const pendingWord = (id, n) => ({
  id,
  type: 'word',
  sl: `beseda ${n}`,
  en: `word ${n}`,
  register: 'neutral',
  examples: [],
  verification: { review1: null, review2: null, native: null, status: 'pending' },
});

/**
 * A dev bundle's index.json: `mode` dev, `version` e2e000000000, no rules.
 * @param {object[]} units
 * @param {object[]} lessonIndex
 * @param {{ scheduledItems: number, lemmasMet: number }} counts
 * @returns {object}
 */
const devIndex = (units, lessonIndex, counts) => ({
  version: 'e2e000000000',
  mode: 'dev',
  generated: '2026-11-09T00:00:00.000Z',
  units,
  rules: [],
  lessonIndex,
  counts,
});

/**
 * The course as a dev bundle: `index` is index.json (`mode` dev, `version` e2e000000000, no
 * rules), `units` the unit files by unit id. Unit k is `uNN` with the k-th course title, English
 * title "Unit k", level A1 and five lessons `uNN-l01` to `uNN-l05` titled "Lekcija 1" to
 * "Lekcija 5", the fifth with the role consolidation; lesson n of the course (1 to 50) holds the
 * one pending word "beseda n" ("word n") with no examples, rules, structured or production
 * exercises. A fresh copy on every call.
 * @returns {{ index: object, units: Record<string, object> }}
 */
export function tenByFive() {
  /** @type {object[]} */
  const unitEntries = [];
  /** @type {object[]} */
  const lessonIndex = [];
  /** @type {Record<string, object>} */
  const units = {};
  COURSE_TITLES.forEach((title, at) => {
    const unitId = `u${two(at + 1)}`;
    const lessons = Array.from({ length: LESSONS }, (_, step) => {
      const order = step + 1;
      const id = `${unitId}-l${two(order)}`;
      const n = at * LESSONS + order;
      return {
        id,
        unit: unitId,
        order,
        ...(order === LESSONS ? { role: 'consolidation' } : {}),
        title_sl: `Lekcija ${order}`,
        title_en: `Lesson ${order}`,
        items: [pendingWord(`${id}-i01`, n)],
        rules: [],
        structured: [],
        production: [],
      };
    });
    const unit = {
      id: unitId,
      order: at + 1,
      title_sl: title,
      title_en: `Unit ${at + 1}`,
      motif: MOTIFS[at],
      level: 'A1',
      lessonCount: LESSONS,
      lessons: lessons.map((lesson) => lesson.id),
    };
    unitEntries.push(unit);
    units[unitId] = { unit: { ...unit, lessons: [...unit.lessons] }, lessons };
    for (const lesson of lessons) {
      lessonIndex.push({ id: lesson.id, unit: unitId, order: lesson.order, title_sl: lesson.title_sl, title_en: lesson.title_en, itemCount: 1 });
    }
  });
  return { index: devIndex(unitEntries, lessonIndex, { scheduledItems: 50, lemmasMet: 51 }), units };
}

/** Words in fourWords' lesson: one more than the three new items a day the quiet scenario sets. */
const FOUR_WORDS = 4;

/**
 * A course of one unit for the quiet scenario, a dev bundle like tenByFive's: `u01` with the first
 * course title, English title "Unit 1", motif flower, level A1 and one lesson, `u01-l01` titled
 * "Lekcija 1", a theme lesson (no role) holding four pending words, "beseda 1" to "beseda 4"
 * ("word 1" to "word 4"), with no examples, rules, structured or production exercises. With three
 * new items a day, the lesson has a word left for "Continue the lesson". A fresh copy on every call.
 * @returns {{ index: object, units: Record<string, object> }}
 */
export function fourWords() {
  const lesson = {
    id: 'u01-l01',
    unit: 'u01',
    order: 1,
    title_sl: 'Lekcija 1',
    title_en: 'Lesson 1',
    items: Array.from({ length: FOUR_WORDS }, (_, at) => pendingWord(`u01-l01-i${two(at + 1)}`, at + 1)),
    rules: [],
    structured: [],
    production: [],
  };
  const unit = {
    id: 'u01',
    order: 1,
    title_sl: COURSE_TITLES[0],
    title_en: 'Unit 1',
    motif: MOTIFS[0],
    level: 'A1',
    lessonCount: 1,
    lessons: [lesson.id],
  };
  const entry = { id: lesson.id, unit: unit.id, order: 1, title_sl: lesson.title_sl, title_en: lesson.title_en, itemCount: FOUR_WORDS };
  return {
    // lemmasMet counts the distinct tokens of the words: "beseda" and the four numbers
    index: devIndex([unit], [entry], { scheduledItems: FOUR_WORDS, lemmasMet: FOUR_WORDS + 1 }),
    units: { u01: { unit: { ...unit, lessons: [...unit.lessons] }, lessons: [lesson] } },
  };
}
