// The toast (Task 19): one fixed bar above the tab bar for something the learner can act on later,
// such as a new version being ready. showToast puts the text, an optional action button and a
// "Later" button into the one status region on the body, so assistive technology reads it without
// the focus moving. The region is there before any toast (main.js calls toastRegion at boot) and
// stays when a toast goes, since a live region that arrives with its text is not read out. One
// toast shows at a time, a new one replaces the old, and the returned function dismisses it. The
// action leaves the toast to its caller, who dismisses it when the action is done (or the page
// reloads). The bar's place above the tab bar and its motion, only where the device allows
// motion, live in components.css under `.toast`.

import { h } from '../../util/dom.js';

/** The status region the toasts show in, once it is made. @type {HTMLElement|null} */
let region = null;
/** The toast showing. @type {HTMLElement|null} */
let current = null;

/**
 * The status region on the body, made on the first call and the same one on every later call.
 * @returns {HTMLElement}
 */
export function toastRegion() {
  if (!region) {
    region = h('div', { class: 'toast-region', role: 'status' });
    document.body.append(region);
  }
  return region;
}

/**
 * @param {{ text: string, action?: { label: string, onTap: () => void } }} options
 * @returns {() => void} dismisses this toast; nothing once it is gone or replaced
 */
export function showToast({ text, action }) {
  current?.remove();
  const later = h('button', { type: 'button', class: 'btn btn-quiet' }, 'Later');
  const toast = h('div', { class: 'toast' },
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
  toastRegion().append(toast);
  return dismiss;
}
