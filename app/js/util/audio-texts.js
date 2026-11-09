// The texts the course records (Rulings 46 and 57), one rule in one place for the audio tool
// (tools/gen-audio.js bundles them unit by unit), the service worker ("Keep offline" caches a
// unit's clips) and the tests. audioTexts(unit) gives the `sl` of every accepted item and of its
// examples, and every dialogue line of a lesson with at least one accepted item (the lessons a
// strict build keeps), duplicates dropped, first occurrence first. drillTexts() gives the
// perception drill's words, which are drill audio rather than practised items.

import { PERCEPTION_SETS } from '../content/perception-sets.js';

/** @typedef {import('../content/types.js').UnitContent} UnitContent */

/**
 * The texts one unit records, in the order they appear, each once.
 * @param {UnitContent} unit a unit file of the bundle
 * @returns {string[]}
 */
export function audioTexts(unit) {
  /** @type {Set<string>} */
  const texts = new Set();
  for (const lesson of unit.lessons) {
    const accepted = lesson.items.filter((item) => item.verification.status === 'accepted');
    if (accepted.length === 0) continue;
    for (const item of accepted) {
      texts.add(item.sl);
      for (const example of item.examples) texts.add(example.sl);
    }
    for (const line of lesson.dialogue?.lines ?? []) texts.add(line.sl);
  }
  return [...texts];
}

/**
 * The perception drill's words, flat and in the drill's order.
 * @returns {string[]}
 */
export function drillTexts() {
  return PERCEPTION_SETS.flat();
}
