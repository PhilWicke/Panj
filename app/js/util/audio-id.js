// The id of a recording: the first 16 hex characters of the SHA-256 over the
// voice name, a newline and the exact text. tools/gen-audio.js names the MP3
// files and the manifest entries by it, and the player looks recordings up by
// it, so both sides import this one module (Web Crypto, Node and browser).
import { sha256Hex } from './hash.js';

const AUDIO_ID_LENGTH = 16;

/**
 * @param {string} text the text exactly as spoken and shown, no normalisation
 * @param {string} voice the Gemini voice name, such as `Kore`
 * @returns {Promise<string>} 16 lowercase hex characters
 */
export async function audioId(text, voice) {
  return (await sha256Hex(`${voice}\n${text}`)).slice(0, AUDIO_ID_LENGTH);
}
