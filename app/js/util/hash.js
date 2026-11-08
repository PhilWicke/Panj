// SHA-256 as lowercase hex over the UTF-8 bytes of a string, through Web Crypto.
// The same module runs in the browser, in the service worker and in Node: the
// content compiler derives the bundle version from it, and the audio ids are
// built on it too, so a text hashes to the same id on every side.

/**
 * @param {string} text
 * @returns {Promise<string>} 64 lowercase hex characters
 */
export async function sha256Hex(text) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
