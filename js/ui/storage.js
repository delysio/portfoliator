// IndexedDB persistence for the battery-backed RAM and memory card images.
// The Portfolio keeps everything in NVRAM, so losing this is equivalent to
// pulling the batteries out.

const DB_NAME = 'portaliator';
const DB_VERSION = 1;
const STORE = 'blobs';

// Two Portfoliator tabs on the same origin share one database, and both flush
// NVRAM every few seconds - without separate key namespaces the second tab
// would silently overwrite the first one's C: drive. Each tab therefore claims
// a slot at boot; slot 0 keeps the original keys so a single tab is unaffected.
const MAX_SLOTS = 8;

let dbPromise = null;
let prefix = '';

export let instanceSlot = 0;

/**
 * Takes the lowest slot no other open tab holds. Web Locks does the arbitration:
 * a lock is granted to exactly one holder and released when its page goes away,
 * so tabs opened at the same instant cannot both end up with slot 0 - which is
 * precisely what a broadcast-and-wait handshake gets wrong.
 *
 * Where the API is missing, every tab stays on slot 0, i.e. the old behaviour.
 */
export function claimInstance() {
  if (typeof navigator === 'undefined' || !navigator.locks) return Promise.resolve(0);

  return new Promise((resolve) => {
    const settle = (slot) => {
      instanceSlot = slot;
      prefix = slot === 0 ? '' : `#${slot}:`;
      resolve(slot);
    };

    const attempt = (slot) => {
      if (slot >= MAX_SLOTS) { settle(0); return; }

      navigator.locks.request(`portfoliator-slot-${slot}`, { ifAvailable: true }, (lock) => {
        if (!lock) { attempt(slot + 1); return; }   // held by another tab
        settle(slot);
        // Never resolving keeps the lock for as long as this page lives.
        return new Promise(() => {});
      }).catch(() => settle(0));
    };

    attempt(0);
  });
}

function openDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return dbPromise;
}

async function write(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function read(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function drop(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export const put = (key, value) => write(prefix + key, value);
export const get = (key) => read(prefix + key);
export const remove = (key) => drop(prefix + key);

// Keys every instance slot sees, prefix or no prefix. NVRAM and card images are
// rightly per-tab - two Portfolios should not share a C: drive - but the ROM is
// the identity of the machine rather than its state, and asking the second tab
// for the same four files would be absurd.
export const putShared = (key, value) => write(key, value);
export const getShared = (key) => read(key);
export const removeShared = (key) => drop(key);

/**
 * Asks the browser to keep this origin's storage out of the eviction pool.
 * Without it a low-disk condition can drop the whole database - which costs the
 * user not just the ROM images but their NVRAM and cards as well. Best effort:
 * some browsers grant it silently, some tie it to an install or engagement
 * heuristic, and Firefox prompts. A refusal is not an error.
 */
export async function requestPersistence() {
  if (!navigator.storage || !navigator.storage.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
