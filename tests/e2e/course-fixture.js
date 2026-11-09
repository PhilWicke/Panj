// tests/e2e/course-fixture.js
// A course of ten units with five lessons each, for the end-to-end hive scenario: a dev bundle
// (index.json and one file per unit) in the shape tools/build-content.js writes, built here so the
// scenario serves it with page.route and depends neither on the content written so far nor on
// tools/. The units carry the course's Slovenian titles in order, the fields of the content
// interface (level, lessonCount, the last lesson's consolidation role) and one pending word per
// lesson, "beseda 1" to "beseda 50".

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
        items: [{
          id: `${id}-i01`,
          type: 'word',
          sl: `beseda ${n}`,
          en: `word ${n}`,
          register: 'neutral',
          examples: [],
          verification: { review1: null, review2: null, native: null, status: 'pending' },
        }],
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
  return {
    index: {
      version: 'e2e000000000',
      mode: 'dev',
      generated: '2026-11-09T00:00:00.000Z',
      units: unitEntries,
      rules: [],
      lessonIndex,
      counts: { scheduledItems: 50, lemmasMet: 51 },
    },
    units,
  };
}
