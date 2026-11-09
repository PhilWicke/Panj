// The texts the course records (Rulings 46 and 57), one rule in one place for the audio tool
// (tools/gen-audio.js bundles them unit by unit), the service worker ("Keep offline" caches a
// unit's clips) and the tests. audioTexts(unit) gives the `sl` of every accepted item and of its
// examples, and every dialogue line of a lesson with at least one accepted item (the lessons a
// strict build keeps), duplicates dropped, first occurrence first. unitClips(unit, voice) gives
// the clips "Keep offline" fetches: those texts in the learner's voice, then the dialogue lines
// whose speaker has a cast entry, in that speaker's voice. drillTexts() gives the perception
// drill's words, which are drill audio rather than practised items.

import { PERCEPTION_SETS } from '../content/perception-sets.js';
import { VOICES } from '../audio/voices.js';

/** @typedef {import('../content/types.js').UnitContent} UnitContent */
/** @typedef {import('../content/types.js').Item} Item */

/** @param {Item} item */
const isAccepted = (item) => item.verification.status === 'accepted';

/**
 * The texts one unit records, in the order they appear, each once.
 * @param {UnitContent} unit a unit file of the bundle
 * @returns {string[]}
 */
export function audioTexts(unit) {
  /** @type {Set<string>} */
  const texts = new Set();
  for (const lesson of unit.lessons) {
    const accepted = lesson.items.filter(isAccepted);
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
 * The clips one unit keeps offline: every text of audioTexts in `voice`, then every dialogue line
 * of those same lessons whose speaker has a cast entry in that entry's voice, each pair once,
 * first occurrence first.
 * @param {UnitContent} unit a unit file of the bundle
 * @param {string} voice the learner's recording voice, such as `Kore`
 * @returns {{ text: string, voice: string }[]}
 */
export function unitClips(unit, voice) {
  /** @type {Map<string, { text: string, voice: string }>} */
  const clips = new Map();
  /** @param {string} text @param {string} clipVoice */
  const add = (text, clipVoice) => clips.set(`${clipVoice}\n${text}`, { text, voice: clipVoice });
  for (const text of audioTexts(unit)) add(text, voice);
  for (const lesson of unit.lessons) {
    if (!lesson.items.some(isAccepted)) continue;
    for (const line of lesson.dialogue?.lines ?? []) {
      const speaker = lesson.dialogue?.cast?.[line.speaker];
      if (speaker) add(line.sl, VOICES[speaker]);
    }
  }
  return [...clips.values()];
}

/**
 * The perception drill's words, flat and in the drill's order.
 * @returns {string[]}
 */
export function drillTexts() {
  return PERCEPTION_SETS.flat();
}
