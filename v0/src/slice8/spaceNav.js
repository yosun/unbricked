const ORIGIN_KEY = "unbricked.originSpaceId";
const ADVANCED_KEY = "unbricked.slice8.advanced";
export function parseSpaceIdFromHash(hash) {
    // expected: #space_<id>
    const m = hash.match(/^#(space_.+)$/);
    return m?.[1] ?? null;
}
export function getCurrentSpaceId() {
    return parseSpaceIdFromHash(window.location.hash);
}
export function setHashSpace(spaceId, mode = "push") {
    const nextHash = `#${spaceId}`;
    if (mode === "replace") {
        window.history.replaceState({ spaceId }, "", nextHash);
    }
    else {
        window.location.hash = nextHash; // push onto browser history automatically
    }
}
export function buildSpaceUrl(spaceId) {
    const url = new URL(window.location.href);
    url.hash = spaceId;
    return url.toString();
}
export function loadOriginSpaceId() {
    const v = localStorage.getItem(ORIGIN_KEY);
    if (v && v.startsWith("space_"))
        return v;
    return null;
}
export function saveOriginSpaceId(spaceId) {
    localStorage.setItem(ORIGIN_KEY, spaceId);
}
export function loadAdvancedToggle() {
    return localStorage.getItem(ADVANCED_KEY) === "1";
}
export function saveAdvancedToggle(v) {
    localStorage.setItem(ADVANCED_KEY, v ? "1" : "0");
}
export function shortSpaceLabel(spaceId) {
    // Strip the "space_" prefix, then abbreviate the ULID portion
    const raw = spaceId.slice(6);
    if (raw.length <= 10)
        return `Space ${raw}`;
    return `Space ${raw.slice(0, 6)}…${raw.slice(-4)}`;
}
