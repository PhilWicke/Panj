// The store contract and its in-memory implementation. A StoreAdapter is five named stores of
// records keyed by `id`, each operation its own promise. db.js implements the same contract over
// IndexedDB and falls back to this one where IndexedDB is missing or refuses to open (a private
// window, blocked storage), so the app still runs, with nothing kept past the page; state.js reads
// and writes the app's state through either. Records are copied in and out with structuredClone,
// as IndexedDB copies them, so neither adapter ever aliases the caller's objects.

/** @typedef {'items'|'sessions'|'settings'|'flags'|'meta'} StoreName */

/**
 * Five stores of records keyed by `id`. `get` resolves undefined for a missing key; `put` adds the
 * record or replaces the one with its id; `getAll` returns the records in key order.
 * @typedef {object} StoreAdapter
 * @property {(store: StoreName, key: string) => Promise<any>} get
 * @property {(store: StoreName, value: { id: string }) => Promise<void>} put
 * @property {(store: StoreName) => Promise<any[]>} getAll
 * @property {(store: StoreName, key: string) => Promise<void>} del
 * @property {(store: StoreName) => Promise<void>} clear
 */

/** The stores, the same five in IndexedDB and in memory. @type {readonly StoreName[]} */
export const STORE_NAMES = Object.freeze(['items', 'sessions', 'settings', 'flags', 'meta']);

/**
 * A store that lives as long as the page. It behaves as the IndexedDB adapter does: an unknown
 * store name or a record without a string id is refused (the promise rejects), values are copied
 * on the way in and out, and getAll comes back in key order.
 * @returns {StoreAdapter}
 */
export function createMemoryStore() {
  /** @type {Map<StoreName, Map<string, any>>} */
  const stores = new Map(STORE_NAMES.map((name) => [name, new Map()]));

  /** @param {StoreName} store @returns {Map<string, any>} */
  function table(store) {
    const records = stores.get(store);
    if (!records) throw new RangeError(`Unknown store: ${String(store)}`);
    return records;
  }

  return {
    async get(store, key) {
      return structuredClone(table(store).get(key));
    },
    async put(store, value) {
      const records = table(store);
      if (typeof value?.id !== 'string') throw new TypeError('A record needs a string id');
      records.set(value.id, structuredClone(value));
    },
    async getAll(store) {
      const records = table(store);
      return Array.from(records.keys()).sort().map((key) => structuredClone(records.get(key)));
    },
    async del(store, key) {
      table(store).delete(key);
    },
    async clear(store) {
      table(store).clear();
    },
  };
}
