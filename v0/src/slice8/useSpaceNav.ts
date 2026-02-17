// src/slice8/useSpaceNav.ts
import { useEffect, useMemo, useState } from "react";
import type { SpaceId } from "../core";
import {
  getCurrentSpaceId,
  setHashSpace,
  loadOriginSpaceId,
  saveOriginSpaceId,
  buildSpaceUrl,
  loadAdvancedToggle,
  saveAdvancedToggle,
} from "./spaceNav";

export interface NavigateOptions {
  replace?: boolean;
  /** Optional async callback invoked before the hash changes (e.g. camera animation). */
  beforeNavigate?: (to: SpaceId) => Promise<void> | void;
}

export interface SpaceNavApi {
  current: SpaceId;
  origin: SpaceId;
  advanced: boolean;
  navigateTo: (spaceId: SpaceId, opts?: NavigateOptions) => Promise<void>;
  setOrigin: (spaceId: SpaceId) => void;
  goOrigin: (opts?: NavigateOptions) => Promise<void>;
  copyLink: (spaceId: SpaceId) => Promise<string>;
  toggleAdvanced: (v: boolean) => void;
}

export function useSpaceNav(fallbackSpaceId: SpaceId): SpaceNavApi {
  const [current, setCurrent] = useState<SpaceId>(
    () => getCurrentSpaceId() ?? fallbackSpaceId,
  );
  const [origin, setOriginState] = useState<SpaceId>(
    () => loadOriginSpaceId() ?? fallbackSpaceId,
  );
  const [advanced, setAdvanced] = useState<boolean>(() => loadAdvancedToggle());

  // Initialise hash on mount if empty
  useEffect(() => {
    if (!getCurrentSpaceId()) {
      setHashSpace(current, "replace");
    }
  }, []);

  // Sync on hashchange (covers browser back/forward + manual hash edits)
  useEffect(() => {
    const onHash = () => {
      const id = getCurrentSpaceId();
      if (id) setCurrent(id);
    };
    window.addEventListener("hashchange", onHash);
    return () => { window.removeEventListener("hashchange", onHash); };
  }, []);

  const api = useMemo(() => {
    async function navigateTo(spaceId: SpaceId, opts: NavigateOptions = {}): Promise<void> {
      if (opts.beforeNavigate) await opts.beforeNavigate(spaceId);
      setHashSpace(spaceId, opts.replace ? "replace" : "push");
      // Also set directly — hashchange won't fire if the hash value is unchanged
      setCurrent(spaceId);
    }

    function setOrigin(spaceId: SpaceId): void {
      setOriginState(spaceId);
      saveOriginSpaceId(spaceId);
    }

    async function goOrigin(opts: NavigateOptions = {}): Promise<void> {
      return navigateTo(origin, opts);
    }

    async function copyLink(spaceId: SpaceId): Promise<string> {
      const url = buildSpaceUrl(spaceId);
      await navigator.clipboard.writeText(url);
      return url;
    }

    function toggleAdvanced(v: boolean): void {
      setAdvanced(v);
      saveAdvancedToggle(v);
    }

    return { navigateTo, setOrigin, goOrigin, copyLink, toggleAdvanced };
  }, [origin]);

  return { current, origin, advanced, ...api };
}
