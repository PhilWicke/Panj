// The theme switch, shared by boot (main.js), onboarding and Settings: the learner's choice lands
// on the root element as `data-theme`, which tokens.css reads; `system` removes it so the
// prefers-color-scheme media query decides.

/** @typedef {import('../store/state.js').Preferences['theme']} Theme */

/**
 * Applies a theme to the page at once.
 * @param {Theme} theme
 */
export function applyTheme(theme) {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}
