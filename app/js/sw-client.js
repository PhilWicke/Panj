// Registration of the service worker and the update flow (Ruling 58), kept out of main.js. The
// worker is registered as a module with updateViaCache none where a worker can run: https, or
// localhost and 127.0.0.1 in development. Its URL carries the version (`sw.js?v=...`),
// so a new version is a new script URL and installs as a fresh worker: Chromium's update check
// for a module worker whose own bytes are unchanged fails to start the new worker when the module
// that changed is its first or a nested import (version.js here; found in the Task 19 browser
// check), so the byte comparison cannot be relied on. onUpdate is called when a new version is
// ready: a worker waiting at registration time, a new worker installed while this page is
// controlled by the old one, or a worker that activated (another tab's Reload) with a version
// other than this page's. It gets `reload`, which the toast's Reload button calls: it asks the
// waiting worker to skip waiting and reloads the page once that worker controls it, or reloads
// at once when the new worker already does. The page never reloads otherwise: a controller
// change without the tap changes nothing on screen.

import { SLOVELINGO_VERSION } from '../version.js';

/** The worker's URL for this version of the page, relative to the page. */
const WORKER_URL = `./sw.js?v=${encodeURIComponent(SLOVELINGO_VERSION)}`;

/** Hosts where a worker runs over plain http. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

/** Whether a worker can run on this page. @param {Location} location */
const workerAllowed = (location) => location.protocol === 'https:' || LOCAL_HOSTS.has(location.hostname);

/**
 * @param {{ onUpdate: (update: { reload: () => void }) => void }} options `onUpdate` shows the
 *   learner that a new version is ready; `reload` is what its Reload action calls
 * @returns {Promise<ServiceWorkerRegistration|null>} the registration, or null where no worker runs
 */
export async function registerWorker({ onUpdate }) {
  if (!('serviceWorker' in navigator) || !workerAllowed(location)) return null;
  const container = navigator.serviceWorker;
  /** @type {ServiceWorkerRegistration|null} */
  let registration = null;
  /** Set by the Reload tap; only then does a controller change reload the page. */
  let reloadRequested = false;

  const reload = () => {
    reloadRequested = true;
    const waiting = registration?.waiting;
    if (waiting) waiting.postMessage({ type: 'skip-waiting' });
    else location.reload();
  };
  const announce = () => onUpdate({ reload });

  container.addEventListener('controllerchange', () => {
    if (reloadRequested) location.reload();
  });
  container.addEventListener('message', (event) => {
    const data = event.data;
    if (data && data.type === 'updated' && data.version !== SLOVELINGO_VERSION) announce();
  });

  try {
    registration = await container.register(WORKER_URL, { type: 'module', updateViaCache: 'none' });
  } catch (error) {
    console.error('The service worker could not be registered.', error);
    return null;
  }
  const current = registration;
  if (current.waiting) announce();
  current.addEventListener('updatefound', () => {
    const installing = current.installing;
    if (!installing) return;
    installing.addEventListener('statechange', () => {
      if (installing.state === 'installed' && container.controller) announce();
    });
  });
  return current;
}
