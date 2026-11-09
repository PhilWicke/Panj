// How long a line's playback may hold what waits for it (Ruling 42): the dialogue scene before it
// goes on, and the speaking exercise's Speak button while the model line plays. A playback whose
// promise never settles (a browser that drops the utterance's `end`, a stalled load) holds either
// for the line's wait at most, so neither can be stuck behind a sound that never reports its end.

// The longest a line's playback holds: an allowance for loading the voice or the file, plus the
// line at a slow speaking rate (about ten characters a second).
const PLAY_WAIT_BASE_MS = 3000;
const PLAY_WAIT_PER_CHAR_MS = 100;

/**
 * How long to wait for a line to play before going on without the end of the playback.
 * @param {string} text the line's Slovenian
 * @returns {number} milliseconds
 */
export function playWaitMs(text) {
  return PLAY_WAIT_BASE_MS + PLAY_WAIT_PER_CHAR_MS * text.length;
}

/**
 * Starts `play` and settles once it settles or after `ms`, whichever comes first; it never
 * rejects, also when `play` throws. A playback whose promise never settles so holds the caller
 * for `ms` at most; `play` itself runs on, and whatever it does when it settles late still happens.
 * @param {() => Promise<unknown>} play
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function playWithin(play, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    Promise.resolve().then(play).then(done, done);
  });
}
