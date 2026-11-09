// The word tokeniser shared by the content compiler and the progress counters. The compiler's
// `lemmasMet` (tools/build-content.js) and the learner's `wordsMet` (engine/progress.js) are
// measured against each other, so both split text here and nowhere else (Ruling 13).

/**
 * Lowercase word tokens: the text in NFC, lowercased, split on every run of characters that are
 * neither letters nor digits, with empty pieces dropped. `Živjo, kako si? 12:30` gives
 * `živjo kako si 12 30`.
 * @param {string} text
 * @returns {string[]}
 */
export function wordTokens(text) {
  return text.normalize('NFC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}
