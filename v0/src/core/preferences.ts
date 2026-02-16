/** Project Preferences — persisted in localStorage, not undoable. */

const PREFS_KEY = "unbricked.preferences.v1";

export interface ProjectPreferences {
  defaultImageOperationId: string;
}

const DEFAULT_PREFS: ProjectPreferences = {
  defaultImageOperationId: "sam3.segment",
};

export function loadPreferences(): ProjectPreferences {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<ProjectPreferences>;
    return {
      defaultImageOperationId:
        typeof parsed.defaultImageOperationId === "string"
          ? parsed.defaultImageOperationId
          : DEFAULT_PREFS.defaultImageOperationId,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePreferences(prefs: ProjectPreferences): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // quota exceeded — ignore
  }
}
