// The audio stub until Task 14's player: the device's own Slovenian voice through speechSynthesis,
// when the phone has one, and nothing otherwise. Mute is respected. Task 14 replaces this with
// createPlayer, which plays the generated recordings first.

const VOICES_WAIT_MS = 500;

/** The utterance being spoken, held so the browser cannot collect it before `end` fires. @type {SpeechSynthesisUtterance|null} */
let speaking = null;

/**
 * The device's voices. Some browsers fill the list only after `voiceschanged`, so an empty list
 * waits for that event once, briefly.
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
 * Speaks `text` with a Slovenian device voice (one whose `lang` starts with `sl`). Resolves
 * `'device'` once it has been spoken and `'none'` when muted, when the device has no Slovenian
 * voice or when speaking fails.
 * @param {string} text
 * @param {{ mute?: boolean }} [opts]
 * @returns {Promise<'device'|'none'>}
 */
export async function speak(text, opts = {}) {
  const synth = globalThis.speechSynthesis;
  if (opts.mute || !synth || typeof SpeechSynthesisUtterance === 'undefined') return 'none';
  const voice = (await voices(synth)).find((candidate) => candidate.lang.toLowerCase().startsWith('sl'));
  if (!voice) return 'none';
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    /** @param {'device'|'none'} how */
    const finish = (how) => {
      if (speaking === utterance) speaking = null;
      resolve(how);
    };
    utterance.onend = () => finish('device');
    utterance.onerror = () => finish('none');
    speaking = utterance;
    synth.cancel();
    synth.speak(utterance);
  });
}
