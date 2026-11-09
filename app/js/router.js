// Hash routing. A route is the part of location.hash after `#`: a path such as `/today` with an
// optional query, `/session?mode=continue`, whose pairs arrive as params. Hash routes need no
// server rewrite, so the app runs from any static folder. navigate() to the route already showing
// still runs the handlers, so "start another session" from the session screen starts one.

/** @typedef {(path: string, params: Record<string, string>) => void} RouteHandler */

/** @type {Set<RouteHandler>} */
const handlers = new Set();
let listening = false;

/**
 * @param {string} hash `#/session?mode=continue`, or empty
 * @returns {{ path: string, params: Record<string, string> }}
 */
function parseRoute(hash) {
  const route = hash.replace(/^#/, '');
  const queryAt = route.indexOf('?');
  const path = (queryAt === -1 ? route : route.slice(0, queryAt)) || '/';
  const params = Object.fromEntries(new URLSearchParams(queryAt === -1 ? '' : route.slice(queryAt + 1)));
  return { path: path.startsWith('/') ? path : `/${path}`, params };
}

/** @returns {string} the path of the current route, `/` when there is none */
export function currentPath() {
  return parseRoute(location.hash).path;
}

/** @returns {Record<string, string>} the params of the current route */
export function currentParams() {
  return parseRoute(location.hash).params;
}

function dispatch() {
  const { path, params } = parseRoute(location.hash);
  for (const handler of handlers) handler(path, params);
}

/**
 * Goes to a route. `replace` swaps the current history entry instead of adding one, for redirects.
 * @param {string} path `/today`, `/session?mode=continue`
 * @param {{ replace?: boolean }} [options]
 */
export function navigate(path, options = {}) {
  const hash = `#${path}`;
  if (location.hash === hash) {
    dispatch();
  } else if (options.replace) {
    location.replace(hash);
  } else {
    location.hash = hash;
  }
}

/**
 * Calls `handler` on every route change from now on.
 * @param {RouteHandler} handler
 * @returns {() => void} removes the handler
 */
export function onRoute(handler) {
  if (!listening) {
    window.addEventListener('hashchange', dispatch);
    listening = true;
  }
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}
