/** Project Preferences — persisted in localStorage, not undoable. */
const PREFS_KEY = "unbricked.preferences.v1";
const DEFAULT_PREFS = {
    defaultImageOperationId: "sam3.segment",
    defaultAiEditModelId: "nano-banana",
};
export function loadPreferences() {
    try {
        const raw = localStorage.getItem(PREFS_KEY);
        if (!raw)
            return { ...DEFAULT_PREFS };
        const parsed = JSON.parse(raw);
        return {
            defaultImageOperationId: typeof parsed.defaultImageOperationId === "string"
                ? parsed.defaultImageOperationId
                : DEFAULT_PREFS.defaultImageOperationId,
            defaultAiEditModelId: typeof parsed.defaultAiEditModelId === "string"
                ? parsed.defaultAiEditModelId
                : DEFAULT_PREFS.defaultAiEditModelId,
        };
    }
    catch {
        return { ...DEFAULT_PREFS };
    }
}
export function savePreferences(prefs) {
    try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    }
    catch {
        // quota exceeded — ignore
    }
}
