// tests/helpers/fake-dom.js
// A minimal stand-in for the browser's document, enough to run app/js/util/dom.js under Node:
// createElement, createElementNS (the tag name keeps its case and the element records its
// namespace, as an SVG element does), createTextNode, className, classList, dataset, style,
// setAttribute, removeAttribute, hidden (reflecting the attribute, as on an HTML element),
// querySelector (one class selector only), appendChild, append, replaceChildren, addEventListener,
// focus (recorded as document.activeElement), textContent and a documentElement for the theme. It
// keeps dom.js and the small components honest without a browser; the session itself runs in the
// end-to-end check.

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
  /** @param {string} tag @param {string|null} [namespace] */
  constructor(tag, namespace = null) {
    super();
    this.tagName = namespace === null ? tag.toUpperCase() : tag;
    this.namespaceURI = namespace ?? 'http://www.w3.org/1999/xhtml';
    this.className = '';
    /** @type {Record<string, string>} */
    this.dataset = {};
    /** @type {Map<string, string>} */
    this.attributes = new Map();
    /** @type {Map<string, Function[]>} */
    this.listeners = new Map();
    /** @type {Map<string, string>} */
    const declarations = new Map();
    /** The inline style, as far as setProperty and getPropertyValue go. */
    this.style = {
      /** @param {string} property @param {string} value */
      setProperty: (property, value) => { declarations.set(property, String(value)); },
      /** @param {string} property */
      getPropertyValue: (property) => declarations.get(property) ?? '',
    };
  }

  /** `class` also lands in className, as it does on an HTML element. @param {string} name @param {string} value */
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'class') this.className = String(value);
  }

  /** @param {string} name */
  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  /** @param {string} name */
  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === 'class') this.className = '';
  }

  /** The `hidden` attribute as a boolean, as HTMLElement reflects it. */
  get hidden() {
    return this.attributes.has('hidden');
  }

  set hidden(value) {
    if (value) this.attributes.set('hidden', '');
    else this.attributes.delete('hidden');
  }

  /**
   * The first element under this one, depth first, that carries the class. Only a single class
   * selector such as `.settings-notice` is understood; anything else throws, so a test never
   * passes on a selector the fake cannot read.
   * @param {string} selector
   * @returns {FakeElement|null}
   */
  querySelector(selector) {
    const match = /^\.([\w-]+)$/.exec(selector);
    if (!match) throw new Error(`The fake DOM's querySelector takes one class selector, not ${selector}`);
    /** @param {FakeNode} node @returns {FakeElement|null} */
    const find = (node) => {
      for (const child of node.childNodes) {
        if (!(child instanceof FakeElement)) continue;
        if (child.classList.contains(match[1])) return child;
        const below = find(child);
        if (below) return below;
      }
      return null;
    };
    return find(this);
  }

  /** @param {string} type @param {Function} listener */
  addEventListener(type, listener) {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  /**
   * Calls the listeners of `type` with a bare event object, as a click would; `init` adds fields
   * such as a keydown's `key`.
   * @param {string} type
   * @param {Record<string, any>} [init]
   */
  dispatch(type, init = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener({ type, target: this, preventDefault() {}, ...init });
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
 * @returns {{ createElement(tag: string): FakeElement, createElementNS(namespace: string, tag: string): FakeElement, createTextNode(data: string): FakeText, documentElement: FakeElement, activeElement: FakeElement|null }}
 */
export function installFakeDom() {
  const document = {
    createElement: (/** @type {string} */ tag) => new FakeElement(tag),
    createElementNS: (/** @type {string} */ namespace, /** @type {string} */ tag) => new FakeElement(tag, namespace),
    createTextNode: (/** @type {string} */ data) => new FakeText(String(data)),
    /** The root element, whose dataset carries the theme. */
    documentElement: new FakeElement('html'),
    /** @type {FakeElement|null} */
    activeElement: null,
  };
  installed = document;
  Object.defineProperty(globalThis, 'document', { value: document, configurable: true, writable: true });
  return document;
}
