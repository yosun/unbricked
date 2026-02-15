import { ProjectStateSchema } from "./schema";
import type { ProjectState } from "./types";

export const STORAGE_KEY = "unbricked.projectState.v1";

function getStorage(): Storage | null {
  try {
    // In browsers, window.localStorage is the standard Web Storage API.
    // Node >=22 exposes a globalThis.localStorage that lacks setItem/getItem,
    // so we gate on the presence of the standard method.
    const s = globalThis.localStorage;
    if (typeof s.getItem === "function") return s;
    return null;
  } catch {
    return null;
  }
}

/**
 * Load persisted ProjectState from localStorage.
 * Returns null (and clears the key) on any failure — missing, invalid JSON, or Zod validation error.
 */
export function loadProjectState(): ProjectState | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    const result = ProjectStateSchema.safeParse(parsed);
    if (!result.success) {
      storage.removeItem(STORAGE_KEY);
      return null;
    }
    return result.data as ProjectState;
  } catch {
    storage.removeItem(STORAGE_KEY);
    return null;
  }
}

/**
 * Persist ProjectState to localStorage. Silently swallows errors (e.g. quota exceeded).
 */
export function saveProjectState(state: ProjectState): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // quota exceeded or SecurityError in restrictive environments — ignore
  }
}

/**
 * Remove persisted ProjectState from localStorage.
 */
export function clearProjectState(): void {
  const storage = getStorage();
  if (!storage) return;
  storage.removeItem(STORAGE_KEY);
}
