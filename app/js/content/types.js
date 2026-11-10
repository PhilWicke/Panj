// Content types for Panj: the shapes of the JSON files under content/.
//
// These typedefs are the reference for authors, for the linter
// (tools/lint-content.js, which checks every file against them by hand) and for
// the bundle compiler. The files under content/schema/ describe the same shapes
// as JSON Schema for editors and for the content plan.
//
// Ids: units are `uNN`, lessons `uNN-lNN`, and everything inside a lesson
// carries the lesson id as its prefix: items `uNN-lNN-iNN`, structured
// exercises `uNN-lNN-sNN`, production exercises `uNN-lNN-pNN` and the dialogue
// `uNN-lNN-d`. Rules are `r-[a-z0-9-]+`. Ids are unique across the corpus.

/** @typedef {'neutral'|'colloquial'|'formal'|'recognition'} Register */

/** @typedef {'accepted'|'pending'|'rejected'} VerifyStatus */

/**
 * The verification record of an item. Only items with status `accepted` are practised.
 * @typedef {object} Verification
 * @property {'accepted'|'doubtful'|'rejected'|null} review1 verdict of the first blind review, null until reviewed
 * @property {'accepted'|'doubtful'|'rejected'|null} review2 verdict of the second blind review, null until reviewed
 * @property {'confirmed'|'corrected'|null} native what the native speaker said, null until asked
 * @property {VerifyStatus} status
 * @property {string} [notes] internal notes, not shown in the app
 */

/**
 * A scheduled item: a chunk, a word, or an inflected form practised on its own.
 * @typedef {object} Item
 * @property {string} id `uNN-lNN-iNN`
 * @property {'chunk'|'word'|'form'} type
 * @property {string} sl standard Slovenian form
 * @property {string|null} [sl_colloquial] colloquial form that is heard but not written
 * @property {string} en English gloss
 * @property {Register} register
 * @property {string} [pos] part of speech
 * @property {'m'|'f'|'n'|null} [gender]
 * @property {Record<string, string>} [forms] inflected forms by label (case, number), so slot production can grade them
 * @property {{ label: string, fillers: string[] }[]} [slots] the slots of a chunk, each with the ids of the items that fill it
 * @property {{ sl: string, en: string }[]} examples
 * @property {string|null} [helper] cognate, false friend or one-line mnemonic
 * @property {string[]} [accept] accepted answer variants
 * @property {string[]} [rules] ids of the rules the item exercises
 * @property {number|null} [freq_rank] rank in the spoken frequency list
 * @property {{ sl?: string, examples?: string[] }} [audio] audio ids for the headword and the examples
 * @property {Verification} verification
 */

/**
 * Choose the form or ending in context. Practises a rule, not an item.
 * @typedef {object} StructuredExercise
 * @property {string} id `uNN-lNN-sNN`
 * @property {string} prompt_sl the sentence with exactly one blank, a run of one or more underscores that may attach to a stem ("Midva ___ lačna.", "Pijem kav_"); the underscore is the only character outside the Slovenian alphabet allowed here, and the exercise replaces that run when it renders
 * @property {string[]} options
 * @property {string} answer one of the options
 * @property {string} rule id of the rule the exercise practises
 * @property {string} en
 */

/**
 * Typed production from English to Slovenian, recorded as a recall of `item`.
 * @typedef {object} ProductionExercise
 * @property {string} id `uNN-lNN-pNN`
 * @property {string} en the instruction shown to the learner
 * @property {string} answer
 * @property {string[]} [accept]
 * @property {string} item id of the item practised
 * @property {string} [filler] the slot filler used, for slot substitutions
 */

/**
 * @typedef {object} DialogueLine
 * @property {string} speaker `you` is the learner; the other speakers are the roles in the scene
 * @property {string} sl
 * @property {string} en
 * @property {string[]} [accept] other answers that count as correct
 * @property {string} [audio]
 * @property {string[]} [new_items] ids of the items this line practises
 */

/**
 * @typedef {object} Dialogue
 * @property {string} id `uNN-lNN-d`
 * @property {string} title_sl
 * @property {string} title_en
 * @property {string} setting_en the scene in English, in generic framing
 * @property {DialogueLine[]} lines
 * @property {Record<string, 'female'|'male'>} [cast] the recorded voice of each speaker other than the learner
 */

/**
 * One file under content/lessons/<id>.json.
 * @typedef {object} Lesson
 * @property {string} id `uNN-lNN`
 * @property {string} unit id of the unit, which lists this lesson in units.json
 * @property {number} order position within the unit, from 1
 * @property {'theme'|'consolidation'} [role] a consolidation lesson brings the unit's earlier lessons together; a missing or other role is a theme lesson (lessonRole, engine/course.js)
 * @property {string} title_sl
 * @property {string} title_en
 * @property {Item[]} items
 * @property {string[]} rules ids of the rule cards introduced in this lesson
 * @property {StructuredExercise[]} structured
 * @property {ProductionExercise[]} production
 * @property {Dialogue} [dialogue]
 */

/**
 * @typedef {object} RuleCell
 * @property {string} form
 * @property {string} [pronoun]
 * @property {string} [note_en]
 */

/**
 * One file under content/rules/<id>.json: a rule card.
 * @typedef {object} Rule
 * @property {string} id `r-[a-z0-9-]+`
 * @property {string} unit
 * @property {string} title_en
 * @property {string} card_en the card text, at most 40 words
 * @property {{ sl: string, en: string }} example
 * @property {{ rows: string[], cols: string[], cells: Record<string, RuleCell> }} [table] paradigm table; `cells` is keyed `"<row>.<col>"`
 * @property {{ label: string, options: string[], examples: Record<string, { sl: string, en: string }> }[]} [toggles] each toggle has one example per option, keyed by the option
 * @property {{ prompt_sl: string, options: string[], answer: string, explain_en: string }} quick_check one question on the card; `prompt_sl` follows the same blank contract as `StructuredExercise.prompt_sl`
 * @property {string|null} [helper_de]
 * @property {string|null} [helper_en]
 */

/**
 * One entry of content/units.json, which is an array of units in course order.
 * @typedef {object} Unit
 * @property {string} id `uNN`
 * @property {number} order
 * @property {string} title_sl
 * @property {string} title_en
 * @property {string} motif the hive motif drawn on the unit's panel
 * @property {string[]} lessons lesson ids in order
 * @property {string} [level] the level the unit belongs to, such as `A1`; each run of units of one level forms a group (levelGroups, engine/course.js), and a course without levels is one group
 * @property {number} [lessonCount] the cells the hive draws for the unit, its lessons whether the bundle carries them yet or not; without it the hive draws the bundled lessons
 */

// ---------------------------------------------------------------------------
// The compiled bundle under app/content/dist/, written by tools/build-content.js.

/**
 * One entry of the bundle's lesson list, in course order (units in order, lessons in the unit's order).
 * @typedef {object} LessonIndexEntry
 * @property {string} id
 * @property {string} unit
 * @property {number} order
 * @property {string} title_sl
 * @property {string} title_en
 * @property {number} itemCount items the lesson schedules: every item in a dev build, accepted items in a strict build
 */

/**
 * app/content/dist/index.json.
 * @typedef {object} Index
 * @property {string} version the build's version, 12 hex characters of a SHA-256 over the content files and the app shell (tools/build-content.js says which files); app/version.js and app/precache.json carry the same value
 * @property {'dev'|'strict'} mode `dev` when built with --allow-pending (every item is practised), `strict` otherwise (items that are not accepted stay in `items` but leave the practice sets, and a lesson without an accepted item is left out)
 * @property {string} generated time of the build, ISO 8601
 * @property {Unit[]} units every unit of units.json, each listing only the lessons the bundle carries
 * @property {Rule[]} rules
 * @property {LessonIndexEntry[]} lessonIndex
 * @property {{ scheduledItems: number, lemmasMet: number }} counts `lemmasMet` is the number of distinct lowercase word tokens (runs of letters and digits, split on everything else) over the `sl` of the scheduled items, their examples and the dialogue lines of the lessons in the index
 */

/**
 * app/content/dist/units/uNN.json, one file per unit, also for a unit without lessons.
 * @typedef {object} UnitContent
 * @property {Unit} unit
 * @property {Lesson[]} lessons the unit's lessons in order, with `verification.notes` removed and, in a strict build, the practice sets reduced to accepted items
 */

export {};
