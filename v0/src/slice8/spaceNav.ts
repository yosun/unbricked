// src/slice8/spaceNav.ts
import type { SpaceId } from "../core";

const ORIGIN_KEY = "unbricked.originSpaceId";
const ADVANCED_KEY = "unbricked.slice8.advanced";

export function parseSpaceIdFromHash(hash: string): SpaceId | null {
  // expected: #space_<id>
  const m = hash.match(/^#(space_.+)$/);
  return (m?.[1] as SpaceId | undefined) ?? null;
}

export function getCurrentSpaceId(): SpaceId | null {
  return parseSpaceIdFromHash(window.location.hash);
}

export function setHashSpace(spaceId: SpaceId, mode: "push" | "replace" = "push"): void {
  const nextHash = `#${spaceId}`;
  if (mode === "replace") {
    window.history.replaceState({ spaceId }, "", nextHash);
  } else {
    window.location.hash = nextHash; // push onto browser history automatically
  }
}

export function buildSpaceUrl(spaceId: SpaceId): string {
  const url = new URL(window.location.href);
  url.hash = spaceId;
  return url.toString();
}

export function loadOriginSpaceId(): SpaceId | null {
  const v = localStorage.getItem(ORIGIN_KEY);
  if (v && v.startsWith("space_")) return v as SpaceId;
  return null;
}

export function saveOriginSpaceId(spaceId: SpaceId): void {
  localStorage.setItem(ORIGIN_KEY, spaceId);
}

export function loadAdvancedToggle(): boolean {
  return localStorage.getItem(ADVANCED_KEY) === "1";
}

export function saveAdvancedToggle(v: boolean): void {
  localStorage.setItem(ADVANCED_KEY, v ? "1" : "0");
}

export function shortSpaceLabel(spaceId: SpaceId): string {
  // Strip the "space_" prefix, then abbreviate the ULID portion
  const raw = spaceId.slice(6);
  if (raw.length <= 10) return `Space ${raw}`;
  return `Space ${raw.slice(0, 6)}…${raw.slice(-4)}`;
}
