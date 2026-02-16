import { useCallback, useEffect, useRef, useState } from "react";
import type { SpaceId } from "../core";

/**
 * Camera pose snapshot stored with each navigation entry.
 * The actual camera restore happens via the `AnimPhase` system.
 */
export interface CameraPose {
  x: number;
  y: number;
  z: number;
}

export interface NavEntry {
  spaceId: SpaceId;
  camera: CameraPose;
}

interface SpaceNav {
  /** Currently active Space ID. */
  currentSpaceId: SpaceId;
  /** Navigate into a different space (pushes history). */
  navigateTo: (spaceId: SpaceId) => void;
  /** Go back (returns true if there was somewhere to go). */
  goBack: () => boolean;
  /** Go forward (returns true if there was somewhere to go). */
  goForward: () => boolean;
  /** Whether back is available. */
  canGoBack: boolean;
  /** Whether forward is available. */
  canGoForward: boolean;
  /** Set the "origin" space the user can quick-return to. */
  setOrigin: (spaceId: SpaceId) => void;
  /** Return to origin (no-op if no origin set). */
  returnToOrigin: () => void;
  /** The current origin space, if set. */
  origin: SpaceId | null;
  /** Update the camera pose snapshot for the current entry (call on navigate-away). */
  snapshotCamera: (pose: CameraPose) => void;
  /** Whether a spatial transition is in progress. */
  isTransitioning: boolean;
  /** Signal that the transition animation completed. */
  onTransitionDone: () => void;
}

/** Parse the current URL hash for a space ID, e.g. `#space_01J...` */
function spaceIdFromHash(): SpaceId | null {
  const hash = window.location.hash.slice(1); // strip '#'
  if (hash.startsWith("space_") && hash.length > 6) {
    return hash as SpaceId;
  }
  return null;
}

function pushHash(spaceId: SpaceId): void {
  const newUrl = `${window.location.pathname}#${spaceId}`;
  window.history.pushState({ spaceId }, "", newUrl);
}

function replaceHash(spaceId: SpaceId): void {
  const newUrl = `${window.location.pathname}#${spaceId}`;
  window.history.replaceState({ spaceId }, "", newUrl);
}

/**
 * Hook managing spatial navigation state + browser history integration.
 * Coordinates with CameraRig via the `isTransitioning` flag.
 */
export function useSpaceNav(rootSpaceId: SpaceId): SpaceNav {
  // Resolve initial space from URL hash or fall back to root
  const initialSpace = spaceIdFromHash() ?? rootSpaceId;

  const [currentSpaceId, setCurrentSpaceId] = useState<SpaceId>(initialSpace);
  const [origin, setOriginState] = useState<SpaceId | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Internal nav stacks (separate from browser history for canGoBack/Forward UI)
  const backStack = useRef<NavEntry[]>([]);
  const forwardStack = useRef<NavEntry[]>([]);
  const currentCamera = useRef<CameraPose>({ x: 6, y: 5, z: 6 });

  // Ensure the initial hash is set on mount
  const initialRef = useRef(currentSpaceId);
  useEffect(() => {
    replaceHash(initialRef.current);
  }, []);

  const snapshotCamera = useCallback((pose: CameraPose) => {
    currentCamera.current = pose;
  }, []);

  const navigateTo = useCallback(
    (spaceId: SpaceId) => {
      if (spaceId === currentSpaceId) return;
      // Push current onto back stack
      backStack.current = [
        ...backStack.current,
        { spaceId: currentSpaceId, camera: { ...currentCamera.current } },
      ];
      // Clear forward stack on new navigation
      forwardStack.current = [];
      setCurrentSpaceId(spaceId);
      setIsTransitioning(true);
      pushHash(spaceId);
    },
    [currentSpaceId],
  );

  const goBack = useCallback((): boolean => {
    const entry = backStack.current[backStack.current.length - 1];
    if (!entry) return false;
    backStack.current = backStack.current.slice(0, -1);
    forwardStack.current = [
      { spaceId: currentSpaceId, camera: { ...currentCamera.current } },
      ...forwardStack.current,
    ];
    setCurrentSpaceId(entry.spaceId);
    setIsTransitioning(true);
    replaceHash(entry.spaceId);
    return true;
  }, [currentSpaceId]);

  const goForward = useCallback((): boolean => {
    const entry = forwardStack.current[0];
    if (!entry) return false;
    forwardStack.current = forwardStack.current.slice(1);
    backStack.current = [
      ...backStack.current,
      { spaceId: currentSpaceId, camera: { ...currentCamera.current } },
    ];
    setCurrentSpaceId(entry.spaceId);
    setIsTransitioning(true);
    replaceHash(entry.spaceId);
    return true;
  }, [currentSpaceId]);

  const setOrigin = useCallback((spaceId: SpaceId) => {
    setOriginState(spaceId);
  }, []);

  const returnToOrigin = useCallback(() => {
    if (origin && origin !== currentSpaceId) {
      navigateTo(origin);
    }
  }, [origin, currentSpaceId, navigateTo]);

  const onTransitionDone = useCallback(() => {
    setIsTransitioning(false);
  }, []);

  // Listen for browser popstate (back/forward buttons)
  useEffect(() => {
    const handler = (e: PopStateEvent) => {
      const state = e.state as { spaceId?: string } | null;
      const targetId = (state?.spaceId as SpaceId | undefined) ?? spaceIdFromHash();
      if (targetId && targetId !== currentSpaceId) {
        setCurrentSpaceId(targetId);
        setIsTransitioning(true);
      }
    };
    window.addEventListener("popstate", handler);
    return () => { window.removeEventListener("popstate", handler); };
  }, [currentSpaceId]);

  return {
    currentSpaceId,
    navigateTo,
    goBack,
    goForward,
    canGoBack: backStack.current.length > 0,
    canGoForward: forwardStack.current.length > 0,
    setOrigin,
    returnToOrigin,
    origin,
    snapshotCamera,
    isTransitioning,
    onTransitionDone,
  };
}
