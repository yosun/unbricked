import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sampleProject } from "./sampleProject";
import {
  STORAGE_KEY,
  clearProjectState,
  loadProjectState,
  saveProjectState,
} from "./persistProjectState";

/**
 * Node >=22 exposes a built-in globalThis.localStorage that lacks getItem/setItem.
 * We provide a spec-compliant in-memory Storage to make tests deterministic.
 */
function makeMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() { return store.size; },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    getItem(key: string) { return store.get(key) ?? null; },
    setItem(key: string, value: string) { store.set(key, value); },
    removeItem(key: string) { store.delete(key); },
    clear() { store.clear(); },
  };
}

describe("persistProjectState", () => {
  let origStorage: Storage;

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
});
