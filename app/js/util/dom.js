// The two DOM helpers the screens build with. h(tag, props, ...children) creates an element, sets
// its props and appends its children, so a screen reads as a tree of calls; svg(tag, props,
// ...children) does the same in the SVG namespace, for the hive. Props: `class` sets the class
// name, `on*` functions become event listeners (`onclick` listens for `click`), `data-*` lands in
// dataset, `style` takes an object of CSS properties (camelCase or kebab-case, custom properties
// too), `true` is a bare boolean attribute, `false`, null and undefined leave the prop out, and
// everything else is an attribute. Children may be strings, numbers, nodes, or arrays of them,
// nested; null, undefined and false are skipped, so conditions read inline.

/** @typedef {Node|string|number|boolean|null|undefined} Leaf */
/** @typedef {Leaf|Array<Leaf|Array<Leaf>>} Child children nest two arrays deep, as a list of mapped lists does */

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * @param {string} tag
 * @param {Record<string, any>|null} [props]
 * @param {...Child} children
 * @returns {HTMLElement}
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  setProps(el, props, (value) => { el.className = value; });
  append(el, children);
  return el;
}

/**
 * An element in the SVG namespace, with its props and children as h() takes them. The class goes
 * through the attribute, since an SVG element's className is not a string.
 * @param {string} tag `svg`, `g`, `rect`, `polygon`, `text`, `clipPath`, ...
 * @param {Record<string, any>|null} [props]
 * @param {...Child} children
 * @returns {SVGElement}
 */
export function svg(tag, props, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  setProps(el, props, (value) => el.setAttribute('class', value));
  append(el, children);
  return el;
}

/**
 * Sets the props as the module comment describes them.
 * @param {HTMLElement|SVGElement} el
 * @param {Record<string, any>|null|undefined} props
 * @param {(value: string) => void} setClass how this element takes its class name
 */
function setProps(el, props, setClass) {
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') {
      setClass(String(value));
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key.startsWith('data-')) {
      el.dataset[camelCase(key.slice(5))] = String(value);
    } else if (key === 'style' && typeof value === 'object') {
      for (const [property, setting] of Object.entries(value)) {
        if (setting !== undefined && setting !== null) el.style.setProperty(kebabCase(property), String(setting));
      }
    } else {
      el.setAttribute(key, value === true ? '' : String(value));
    }
  }
}

/**
 * Appends children as h() does: nodes as they are, strings and numbers as text, arrays flattened,
 * null, undefined and false skipped.
 * @param {Node} parent
 * @param {Child[]} children
 */
function append(parent, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false || child === true) continue;
    if (Array.isArray(child)) append(parent, child);
    else if (typeof child === 'string' || typeof child === 'number') parent.appendChild(document.createTextNode(String(child)));
    else parent.appendChild(child);
  }
}

/**
 * Replaces the children of `parent` with `children`.
 * @param {HTMLElement} parent
 * @param {...Child} children
 */
export function mount(parent, ...children) {
  parent.replaceChildren();
  append(parent, children);
}

/** @param {string} name `item-id` @returns {string} `itemId` */
function camelCase(name) {
  return name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

/** @param {string} name `fontSize` or `--gap` @returns {string} `font-size` or `--gap` */
function kebabCase(name) {
  return name.startsWith('--') ? name : name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}
