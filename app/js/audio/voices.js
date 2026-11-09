// The recorded voices, in a file of their own so the service worker (through util/audio-texts.js)
// can use their names without importing the player, which re-exports them for its callers.

/** The Gemini voice of each voice preference, as the recordings are named; the one place to rename them. */
export const VOICES = Object.freeze({ female: 'Kore', male: 'Puck' });
