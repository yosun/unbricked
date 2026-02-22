import { ProjectStateSchema } from "./schema";
export const STORAGE_KEY = "unbricked.projectState.v1";
const IDB_NAME = "unbricked";
const IDB_STORE = "blobs";
const IDB_VERSION = 1;
/** Payloads with data-URL URIs larger than this are offloaded to IndexedDB. */
const BLOB_THRESHOLD = 64 * 1024; // 64 KB
/** Sentinel prefix stored in the payload URI when the real data lives in IDB. */
const IDB_REF_PREFIX = "idb://blob/";
function getStorage() {
    try {
        // In browsers, window.localStorage is the standard Web Storage API.
        // Node >=22 exposes a globalThis.localStorage that lacks setItem/getItem,
        // so we gate on the presence of the standard method.
        const s = globalThis.localStorage;
        if (typeof s.getItem === "function")
            return s;
        return null;
    }
    catch {
        return null;
    }
}
// ── IndexedDB helpers (best-effort, no hard dependency) ──────────────
function openBlobDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(IDB_NAME, IDB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(IDB_STORE)) {
                db.createObjectStore(IDB_STORE);
            }
        };
        req.onsuccess = () => { resolve(req.result); };
        req.onerror = () => { reject(req.error); };
    });
}
function idbPut(db, key, value) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).put(value, key);
        tx.oncomplete = () => { resolve(); };
        tx.onerror = () => { reject(tx.error); };
    });
}
function idbGet(db, key) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readonly");
        const req = tx.objectStore(IDB_STORE).get(key);
        req.onsuccess = () => { resolve(req.result); };
        req.onerror = () => { reject(req.error); };
    });
}
function idbClear(db) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).clear();
        tx.oncomplete = () => { resolve(); };
        tx.onerror = () => { reject(tx.error); };
    });
}
function hasIDB() {
    try {
        return typeof indexedDB !== "undefined";
    }
    catch {
        return false;
    }
}
// ── Public API (sync wrappers kept for backward compat) ──────────────
/**
 * Load persisted ProjectState from localStorage.
 * Returns null (and clears the key) on any failure — missing, invalid JSON, or Zod validation error.
 *
 * NOTE: this is the *synchronous* fast path — it returns the state with IDB
 * blob references *unresolved*.  Call `rehydrateBlobs` afterward to restore
 * full data-URL URIs asynchronously.
 */
export function loadProjectState() {
    const storage = getStorage();
    if (!storage)
        return null;
    try {
        const raw = storage.getItem(STORAGE_KEY);
        if (raw === null)
            return null;
        const parsed = JSON.parse(raw);
        const result = ProjectStateSchema.safeParse(parsed);
        if (!result.success) {
            storage.removeItem(STORAGE_KEY);
            return null;
        }
        return result.data;
    }
    catch {
        storage.removeItem(STORAGE_KEY);
        return null;
    }
}
/**
 * After loadProjectState, resolve any `idb://blob/…` payload URIs back to
 * their full data-URL values from IndexedDB.
 * Returns a new state (or the same reference if nothing changed).
 */
export async function rehydrateBlobs(state) {
    if (!hasIDB())
        return state;
    // Collect payload IDs whose URIs need rehydration
    const toResolve = [];
    for (const [pid, p] of Object.entries(state.payloads)) {
        if (p.uri.startsWith(IDB_REF_PREFIX)) {
            toResolve.push({ pid: pid, key: p.uri.slice(IDB_REF_PREFIX.length) });
        }
    }
    if (toResolve.length === 0)
        return state;
    try {
        const db = await openBlobDB();
        const patched = { ...state, payloads: { ...state.payloads } };
        for (const { pid, key } of toResolve) {
            const value = await idbGet(db, key);
            if (value) {
                patched.payloads[pid] = { ...patched.payloads[pid], uri: value };
            }
        }
        db.close();
        return patched;
    }
    catch {
        return state;
    }
}
/**
 * Persist ProjectState to localStorage, offloading large data-URL
 * payloads to IndexedDB so we stay within the localStorage quota.
 */
export function saveProjectState(state) {
    const storage = getStorage();
    if (!storage)
        return;
    // Identify payloads whose URIs should be offloaded
    const offloads = [];
    let slim = state;
    for (const [pid, p] of Object.entries(state.payloads)) {
        if (p.uri.length > BLOB_THRESHOLD && p.uri.startsWith("data:")) {
            offloads.push({ pid: pid, uri: p.uri });
        }
    }
    if (offloads.length > 0) {
        // Build a "slim" copy with IDB references instead of full data URLs
        const slimPayloads = { ...state.payloads };
        for (const { pid } of offloads) {
            slimPayloads[pid] = { ...slimPayloads[pid], uri: `${IDB_REF_PREFIX}${pid}` };
        }
        slim = { ...state, payloads: slimPayloads };
    }
    try {
        storage.setItem(STORAGE_KEY, JSON.stringify(slim));
    }
    catch {
        // quota exceeded or SecurityError — ignore
    }
    // Write the large blobs to IndexedDB (fire-and-forget)
    if (offloads.length > 0 && hasIDB()) {
        void (async () => {
            try {
                const db = await openBlobDB();
                for (const { pid, uri } of offloads) {
                    await idbPut(db, pid, uri);
                }
                db.close();
            }
            catch {
                // IDB unavailable — blobs won't survive reload, same as before
            }
        })();
    }
}
/**
 * Remove persisted ProjectState from localStorage and IndexedDB.
 */
export function clearProjectState() {
    const storage = getStorage();
    if (!storage)
        return;
    storage.removeItem(STORAGE_KEY);
    if (hasIDB()) {
        void (async () => {
            try {
                const db = await openBlobDB();
                await idbClear(db);
                db.close();
            }
            catch { /* ignore */ }
        })();
    }
}
