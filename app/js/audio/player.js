// The audio player (spec 5). A line plays from its recording when the manifest lists one in the
// learner's voice, else with the device's own Slovenian voice (one whose `lang` starts with `sl`)
// through speechSynthesis, else not at all, and play() says which happened; audioAvailable() says
// beforehand whether either source exists, so the session schedules no audio exercise nothing can
// play (Ruling 81). Mute plays nothing.
// One sound at a time: play(), stop(), setMute() and setVoice() end whatever plays; setVoice()
// changes the learner's voice for every later lookup (Ruling 48). The manifest is the one
// tools/gen-audio.js writes ({ id: { text, voice, model, bytes } }, id = audioId(text, voice)),
// with the MP3 files beside it; it is fetched once, on first use, and a 404 or a network error
// means there are no recordings yet and reads as an empty manifest. The player fetches nothing
// but the app's own files.

import { audioId } from '../util/audio-id.js';

/** The Gemini voice of each voice preference, as the recordings are named; the one place to rename them. */
export const VOICES = Object.freeze({ female: 'Kore', male: 'Puck' });

/** How long an empty voice list waits for `voiceschanged`; some browsers fill it late. */
const VOICES_WAIT_MS = 500;
/**
 * How long a cancelled utterance gets to report its end or error before the next one is spoken:
 * cancel then speak back to back drops the new utterance on some Android browsers.
 */
const CANCEL_SETTLE_MS = 150;

/** @typedef {'female'|'male'|'device'} VoicePref */
/** @typedef {'file'|'device'|'none'} PlaySource */
/** @typedef {{ text: string, voice: string, model: string, bytes: number }} ManifestEntry */

/**
 * @typedef {object} Player
 * @property {(text: string) => Promise<PlaySource>} play plays `text` and resolves once it has
 *   played, or was cut short by a later play(), stop() or setMute(), with where the sound came
 *   from: `file`, `device`, or `none` when muted or when neither a recording nor a Slovenian
 *   device voice can play it. It awaits the manifest and audioId, which is async (Ruling 6), and
 *   never rejects.
 * @property {() => void} stop ends whatever plays
 * @property {(mute: boolean) => void} setMute muted, play() plays nothing; also stops what plays
 * @property {(voicePref: VoicePref) => void} setVoice the voice of the recordings from now on, for
 *   every later play() and hasAudioFor(); also stops what plays
 * @property {(text: string) => Promise<boolean>} hasAudioFor whether a recording of `text` in the
 *   preferred voice exists; a promise, since it awaits the manifest and audioId
 * @property {() => boolean} deviceVoiceAvailable whether the device has a Slovenian voice, from
 *   the voice list as it stands
 * @property {() => Promise<boolean>} audioAvailable whether anything can play: the manifest has a
 *   recording in the preferred voice, or the device has a Slovenian voice. It awaits the manifest
 *   (never fetched for the voice `device`, Ruling 45) and the voice list, which some browsers
 *   fill late; mute does not enter into it
 */

/**
 * The voice of the recordings for a voice preference; none for `device`, which plays the device's
 * own voice only.
 * @param {VoicePref} voicePref
 * @returns {string|null}
 */
export function voiceFor(voicePref) {
  return voicePref === 'device' ? null : VOICES[voicePref] ?? null;
}

/**
 * @param {SpeechSynthesisVoice[]} list
 * @returns {SpeechSynthesisVoice|null}
 */
function slovenianVoice(list) {
  return list.find((voice) => voice.lang.toLowerCase().startsWith('sl')) ?? null;
}

/**
 * The device's voices. An empty list waits for `voiceschanged` once, briefly.
 * @param {SpeechSynthesis} synth
 * @returns {Promise<SpeechSynthesisVoice[]>}
 */
function voices(synth) {
  const now = synth.getVoices();
  if (now.length > 0) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      synth.removeEventListener('voiceschanged', done);
      resolve(synth.getVoices());
    };
    const timer = setTimeout(done, VOICES_WAIT_MS);
    synth.addEventListener('voiceschanged', done);
  });
}

/**
 * The manifest at `url`, or an empty one when it is missing, unreadable or not an object.
 * @param {string} url
 * @returns {Promise<Record<string, ManifestEntry>>}
 */
async function fetchManifest(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) return {};
    const data = await response.json();
    return typeof data === 'object' && data !== null && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

/**
 * Settles once `promise` settles or after `ms`, whichever comes first.
 * @param {Promise<void>} promise
 * @param {number} ms
 * @returns {Promise<void>}
 */
function within(promise, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    promise.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * @param {{ manifestUrl: string, voicePref: VoicePref, mute: boolean }} options `manifestUrl` is
 *   relative to the page (`assets/audio/manifest.json`); the MP3 files sit beside it
 * @returns {Player}
 */
export function createPlayer({ manifestUrl, voicePref, mute }) {
  const folder = manifestUrl.slice(0, manifestUrl.lastIndexOf('/') + 1);
  let muted = mute;
  /** The learner's voice preference, which setVoice() changes. */
  let preferred = voicePref;
  /** @type {Promise<Record<string, ManifestEntry>>|null} */
  let manifest = null;
  /** Counts play(), stop(), setMute() and setVoice(); a play whose turn has passed plays nothing more. */
  let turn = 0;
  /** The recording being played. @type {{ audio: HTMLAudioElement, cut: () => void }|null} */
  let clip = null;
  /**
   * The utterance being spoken, held so the browser cannot collect it before its `end` fires;
   * `settled` settles on its end or error.
   * @type {{ utterance: SpeechSynthesisUtterance, settled: Promise<void>, cut: () => void }|null}
   */
  let speaking = null;
  /** Settles once the last cancelled utterance has let go (its end or error, or CANCEL_SETTLE_MS). */
  let released = Promise.resolve();

  /**
   * The URL of the recording of `text` in the preferred voice, or null; also null when the id
   * cannot be computed (Web Crypto is missing outside a secure context, such as a LAN address over http).
   * @param {string} text
   * @returns {Promise<string|null>}
   */
  const recordingFor = async (text) => {
    const voice = voiceFor(preferred);
    if (!voice) return null;
    manifest ??= fetchManifest(manifestUrl);
    try {
      const [entries, id] = await Promise.all([manifest, audioId(text, voice)]);
      return Object.hasOwn(entries, id) ? `${folder}${id}.mp3` : null;
    } catch {
      return null;
    }
  };

  /**
   * Ends what plays: pauses the clip and cancels the utterance, whose plays then resolve, and
   * moves the turn on, so a play still looking up its source plays nothing.
   */
  const halt = () => {
    turn += 1;
    const playing = clip;
    clip = null;
    if (playing) {
      playing.audio.pause();
      playing.cut();
    }
    const spoken = speaking;
    speaking = null;
    if (spoken) {
      globalThis.speechSynthesis?.cancel();
      released = within(spoken.settled, CANCEL_SETTLE_MS).then(spoken.cut);
    }
  };

  /**
   * Plays the recording at `url`.
   * @param {string} url
   * @returns {Promise<boolean>} true once it has played or was cut short, false when it failed
   */
  const playFile = (url) => new Promise((resolve) => {
    if (typeof Audio === 'undefined') return resolve(false);
    const audio = new Audio(url);
    /** @param {boolean} played */
    const finish = (played) => {
      if (clip?.audio === audio) clip = null;
      audio.onended = null;
      audio.onerror = null;
      resolve(played);
    };
    clip = { audio, cut: () => finish(true) };
    audio.onended = () => finish(true);
    audio.onerror = () => finish(false);
    audio.play().catch(() => finish(false));
  });

  /**
   * Speaks `text` with the device's Slovenian voice, once the utterance cancelled before it has let go.
   * @param {string} text
   * @param {number} mine the turn of the play this belongs to
   * @returns {Promise<PlaySource>}
   */
  const speakDevice = async (text, mine) => {
    const synth = globalThis.speechSynthesis;
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return 'none';
    const voice = slovenianVoice(await voices(synth));
    if (!voice) return 'none';
    await released;
    if (mine !== turn) return 'device';
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = voice;
      utterance.lang = voice.lang;
      /** @type {() => void} */
      let settle = () => {};
      /** @type {Promise<void>} */
      const settled = new Promise((done) => { settle = () => done(); });
      /** @param {PlaySource} how */
      const finish = (how) => {
        settle();
        if (speaking?.utterance === utterance) speaking = null;
        resolve(how);
      };
      utterance.onend = () => finish('device');
      // A cancelled utterance reports `interrupted` or `canceled`: it was speaking, so it counts as played.
      utterance.onerror = (event) => finish(event.error === 'interrupted' || event.error === 'canceled' ? 'device' : 'none');
      speaking = { utterance, settled, cut: () => resolve('device') };
      synth.speak(utterance);
    });
  };

  /** @type {Player['deviceVoiceAvailable']} */
  const deviceVoiceAvailable = () => {
    const synth = globalThis.speechSynthesis;
    return Boolean(synth && typeof SpeechSynthesisUtterance !== 'undefined' && slovenianVoice(synth.getVoices()));
  };

  return {
    async play(text) {
      halt();
      const mine = turn;
      if (muted) return 'none';
      const url = await recordingFor(text);
      if (url) {
        if (mine !== turn) return 'file';
        if (await playFile(url)) return 'file';
        // The recording failed to load or play: the device voice stands in.
      }
      if (mine !== turn) return deviceVoiceAvailable() ? 'device' : 'none';
      return speakDevice(text, mine);
    },
    stop: halt,
    setMute(value) {
      muted = value;
      halt();
    },
    setVoice(value) {
      preferred = value;
      halt();
    },
    async hasAudioFor(text) {
      return (await recordingFor(text)) !== null;
    },
    deviceVoiceAvailable,
    async audioAvailable() {
      const voice = voiceFor(preferred);
      if (voice) {
        manifest ??= fetchManifest(manifestUrl);
        if (Object.values(await manifest).some((entry) => entry?.voice === voice)) return true;
      }
      const synth = globalThis.speechSynthesis;
      if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return false;
      return slovenianVoice(await voices(synth)) !== null;
    },
  };
}
