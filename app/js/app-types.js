// The App object every screen works with, as main.js builds it at boot. The typedef lives here,
// not in main.js, so a screen imports a type and never the entry point.

/** @typedef {import('./store/memory.js').StoreAdapter} StoreAdapter */
/** @typedef {import('./store/state.js').AppState} AppState */
/** @typedef {import('./content/types.js').Index} Index */
/** @typedef {import('./content/types.js').UnitContent} UnitContent */
/** @typedef {import('./content/types.js').Item} Item */
/** @typedef {import('./content/types.js').Lesson} Lesson */
/** @typedef {import('./content/types.js').Rule} Rule */
/** @typedef {import('./audio/player.js').Player} Player */

/**
 * Everything the screens work with.
 * @typedef {object} App
 * @property {StoreAdapter} adapter
 * @property {boolean} persistent false when the store fell back to memory
 * @property {AppState} state loaded once; screens update it as they save
 * @property {Index} index
 * @property {UnitContent[]} units every unit file, in course order
 * @property {Set<string>} known the item and rule ids the bundle carries (Ruling 23)
 * @property {Map<string, { item: Item, lesson: Lesson }>} items item content by id
 * @property {Map<string, Lesson>} lessons by id
 * @property {Map<string, Rule>} rules by id
 * @property {boolean} allowPending a dev build practises pending items (Ruling 20)
 * @property {Player} player the one audio player: recordings, else the device's Slovenian voice
 */

export {};
