// The IndexedDB store: one database, one object store per StoreName with keyPath `id`, one
// transaction per operation. openStore is what the app boots with: IndexedDB when it opens, the
// memory store (memory.js) when it is missing, refuses (a private window, blocked storage) or is
// blocked by another tab that holds an older version open, reported as `persistent: false` so
// Today can say that progress will not outlive the page. Version 1 creates the five stores in
// onupgradeneeded; a later version migrates there too.

import { STORE_NAMES, createMemoryStore } from './memory.js';

/** @typedef {import('./memory.js').StoreName} StoreName */
/** @typedef {import('./memory.js').StoreAdapter} StoreAdapter */

export const DB_NAME = 'slovelingo';
export const DB_VERSION = 1;

/**
 * Runs one request in its own transaction and resolves with its result once the transaction has
 * committed, so a resolved write is on disk. A request or transaction error rejects.
 * @param {IDBDatabase} db
 * @param {StoreName} store
 * @param {IDBTransactionMode} mode
 * @param {(objectStore: IDBObjectStore) => IDBRequest} operate
 * @returns {Promise<any>}
 */
function run(db, store, mode, operate) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = operate(tx.objectStore(store));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error ?? request.error ?? new Error(`Transaction on ${store} failed`));
    tx.onabort = () => reject(tx.error ?? request.error ?? new Error(`Transaction on ${store} aborted`));
  });
}

/**
 * @param {IDBDatabase} db
 * @returns {StoreAdapter}
 */
function adapterFor(db) {
  return {
    async get(store, key) {
      return run(db, store, 'readonly', (objectStore) => objectStore.get(key));
    },
    async put(store, value) {
      await run(db, store, 'readwrite', (objectStore) => objectStore.put(value));
    },
    async getAll(store) {
      return run(db, store, 'readonly', (objectStore) => objectStore.getAll());
    },
    async del(store, key) {
      await run(db, store, 'readwrite', (objectStore) => objectStore.delete(key));
    },
    async clear(store) {
      await run(db, store, 'readwrite', (objectStore) => objectStore.clear());
    },
  };
}

/**
 * Opens the database, creating any of the five object stores it lacks. Rejects when IndexedDB is
 * missing, when `open` throws (a context without storage), when the request fails (blocked or
 * full storage) or when it is blocked by another tab that holds an older version open and does not
 * close it, since such an open may never finish.
 * @param {string} [name]
 * @param {number} [version]
 * @returns {Promise<StoreAdapter>}
 */
export function openIndexedDb(name = DB_NAME, version = DB_VERSION) {
  return new Promise((resolve, reject) => {
    /** @type {IDBFactory|undefined} */
    const factory = globalThis.indexedDB;
    if (!factory) {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const request = factory.open(name, version);
    let blocked = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of STORE_NAMES) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: 'id' });
      }
    };
    request.onblocked = () => {
      blocked = true;
      reject(new Error('IndexedDB open is blocked by another tab'));
    };
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) {
        // The other tab closed after all, but this page already runs on memory: close the
        // connection rather than leave one open that would block the next upgrade.
        db.close();
        return;
      }
      // Another tab is upgrading to a newer version: close so it is not blocked. Operations on this
      // page then fail until it is reloaded, which is the better of the two failure modes.
      db.onversionchange = () => db.close();
      resolve(adapterFor(db));
    };
    request.onerror = () => reject(request.error ?? new Error('IndexedDB could not be opened'));
  });
}

/**
 * The store the app runs on: IndexedDB, or memory when it cannot be opened, with `persistent`
 * false on the fallback (export still works there). A blocked open (another tab holds an older
 * version and does not close it) falls back the same way, so the app can show that progress is
 * not being saved instead of waiting on a request that may never finish.
 * @returns {Promise<{ adapter: StoreAdapter, persistent: boolean }>}
 */
export async function openStore() {
  try {
    return { adapter: await openIndexedDb(), persistent: true };
  } catch {
    return { adapter: createMemoryStore(), persistent: false };
  }
}
