import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sampleProject } from "./sampleProject";
import { STORAGE_KEY, clearProjectState, loadProjectState, saveProjectState, rehydrateBlobs, } from "./persistProjectState";
import { makeId } from "./ids";
/**
 * Node >=22 exposes a built-in globalThis.localStorage that lacks getItem/setItem.
 * We provide a spec-compliant in-memory Storage to make tests deterministic.
 */
function makeMemoryStorage() {
    const store = new Map();
    return {
        get length() { return store.size; },
        key(index) {
            return [...store.keys()][index] ?? null;
        },
        getItem(key) { return store.get(key) ?? null; },
        setItem(key, value) { store.set(key, value); },
        removeItem(key) { store.delete(key); },
        clear() { store.clear(); },
    };
}
describe("persistProjectState", () => {
    let origStorage;
    beforeEach(() => {
        origStorage = globalThis.localStorage;
        Object.defineProperty(globalThis, "localStorage", {
            value: makeMemoryStorage(),
            writable: true,
            configurable: true,
        });
    });
    afterEach(() => {
        Object.defineProperty(globalThis, "localStorage", {
            value: origStorage,
            writable: true,
            configurable: true,
        });
    });
    it("round-trips: save then load returns deep-equal state", () => {
        const original = sampleProject.state;
        saveProjectState(original);
        const loaded = loadProjectState();
        expect(loaded).toEqual(original);
    });
    it("returns null when nothing is stored", () => {
        expect(loadProjectState()).toBeNull();
    });
    it("returns null and clears key for invalid JSON", () => {
        globalThis.localStorage.setItem(STORAGE_KEY, "not valid json{{{");
        expect(loadProjectState()).toBeNull();
        expect(globalThis.localStorage.getItem(STORAGE_KEY)).toBeNull();
    });
    it("returns null and clears key for Zod-invalid payload", () => {
        globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify({ manifest: "wrong" }));
        expect(loadProjectState()).toBeNull();
        expect(globalThis.localStorage.getItem(STORAGE_KEY)).toBeNull();
    });
    it("clearProjectState removes the key", () => {
        saveProjectState(sampleProject.state);
        expect(globalThis.localStorage.getItem(STORAGE_KEY)).not.toBeNull();
        clearProjectState();
        expect(globalThis.localStorage.getItem(STORAGE_KEY)).toBeNull();
    });
    it("offloads large data-URL payloads so localStorage stays small", () => {
        // Create a state with a huge base64 payload (> 64KB threshold)
        const bigDataUrl = "data:model/gltf-binary;base64," + "A".repeat(100_000);
        const pid = makeId("payload");
        const stateWithBlob = {
            ...sampleProject.state,
            payloads: {
                ...sampleProject.state.payloads,
                [pid]: {
                    id: pid,
                    kind: "Payload",
                    mediaType: "model/gltf-binary",
                    uri: bigDataUrl,
                    sha256: "fake",
                    bytes: 100_000,
                    meta: {},
                },
            },
        };
        saveProjectState(stateWithBlob);
        // The localStorage copy should have an idb:// reference, not the full URI
        const raw = globalThis.localStorage.getItem(STORAGE_KEY);
        expect(raw).not.toBeNull();
        expect(raw).not.toContain("AAAAAAA");
        expect(raw).toContain("idb://blob/");
        // loadProjectState still succeeds (returns idb:// refs as-is)
        const loaded = loadProjectState();
        expect(loaded).not.toBeNull();
        expect(loaded.payloads[pid].uri).toMatch(/^idb:\/\/blob\//);
    });
    it("rehydrateBlobs is a no-op when no idb refs present", async () => {
        const state = sampleProject.state;
        const result = await rehydrateBlobs(state);
        expect(result).toBe(state); // same reference — nothing changed
    });
});
