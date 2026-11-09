// The theme switch, shared by boot (main.js), onboarding and Settings: the learner's choice lands
// on the root element as `data-theme`, which tokens.css reads; `system` removes it so the
// prefers-color-scheme media query decides. The choice is also mirrored to localStorage (spec 8
// allows it for the theme) and read back as this module loads, before the store opens, so a dark
// theme on a light-system phone does not flash warm white at every start (Ruling 83). The store
// stays the source of truth: boot applies the loaded settings' theme as before.

/** @typedef {import('../store/state.js').Preferences['theme']} Theme */

/** The localStorage key the theme is mirrored under. */
const STORAGE_KEY = 'slovelingo-theme';

/**
 * Applies a theme to the page at once and mirrors it for the next start.
 * @param {Theme} theme
 */
export function applyTheme(theme) {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage refused or full: the theme still applies to this page, and boot applies the stored one.
  }
}

/**
 * Applies the mirrored theme early, where there is a page to paint: `light` or `dark` as stored,
 * nothing for `system` or no mirror, so the media query decides until the store has loaded.
 */
function applyMirrored() {
  if (typeof document === 'undefined') return;
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') applyTheme(stored);
  } catch {
    // No readable storage: the store's theme applies after load, as it always did.
  }
}

applyMirrored();
