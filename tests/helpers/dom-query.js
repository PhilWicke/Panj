// tests/helpers/dom-query.js
// The tree walkers the UI tests share: every element under a root, depth first, and those of them
// that carry a class. They read only childNodes, tagName and classList, so they walk the tree
// tests/helpers/fake-dom.js builds; text nodes have no tagName and are skipped.

/** Every element under `root`, depth first. @param {any} root @returns {any[]} */
export function elements(root) {
  /** @type {any[]} */
  const found = [];
  /** @param {any} node */
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (!child.tagName) continue;
      found.push(child);
      walk(child);
    }
  };
  walk(root);
  return found;
}

/** The elements under `root` that carry the class, depth first. @param {any} root @param {string} className @returns {any[]} */
export const withClass = (root, className) => elements(root).filter((e) => e.classList.contains(className));
