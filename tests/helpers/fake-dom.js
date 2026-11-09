// tests/helpers/fake-dom.js
// A minimal stand-in for the browser's document, enough to run app/js/util/dom.js under Node:
// createElement, createTextNode, className, classList, dataset, setAttribute, appendChild, append,
// replaceChildren, addEventListener, focus (recorded as document.activeElement) and textContent.
// It keeps dom.js and the small components honest without a browser; the session itself runs in
// the end-to-end check.

/** The document installFakeDom put on globalThis, which focus() reports to. @type {{ activeElement: FakeElement|null }|null} */
let installed = null;

class FakeNode {
  constructor() {
    /** @type {FakeNode[]} */
    this.childNodes = [];
    /** @type {FakeNode|null} */
    this.parentNode = null;
  }

  /** @param {FakeNode} child */
  appendChild(child) {
    if (!(child instanceof FakeNode)) throw new TypeError('appendChild takes a node');
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  /** Appends nodes, and strings as text, as the DOM's append does. @param {...(FakeNode|string)} nodes */
  append(...nodes) {
    for (const node of nodes) this.appendChild(typeof node === 'string' ? new FakeText(node) : node);
  }

  /** @param {...(FakeNode|string)} nodes */
  replaceChildren(...nodes) {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    this.append(...nodes);
  }

  get textContent() {
    return this.childNodes.map((child) => child.textContent).join('');
  }

  set textContent(text) {
    this.childNodes = [];
    if (text !== '') this.appendChild(new FakeText(String(text)));
  }
}

class FakeText extends FakeNode {
  /** @param {string} data */
  constructor(data) {
    super();
    this.data = data;
  }

  get textContent() {
    return this.data;
  }

  set textContent(text) {
    this.data = String(text);
  }
}

class FakeElement extends FakeNode {
  /** @param {string} tag */
  constructor(tag) {
    super();
    this.tagName = tag.toUpperCase();
    this.className = '';
    /** @type {Record<string, string>} */
    this.dataset = {};
    /** @type {Map<string, string>} */
    this.attributes = new Map();
    /** @type {Map<string, Function[]>} */
    this.listeners = new Map();
  }

  /** @param {string} name @param {string} value */
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  /** @param {string} name */
  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  /** @param {string} type @param {Function} listener */
  addEventListener(type, listener) {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  /** Calls the listeners of `type` with a bare event object, as a click would. @param {string} type */
  dispatch(type) {
    for (const listener of this.listeners.get(type) ?? []) listener({ type, target: this });
  }

  /** The class names, over className, as the DOM's classList keeps them. */
  get classList() {
    const names = () => this.className.split(/\s+/).filter(Boolean);
    return {
      add: (/** @type {string[]} */ ...tokens) => { this.className = [...new Set([...names(), ...tokens])].join(' '); },
      remove: (/** @type {string[]} */ ...tokens) => { this.className = names().filter((name) => !tokens.includes(name)).join(' '); },
      contains: (/** @type {string} */ token) => names().includes(token),
    };
  }

  focus() {
    if (installed) installed.activeElement = this;
  }
}

/**
 * Puts a fake `document` on globalThis and returns it.
 * @returns {{ createElement(tag: string): FakeElement, createTextNode(data: string): FakeText, activeElement: FakeElement|null }}
 */
export function installFakeDom() {
  const document = {
    createElement: (/** @type {string} */ tag) => new FakeElement(tag),
    createTextNode: (/** @type {string} */ data) => new FakeText(String(data)),
    /** @type {FakeElement|null} */
    activeElement: null,
  };
  installed = document;
  Object.defineProperty(globalThis, 'document', { value: document, configurable: true, writable: true });
  return document;
}
