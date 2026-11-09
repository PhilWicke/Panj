// The toast (Task 19): one fixed bar above the tab bar for something the learner can act on later,
// such as a new version being ready. showToast puts the text, an optional action button and a
// "Later" button on the body as a status region, so assistive technology reads it without the
// focus moving; one toast shows at a time, a new one replaces the old, and the returned function
// dismisses it. The action leaves the toast to its caller, who dismisses it when the action is
// done (or the page reloads). The bar's place above the tab bar and its motion, only where the
// device allows motion, live in components.css under `.toast`.

import { h } from '../../util/dom.js';

/** The toast showing. @type {HTMLElement|null} */
let current = null;

/**
 * @param {{ text: string, action?: { label: string, onTap: () => void } }} options
 * @returns {() => void} dismisses this toast; nothing once it is gone or replaced
 */
export function showToast({ text, action }) {
  current?.remove();
  const later = h('button', { type: 'button', class: 'btn btn-quiet' }, 'Later');
  const toast = h('div', { class: 'toast', role: 'status' },
    h('p', { class: 'toast-text' }, text),
    h('div', { class: 'toast-actions' },
      action ? h('button', { type: 'button', class: 'btn btn-quiet toast-action', onclick: () => action.onTap() }, action.label) : null,
      later));
  const dismiss = () => {
    toast.remove();
    if (current === toast) current = null;
  };
  later.addEventListener('click', dismiss);
  current = toast;
  document.body.append(toast);
  return dismiss;
}
