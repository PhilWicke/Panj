// Syllabus reader: content/SYLLABUS.md as data, so the unit tests can hold each unit's lesson files
// to the plan. The file holds one section per level, each unit in a fixed set of line shapes, every
// line starting at column 0:
//
//   # Level A1
//   ## u01 Prvi stik / First contact (motif flower)
//   ### u01-l01 theme: Prvi pozdrav / First hello
//   - Situations: <generic English>
//   - Items (8): Živjo. | Dober dan. | ...          entries split on |
//   - Rules: r-biti-present, r-ti-vi               split on , ("none" for no rule card)
//   - Table keys: 1, 2, 3, sg, du, pl              split on , ("none" for no table)
//   - Slot: <chunk with ___> with <filler>, ...    optional
//   - Dialogue (6 lines): <scene in one sentence>
//   Checkpoint: <one line per unit, after its lessons>
//
// Every list entry is trimmed. A line starting `### ` that is not a lesson heading, and an Items
// line whose entries are not as many as it says, are errors; every other line is prose and ignored.
//
// Library: parseSyllabus(text), readSyllabus(contentDir). No dependencies: node:fs and node:path.
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * @typedef {object} SyllabusLesson
 * @property {string} id
 * @property {'theme'|'consolidation'} role
 * @property {string} title_sl
 * @property {string} title_en
 * @property {string} situations
 * @property {string[]} items the planned items' Slovenian, in order
 * @property {string[]} rules the rule card ids the lesson introduces
 * @property {string[]} tableKeys the row and column keys of the tables those cards have
 * @property {string|null} slot the planned slot substitution, null when the lesson plans none
 * @property {number} dialogueLines
 * @property {string} dialogue the scene and setting
 */

/**
 * @typedef {object} SyllabusUnit
 * @property {string} level
 * @property {string} id
 * @property {string} title_sl
 * @property {string} title_en
 * @property {string} motif
 * @property {SyllabusLesson[]} lessons
 * @property {string} checkpoint
 */

const LEVEL = /^# Level (\S+)$/;
const UNIT = /^## (u\d{2}) (.+?) \/ (.+) \(motif ([^()]+)\)$/;
const LESSON = /^### (u\d{2}-l\d{2}) (theme|consolidation): (.+?) \/ (.+)$/;
const ITEMS = /^- Items \((\d+)\): (.*)$/;
const DIALOGUE = /^- Dialogue \((\d+) lines\): (.*)$/;
/** The field lines of a lesson that carry plain text or a list. */
const FIELDS = /^- (Situations|Rules|Table keys|Slot): (.*)$/;
const CHECKPOINT = /^Checkpoint: (.*)$/;

/** Entries of a list field, trimmed; "none" (or nothing) is the empty list. @param {string} text @param {string} separator */
const list = (text, separator) => {
  const trimmed = text.trim();
  return trimmed === '' || trimmed === 'none' ? [] : trimmed.split(separator).map((entry) => entry.trim());
};

/**
 * The units of a syllabus text, in the order the text gives them.
 * @param {string} text
 * @returns {SyllabusUnit[]}
 */
export function parseSyllabus(text) {
  /** @type {SyllabusUnit[]} */
  const units = [];
  let level = '';
  /** @type {SyllabusUnit|null} */
  let unit = null;
  /** @type {SyllabusLesson|null} */
  let lesson = null;
  text.split(/\r?\n/).forEach((raw, index) => {
    const n = index + 1;
    const line = raw.trimEnd();
    let match;
    if ((match = LEVEL.exec(line))) {
      level = match[1];
      unit = null;
      lesson = null;
    } else if ((match = UNIT.exec(line))) {
      unit = { level, id: match[1], title_sl: match[2], title_en: match[3], motif: match[4].trim(), lessons: [], checkpoint: '' };
      units.push(unit);
      lesson = null;
    } else if (line.startsWith('### ')) {
      match = LESSON.exec(line);
      if (!match) throw new Error(`line ${n}: "${raw}" is not a lesson heading`);
      if (!unit) throw new Error(`line ${n}: "${raw}" comes before any unit heading`);
      lesson = {
        id: match[1],
        role: /** @type {'theme'|'consolidation'} */ (match[2]),
        title_sl: match[3],
        title_en: match[4],
        situations: '',
        items: [],
        rules: [],
        tableKeys: [],
        slot: null,
        dialogueLines: 0,
        dialogue: '',
      };
      unit.lessons.push(lesson);
    } else if (unit && (match = CHECKPOINT.exec(line))) {
      unit.checkpoint = match[1];
      lesson = null;
    } else if (lesson && (match = ITEMS.exec(line))) {
      const items = list(match[2], '|');
      if (items.length !== Number(match[1])) throw new Error(`line ${n}: Items (${match[1]}) lists ${items.length} entries`);
      lesson.items = items;
    } else if (lesson && (match = DIALOGUE.exec(line))) {
      lesson.dialogueLines = Number(match[1]);
      lesson.dialogue = match[2];
    } else if (lesson && (match = FIELDS.exec(line))) {
      const [, field, value] = match;
      if (field === 'Situations') lesson.situations = value;
      else if (field === 'Rules') lesson.rules = list(value, ',');
      else if (field === 'Table keys') lesson.tableKeys = list(value, ',');
      else lesson.slot = value;
    }
  });
  return units;
}

/**
 * Reads and parses `<contentDir>/SYLLABUS.md`.
 * @param {string} contentDir
 * @returns {Promise<SyllabusUnit[]>}
 */
export async function readSyllabus(contentDir) {
  return parseSyllabus(await readFile(path.join(contentDir, 'SYLLABUS.md'), 'utf8'));
}
