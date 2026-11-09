// Speech recognition (spec 4.5), the one runtime feature that sends anything off the phone: the
// browser's Web Speech recogniser streams the learner's voice to its speech service while it
// listens. So the exercises call recognizeOnce only after the learner has switched recognition on
// (settings.speech, off by default); speechAvailable only checks that the API exists and never
// constructs a recogniser. A failure that does not pass by itself (a refused microphone or speech
// service, no microphone, a recogniser without Slovenian) is remembered until resetRecognition,
// which the session screen calls as each session starts, so a recogniser refused in one session
// is offered again in the next; recognitionBlocked tells the exercises so they do not ask again
// in the meantime.
// Any other failure (no connection, a recogniser that would not start, an error the browser names
// otherwise) is reported for the one attempt only. compareSpoken judges a transcript against the
// line coarsely: a match, close, or a miss, never a score.

import { grade, levenshtein, normalize, stripDiacritics } from '../engine/grading.js';

/** Edits a transcript may be off by and still count as close, or this share of the line's length if that is more. */
const CLOSE_EDITS = 2;
const CLOSE_SHARE = 0.2;
/** Recogniser errors that stay until the learner or the browser changes something. */
const LASTING_ERRORS = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported']);

/** Set by a lasting error, cleared by resetRecognition. */
let blocked = false;

/**
 * The part of the Web Speech recogniser used here. The DOM typings leave the interface out (it is
 * still prefixed in Chrome and Safari), so it is described here.
 * @typedef {object} Recognition
 * @property {string} lang
 * @property {boolean} interimResults
 * @property {boolean} continuous
 * @property {number} maxAlternatives
 * @property {((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void)|null} onresult
 * @property {((event: { error: string }) => void)|null} onerror
 * @property {(() => void)|null} onend
 * @property {() => void} start
 * @property {() => void} abort
 */

/** @typedef {{ transcript: string|null, error: string|null }} Recognised */

/** @returns {(new () => Recognition)|null} the recogniser's constructor, unprefixed or prefixed */
function recognitionConstructor() {
  const scope = /** @type {{ SpeechRecognition?: new () => Recognition, webkitSpeechRecognition?: new () => Recognition }} */ (
    /** @type {unknown} */ (globalThis));
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

/**
 * Whether the browser has a speech recogniser (`SpeechRecognition` or `webkitSpeechRecognition`).
 * Constructs nothing.
 * @returns {boolean}
 */
export function speechAvailable() {
  return recognitionConstructor() !== null;
}

/**
 * Whether recognition failed in a way that does not pass by itself (`not-allowed`,
 * `service-not-allowed`, `audio-capture`, `language-not-supported`) since the last
 * resetRecognition. Other errors never set it.
 * @returns {boolean}
 */
export function recognitionBlocked() {
  return blocked;
}

/**
 * Forgets a lasting failure, so the next speaking exercise offers recognition again. The session
 * screen calls it as a session starts; Settings calls it when recognition is switched on.
 */
export function resetRecognition() {
  blocked = false;
}

/**
 * Listens once and resolves with what was heard. It never rejects: `transcript` is null with
 * `error` naming why when the API is missing (`unavailable`), when the recogniser cannot start
 * (`start-failed`), on the recogniser's own errors (`not-allowed` when the microphone is refused,
 * `no-speech`, `network` and the others, as the browser names them), when it ends without a
 * result (`no-speech`) and after `timeoutMs` (`timeout`, and the recogniser is stopped). A lasting
 * error sets recognitionBlocked.
 * @param {{ lang?: string, timeoutMs?: number }} [options]
 * @returns {Promise<Recognised>}
 */
export function recognizeOnce({ lang = 'sl-SI', timeoutMs = 6000 } = {}) {
  const Recognizer = recognitionConstructor();
  if (!Recognizer) return Promise.resolve({ transcript: null, error: 'unavailable' });
  return new Promise((resolve) => {
    /** @type {Recognition|null} */
    let recognition = null;
    let done = false;
    /** @param {string|null} transcript @param {string|null} error */
    const finish = (transcript, error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error !== null && LASTING_ERRORS.has(error)) blocked = true;
      if (recognition) {
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        try {
          recognition.abort();
        } catch {
          // Already stopped.
        }
      }
      resolve({ transcript, error });
    };
    const timer = setTimeout(() => finish(null, 'timeout'), timeoutMs);
    try {
      recognition = new Recognizer();
      recognition.lang = lang;
      recognition.interimResults = false;
      recognition.continuous = false;
      recognition.maxAlternatives = 1;
      recognition.onresult = (event) => {
        const heard = (event.results[0]?.[0]?.transcript ?? '').trim();
        finish(heard || null, heard ? null : 'no-speech');
      };
      recognition.onerror = (event) => finish(null, event.error || 'error');
      recognition.onend = () => finish(null, 'no-speech');
      recognition.start();
    } catch {
      finish(null, 'start-failed');
    }
  });
}

/**
 * How a transcript compares with the line: `match` when grade calls it correct or a slip; `close`
 * when, normalised and without diacritics, it is at most CLOSE_EDITS edits (Levenshtein) from the
 * line or at most CLOSE_SHARE of the line's length; otherwise `miss`.
 * @param {string} transcript what the recogniser heard
 * @param {string} target the Slovenian line as written in the content
 * @returns {'match'|'close'|'miss'}
 */
export function compareSpoken(transcript, target) {
  if (grade(transcript, target).result !== 'wrong') return 'match';
  const line = stripDiacritics(normalize(target));
  const distance = levenshtein(stripDiacritics(normalize(transcript)), line);
  return distance <= Math.max(CLOSE_EDITS, CLOSE_SHARE * Array.from(line).length) ? 'close' : 'miss';
}
