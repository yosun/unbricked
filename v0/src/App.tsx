import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyPatch,
  findLayerSelection,
  findLayerProps,
  findLayerOrder,
  findLayerRender,
  findLayerGlb,
  layerPayloadId,
  layerGlbPayloadId,
  defaultLayerOrder,
  serializeOrder,
  isHidden,
  isMaskActive,
  isMaskInverted,
  opacityMultiplier,
  soloIndex,
  makeId,
  newPatch,
  putOp,
  delOp,
  sha256Hex,
  sampleProject,
  createSampleProject,
  loadProjectState,
  saveProjectState,
  clearProjectState,
  getOperation,
  loadPreferences,
  savePreferences,
} from "./core";
import type { AnnotationId, Edge, GraphPatch, GraphPatchOp, JsonObject, PayloadId, ProjectState, SpaceId, OperatorRunId } from "./core";
import type { ProjectPreferences } from "./core/preferences";
import { findPortalEdges, findAIHistory, findSliceIds } from "./core";
import {
  createSpaceAIHistory,
  ensureHistoryGraphForSlice,
  addOpResultToGraph,
  getSeedPathIds,
  setDisplayCursor,
  setOperationCursor,
  serializeAIHistory,
  SPACE_AI_HISTORY_SCHEMA,
} from "./core/history/historyGraph";
import type { SpaceAIHistory } from "./core/history/aiHistorySchema";
import type { OpType } from "./core/history/aiHistorySchema";
import { runImg2Img, runTextToImg, runNanoBananaEdit, fetchImageBlob, applyAlphaMask, invertAlpha, invertMaskWithOriginal, getAiEditModel, combineMasksToOriginal, refitAiResult, runImageTo3D, runBackgroundRemoval } from "./services/falProxy";
import type { CropInfo } from "./services/falProxy";
import { runOperation } from "./services/operationRunner";
import type { OperationProgress, MaskCandidate } from "./services/operationRunner";
import SpaceViewport from "./ui/SpaceViewport";
import type { SegmentDisplayMode } from "./ui/SpaceViewport";
import SpaceAddressHUD from "./slice8/SpaceAddressHUD";
import { useSpaceNav } from "./slice8/useSpaceNav";
import PortalOverlay from "./ui/PortalOverlay";
import ViewModeSwitcher from "./ui/ViewModeSwitcher";
import TabulaRasa from "./ui/TabulaRasa";
import ImageIngestPanel from "./ui/ImageIngestPanel";
import type { IngestResult } from "./ui/ImageIngestPanel";
import OperationProgressHUD from "./ui/OperationProgressHUD";
import SlicingOverlay from "./ui/SlicingOverlay";
import SettingsPanel from "./ui/SettingsPanel";
import MaskPickerPanel from "./ui/MaskPickerPanel";
import type { AnimPhase } from "./ui/CameraRig";
import type { ViewMode } from "./ui/ViewMode";
import { useUIStyle } from "./ui/uiStyleStore";

const MAX_UNDO = 100;

export default function App(): React.JSX.Element {
  const [state, setState] = useState<ProjectState>(
    () => loadProjectState() ?? sampleProject.state,
  );
  const pastRef = useRef<ProjectState[]>([]);
  const futureRef = useRef<ProjectState[]>([]);
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);
  const [previewLayerIndex, setPreviewLayerIndex] = useState<number | null>(null);
  const [previewOpacity, setPreviewOpacity] = useState<number | null>(null);
  const [previewOrder, setPreviewOrder] = useState<number[] | null>(null);
  const [animPhase, setAnimPhase] = useState<AnimPhase>("intro");
  const [isTopDown, setIsTopDown] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("universal");
  const [peekLayers, setPeekLayers] = useState(false);
  const [peekRail, setPeekRail] = useState(false);

  // ── Tabula Rasa / Ingest / Settings state ──
  const [showIngest, setShowIngest] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [preferences, setPreferences] = useState<ProjectPreferences>(loadPreferences);
  const [opProgress, setOpProgress] = useState<OperationProgress | null>(null);
  const [opLabel, setOpLabel] = useState("");
  /** Last completed operation result — persists after HUD is dismissed so the user can recall it. */
  const [lastOpResult, setLastOpResult] = useState<{ label: string; maskCount: number; warning?: string } | null>(null);
  /** Image URL shown in the slicing overlay while the initial operation runs. */
  const [slicingImageUrl, setSlicingImageUrl] = useState<string | null>(null);

  /** Stores the last ingest context so the Retry button can re-run the operation without re-ingesting. */
  const lastIngestRef = useRef<{
    payloadId: PayloadId;
    imageUrl: string;
    width: number;
    height: number;
    operationId: string;
    segmentMode?: "filtered" | "raw" | undefined;
  } | null>(null);

  /** Segment display mode: masked original or colored silhouettes. */
  const [segmentDisplayMode, setSegmentDisplayMode] = useState<SegmentDisplayMode>("masked");
  /** Reveal animation: triggers when new slices are added after segmentation. */
  const [revealActive, setRevealActive] = useState(false);

  /** SAM2 mask candidates from the last segmentation — for the mask picker. */
  const [maskCandidates, setMaskCandidates] = useState<MaskCandidate[]>([]);
  /** Whether the mask picker panel is visible. */
  const [showMaskPicker, setShowMaskPicker] = useState(false);
  /** Whether a combine operation is in progress. */
  const [combining, setCombining] = useState(false);

  /** Layer index currently generating 3D (null when idle). */
  const [generating3DLayer, setGenerating3DLayer] = useState<number | null>(null);
  /** GLB data URLs keyed by layer index — when a layer has a 3D model. */
  const [layerGlbUrls, setLayerGlbUrls] = useState<Record<number, string>>({});
  /** Set of layer indices whose source image is hidden during/after 3D generation. */
  const [threeDSourceHidden, setThreeDSourceHidden] = useState<Set<number>>(new Set());

  /** Is the project in "tabula rasa" state — no meaningful content yet? */
  const isTabulaRasa = useMemo(() => {
    return Object.keys(state.payloads).length === 0;
  }, [state.payloads]);

  /* ── Way-of-Code style template ─────────────── */
  const template = useUIStyle((s) => s.template);
  // Chrome visibility is driven via DOM class to avoid re-rendering the entire App
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const unsub = useUIStyle.subscribe((s) => {
      const show = s.template.ui.showChrome || s.chromeVisible;
      headerRef.current?.parentElement?.classList.toggle("chrome-visible", show);
    });
    // Set initial state
    const s = useUIStyle.getState();
    const show = s.template.ui.showChrome || s.chromeVisible;
    headerRef.current?.parentElement?.classList.toggle("chrome-visible", show);
    return unsub;
  }, []);

  const rootSpaceId = state.manifest.rootSpaceId;
  const spaceNav = useSpaceNav(rootSpaceId);
  const activeSpaceId = spaceNav.current;

  // Keep navigation aligned with the current root space after resets.
  useEffect(() => {
    void spaceNav.navigateTo(rootSpaceId);
  }, [rootSpaceId, spaceNav]);

  // Trigger camera transition whenever the active space changes (covers browser back/forward)
  const prevActiveRef = useRef(activeSpaceId);
  useEffect(() => {
    if (activeSpaceId !== prevActiveRef.current) {
      prevActiveRef.current = activeSpaceId;
      setAnimPhase("spaceTransition");
    }
  }, [activeSpaceId]);

  /** Central commit: applies a patch, pushes to undo stack, clears redo, persists. */
  const commitPatch = useCallback(
    (patchBuilder: (current: ProjectState) => GraphPatch | null) => {
      setState((prev) => {
        try {
          const patch = patchBuilder(prev);
          if (!patch) return prev;
          const next = applyPatch(prev, patch);
          pastRef.current = [...pastRef.current.slice(-(MAX_UNDO - 1)), prev];
          futureRef.current = [];
          saveProjectState(next);
          // Schedule counter updates outside of setState
          queueMicrotask(() => {
            setUndoCount(pastRef.current.length);
            setRedoCount(0);
          });
          return next;
        } catch (err) {
          console.error("[commitPatch] FAILED:", err);
          return prev;
        }
      });
    },
    [],
  );

  const handleUndo = useCallback(() => {
    setState((prev) => {
      const past = pastRef.current;
      const restored = past[past.length - 1];
      if (!restored) return prev;
      pastRef.current = past.slice(0, -1);
      futureRef.current = [prev, ...futureRef.current];
      saveProjectState(restored);
      queueMicrotask(() => {
        setUndoCount(pastRef.current.length);
        setRedoCount(futureRef.current.length);
      });
      return restored;
    });
  }, []);

  const handleRedo = useCallback(() => {
    setState((prev) => {
      const future = futureRef.current;
      const restored = future[0];
      if (!restored) return prev;
      futureRef.current = future.slice(1);
      pastRef.current = [...pastRef.current, prev];
      saveProjectState(restored);
      queueMicrotask(() => {
        setUndoCount(pastRef.current.length);
        setRedoCount(futureRef.current.length);
      });
      return restored;
    });
  }, []);

  const handleAnimDone = useCallback(() => {
    setAnimPhase((prev) => {
      if (prev === "toTopDown") setIsTopDown(true);
      else if (prev === "toIso" || prev === "intro") setIsTopDown(false);
      // reset ends at iso
      else if (prev === "reset") setIsTopDown(false);
      // space transition ends at iso
      else if (prev === "spaceTransition") setIsTopDown(false);
      return "idle";
    });
  }, []);

  const handleResetView = useCallback(() => {
    setAnimPhase("reset");
  }, []);

  const handleToggleView = useCallback(() => {
    setAnimPhase(isTopDown ? "toIso" : "toTopDown");
  }, [isTopDown]);

  /** Switch view mode, clearing all transient preview state so views don't conflict. */
  const handleSetViewMode = useCallback((mode: ViewMode) => {
    setPreviewLayerIndex(null);
    setPreviewOpacity(null);
    setPreviewOrder(null);
    setViewMode(mode);
  }, []);

  /** Navigate to a different space via portal entry. Camera transition handled by activeSpaceId effect. */
  const handleNavigateToSpace = useCallback(
    (spaceId: SpaceId) => {
      if (!state.spaces[spaceId]) return; // target must exist
      void spaceNav.navigateTo(spaceId);
    },
    [state.spaces, spaceNav],
  );

  // activeSpaceId comes from spaceNav (declared above); rootSpaceId also above
  const activeSpace = state.spaces[activeSpaceId];

  const selection = useMemo(
    () => findLayerSelection(state, activeSpaceId),
    [state, activeSpaceId],
  );

  const effectiveSelectedIndex = previewLayerIndex ?? selection?.index ?? null;

  const layerProps = useMemo(
    () => findLayerProps(state, activeSpaceId),
    [state, activeSpaceId],
  );

  const persistedLayerOrder = useMemo(() => {
    const found = findLayerOrder(state, activeSpaceId);
    return found ? found : null;
  }, [state, activeSpaceId]);

  // Build per-layer visibility/opacity for SpaceViewport
  const layerCount = activeSpace?.layerCount ?? 1;
  const effectiveOrder = previewOrder ?? persistedLayerOrder?.order ?? defaultLayerOrder(layerCount);
  const solo = soloIndex(layerProps, layerCount);
  const layerVisibility = useMemo(() => {
    const result: Array<{ visible: boolean; opacity: number; textureOpacity: number }> = [];
    for (let i = 0; i < layerCount; i++) {
      let visible = true;
      if (solo !== null) {
        visible = i === solo;
      } else if (isHidden(layerProps, i, layerCount)) {
        visible = false;
      }

      const selected = i === effectiveSelectedIndex;
      const baseOpacity = selected ? 0.30 : 0.10;
      let mult = opacityMultiplier(layerProps, i, layerCount);
      // Use preview opacity for the selected layer while dragging
      if (selected && previewOpacity !== null) {
        mult = previewOpacity;
      }
      const finalOpacity = baseOpacity * mult;
      // Texture opacity: user's multiplier directly (not mixed with base tint)
      const texOpacity = !visible ? Math.max(mult * 0.35, 0.06) : mult;

      result.push({ visible, opacity: finalOpacity, textureOpacity: texOpacity });
    }
    return result;
  }, [layerCount, solo, layerProps, effectiveSelectedIndex, previewOpacity]);

  /* ── Layer props helpers ──────────────────────── */

  const emitPropsUpdate = useCallback(
    (updater: (data: Record<string, string>) => Record<string, string>) => {
      commitPatch((prev) => {
        const existing = findLayerProps(prev, activeSpaceId);
        const annId: AnnotationId = existing
          ? existing.annotationId
          : makeId("annotation");
        const currentData = existing ? { ...existing.annotation.data } : {};
        const newData = updater(currentData);

        // If no keys remain, delete the annotation entirely
        if (Object.keys(newData).length === 0 && existing) {
          return newPatch({
            baseRevision: prev.revision,
            ops: [delOp("Annotation", annId)],
          });
        }

        const annotationValue: JsonObject = {
          id: annId,
          kind: "Annotation",
          target: { kind: "Space", id: activeSpaceId },
          schema: "ui.layers.props",
          data: newData,
          createdAt: new Date().toISOString(),
        };

        return newPatch({
          baseRevision: prev.revision,
          ops: [putOp("Annotation", annId, annotationValue)],
        });
      });
    },
    [activeSpaceId, commitPatch],
  );

  const handleToggleHidden = useCallback(
    (index: number) => {
      emitPropsUpdate((data) => {
        const key = `hidden.${String(index)}`;
        if (data[key] === "true") {
          return Object.fromEntries(Object.entries(data).filter(([k]) => k !== key));
        }
        return { ...data, [key]: "true" };
      });
    },
    [emitPropsUpdate],
  );

  const handleToggleSolo = useCallback(
    (index: number) => {
      emitPropsUpdate((data) => {
        if (data["solo"] === String(index)) {
          return Object.fromEntries(Object.entries(data).filter(([k]) => k !== "solo"));
        }
        return { ...data, solo: String(index) };
      });
    },
    [emitPropsUpdate],
  );

  const handleToggleMask = useCallback(
    (index: number) => {
      emitPropsUpdate((data) => {
        const key = `maskActive.${String(index)}`;
        const currently = data[key] !== "false"; // default true
        if (currently) {
          return { ...data, [key]: "false" };
        }
        return Object.fromEntries(Object.entries(data).filter(([k]) => k !== key));
      });
    },
    [emitPropsUpdate],
  );

  const handleCommitOrder = useCallback(
    (order: number[]) => {
      // If it's the default order, delete the annotation instead
      const isDefault = order.every((v, i) => v === i);
      commitPatch((prev) => {
        const existing = findLayerOrder(prev, activeSpaceId);
        if (isDefault) {
          if (!existing) return null;
          return newPatch({
            baseRevision: prev.revision,
            ops: [delOp("Annotation", existing.annotationId)],
          });
        }
        const annId: AnnotationId = existing
          ? existing.annotationId
          : makeId("annotation");
        const annotationValue: JsonObject = {
          id: annId,
          kind: "Annotation",
          target: { kind: "Space", id: activeSpaceId },
          schema: "ui.layers.order",
          data: { order: serializeOrder(order) },
          createdAt: new Date().toISOString(),
        };
        return newPatch({
          baseRevision: prev.revision,
          ops: [putOp("Annotation", annId, annotationValue)],
        });
      });
    },
    [activeSpaceId, commitPatch],
  );

  const handleCommitOpacity = useCallback(
    (index: number, value: number) => {
      setPreviewOpacity(null);
      emitPropsUpdate((data) => {
        const key = `opacity.${String(index)}`;
        if (Math.abs(value - 1.0) < 0.01) {
          return Object.fromEntries(Object.entries(data).filter(([k]) => k !== key));
        }
        return { ...data, [key]: String(value) };
      });
    },
    [emitPropsUpdate],
  );

  const handleSelectLayer = useCallback(
    (index: number) => {
      setPreviewOpacity(null);
      commitPatch((prev) => {
        const space = prev.spaces[activeSpaceId];
        if (!space || index < 0 || index >= space.layerCount) return null;

        const existing = findLayerSelection(prev, activeSpaceId);
        const annId: AnnotationId = existing
          ? existing.annotationId
          : makeId("annotation");

        const annotationValue: JsonObject = {
          id: annId,
          kind: "Annotation",
          target: { kind: "Space", id: activeSpaceId },
          schema: "ui.selection.layerIndex",
          data: { layerIndex: String(index) },
          createdAt: new Date().toISOString(),
        };

        return newPatch({
          baseRevision: prev.revision,
          ops: [putOp("Annotation", annId, annotationValue)],
        });
      });
    },
    [activeSpaceId, commitPatch],
  );

  const handleClearSelection = useCallback(() => {
    setPreviewOpacity(null);
    commitPatch((prev) => {
      const existing = findLayerSelection(prev, activeSpaceId);
      if (!existing) return null;

      return newPatch({
        baseRevision: prev.revision,
        ops: [delOp("Annotation", existing.annotationId)],
      });
    });
  }, [activeSpaceId, commitPatch]);

  /** Add a new slice (layer) to the active space and select it. */
  const handleAddSlice = useCallback(() => {
    commitPatch((prev) => {
      const space = prev.spaces[activeSpaceId];
      if (!space) return null;

      const newCount = space.layerCount + 1;
      const newLayerIdx = space.layerCount; // 0-based, so old count = new index

      const ops: GraphPatchOp[] = [];

      // 1. Update space with incremented layerCount
      const updatedSpace: JsonObject = {
        ...space,
        layerCount: newCount,
      };
      ops.push(putOp("Space", activeSpaceId, updatedSpace));

      // 2. Extend layer order if one exists (append new index at top)
      const existingOrder = findLayerOrder(prev, activeSpaceId);
      if (existingOrder) {
        const newOrder = [...existingOrder.order, newLayerIdx];
        const orderAnnotation: JsonObject = {
          id: existingOrder.annotationId,
          kind: "Annotation",
          target: { kind: "Space", id: activeSpaceId },
          schema: "ui.layers.order",
          data: { order: serializeOrder(newOrder) },
          createdAt: new Date().toISOString(),
        };
        ops.push(putOp("Annotation", existingOrder.annotationId, orderAnnotation));
      }

      // 3. Select the new layer
      const existingSel = findLayerSelection(prev, activeSpaceId);
      const selAnnId: AnnotationId = existingSel
        ? existingSel.annotationId
        : makeId("annotation");
      const selAnnotation: JsonObject = {
        id: selAnnId,
        kind: "Annotation",
        target: { kind: "Space", id: activeSpaceId },
        schema: "ui.selection.layerIndex",
        data: { layerIndex: String(newLayerIdx) },
        createdAt: new Date().toISOString(),
      };
      ops.push(putOp("Annotation", selAnnId, selAnnotation));

      return newPatch({ baseRevision: prev.revision, ops });
    });
  }, [activeSpaceId, commitPatch]);

  /* ── AI / Import state ───────────────────────────── */
  const [aiRunning, setAiRunning] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiPromptOpen, setAiPromptOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const layerRender = useMemo(
    () => findLayerRender(state, activeSpaceId),
    [state, activeSpaceId],
  );

  /** Restore persisted GLB 3D models on load / space change. */
  const layerGlbAnnotation = useMemo(
    () => findLayerGlb(state, activeSpaceId),
    [state, activeSpaceId],
  );
  useEffect(() => {
    const glb = layerGlbAnnotation;
    if (!glb) return;
    const urls: Record<number, string> = {};
    const hiddenSet = new Set<number>();
    for (const [key, payloadId] of Object.entries(glb.annotation.data)) {
      if (!key.startsWith("glb.")) continue;
      const idx = Number(key.slice(4));
      if (!Number.isFinite(idx)) continue;
      const payload = state.payloads[payloadId as PayloadId];
      if (!payload) continue;
      // Convert the data URL to a blob URL for Three.js
      fetch(payload.uri)
        .then((r) => r.blob())
        .then((blob) => {
          const blobUrl = URL.createObjectURL(blob);
          setLayerGlbUrls((prev) => ({ ...prev, [idx]: blobUrl }));
          setThreeDSourceHidden((prev) => new Set(prev).add(idx));
        })
        .catch((err) => {
          console.warn(`[3D] Failed to restore GLB for layer ${String(idx)}:`, err);
        });
      urls[idx] = "pending"; // mark as known so we don't lose track
      hiddenSet.add(idx);
    }
    // Immediately set the hidden set so source textures are suppressed
    if (hiddenSet.size > 0) {
      setThreeDSourceHidden(hiddenSet);
    }
  // Only run when the annotation identity changes (load / space switch)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerGlbAnnotation?.annotationId]);

  /** Portal edges from the current space. */
  const portalEdges: Edge[] = useMemo(
    () => findPortalEdges(state, activeSpaceId),
    [state, activeSpaceId],
  );

  /** Build a map of layerIndex → payload URI for texture rendering.
   *  When maskActive is false for a slice layer, fall back to the
   *  original image (layer 0) so the user sees the unmasked original.
   *  When a layer's source image is hidden (3D mode), skip its texture. */
  const layerTextures = useMemo(() => {
    const result: Record<number, string> = {};
    // Resolve the original image URI from layer 0 for mask-off fallback
    const origPid = layerPayloadId(layerRender, 0);
    const origUri = origPid ? state.payloads[origPid as PayloadId]?.uri : undefined;
    for (let i = 0; i < layerCount; i++) {
      // Skip texture for layers whose source image is hidden (3D model visible instead),
      // but always include the selected layer's texture so the segment is visible when editing.
      if (threeDSourceHidden.has(i) && i !== effectiveSelectedIndex) continue;

      const pid = layerPayloadId(layerRender, i);
      const payload = pid ? state.payloads[pid as PayloadId] : undefined;
      const maskOn = isMaskActive(layerProps, i, layerCount);
      // When mask is OFF on a slice layer whose payload is still the
      // original segmentation mask, show the full original image instead.
      // AI-edited payloads (no segmentIndex) always show their own URI.
      const isOriginalMask = payload?.meta.segmentIndex !== undefined;
      if (!maskOn && i > 0 && origUri && isOriginalMask) {
        result[i] = origUri;
        continue;
      }
      if (payload) {
        result[i] = payload.uri;
      }
    }
    return result;
  }, [layerCount, layerRender, state.payloads, layerProps, threeDSourceHidden, effectiveSelectedIndex]);

  /** Build a map of layerIndex → payload URI for panel thumbnails.
   *  Unlike layerTextures, this always includes textures even when
   *  the source image is hidden (3D mode) so thumbnails stay visible. */
  const layerThumbnails = useMemo(() => {
    const result: Record<number, string> = {};
    const origPid = layerPayloadId(layerRender, 0);
    const origUri = origPid ? state.payloads[origPid as PayloadId]?.uri : undefined;
    for (let i = 0; i < layerCount; i++) {
      const pid = layerPayloadId(layerRender, i);
      const payload = pid ? state.payloads[pid as PayloadId] : undefined;
      const maskOn = isMaskActive(layerProps, i, layerCount);
      const isOriginalMask = payload?.meta.segmentIndex !== undefined;
      if (!maskOn && i > 0 && origUri && isOriginalMask) {
        result[i] = origUri;
        continue;
      }
      if (payload) {
        result[i] = payload.uri;
      }
    }
    return result;
  }, [layerCount, layerRender, state.payloads, layerProps]);

  /** Build a map of layerIndex → CropInfo for layers that were tightly cropped.
   *  When a layer has an AI history with a non-root display cursor, we use the
   *  **root state's** crop info so the plane geometry stays stable while the
   *  user navigates between history states (avoids visible restretch). */
  const historyRootCropPids = useMemo(() => {
    const result: Record<number, string> = {};
    const hist = findAIHistory(state, activeSpaceId);
    const slices = findSliceIds(state, activeSpaceId);
    if (!hist || !slices) return result;
    for (let i = 0; i < layerCount; i++) {
      const sliceId = slices.ids[i];
      const graph = sliceId ? hist.history.slices[sliceId] : undefined;
      if (!graph) continue;
      const rootState = graph.states[graph.rootStateId];
      const rootImagePid = rootState?.assetRefs.image;
      if (rootImagePid) result[i] = rootImagePid;
    }
    return result;
  }, [state, activeSpaceId, layerCount]);

  const layerCropInfo = useMemo(() => {
    const result: Record<number, CropInfo> = {};
    for (let i = 0; i < layerCount; i++) {
      // Prefer the root state's payload for stable plane geometry across history nav
      let cropPid: string | undefined = historyRootCropPids[i];
      if (!cropPid) {
        const pid = layerPayloadId(layerRender, i);
        if (pid) cropPid = pid;
      }
      if (!cropPid) continue;
      const payload = state.payloads[cropPid as PayloadId];
      if (!payload) continue;
      const m = payload.meta;
      const cx = Number(m.cropX);
      const cy = Number(m.cropY);
      const cw = Number(m.cropW);
      const ch = Number(m.cropH);
      const ow = Number(m.origW);
      const oh = Number(m.origH);
      if (ow > 0 && oh > 0 && cw > 0 && ch > 0 && (cw < ow || ch < oh)) {
        result[i] = { cropX: cx, cropY: cy, cropW: cw, cropH: ch, origW: ow, origH: oh };
      }
    }
    return result;
  }, [layerCount, layerRender, state.payloads, historyRootCropPids]);

  /** Build a map of layerIndex → colored-segment URI for the "colored" display mode. */
  const colorLayerTextures = useMemo(() => {
    const result: Record<number, string> = {};
    for (let i = 0; i < layerCount; i++) {
      const pid = layerPayloadId(layerRender, i);
      if (pid) {
        const payload = state.payloads[pid as PayloadId];
        if (payload) {
          // Layer 0 is always the original image (no colored variant)
          const colorUri = i > 0 ? payload.meta["colorUri"] : undefined;
          if (colorUri) {
            result[i] = colorUri;
          } else {
            result[i] = payload.uri;
          }
        }
      }
    }
    return result;
  }, [layerCount, layerRender, state.payloads]);

  /** Derive aspect ratio (width/height) from the first payload that has dimensions. */
  const imageAspect = useMemo<number | null>(() => {
    for (let i = 0; i < layerCount; i++) {
      const pid = layerPayloadId(layerRender, i);
      if (!pid) continue;
      const payload = state.payloads[pid as PayloadId];
      if (!payload) continue;
      const w = Number(payload.meta.width);
      const h = Number(payload.meta.height);
      if (w > 0 && h > 0) return w / h;
    }
    return null;
  }, [layerCount, layerRender, state.payloads]);

  /** Keyframe preview: composite all visible/display-state layers top-down into a single image. */
  const [keyframePreviewUrl, setKeyframePreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    // Only build if we have textures
    const textureEntries = Object.entries(layerTextures);
    if (textureEntries.length === 0) {
      setKeyframePreviewUrl(null);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        // Load all visible layer images
        const images: { idx: number; img: HTMLImageElement }[] = [];
        await Promise.all(
          textureEntries.map(async ([idxStr, uri]) => {
            const idx = Number(idxStr);
            const vis = layerVisibility[idx];
            if (vis && !vis.visible) return; // skip hidden layers
            const img = new Image();
            img.src = uri;
            await new Promise<void>((resolve, reject) => {
              img.onload = () => { resolve(); };
              img.onerror = () => { reject(new Error("img load failed")); };
            });
            if (!cancelled) images.push({ idx, img });
          }),
        );
        if (cancelled || images.length === 0) return;

        // Find max dimensions
        let maxW = 0, maxH = 0;
        for (const { img } of images) {
          if (img.naturalWidth > maxW) maxW = img.naturalWidth;
          if (img.naturalHeight > maxH) maxH = img.naturalHeight;
        }
        if (maxW === 0 || maxH === 0) return;

        // Cap size for performance
        const scale = Math.min(1, 200 / Math.max(maxW, maxH));
        const cW = Math.round(maxW * scale);
        const cH = Math.round(maxH * scale);

        const canvas = document.createElement("canvas");
        canvas.width = cW;
        canvas.height = cH;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        // Sort by order (bottom to top)
        images.sort((a, b) => {
          const posA = effectiveOrder.indexOf(a.idx);
          const posB = effectiveOrder.indexOf(b.idx);
          return posA - posB;
        });

        // Draw each layer using its crop info if available
        for (const { idx, img } of images) {
          const vis = layerVisibility[idx];
          const texOpacity = vis ? vis.textureOpacity : 1;
          ctx.globalAlpha = texOpacity;

          const crop = layerCropInfo[idx];
          if (crop && crop.origW > 0 && crop.origH > 0) {
            const sx = (crop.cropX / crop.origW) * cW;
            const sy = (crop.cropY / crop.origH) * cH;
            const sw = (crop.cropW / crop.origW) * cW;
            const sh = (crop.cropH / crop.origH) * cH;
            ctx.drawImage(img, sx, sy, sw, sh);
          } else {
            ctx.drawImage(img, 0, 0, cW, cH);
          }
        }

        if (!cancelled) {
          setKeyframePreviewUrl(canvas.toDataURL("image/png"));
        }
      } catch {
        // Silently ignore — keyframe preview is optional
      }
    })();

    return () => { cancelled = true; };
  }, [layerTextures, layerVisibility, effectiveOrder, layerCropInfo]);

  /**
   * Helper: emit a render-mapping update patch.
   * Takes the current render annotation (or creates one) and applies an updater.
   */
  const emitRenderUpdate = useCallback(
    (
      updater: (data: Record<string, string>) => Record<string, string>,
      extraOps?: GraphPatchOp[],
    ) => {
      commitPatch((prev) => {
        const existing = findLayerRender(prev, activeSpaceId);
        const annId: AnnotationId = existing
          ? existing.annotationId
          : makeId("annotation");
        const currentData = existing ? { ...existing.annotation.data } : {};
        const newData = updater(currentData);

        const annotationValue: JsonObject = {
          id: annId,
          kind: "Annotation",
          target: { kind: "Space", id: activeSpaceId },
          schema: "ui.layers.render",
          data: newData,
          createdAt: new Date().toISOString(),
        };

        const ops: GraphPatchOp[] = [
          ...(extraOps ?? []),
          putOp("Annotation", annId, annotationValue),
        ];

        return newPatch({ baseRevision: prev.revision, ops });
      });
    },
    [activeSpaceId, commitPatch],
  );

  /* ── AI History helpers ───────────────────────── */

  /** Get or initialize stable slice IDs for the active space. */
  const getOrCreateSliceIds = useCallback(
    (prev: ProjectState, spaceId: SpaceId): { sliceIds: string[]; ops: GraphPatchOp[] } => {
      const existing = findSliceIds(prev, spaceId);
      if (existing) {
        const space = prev.spaces[spaceId];
        const count = space?.layerCount ?? 0;
        // Extend if needed (new layers added)
        if (existing.ids.length >= count) {
          return { sliceIds: existing.ids, ops: [] };
        }
        const extended = [...existing.ids];
        while (extended.length < count) {
          extended.push(makeId("slice" as "slice"));
        }
        const ann: JsonObject = {
          id: existing.annotationId,
          kind: "Annotation",
          target: { kind: "Space", id: spaceId },
          schema: "ui.layers.sliceIds",
          data: { ids: JSON.stringify(extended) },
          createdAt: new Date().toISOString(),
        };
        return { sliceIds: extended, ops: [putOp("Annotation", existing.annotationId, ann)] };
      }
      // Create new
      const space = prev.spaces[spaceId];
      const count = space?.layerCount ?? 1;
      const ids: string[] = [];
      for (let i = 0; i < count; i++) {
        ids.push(makeId("slice" as "slice"));
      }
      const annId = makeId("annotation");
      const ann: JsonObject = {
        id: annId,
        kind: "Annotation",
        target: { kind: "Space", id: spaceId },
        schema: "ui.layers.sliceIds",
        data: { ids: JSON.stringify(ids) },
        createdAt: new Date().toISOString(),
      };
      return { sliceIds: ids, ops: [putOp("Annotation", annId, ann)] };
    },
    [],
  );

  /** Get or initialize the AI history for the active space. */
  const getOrCreateAIHistory = useCallback(
    (
      prev: ProjectState,
      spaceId: SpaceId,
      sliceIds: string[],
    ): { history: SpaceAIHistory; annotationId: AnnotationId; ops: GraphPatchOp[] } => {
      const existing = findAIHistory(prev, spaceId);
      if (existing) {
        return { history: existing.history, annotationId: existing.annotationId, ops: [] };
      }
      // Initialize: create root state for each slice that has a render payload
      let history = createSpaceAIHistory();
      const render = findLayerRender(prev, spaceId);
      for (let i = 0; i < sliceIds.length; i++) {
        const sliceId = sliceIds[i]!;
        const pid = layerPayloadId(render, i);
        if (pid) {
          history = ensureHistoryGraphForSlice(history, sliceId, {
            image: pid as PayloadId,
          });
        }
      }
      const annId = makeId("annotation");
      const ann: JsonObject = {
        id: annId,
        kind: "Annotation",
        target: { kind: "Space", id: spaceId },
        schema: SPACE_AI_HISTORY_SCHEMA,
        data: serializeAIHistory(history) as unknown as Record<string, string>,
        createdAt: new Date().toISOString(),
      };
      return { history, annotationId: annId, ops: [putOp("Annotation", annId, ann)] };
    },
    [],
  );

  /** Commit an AI history update as a patch operation. */
  const buildHistoryPatchOp = useCallback(
    (
      history: SpaceAIHistory,
      annotationId: AnnotationId,
      spaceId: SpaceId,
    ): GraphPatchOp => {
      const ann: JsonObject = {
        id: annotationId,
        kind: "Annotation",
        target: { kind: "Space", id: spaceId },
        schema: SPACE_AI_HISTORY_SCHEMA,
        data: serializeAIHistory(history) as unknown as Record<string, string>,
        createdAt: new Date().toISOString(),
      };
      return putOp("Annotation", annotationId, ann);
    },
    [],
  );

  /** Current AI history for the active space (memoized). */
  const aiHistory = useMemo(
    () => findAIHistory(state, activeSpaceId),
    [state, activeSpaceId],
  );

  /** Current slice IDs for the active space (memoized). */
  const sliceIdsResult = useMemo(
    () => findSliceIds(state, activeSpaceId),
    [state, activeSpaceId],
  );

  /** Get the sliceId for a given layer index. */
  const getSliceIdForLayer = useCallback(
    (layerIndex: number): string | null => {
      if (!sliceIdsResult) return null;
      return sliceIdsResult.ids[layerIndex] ?? null;
    },
    [sliceIdsResult],
  );

  /** Get the SliceHistoryGraph for a given layer index. */
  const getSliceHistory = useCallback(
    (layerIndex: number) => {
      const sliceId = getSliceIdForLayer(layerIndex);
      if (!sliceId || !aiHistory) return null;
      return aiHistory.history.slices[sliceId] ?? null;
    },
    [getSliceIdForLayer, aiHistory],
  );

  /** Set the display cursor for a slice (by layer index) and update render annotation. */
  const handleSetDisplayCursor = useCallback(
    (layerIndex: number, stateId: string) => {
      commitPatch((prev) => {
        const { sliceIds, ops: sliceOps } = getOrCreateSliceIds(prev, activeSpaceId);
        const sliceId = sliceIds[layerIndex];
        if (!sliceId) return null;

        const { history, annotationId, ops: histOps } = getOrCreateAIHistory(prev, activeSpaceId, sliceIds);
        const graph = history.slices[sliceId];
        if (!graph) return null;

        const stateNode = graph.states[stateId];
        if (!stateNode) return null;

        const updatedGraph = setDisplayCursor(graph, stateId);
        const updatedHistory: SpaceAIHistory = {
          ...history,
          slices: { ...history.slices, [sliceId]: updatedGraph },
        };

        const allOps: GraphPatchOp[] = [...sliceOps, ...histOps];
        allOps.push(buildHistoryPatchOp(updatedHistory, annotationId, activeSpaceId));

        // Update render annotation to reflect new display state
        if (stateNode.assetRefs.image) {
          const existing = findLayerRender(prev, activeSpaceId);
          const annId: AnnotationId = existing ? existing.annotationId : makeId("annotation");
          const currentData = existing ? { ...existing.annotation.data } : {};
          currentData[`payload.${String(layerIndex)}`] = stateNode.assetRefs.image;
          const renderAnn: JsonObject = {
            id: annId,
            kind: "Annotation",
            target: { kind: "Space", id: activeSpaceId },
            schema: "ui.layers.render",
            data: currentData,
            createdAt: new Date().toISOString(),
          };
          allOps.push(putOp("Annotation", annId, renderAnn));
        }

        return newPatch({ baseRevision: prev.revision, ops: allOps });
      });
    },
    [activeSpaceId, commitPatch, getOrCreateSliceIds, getOrCreateAIHistory, buildHistoryPatchOp],
  );

  /** Set the operation cursor for a slice (by layer index). */
  const handleSetOperationCursor = useCallback(
    (layerIndex: number, stateId: string) => {
      commitPatch((prev) => {
        const { sliceIds, ops: sliceOps } = getOrCreateSliceIds(prev, activeSpaceId);
        const sliceId = sliceIds[layerIndex];
        if (!sliceId) return null;

        const { history, annotationId, ops: histOps } = getOrCreateAIHistory(prev, activeSpaceId, sliceIds);
        const graph = history.slices[sliceId];
        if (!graph) return null;

        const updatedGraph = setOperationCursor(graph, stateId);
        const updatedHistory: SpaceAIHistory = {
          ...history,
          slices: { ...history.slices, [sliceId]: updatedGraph },
        };

        const allOps: GraphPatchOp[] = [...sliceOps, ...histOps];
        allOps.push(buildHistoryPatchOp(updatedHistory, annotationId, activeSpaceId));

        return newPatch({ baseRevision: prev.revision, ops: allOps });
      });
    },
    [activeSpaceId, commitPatch, getOrCreateSliceIds, getOrCreateAIHistory, buildHistoryPatchOp],
  );

  /**
   * Invert mask: flip the alpha channel of the layer's current image,
   * creating a new payload with inverted transparency.
   * Also toggles the `maskInverted` annotation flag.
   */
  const handleInvertMask = useCallback(
    async (index: number) => {
      const pid = layerPayloadId(layerRender, index);
      if (!pid) return;
      const payload = state.payloads[pid as PayloadId];
      if (!payload) return;

      try {
        // Find the original (full) image for correct RGB compositing.
        // PNG round-tripping loses RGB for transparent pixels, so we need
        // the original to provide clean pixels in the inverted region.
        const origPid = layerPayloadId(layerRender, 0);
        const origPayload = origPid ? state.payloads[origPid as PayloadId] : undefined;

        let invertedUrl: string;
        let invertedCrop: CropInfo | undefined;
        if (origPayload && index > 0) {
          // Pass source crop info so the cropped mask is placed correctly
          // in the full-size canvas before inverting.
          const srcCrop = layerCropInfo[index];
          const result = await invertMaskWithOriginal(origPayload.uri, payload.uri, undefined, srcCrop);
          invertedUrl = result.dataUrl;
          invertedCrop = result.crop;
        } else {
          invertedUrl = await invertAlpha(payload.uri);
        }

        const encoder = new TextEncoder();
        const bytes = encoder.encode(invertedUrl);
        const hash = await sha256Hex(bytes.buffer as ArrayBuffer);

        // Build new meta: start from source, override crop with inverted bounds
        const baseMeta = { ...(payload.meta as Record<string, string> ?? {}) };
        if (invertedCrop) {
          baseMeta.width = String(invertedCrop.cropW);
          baseMeta.height = String(invertedCrop.cropH);
          baseMeta.cropX = String(invertedCrop.cropX);
          baseMeta.cropY = String(invertedCrop.cropY);
          baseMeta.cropW = String(invertedCrop.cropW);
          baseMeta.cropH = String(invertedCrop.cropH);
          baseMeta.origW = String(invertedCrop.origW);
          baseMeta.origH = String(invertedCrop.origH);
        } else if (invertedCrop === undefined && origPayload && index > 0) {
          // Inverted to nothing — remove crop fields
          delete baseMeta.cropX;
          delete baseMeta.cropY;
          delete baseMeta.cropW;
          delete baseMeta.cropH;
          delete baseMeta.origW;
          delete baseMeta.origH;
        }

        const newPayloadId = makeId("payload");
        const newPayloadValue: JsonObject = {
          id: newPayloadId,
          kind: "Payload",
          mediaType: "image/png",
          uri: invertedUrl,
          sha256: hash,
          bytes: bytes.byteLength,
          meta: {
            ...baseMeta,
            invertedFrom: pid,
          },
        };

        // Update the render annotation + record in AI history
        commitPatch((prev) => {
          const patchOps: GraphPatchOp[] = [putOp("Payload", newPayloadId, newPayloadValue)];

          const { sliceIds, ops: sliceOps } = getOrCreateSliceIds(prev, activeSpaceId);
          const sliceId = sliceIds[index];
          patchOps.push(...sliceOps);

          if (sliceId) {
            const { history, annotationId, ops: histOps } = getOrCreateAIHistory(prev, activeSpaceId, sliceIds);
            patchOps.push(...histOps);

            const existingPid = layerPayloadId(findLayerRender(prev, activeSpaceId), index);
            const rootAssets: { image?: PayloadId } = {};
            if (existingPid) rootAssets.image = existingPid as PayloadId;
            let updatedHistory = ensureHistoryGraphForSlice(history, sliceId, rootAssets);
            const graph = updatedHistory.slices[sliceId]!;

            const result = addOpResultToGraph(graph, {
              inputStateId: graph.operationStateId,
              opType: "maskInvert",
              outputAssets: [{ image: newPayloadId as PayloadId }],
              sliceIndex: index,
            });
            updatedHistory = { ...updatedHistory, slices: { ...updatedHistory.slices, [sliceId]: result.graph } };
            patchOps.push(buildHistoryPatchOp(updatedHistory, annotationId, activeSpaceId));
          }

          // Render annotation update
          const existing = findLayerRender(prev, activeSpaceId);
          const annId: AnnotationId = existing ? existing.annotationId : makeId("annotation");
          const currentData = existing ? { ...existing.annotation.data } : {};
          currentData[`payload.${String(index)}`] = newPayloadId;
          patchOps.push(putOp("Annotation", annId, {
            id: annId, kind: "Annotation",
            target: { kind: "Space", id: activeSpaceId },
            schema: "ui.layers.render", data: currentData,
            createdAt: new Date().toISOString(),
          }));

          return newPatch({ baseRevision: prev.revision, ops: patchOps });
        });

        // Toggle the maskInverted annotation flag
        emitPropsUpdate((data) => {
          const key = `maskInverted.${String(index)}`;
          const currently = data[key] === "true";
          if (currently) {
            return Object.fromEntries(Object.entries(data).filter(([k]) => k !== key));
          }
          return { ...data, [key]: "true" };
        });
      } catch (err) {
        console.error("[InvertMask] failed:", err);
      }
    },
[layerRender, state.payloads, commitPatch, activeSpaceId, emitPropsUpdate, layerCropInfo, getOrCreateSliceIds, getOrCreateAIHistory, buildHistoryPatchOp],
  );

  /** Combine user-selected masks into a new layer. */
  const handleCombineMasks = useCallback(
    async (maskUrls: string[]) => {
      if (maskUrls.length === 0) return;
      setCombining(true);
      try {
        // Get original image from layer 0
        const origPid = layerPayloadId(layerRender, 0);
        const origPayload = origPid ? state.payloads[origPid as PayloadId] : undefined;
        if (!origPayload) {
          console.error("[CombineMasks] No original image found on layer 0");
          return;
        }

        const { dataUrl: combinedUrl, crop } = await combineMasksToOriginal(maskUrls, origPayload.uri);

        const encoder = new TextEncoder();
        const bytes = encoder.encode(combinedUrl);
        const hash = await sha256Hex(bytes.buffer as ArrayBuffer);

        const newPayloadId = makeId("payload");
        const payloadValue: JsonObject = {
          id: newPayloadId,
          kind: "Payload",
          mediaType: "image/png",
          uri: combinedUrl,
          sha256: hash,
          bytes: bytes.byteLength,
          meta: {
            source: "mask-picker-combine",
            width: String(crop.cropW),
            height: String(crop.cropH),
            cropX: String(crop.cropX),
            cropY: String(crop.cropY),
            cropW: String(crop.cropW),
            cropH: String(crop.cropH),
            origW: String(crop.origW),
            origH: String(crop.origH),
          },
        };

        // Add new layer and assign the combined payload
        commitPatch((prev) => {
          const space = prev.spaces[activeSpaceId];
          if (!space) return null;

          const newCount = space.layerCount + 1;
          const newLayerIdx = space.layerCount;
          const ops: GraphPatchOp[] = [];

          // Update space layerCount
          ops.push(putOp("Space", activeSpaceId, { ...space, layerCount: newCount }));

          // Add the payload
          ops.push(putOp("Payload", newPayloadId, payloadValue));

          // Extend layer order
          const existingOrder = findLayerOrder(prev, activeSpaceId);
          if (existingOrder) {
            const newOrder = [...existingOrder.order, newLayerIdx];
            ops.push(putOp("Annotation", existingOrder.annotationId, {
              id: existingOrder.annotationId,
              kind: "Annotation",
              target: { kind: "Space", id: activeSpaceId },
              schema: "ui.layers.order",
              data: { order: serializeOrder(newOrder) },
              createdAt: new Date().toISOString(),
            }));
          }

          // Assign payload to the new layer in render
          const existing = findLayerRender(prev, activeSpaceId);
          const annId = existing ? existing.annotationId : makeId("annotation");
          const currentData = existing ? { ...existing.annotation.data } : {};
          currentData[`payload.${String(newLayerIdx)}`] = newPayloadId;
          ops.push(putOp("Annotation", annId, {
            id: annId,
            kind: "Annotation",
            target: { kind: "Space", id: activeSpaceId },
            schema: "ui.layers.render",
            data: currentData,
            createdAt: new Date().toISOString(),
          }));

          // Select the new layer
          const existingSel = findLayerSelection(prev, activeSpaceId);
          const selAnnId = existingSel ? existingSel.annotationId : makeId("annotation");
          ops.push(putOp("Annotation", selAnnId, {
            id: selAnnId,
            kind: "Annotation",
            target: { kind: "Space", id: activeSpaceId },
            schema: "ui.selection.layerIndex",
            data: { layerIndex: String(newLayerIdx) },
            createdAt: new Date().toISOString(),
          }));

          // Record in AI history: create a new slice with maskCombine root
          const { sliceIds, ops: sliceOps } = getOrCreateSliceIds(prev, activeSpaceId);
          // Extend sliceIds for the new layer
          const extendedSliceIds = [...sliceIds];
          const newSliceId = makeId("hslice" as "hslice");
          extendedSliceIds[newLayerIdx] = newSliceId;
          ops.push(...sliceOps);

          // Update sliceIds annotation with extended array
          const existingSliceIdsResult = findSliceIds(prev, activeSpaceId);
          const sliceIdsAnnId = existingSliceIdsResult ? existingSliceIdsResult.annotationId : makeId("annotation");
          ops.push(putOp("Annotation", sliceIdsAnnId, {
            id: sliceIdsAnnId,
            kind: "Annotation",
            target: { kind: "Space", id: activeSpaceId },
            schema: "ui.layers.sliceIds",
            data: { ids: extendedSliceIds.join(",") },
            createdAt: new Date().toISOString(),
          }));

          const { history, annotationId: histAnnId, ops: histOps } = getOrCreateAIHistory(prev, activeSpaceId, extendedSliceIds);
          ops.push(...histOps);
          // Ensure graph for the new slice with the combined payload as root
          const updatedHistory = ensureHistoryGraphForSlice(history, newSliceId, { image: newPayloadId as PayloadId });
          ops.push(buildHistoryPatchOp(updatedHistory, histAnnId, activeSpaceId));

          return newPatch({ baseRevision: prev.revision, ops });
        });

        setShowMaskPicker(false);
      } catch (err) {
        console.error("[CombineMasks] failed:", err);
      } finally {
        setCombining(false);
      }
    },
    [layerRender, state.payloads, activeSpaceId, commitPatch, getOrCreateSliceIds, getOrCreateAIHistory, buildHistoryPatchOp],
  );

  /** Toggle source-image visibility for a layer that has a 3D model. */
  const handleToggle3DSourceImage = useCallback(
    (index: number) => {
      setThreeDSourceHidden((prev) => {
        const next = new Set(prev);
        if (next.has(index)) {
          next.delete(index);
        } else {
          next.add(index);
        }
        return next;
      });
    },
    [],
  );

  /** Generate a 3D object from a segmented layer using SAM-3. */
  const handleGenerate3D = useCallback(
    async (index: number) => {
      if (generating3DLayer !== null) return; // already running

      const pid = layerPayloadId(layerRender, index);
      if (!pid) return;
      const payload = state.payloads[pid as PayloadId];
      if (!payload) return;

      // Get the original (full) image from layer 0 for context
      const origPid = layerPayloadId(layerRender, 0);
      const origPayload = origPid ? state.payloads[origPid as PayloadId] : undefined;
      if (!origPayload) return;

      setGenerating3DLayer(index);
      // Hide the source image by default during generation
      setThreeDSourceHidden((prev) => new Set(prev).add(index));

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        // Build a full-size binary mask from the segment layer's cropped+alpha payload.
        // SAM-3 expects image_url = full scene, mask_urls = binary (white=object, black=bg).
        const meta = payload.meta;
        const cropX = Number(meta["cropX"] ?? 0);
        const cropY = Number(meta["cropY"] ?? 0);
        const origW = Number(meta["origW"] ?? 0);
        const origH = Number(meta["origH"] ?? 0);

        let maskDataUrl: string;
        if (origW > 0 && origH > 0) {
          // Load the cropped+alpha segment image
          const segImg = await new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image();
            img.onload = () => { resolve(img); };
            img.onerror = reject;
            img.src = payload.uri;
          });

          // Create full-size canvas, fill black, draw segment at crop position
          const maskCanvas = document.createElement("canvas");
          maskCanvas.width = origW;
          maskCanvas.height = origH;
          const mCtx = maskCanvas.getContext("2d")!;
          mCtx.fillStyle = "#000000";
          mCtx.fillRect(0, 0, origW, origH);

          // Draw segment onto a temp canvas to read alpha
          const tmpCanvas = document.createElement("canvas");
          tmpCanvas.width = segImg.naturalWidth;
          tmpCanvas.height = segImg.naturalHeight;
          const tCtx = tmpCanvas.getContext("2d")!;
          tCtx.drawImage(segImg, 0, 0);
          const segData = tCtx.getImageData(0, 0, tmpCanvas.width, tmpCanvas.height);

          // Build full-size mask: white where segment alpha > 128
          const fullData = mCtx.getImageData(0, 0, origW, origH);
          const fd = fullData.data;
          const sd = segData.data;
          for (let sy = 0; sy < tmpCanvas.height; sy++) {
            for (let sx = 0; sx < tmpCanvas.width; sx++) {
              const sIdx = (sy * tmpCanvas.width + sx) * 4;
              if (sd[sIdx + 3]! > 128) {
                const fx = cropX + sx;
                const fy = cropY + sy;
                if (fx >= 0 && fx < origW && fy >= 0 && fy < origH) {
                  const fIdx = (fy * origW + fx) * 4;
                  fd[fIdx] = 255;
                  fd[fIdx + 1] = 255;
                  fd[fIdx + 2] = 255;
                  fd[fIdx + 3] = 255;
                }
              }
            }
          }
          mCtx.putImageData(fullData, 0, 0);
          maskDataUrl = maskCanvas.toDataURL("image/png");
        } else {
          // No crop info — send segment as-is (fallback)
          maskDataUrl = payload.uri;
        }

        const imageUrl = origPayload.uri;

        // SAM-3 requires image_url = full scene, mask_urls = binary masks.
        // When mask is active, rebuild the binary mask from the current
        // layer's visible texture (which reflects AI edits and mask changes)
        // so 3D generation always uses up-to-date boundaries.
        const maskOn = isMaskActive(layerProps, index, layerCount);
        const visibleUri = layerTextures[index] ?? payload.uri;

        if (maskOn && index > 0) {
          // The visible texture already has alpha from segmentation / AI edits.
          // Rebuild a full-size binary mask from it.
          const segImg = await new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image();
            img.onload = () => { resolve(img); };
            img.onerror = reject;
            img.src = visibleUri;
          });

          const visW = segImg.naturalWidth;
          const visH = segImg.naturalHeight;
          const tmpC = document.createElement("canvas");
          tmpC.width = visW;
          tmpC.height = visH;
          const tCtx = tmpC.getContext("2d");
          if (!tCtx) throw new Error("Canvas 2D context unavailable");
          tCtx.drawImage(segImg, 0, 0);
          const visData = tCtx.getImageData(0, 0, visW, visH);

          const reMaskCanvas = document.createElement("canvas");
          reMaskCanvas.width = origW > 0 ? origW : visW;
          reMaskCanvas.height = origH > 0 ? origH : visH;
          const rmCtx = reMaskCanvas.getContext("2d");
          if (!rmCtx) throw new Error("Canvas 2D context unavailable");
          rmCtx.fillStyle = "#000000";
          rmCtx.fillRect(0, 0, reMaskCanvas.width, reMaskCanvas.height);

          const fullMaskData = rmCtx.getImageData(0, 0, reMaskCanvas.width, reMaskCanvas.height);
          const fmd = fullMaskData.data;
          const vd = visData.data;
          for (let sy = 0; sy < visH; sy++) {
            for (let sx = 0; sx < visW; sx++) {
              const sIdx = (sy * visW + sx) * 4;
              if ((vd[sIdx + 3] ?? 0) > 128) {
                const fx = cropX + sx;
                const fy = cropY + sy;
                if (fx >= 0 && fx < reMaskCanvas.width && fy >= 0 && fy < reMaskCanvas.height) {
                  const fIdx = (fy * reMaskCanvas.width + fx) * 4;
                  fmd[fIdx] = 255;
                  fmd[fIdx + 1] = 255;
                  fmd[fIdx + 2] = 255;
                  fmd[fIdx + 3] = 255;
                }
              }
            }
          }
          rmCtx.putImageData(fullMaskData, 0, 0);
          maskDataUrl = reMaskCanvas.toDataURL("image/png");
        }

        const result = await runImageTo3D(
          {
            imageUrl,
            maskUrls: [maskDataUrl],
            exportTexturedGlb: true,
          },
          controller.signal,
        );

        // Get the GLB URL from the response
        const glbRef = result.model_glb;
        let glbUrl: string | undefined;
        if (typeof glbRef === "string") {
          glbUrl = glbRef;
        } else if (glbRef && typeof glbRef === "object" && "url" in glbRef) {
          glbUrl = glbRef.url;
        }

        if (!glbUrl) {
          console.warn("[3D] No GLB returned; falling back to splat");
          // Could use gaussian_splat as a fallback here, but GLB is preferred
          setGenerating3DLayer(null);
          return;
        }

        // Fetch GLB and convert to base64 data URL for persistence
        const glbResponse = await fetch(glbUrl, { signal: controller.signal });
        const glbBlob = await glbResponse.blob();
        const glbDataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => { resolve(reader.result as string); };
          reader.onerror = reject;
          reader.readAsDataURL(glbBlob);
        });

        // Create a blob URL for Three.js rendering
        const glbBlobUrl = URL.createObjectURL(glbBlob);
        setLayerGlbUrls((prev) => ({ ...prev, [index]: glbBlobUrl }));

        // Persist the GLB as a Payload + annotation in project state
        const encoder = new TextEncoder();
        const glbBytes = encoder.encode(glbDataUrl);
        const glbHash = await sha256Hex(glbBytes.buffer as ArrayBuffer);
        const glbPayloadId = makeId("payload");
        const glbPayloadValue: JsonObject = {
          id: glbPayloadId,
          kind: "Payload",
          mediaType: "model/gltf-binary",
          uri: glbDataUrl,
          sha256: glbHash,
          bytes: glbBytes.byteLength,
          meta: {
            source: "sam3-image-to-3d",
            layerIndex: String(index),
          },
        };

        commitPatch((prev) => {
          const ops: GraphPatchOp[] = [];
          ops.push(putOp("Payload", glbPayloadId, glbPayloadValue));

          const existing = findLayerGlb(prev, activeSpaceId);
          const annId = existing ? existing.annotationId : makeId("annotation");
          const currentData = existing ? { ...existing.annotation.data } : {};
          currentData[`glb.${String(index)}`] = glbPayloadId;
          ops.push(putOp("Annotation", annId, {
            id: annId,
            kind: "Annotation",
            target: { kind: "Space", id: activeSpaceId },
            schema: "ui.layers.glb",
            data: currentData,
            createdAt: new Date().toISOString(),
          }));

          // Record in AI history
          const { sliceIds, ops: sliceOps } = getOrCreateSliceIds(prev, activeSpaceId);
          const sliceId = sliceIds[index];
          ops.push(...sliceOps);

          if (sliceId) {
            const { history, annotationId: histAnnId, ops: histOps } = getOrCreateAIHistory(prev, activeSpaceId, sliceIds);
            ops.push(...histOps);

            const existingPid = layerPayloadId(findLayerRender(prev, activeSpaceId), index);
            const rootAssets: { image?: PayloadId } = {};
            if (existingPid) rootAssets.image = existingPid as PayloadId;
            let updatedHistory = ensureHistoryGraphForSlice(history, sliceId, rootAssets);
            const graph = updatedHistory.slices[sliceId]!;

            const histResult = addOpResultToGraph(graph, {
              inputStateId: graph.operationStateId,
              opType: "imageTo3D",
              outputAssets: [{ image: (layerPayloadId(findLayerRender(prev, activeSpaceId), index) ?? glbPayloadId) as PayloadId, glb: glbPayloadId as PayloadId }],
              summary: { model: "sam3" },
              sliceIndex: index,
            });
            updatedHistory = { ...updatedHistory, slices: { ...updatedHistory.slices, [sliceId]: histResult.graph } };
            ops.push(buildHistoryPatchOp(updatedHistory, histAnnId, activeSpaceId));
          }

          return newPatch({ baseRevision: prev.revision, ops });
        });

        console.info(`[3D] GLB model loaded and persisted for layer ${String(index)}`);
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        const msg = err instanceof Error ? err.message : "3D generation failed";
        console.error("[3D] failed:", msg);
        // Un-hide source on failure
        setThreeDSourceHidden((prev) => {
          const next = new Set(prev);
          next.delete(index);
          return next;
        });
      } finally {
        setGenerating3DLayer(null);
        abortRef.current = null;
      }
    },
    [generating3DLayer, layerRender, state.payloads, commitPatch, activeSpaceId, layerProps, layerCount, layerTextures, getOrCreateSliceIds, getOrCreateAIHistory, buildHistoryPatchOp],
  );

  /** Import an image file into the selected layer. */
  const handleImportImage = useCallback(async () => {
    if (effectiveSelectedIndex === null) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";

    const file = await new Promise<File | null>((resolve) => {
      input.onchange = () => { resolve(input.files?.[0] ?? null); };
      input.click();
    });
    if (!file) return;

    const buffer = await file.arrayBuffer();
    const hash = await sha256Hex(buffer);

    // Convert to data URL for self-contained storage
    const reader = new FileReader();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      reader.onload = () => { resolve(reader.result as string); };
      reader.onerror = () => { reject(new Error("Failed to read file")); };
      reader.readAsDataURL(file);
    });

    // Read image natural dimensions
    const { w: imgW, h: imgH } = await new Promise<{ w: number; h: number }>((resolve) => {
      const img = new Image();
      img.onload = () => { resolve({ w: img.naturalWidth, h: img.naturalHeight }); };
      img.onerror = () => { resolve({ w: 0, h: 0 }); };
      img.src = dataUrl;
    });

    const payloadId = makeId("payload");
    const payloadValue: JsonObject = {
      id: payloadId,
      kind: "Payload",
      mediaType: file.type || "image/png",
      uri: dataUrl,
      sha256: hash,
      bytes: buffer.byteLength,
      meta: {
        ...(imgW > 0 && imgH > 0 ? { width: String(imgW), height: String(imgH) } : {}),
      },
    };

    const layerIdx = effectiveSelectedIndex;
    commitPatch((prev) => {
      const patchOps: GraphPatchOp[] = [putOp("Payload", payloadId, payloadValue)];

      const { sliceIds, ops: sliceOps } = getOrCreateSliceIds(prev, activeSpaceId);
      const sliceId = sliceIds[layerIdx];
      patchOps.push(...sliceOps);

      if (sliceId) {
        const { history, annotationId, ops: histOps } = getOrCreateAIHistory(prev, activeSpaceId, sliceIds);
        patchOps.push(...histOps);

        const existingPid = layerPayloadId(findLayerRender(prev, activeSpaceId), layerIdx);
        const rootAssets: { image?: PayloadId } = {};
        if (existingPid) rootAssets.image = existingPid as PayloadId;
        let updatedHistory = ensureHistoryGraphForSlice(history, sliceId, rootAssets);
        const graph = updatedHistory.slices[sliceId]!;

        const result = addOpResultToGraph(graph, {
          inputStateId: graph.operationStateId,
          opType: "import",
          outputAssets: [{ image: payloadId as PayloadId }],
          sliceIndex: layerIdx,
        });
        updatedHistory = { ...updatedHistory, slices: { ...updatedHistory.slices, [sliceId]: result.graph } };
        patchOps.push(buildHistoryPatchOp(updatedHistory, annotationId, activeSpaceId));
      }

      // Render annotation update
      const existing = findLayerRender(prev, activeSpaceId);
      const annId: AnnotationId = existing ? existing.annotationId : makeId("annotation");
      const currentData = existing ? { ...existing.annotation.data } : {};
      currentData[`payload.${String(layerIdx)}`] = payloadId;
      patchOps.push(putOp("Annotation", annId, {
        id: annId, kind: "Annotation",
        target: { kind: "Space", id: activeSpaceId },
        schema: "ui.layers.render", data: currentData,
        createdAt: new Date().toISOString(),
      }));

      return newPatch({ baseRevision: prev.revision, ops: patchOps });
    });
  }, [effectiveSelectedIndex, commitPatch, activeSpaceId, getOrCreateSliceIds, getOrCreateAIHistory, buildHistoryPatchOp]);

  /** Run AI edit on the selected layer's current image using the preferred model. */
  const handleAiEdit = useCallback(
    async (prompt: string, strength?: number) => {
      if (effectiveSelectedIndex === null) return;
      setAiError(null);
      setAiRunning(true);

      // Cancel any in-flight request
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        // Get the current layer's image
        const pid = layerPayloadId(layerRender, effectiveSelectedIndex);
        if (!pid) {
          throw new Error("No image on this layer. Import an image first.");
        }
        const payload = state.payloads[pid as PayloadId];
        if (!payload) {
          throw new Error("Payload not found in project state.");
        }

        // Use the *visible* texture (accounts for mask-off fallback, inversions,
        // combined masks, etc.) so the AI receives what the user actually sees.
        const visibleUri = layerTextures[effectiveSelectedIndex] ?? payload.uri;

        const inputPayloadId = pid;
        const modelDef = getAiEditModel(preferences.defaultAiEditModelId);

        // Run the selected model
        let result;
        if (modelDef.id === "nano-banana") {
          result = await runNanoBananaEdit(
            { imageDataUrls: [visibleUri], prompt },
            controller.signal,
          );
        } else {
          result = await runImg2Img(
            { imageDataUrl: visibleUri, prompt, strength: strength ?? 0.75 },
            controller.signal,
          );
        }

        const firstImage = result.images[0];
        if (!firstImage) throw new Error("fal.ai returned no images");
        let outputImageUrl = firstImage.url;
        // Preserve the raw AI output URL for mask regeneration
        const rawAiOutputUrl = outputImageUrl;

        // If the visible input was the masked payload (not the full original
        // fallback), check if the AI result still fits the original mask shape.
        // If not, run background removal to create a fresh segment.
        const maskOn = isMaskActive(layerProps, effectiveSelectedIndex, layerCount);
        const sentMaskedInput = maskOn && effectiveSelectedIndex > 0;

        // Parse source crop metadata if present
        const srcCrop: CropInfo | undefined = payload.meta.cropX !== undefined
          ? {
              cropX: Number(payload.meta.cropX),
              cropY: Number(payload.meta.cropY),
              cropW: Number(payload.meta.cropW),
              cropH: Number(payload.meta.cropH),
              origW: Number(payload.meta.origW),
              origH: Number(payload.meta.origH),
            }
          : undefined;

        let finalCrop: CropInfo | undefined = srcCrop;
        let wasRefit = false;

        if (sentMaskedInput) {
          // Use refitAiResult: measures mask fit, and if the AI output
          // doesn't match the original shape, runs background removal +
          // tight crop to create a proper new segment.
          const refit = await refitAiResult(
            outputImageUrl,
            visibleUri,
            srcCrop,
            controller.signal,
          );
          outputImageUrl = refit.dataUrl;
          finalCrop = refit.crop;
          wasRefit = refit.wasRefit;
        }

        // Fetch the output image to compute sha256 + bytes
        const { blob: outBlob, buffer: outBuffer } = await fetchImageBlob(
          outputImageUrl,
          controller.signal,
        );
        const outHash = await sha256Hex(outBuffer);

        // Always convert to a data URL so Three.js TextureLoader can use it
        // (remote fal.ai URLs hit CORS / expiry issues).
        if (!outputImageUrl.startsWith("data:")) {
          outputImageUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => { resolve(reader.result as string); };
            reader.onerror = () => { reject(new Error("Failed to convert blob to data URL")); };
            reader.readAsDataURL(outBlob);
          });
        }

        const outPayloadId = makeId("payload");

        // Build crop metadata from refitAiResult (may differ from source if refit)
        const cropMeta: Record<string, string> = {};
        if (finalCrop) {
          cropMeta.cropX = String(finalCrop.cropX);
          cropMeta.cropY = String(finalCrop.cropY);
          cropMeta.cropW = String(finalCrop.cropW);
          cropMeta.cropH = String(finalCrop.cropH);
          cropMeta.origW = String(finalCrop.origW);
          cropMeta.origH = String(finalCrop.origH);
        }

        // Use the actual output image dimensions for width/height meta
        const outImgBitmap = await createImageBitmap(outBlob);
        const outW = outImgBitmap.width;
        const outH = outImgBitmap.height;
        outImgBitmap.close();

        const outPayloadValue: JsonObject = {
          id: outPayloadId,
          kind: "Payload",
          mediaType: outBlob.type || "image/png",
          uri: outputImageUrl,
          sha256: outHash,
          bytes: outBuffer.byteLength,
          meta: {
            width: String(outW),
            height: String(outH),
            ...cropMeta,
          },
        };

        // Create OperatorRun for AI edit provenance
        const oprunId = makeId("oprun");
        const oprunValue: JsonObject = {
          id: oprunId,
          kind: "OperatorRun",
          operator: `fal.${modelDef.id}`,
          status: "succeeded",
          createdAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          inputs: [{ kind: "Payload", id: inputPayloadId }],
          outputs: [{ kind: "Payload", id: outPayloadId }],
          params: {
            prompt,
            ...(modelDef.hasStrength ? { strength: String(strength ?? 0.75) } : {}),
            proxyRoute: modelDef.proxyRoute,
            maskApplied: String(sentMaskedInput),
            maskRefit: String(wasRefit),
          },
        };

        const patchOps: GraphPatchOp[] = [
          putOp("Payload", outPayloadId, outPayloadValue),
          putOp("OperatorRun", oprunId, oprunValue),
        ];
        let finalPayloadId = outPayloadId;

        // Mask regeneration: run BiRefNet on the raw AI output to produce
        // a fresh segmentation mask. This prevents stale mask halos when
        // the AI shifts object boundaries.
        if (sentMaskedInput) {
          console.info("[Mask Regen] Running BiRefNet on raw AI output for fresh mask…");
          const bgRemovedUrl = await runBackgroundRemoval(rawAiOutputUrl, controller.signal);

          // Tight-crop the bg-removed result
          const { blob: bgBlob } = await fetchImageBlob(bgRemovedUrl, controller.signal);
          const bgBitmap = await createImageBitmap(bgBlob);
          const bgW = bgBitmap.width;
          const bgH = bgBitmap.height;
          const bgCanvas = document.createElement("canvas");
          bgCanvas.width = bgW;
          bgCanvas.height = bgH;
          const bgCtx = bgCanvas.getContext("2d");
          if (!bgCtx) throw new Error("Canvas 2D context unavailable");
          bgCtx.drawImage(bgBitmap, 0, 0);
          const bgImgData = bgCtx.getImageData(0, 0, bgW, bgH);
          const bgData = bgImgData.data;
          bgBitmap.close();

          let minX = bgW, minY = bgH, maxX = 0, maxY = 0;
          for (let i = 3; i < bgData.length; i += 4) {
            if ((bgData[i] ?? 0) > 10) {
              const pIdx = (i - 3) / 4;
              const px = pIdx % bgW;
              const py = Math.floor(pIdx / bgW);
              if (px < minX) minX = px;
              if (px > maxX) maxX = px;
              if (py < minY) minY = py;
              if (py > maxY) maxY = py;
            }
          }

          let regenUrl: string;
          let regenCrop: CropInfo | undefined;

          if (maxX >= minX && maxY >= minY) {
            const cX = minX, cY = minY;
            const cW = maxX - minX + 1, cH = maxY - minY + 1;
            const cropCanvas = document.createElement("canvas");
            cropCanvas.width = cW;
            cropCanvas.height = cH;
            const cropCtx = cropCanvas.getContext("2d");
            if (!cropCtx) throw new Error("Canvas 2D context unavailable");
            cropCtx.drawImage(bgCanvas, cX, cY, cW, cH, 0, 0, cW, cH);
            regenUrl = cropCanvas.toDataURL("image/png");

            // Map crop back to original image coordinates if source had crop
            if (srcCrop) {
              const scaleX = srcCrop.cropW / bgW;
              const scaleY = srcCrop.cropH / bgH;
              regenCrop = {
                cropX: srcCrop.cropX + Math.round(cX * scaleX),
                cropY: srcCrop.cropY + Math.round(cY * scaleY),
                cropW: Math.round(cW * scaleX),
                cropH: Math.round(cH * scaleY),
                origW: srcCrop.origW,
                origH: srcCrop.origH,
              };
            } else {
              regenCrop = { cropX: cX, cropY: cY, cropW: cW, cropH: cH, origW: bgW, origH: bgH };
            }
          } else {
            regenUrl = bgRemovedUrl;
            regenCrop = srcCrop;
          }

          // Build mask-regen payload
          const regenEncoder = new TextEncoder();
          const regenBytes = regenEncoder.encode(regenUrl);
          const regenHash = await sha256Hex(regenBytes.buffer);
          const regenPayloadId = makeId("payload");

          const regenCropMeta: Record<string, string> = {};
          if (regenCrop) {
            regenCropMeta.cropX = String(regenCrop.cropX);
            regenCropMeta.cropY = String(regenCrop.cropY);
            regenCropMeta.cropW = String(regenCrop.cropW);
            regenCropMeta.cropH = String(regenCrop.cropH);
            regenCropMeta.origW = String(regenCrop.origW);
            regenCropMeta.origH = String(regenCrop.origH);
          }

          const { blob: regenBlob } = await fetchImageBlob(regenUrl, controller.signal);
          const regenBitmap = await createImageBitmap(regenBlob);
          const regenW = regenBitmap.width;
          const regenH = regenBitmap.height;
          regenBitmap.close();

          const regenPayloadValue: JsonObject = {
            id: regenPayloadId,
            kind: "Payload",
            mediaType: "image/png",
            uri: regenUrl,
            sha256: regenHash,
            bytes: regenBytes.byteLength,
            meta: {
              width: String(regenW),
              height: String(regenH),
              sourcePayloadId: outPayloadId,
              ...regenCropMeta,
            },
          };

          // OperatorRun for mask regeneration (separate from AI edit)
          const maskRegenOprunId = makeId("oprun");
          const maskRegenOprunValue: JsonObject = {
            id: maskRegenOprunId,
            kind: "OperatorRun",
            operator: "birefnet.mask-regen",
            status: "succeeded",
            createdAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
            inputs: [{ kind: "Payload", id: outPayloadId }],
            outputs: [{ kind: "Payload", id: regenPayloadId }],
            params: {
              proxyRoute: "fal-ai/birefnet",
              sourceOperatorRunId: oprunId,
            },
          };

          patchOps.push(putOp("Payload", regenPayloadId, regenPayloadValue));
          patchOps.push(putOp("OperatorRun", maskRegenOprunId, maskRegenOprunValue));
          finalPayloadId = regenPayloadId;
          console.info("[Mask Regen] Fresh mask generated and recorded as separate operation");
        }

        const layerIdx = effectiveSelectedIndex;

        // Record in AI history
        commitPatch((prev) => {
          const { sliceIds, ops: sliceOps } = getOrCreateSliceIds(prev, activeSpaceId);
          const sliceId = sliceIds[layerIdx];
          const allOps: GraphPatchOp[] = [...patchOps, ...sliceOps];

          if (sliceId) {
            const { history, annotationId, ops: histOps } = getOrCreateAIHistory(prev, activeSpaceId, sliceIds);
            allOps.push(...histOps);

            // Ensure graph exists for this slice
            const existingPid = layerPayloadId(findLayerRender(prev, activeSpaceId), layerIdx);
            const rootAssets: { image?: PayloadId; mask?: PayloadId } = {};
            if (existingPid) rootAssets.image = existingPid as PayloadId;
            let updatedHistory = ensureHistoryGraphForSlice(history, sliceId, rootAssets);

            const graph = updatedHistory.slices[sliceId]!;

            // Determine the opType
            const aiOpType: OpType = sentMaskedInput ? "img2img" : "img2img";
            const result = addOpResultToGraph(graph, {
              inputStateId: graph.operationStateId,
              opType: aiOpType,
              operatorRunId: oprunId as OperatorRunId,
              outputAssets: [{ image: finalPayloadId as PayloadId }],
              summary: { model: modelDef.id, prompt },
              sliceIndex: layerIdx,
            });

            updatedHistory = {
              ...updatedHistory,
              slices: { ...updatedHistory.slices, [sliceId]: result.graph },
            };
            allOps.push(buildHistoryPatchOp(updatedHistory, annotationId, activeSpaceId));
          }

          // Update render annotation
          const existing = findLayerRender(prev, activeSpaceId);
          const annId: AnnotationId = existing ? existing.annotationId : makeId("annotation");
          const currentData = existing ? { ...existing.annotation.data } : {};
          currentData[`payload.${String(layerIdx)}`] = finalPayloadId;
          const renderAnn: JsonObject = {
            id: annId,
            kind: "Annotation",
            target: { kind: "Space", id: activeSpaceId },
            schema: "ui.layers.render",
            data: currentData,
            createdAt: new Date().toISOString(),
          };
          allOps.push(putOp("Annotation", annId, renderAnn));

          return newPatch({ baseRevision: prev.revision, ops: allOps });
        });
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        const msg = err instanceof Error ? err.message : "Unknown error";
        setAiError(msg);
      } finally {
        setAiRunning(false);
        abortRef.current = null;
      }
    },
    [effectiveSelectedIndex, layerRender, state.payloads, commitPatch, activeSpaceId, preferences.defaultAiEditModelId, layerProps, layerCount, layerTextures, getOrCreateSliceIds, getOrCreateAIHistory, buildHistoryPatchOp],
  );

  /* ── Ingest flow: Tabula Rasa → Image → BrickUI ── */

  /** Proxy function for text-to-image generation via fal.ai */
  const proxyGenerate = useCallback(
    async (prompt: string, signal: AbortSignal) => {
      const result = await runTextToImg({ prompt }, signal);
      const img = result.images[0];
      if (!img) throw new Error("No images returned");
      const out: { url: string; width?: number; height?: number } = { url: img.url };
      if (img.width != null) out.width = img.width;
      if (img.height != null) out.height = img.height;
      return out;
    },
    [],
  );

  /** Handle ingest commit: place image in space, run default operation. */
  const handleIngestCommit = useCallback(
    async (result: IngestResult) => {
      setShowIngest(false);

      const hash = await sha256Hex(result.bytes);
      const payloadId = makeId("payload");
      const payloadValue: JsonObject = {
        id: payloadId,
        kind: "Payload",
        mediaType: result.mediaType,
        uri: result.imageUrl,
        sha256: hash,
        bytes: result.bytes.byteLength,
        meta: {
          ...(result.width > 0 && result.height > 0
            ? { width: String(result.width), height: String(result.height) }
            : {}),
          ...(result.prompt ? { prompt: result.prompt } : {}),
        },
      };

      // Place the image on layer 0 of the active space
      const ops: GraphPatchOp[] = [putOp("Payload", payloadId, payloadValue)];

      // Create/update render annotation to map layer 0 → this payload
      commitPatch((prev) => {
        const existing = findLayerRender(prev, activeSpaceId);
        const annId: AnnotationId = existing
          ? existing.annotationId
          : makeId("annotation");
        const currentData = existing ? { ...existing.annotation.data } : {};
        const newData = { ...currentData, "payload.0": payloadId };

        const annotationValue: JsonObject = {
          id: annId,
          kind: "Annotation",
          target: { kind: "Space", id: activeSpaceId },
          schema: "ui.layers.render",
          data: newData,
          createdAt: new Date().toISOString(),
        };

        return newPatch({
          baseRevision: prev.revision,
          ops: [...ops, putOp("Annotation", annId, annotationValue)],
        });
      });

      // Select layer 0
      handleSelectLayer(0);

      // Store context for retry
      lastIngestRef.current = {
        payloadId,
        imageUrl: result.imageUrl,
        width: result.width,
        height: result.height,
        operationId: result.operationId,
        segmentMode: result.segmentMode,
      };

      // Run the default operation
      const op = getOperation(result.operationId);
      if (op && op.id !== "none") {
        setOpLabel(op.label + "…");
        setOpProgress({ phase: "running", label: op.label + "…" });
        // Show the slicing overlay with the ingested image while the operation runs
        setSlicingImageUrl(result.imageUrl);

        // Cancel any previous operation in-flight
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        try {
          // Read the latest state synchronously for context
          const currentState = await new Promise<ProjectState>((resolve) => {
            setState((s) => { resolve(s); return s; });
          });

          const opResult = await runOperation(
            op,
            activeSpaceId,
            payloadId,
            { state: currentState, imageWidth: result.width, imageHeight: result.height, segmentMode: result.segmentMode },
            controller.signal,
          );
          // Commit the operation result + build the render annotation from
          // the latest state (`prev`), so the annotation ID is always correct.
          commitPatch((prev) => {
            const allOps = [...opResult.ops];

            // Build the render annotation mapping from prev (latest state)
            const maskIds = opResult.maskPayloadIds ?? [];
            if (maskIds.length > 0) {
              const existing = findLayerRender(prev, activeSpaceId);
              const annId: AnnotationId = existing
                ? existing.annotationId
                : makeId("annotation");
              const currentData = existing ? { ...existing.annotation.data } : {};
              for (let i = 0; i < maskIds.length; i++) {
                const pid = maskIds[i];
                if (pid) currentData[`payload.${String(i + 1)}`] = pid;
              }
              const annotationValue: JsonObject = {
                id: annId,
                kind: "Annotation",
                target: { kind: "Space", id: activeSpaceId },
                schema: "ui.layers.render",
                data: currentData,
                createdAt: new Date().toISOString(),
              };
              allOps.push(putOp("Annotation", annId, annotationValue));
            }

            // Initialize AI history with root states for each slice
            const { sliceIds, ops: sliceOps } = getOrCreateSliceIds(prev, activeSpaceId);
            allOps.push(...sliceOps);
            const { history, annotationId: histAnnId, ops: histOps } = getOrCreateAIHistory(prev, activeSpaceId, sliceIds);
            allOps.push(...histOps);
            // Set documentSourceImageId to the layer-0 payload (source image)
            const updatedHistory: SpaceAIHistory = {
              ...history,
              documentSourceImageId: payloadId as PayloadId,
            };
            allOps.push(buildHistoryPatchOp(updatedHistory, histAnnId, activeSpaceId));

            return newPatch({ baseRevision: prev.revision, ops: allOps });
          });
          // Dismiss the slicing overlay — reveals the expanded layers
          setSlicingImageUrl(null);

          const mc = opResult.maskCount ?? 0;
          // Store mask candidates for the picker
          if (opResult.maskCandidates && opResult.maskCandidates.length > 0) {
            setMaskCandidates(opResult.maskCandidates);
          }
          // Trigger reveal animation when new slices are produced
          if (mc > 0) {
            setRevealActive(true);
          }
          if (mc === 0) {
            const warning = "No slices produced — segmentation returned 0 segments. Try a different image or retry.";
            setOpProgress({
              phase: "succeeded-warning",
              oprunId: opResult.oprunId,
              ops: opResult.ops,
              warning,
            });
            setLastOpResult({ label: opLabel, maskCount: 0, warning });
          } else {
            setOpProgress({ phase: "succeeded", oprunId: opResult.oprunId, ops: opResult.ops, maskCount: mc });
            setLastOpResult({ label: opLabel, maskCount: mc });
            // Auto-dismiss after a few seconds
            setTimeout(() => { setOpProgress(null); }, 3000);
          }
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") return;
          const msg = err instanceof Error ? err.message : "Operation failed";
          setOpProgress({ phase: "failed", error: msg });
          setSlicingImageUrl(null);
        } finally {
          abortRef.current = null;
        }
      }
    },
    [activeSpaceId, commitPatch, handleSelectLayer, getOrCreateSliceIds, getOrCreateAIHistory, buildHistoryPatchOp],
  );

  /** Update a preference and persist. */
  const handleChangePreference = useCallback(
    (key: keyof ProjectPreferences, value: string) => {
      setPreferences((prev) => {
        const next = { ...prev, [key]: value };
        savePreferences(next);
        return next;
      });
    },
    [],
  );

  // Helper functions for LayersPanel (needs layerProps + layerCount)
  const isHiddenFn = useCallback(
    (index: number) => isHidden(layerProps, index, layerCount),
    [layerProps, layerCount],
  );

  const persistedOpacityFn = useCallback(
    (index: number) => opacityMultiplier(layerProps, index, layerCount),
    [layerProps, layerCount],
  );

  const isMaskActiveFn = useCallback(
    (index: number) => isMaskActive(layerProps, index, layerCount),
    [layerProps, layerCount],
  );

  const isMaskInvertedFn = useCallback(
    (index: number) => isMaskInverted(layerProps, index, layerCount),
    [layerProps, layerCount],
  );

  // Layer stepping with [ / ]
  const handleStepLayer = useCallback(
    (direction: -1 | 1) => {
      const current = effectiveSelectedIndex ?? 0;
      const next = Math.max(0, Math.min(layerCount - 1, current + direction));
      handleSelectLayer(next);
    },
    [effectiveSelectedIndex, layerCount, handleSelectLayer],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if typing in an input
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "Escape") {
        handleClearSelection();
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if (mod && e.key === "z" && e.shiftKey) {
        e.preventDefault();
        handleRedo();
      } else if (mod && e.key === "y") {
        e.preventDefault();
        handleRedo();
      }

      // View mode switching: 1 / 2 / 3
      if (!mod && e.key === "1") { handleSetViewMode("universal"); return; }
      if (!mod && e.key === "2") { handleSetViewMode("layers"); return; }
      if (!mod && e.key === "3") { handleSetViewMode("minimalist"); return; }

      // Layer stepping: [ / ]
      if (e.key === "[") { handleStepLayer(-1); return; }
      if (e.key === "]") { handleStepLayer(1); return; }

      // Peek overlays: hold Tab = layers, hold Shift = rail
      if (e.key === "Tab" && !mod) {
        e.preventDefault();
        setPeekLayers(true);
        return;
      }
      if (e.key === "Shift" && !e.repeat) {
        setPeekRail(true);
        return;
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        setPeekLayers(false);
      }
      if (e.key === "Shift") {
        setPeekRail(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [handleClearSelection, handleUndo, handleRedo, handleStepLayer, handleSetViewMode]);

  return (
    <div className="app-shell" style={{ height: "100%", display: "grid", gridTemplateRows: "0px 1fr" }}>
      <header
        ref={headerRef}
        style={{
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          background: template.colors.background,
          color: template.colors.foreground,
          borderBottom: `1px solid ${template.colors.accent}22`,
          overflow: "hidden",
          opacity: 0,
          pointerEvents: "none",
        }}
      >
        <strong style={{ color: "var(--hud-text)" }}>Unbricked</strong>
        <span style={{ marginLeft: 10 }}>
          <ViewModeSwitcher current={viewMode} onChange={handleSetViewMode} />
        </span>
        <button
          type="button"
          onClick={handleUndo}
          disabled={undoCount === 0}
          style={{
            marginLeft: "auto",
            background: "none",
            border: "1px solid var(--hud-border-btn)",
            color: undoCount === 0 ? "var(--hud-muted)" : "var(--hud-text)",
            padding: "4px 10px",
            borderRadius: 4,
            cursor: undoCount === 0 ? "default" : "pointer",
            fontSize: 13,
          }}
        >
          Undo
        </button>
        <button
          type="button"
          onClick={handleRedo}
          disabled={redoCount === 0}
          style={{
            marginLeft: 6,
            background: "none",
            border: "1px solid var(--hud-border-btn)",
            color: redoCount === 0 ? "var(--hud-muted)" : "var(--hud-text)",
            padding: "4px 10px",
            borderRadius: 4,
            cursor: redoCount === 0 ? "default" : "pointer",
            fontSize: 13,
          }}
        >
          Redo
        </button>
        <button
          type="button"
          onClick={handleToggleView}
          disabled={animPhase !== "idle"}
          style={{
            marginLeft: 6,
            background: "none",
            border: "1px solid var(--hud-border-btn)",
            color: "var(--hud-text)",
            padding: "4px 10px",
            borderRadius: 4,
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          {isTopDown ? "3D view" : "Top-down"}
        </button>
        <button
          type="button"
          onClick={handleResetView}
          disabled={animPhase !== "idle"}
          style={{
            marginLeft: 6,
            background: "none",
            border: "1px solid var(--hud-border-btn)",
            color: "var(--hud-text)",
            padding: "4px 10px",
            borderRadius: 4,
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          Reset view
        </button>
        <button
          type="button"
          onClick={() => { setShowSettings((v) => !v); }}
          style={{
            marginLeft: 6,
            background: showSettings ? "var(--hud-active)" : "none",
            border: "1px solid var(--hud-border-btn)",
            color: "var(--hud-text)",
            padding: "4px 10px",
            borderRadius: 4,
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          ⚙
        </button>
        <button
          type="button"
          onClick={() => {
            clearProjectState();
            const fresh = createSampleProject();
            setState(fresh.state);
            const newRoot = fresh.state.manifest.rootSpaceId;
            void spaceNav.navigateTo(newRoot, { replace: true });
            spaceNav.setOrigin(newRoot);
            pastRef.current = [];
            futureRef.current = [];
            setUndoCount(0);
            setRedoCount(0);
            setPreviewLayerIndex(null);
            setPreviewOpacity(null);
            setPreviewOrder(null);
            setOpProgress(null);
            setLastOpResult(null);
            setSlicingImageUrl(null);
            setMaskCandidates([]);
            setShowMaskPicker(false);
            setGenerating3DLayer(null);
            setLayerGlbUrls({});
            setThreeDSourceHidden(new Set());
          }}
          style={{
            marginLeft: 6,
            background: "none",
            border: "1px solid var(--hud-border-btn)",
            color: "var(--hud-text)",
            padding: "4px 10px",
            borderRadius: 4,
            cursor: "pointer",
            fontSize: 13,
            opacity: 0.6,
          }}
        >
          Reset project
        </button>
      </header>
      <div style={{ position: "relative", overflow: "hidden" }}>
        <SpaceViewport
          layerCount={layerCount}
          selectedLayerIndex={effectiveSelectedIndex}
          onSelectLayer={handleSelectLayer}
          onPreviewLayer={setPreviewLayerIndex}
          layerVisibility={layerVisibility}
          soloIndex={solo}
          onToggleHidden={handleToggleHidden}
          onToggleSolo={handleToggleSolo}
          onToggleMask={handleToggleMask}
          maskActive={effectiveSelectedIndex !== null ? isMaskActive(layerProps, effectiveSelectedIndex, layerCount) : true}
          onPreviewOpacity={setPreviewOpacity}
          onCommitOpacity={handleCommitOpacity}
          persistedOpacity={effectiveSelectedIndex !== null ? opacityMultiplier(layerProps, effectiveSelectedIndex, layerCount) : 1.0}
          persistedOpacityFn={persistedOpacityFn}
          isHiddenFn={isHiddenFn}
          layerOrder={effectiveOrder}
          onPreviewOrder={setPreviewOrder}
          onCommitOrder={handleCommitOrder}
          animPhase={animPhase}
          onAnimDone={handleAnimDone}
          viewMode={viewMode}
          peekLayers={peekLayers}
          peekRail={peekRail}
          onClearSelection={handleClearSelection}
          layerTextures={layerTextures}
          layerThumbnails={layerThumbnails}
          colorLayerTextures={colorLayerTextures}
          layerCropInfo={layerCropInfo}
          segmentDisplayMode={segmentDisplayMode}
          onToggleSegmentDisplay={() => { setSegmentDisplayMode((m) => m === "masked" ? "colored" : "masked"); }}
          revealActive={revealActive}
          onRevealDone={() => { setRevealActive(false); }}
          imageAspect={imageAspect}
          onImportImage={() => { void handleImportImage(); }}
          onAiEdit={(prompt, strength) => { void handleAiEdit(prompt, strength); }}
          aiRunning={aiRunning}
          aiError={aiError}
          onPromptVisibilityChange={setAiPromptOpen}
          onAddSlice={handleAddSlice}
          isMaskActiveFn={isMaskActiveFn}
          isMaskInvertedFn={isMaskInvertedFn}
          onInvertMask={(index) => { void handleInvertMask(index); }}
          aiEditModelId={preferences.defaultAiEditModelId}
          onChangeAiEditModel={(id) => { handleChangePreference("defaultAiEditModelId", id); }}
          onGenerate3D={(index) => { void handleGenerate3D(index); }}
          generating3DLayer={generating3DLayer}
          layerGlbUrls={layerGlbUrls}
          threeDSourceHidden={threeDSourceHidden}
          onToggle3DSourceImage={handleToggle3DSourceImage}
          getSliceHistory={getSliceHistory}
          onSetDisplayCursor={handleSetDisplayCursor}
          onSetOperationCursor={handleSetOperationCursor}
          payloads={state.payloads as Record<string, { uri: string; meta: Record<string, string> }>}
          keyframePreviewUrl={keyframePreviewUrl}
          documentSourceImageId={aiHistory?.history.documentSourceImageId}
        />
        <SpaceAddressHUD
          fallbackSpaceId={rootSpaceId}
          spaces={state.spaces}
        />
        <PortalOverlay
          portalEdges={portalEdges}
          spaces={state.spaces}
          onEnter={handleNavigateToSpace}
        />

        {/* Tabula Rasa: blank-slate overlay when no images exist */}
        {isTabulaRasa && !showIngest && (
          <TabulaRasa onTap={() => { setShowIngest(true); }} />
        )}

        {/* Image Ingest Panel */}
        {showIngest && (
          <ImageIngestPanel
            defaultOperationId={preferences.defaultImageOperationId}
            onCommit={(result) => void handleIngestCommit(result)}
            onCancel={() => { setShowIngest(false); }}
            proxyGenerate={proxyGenerate}
          />
        )}

        {/* Slicing overlay: shows image with glow while initial operation runs */}
        {slicingImageUrl && opProgress && opProgress.phase === "running" && (
          <SlicingOverlay
            imageUrl={slicingImageUrl}
            label={opLabel}
          />
        )}

        {/* Operation progress / result indicator */}
        {opProgress && !slicingImageUrl && (
          <OperationProgressHUD
            progress={opProgress}
            operationLabel={opLabel}
            onRetry={() => {
              setOpProgress(null);
              if (lastIngestRef.current) {
                const ctx = lastIngestRef.current;
                const op = getOperation(ctx.operationId);
                if (op && op.id !== "none") {
                  setOpLabel(op.label + "…");
                  setOpProgress({ phase: "running", label: op.label + "…" });
                  setSlicingImageUrl(ctx.imageUrl);

                  abortRef.current?.abort();
                  const controller = new AbortController();
                  abortRef.current = controller;

                  void (async () => {
                    try {
                      const currentState = await new Promise<ProjectState>((resolve) => {
                        setState((s) => { resolve(s); return s; });
                      });
                      const opResult = await runOperation(
                        op,
                        activeSpaceId,
                        ctx.payloadId,
                        { state: currentState, imageWidth: ctx.width, imageHeight: ctx.height, segmentMode: ctx.segmentMode },
                        controller.signal,
                      );
                      commitPatch((prev) => {
                        const allOps = [...opResult.ops];
                        const maskIds = opResult.maskPayloadIds ?? [];
                        if (maskIds.length > 0) {
                          const existing = findLayerRender(prev, activeSpaceId);
                          const annId = existing ? existing.annotationId : makeId("annotation");
                          const currentData = existing ? { ...existing.annotation.data } : {};
                          for (let i = 0; i < maskIds.length; i++) {
                            const pid = maskIds[i];
                            if (pid) currentData[`payload.${String(i + 1)}`] = pid;
                          }
                          const annotationValue: JsonObject = {
                            id: annId,
                            kind: "Annotation",
                            target: { kind: "Space", id: activeSpaceId },
                            schema: "ui.layers.render",
                            data: currentData,
                            createdAt: new Date().toISOString(),
                          };
                          allOps.push(putOp("Annotation", annId, annotationValue));
                        }
                        // Initialize AI history with root states (retry path)
                        const { sliceIds: retrySliceIds, ops: retrySliceOps } = getOrCreateSliceIds(prev, activeSpaceId);
                        allOps.push(...retrySliceOps);
                        const { history: retryHist, annotationId: retryHistAnnId, ops: retryHistOps } = getOrCreateAIHistory(prev, activeSpaceId, retrySliceIds);
                        allOps.push(...retryHistOps);
                        const updatedRetryHist: SpaceAIHistory = { ...retryHist, documentSourceImageId: ctx.payloadId as PayloadId };
                        allOps.push(buildHistoryPatchOp(updatedRetryHist, retryHistAnnId, activeSpaceId));
                        return newPatch({ baseRevision: prev.revision, ops: allOps });
                      });
                      setSlicingImageUrl(null);
                      const mc = opResult.maskCount ?? 0;
                      if (opResult.maskCandidates && opResult.maskCandidates.length > 0) {
                        setMaskCandidates(opResult.maskCandidates);
                      }
                      if (mc > 0) setRevealActive(true);
                      if (mc === 0) {
                        const warning = "No slices produced — segmentation returned 0 segments. Try a different image or retry.";
                        setOpProgress({ phase: "succeeded-warning", oprunId: opResult.oprunId, ops: opResult.ops, warning });
                        setLastOpResult({ label: op.label, maskCount: 0, warning });
                      } else {
                        setOpProgress({ phase: "succeeded", oprunId: opResult.oprunId, ops: opResult.ops, maskCount: mc });
                        setLastOpResult({ label: op.label, maskCount: mc });
                        setTimeout(() => { setOpProgress(null); }, 3000);
                      }
                    } catch (err: unknown) {
                      if (err instanceof DOMException && err.name === "AbortError") return;
                      const msg = err instanceof Error ? err.message : "Operation failed";
                      setOpProgress({ phase: "failed", error: msg });
                      setSlicingImageUrl(null);
                    } finally {
                      abortRef.current = null;
                    }
                  })();
                  return;
                }
              }
              // Fallback: re-open ingest if no retry context
              setShowIngest(true);
            }}
            onDismiss={() => { setOpProgress(null); }}
          />
        )}

        {/* Persistent badge: recall last op result after HUD dismissed */}
        {!opProgress && !aiRunning && !aiPromptOpen && lastOpResult && !slicingImageUrl && !isTabulaRasa && (
          <button
            type="button"
            onClick={() => {
              if (lastOpResult.maskCount === 0 && lastOpResult.warning) {
                setOpProgress({
                  phase: "succeeded-warning",
                  oprunId: "" as import("./core").OperatorRunId,
                  ops: [],
                  warning: lastOpResult.warning,
                });
              } else {
                setOpProgress({
                  phase: "succeeded",
                  oprunId: "" as import("./core").OperatorRunId,
                  ops: [],
                  maskCount: lastOpResult.maskCount,
                });
                setTimeout(() => { setOpProgress(null); }, 3000);
              }
            }}
            title="Last segmentation result"
            style={{
              position: "absolute",
              bottom: 60,
              left: "50%",
              transform: "translateX(-50%)",
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 12px",
              background: "var(--hud-bg)",
              border: "1px solid var(--hud-border)",
              borderRadius: 6,
              color: lastOpResult.maskCount === 0 ? "var(--color-warning)" : "var(--color-success)",
              fontSize: 12,
              cursor: "pointer",
              zIndex: 79,
              backdropFilter: "blur(8px)",
              opacity: 0.7,
            }}
          >
            <span style={{ fontSize: 14 }}>{lastOpResult.maskCount === 0 ? "⚠" : "✓"}</span>
            <span>{lastOpResult.maskCount === 0 ? "0 slices" : `${String(lastOpResult.maskCount)} slices`}</span>
          </button>
        )}

        {/* Mask picker button — shown when candidates are available */}
        {!opProgress && !aiRunning && !aiPromptOpen && maskCandidates.length > 0 && !slicingImageUrl && !isTabulaRasa && (
          <button
            type="button"
            onClick={() => { setShowMaskPicker(true); }}
            title="Pick & combine masks"
            style={{
              position: "absolute",
              bottom: 60,
              left: "50%",
              transform: "translateX(80px)",
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "4px 10px",
              background: "var(--hud-bg)",
              border: "1px solid var(--hud-border)",
              borderRadius: 6,
              color: "var(--scrubber-active)",
              fontSize: 12,
              cursor: "pointer",
              zIndex: 79,
              backdropFilter: "blur(8px)",
            }}
          >
            <span style={{ fontSize: 14 }}>🎭</span>
            <span>Masks ({String(maskCandidates.length)})</span>
          </button>
        )}

        {/* Mask picker panel */}
        {showMaskPicker && maskCandidates.length > 0 && (
          <MaskPickerPanel
            candidates={maskCandidates}
            onCombine={handleCombineMasks}
            onClose={() => { setShowMaskPicker(false); }}
            combining={combining}
          />
        )}

        {/* Settings panel */}
        {showSettings && (
          <SettingsPanel
            preferences={preferences}
            onChangePreference={handleChangePreference}
            onClose={() => { setShowSettings(false); }}
          />
        )}

      </div>
    </div>
  );
}
