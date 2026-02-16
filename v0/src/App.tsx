import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyPatch,
  findLayerSelection,
  findLayerProps,
  findLayerOrder,
  findLayerRender,
  layerPayloadId,
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
  loadProjectState,
  saveProjectState,
  clearProjectState,
  getOperation,
  loadPreferences,
  savePreferences,
} from "./core";
import type { AnnotationId, Edge, GraphPatch, GraphPatchOp, JsonObject, PayloadId, ProjectState, SpaceId } from "./core";
import type { ProjectPreferences } from "./core/preferences";
import { findPortalEdges } from "./core";
import { runImg2Img, runTextToImg, runNanoBananaEdit, fetchImageBlob, applyAlphaMask, invertAlpha, invertMaskWithOriginal, getAiEditModel, combineMasksToOriginal } from "./services/falProxy";
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

  /** Is the project in "tabula rasa" state — no meaningful content yet? */
  const isTabulaRasa = useMemo(() => {
    return Object.keys(state.payloads).length === 0;
  }, [state.payloads]);

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
  const abortRef = useRef<AbortController | null>(null);

  const layerRender = useMemo(
    () => findLayerRender(state, activeSpaceId),
    [state, activeSpaceId],
  );

  /** Portal edges from the current space. */
  const portalEdges: Edge[] = useMemo(
    () => findPortalEdges(state, activeSpaceId),
    [state, activeSpaceId],
  );

  /** Build a map of layerIndex → payload URI for texture rendering.
   *  When maskActive is false for a slice layer, fall back to the
   *  original image (layer 0) so the user sees the unmasked original. */
  const layerTextures = useMemo(() => {
    const result: Record<number, string> = {};
    // Resolve the original image URI from layer 0 for mask-off fallback
    const origPid = layerPayloadId(layerRender, 0);
    const origUri = origPid ? state.payloads[origPid as PayloadId]?.uri : undefined;
    for (let i = 0; i < layerCount; i++) {
      const maskOn = isMaskActive(layerProps, i, layerCount);
      // When mask is OFF on a slice layer, show the original image
      if (!maskOn && i > 0 && origUri) {
        result[i] = origUri;
        continue;
      }
      const pid = layerPayloadId(layerRender, i);
      if (pid) {
        const payload = state.payloads[pid as PayloadId];
        if (payload) {
          result[i] = payload.uri;
        }
      }
    }
    return result;
  }, [layerCount, layerRender, state.payloads, layerProps]);

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
        if (origPayload && index > 0) {
          invertedUrl = await invertMaskWithOriginal(origPayload.uri, payload.uri);
        } else {
          invertedUrl = await invertAlpha(payload.uri);
        }

        const encoder = new TextEncoder();
        const bytes = encoder.encode(invertedUrl);
        const hash = await sha256Hex(bytes.buffer as ArrayBuffer);

        const newPayloadId = makeId("payload");
        const newPayloadValue: JsonObject = {
          id: newPayloadId,
          kind: "Payload",
          mediaType: "image/png",
          uri: invertedUrl,
          sha256: hash,
          bytes: bytes.byteLength,
          meta: {
            ...(payload.meta as Record<string, string> ?? {}),
            invertedFrom: pid,
          },
        };

        // Update the render annotation to point to the new payload
        emitRenderUpdate(
          (data) => ({ ...data, [`payload.${String(index)}`]: newPayloadId }),
          [putOp("Payload", newPayloadId, newPayloadValue)],
        );

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
    [layerRender, state.payloads, emitRenderUpdate, emitPropsUpdate],
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

          return newPatch({ baseRevision: prev.revision, ops });
        });

        setShowMaskPicker(false);
      } catch (err) {
        console.error("[CombineMasks] failed:", err);
      } finally {
        setCombining(false);
      }
    },
    [layerRender, state.payloads, activeSpaceId, commitPatch],
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
    emitRenderUpdate(
      (data) => ({ ...data, [`payload.${String(layerIdx)}`]: payloadId }),
      [putOp("Payload", payloadId, payloadValue)],
    );
  }, [effectiveSelectedIndex, emitRenderUpdate]);

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

        const inputPayloadId = pid;
        const modelDef = getAiEditModel(preferences.defaultAiEditModelId);

        // Run the selected model
        let result;
        if (modelDef.id === "nano-banana") {
          result = await runNanoBananaEdit(
            { imageDataUrls: [payload.uri], prompt },
            controller.signal,
          );
        } else {
          result = await runImg2Img(
            { imageDataUrl: payload.uri, prompt, strength: strength ?? 0.75 },
            controller.signal,
          );
        }

        const firstImage = result.images[0];
        if (!firstImage) throw new Error("fal.ai returned no images");
        let outputImageUrl = firstImage.url;

        // If mask is active on this layer, re-apply the original slice's alpha
        // channel to the AI output (removes black background from generated result)
        const maskOn = isMaskActive(layerProps, effectiveSelectedIndex, layerCount);
        if (maskOn && effectiveSelectedIndex > 0) {
          outputImageUrl = await applyAlphaMask(
            outputImageUrl,
            payload.uri,
            controller.signal,
          );
        }

        // Fetch the output image to compute sha256 + bytes
        const { blob: outBlob, buffer: outBuffer } = await fetchImageBlob(
          outputImageUrl,
          controller.signal,
        );
        const outHash = await sha256Hex(outBuffer);

        const outPayloadId = makeId("payload");
        const outW = firstImage.width;
        const outH = firstImage.height;
        const outPayloadValue: JsonObject = {
          id: outPayloadId,
          kind: "Payload",
          mediaType: outBlob.type || "image/png",
          uri: outputImageUrl,
          sha256: outHash,
          bytes: outBuffer.byteLength,
          meta: {
            ...(outW && outH ? { width: String(outW), height: String(outH) } : {}),
          },
        };

        // Create OperatorRun for provenance
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
            maskApplied: String(maskOn && effectiveSelectedIndex > 0),
          },
        };

        const layerIdx = effectiveSelectedIndex;
        emitRenderUpdate(
          (data) => ({ ...data, [`payload.${String(layerIdx)}`]: outPayloadId }),
          [
            putOp("Payload", outPayloadId, outPayloadValue),
            putOp("OperatorRun", oprunId, oprunValue),
          ],
        );
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        const msg = err instanceof Error ? err.message : "Unknown error";
        setAiError(msg);
      } finally {
        setAiRunning(false);
        abortRef.current = null;
      }
    },
    [effectiveSelectedIndex, layerRender, state.payloads, emitRenderUpdate, preferences.defaultAiEditModelId, layerProps, layerCount],
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
    [activeSpaceId, commitPatch, handleSelectLayer],
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
    <div style={{ height: "100%", display: "grid", gridTemplateRows: "48px 1fr" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          background: "#16162a",
          color: "#ccc",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <strong style={{ color: "#eee" }}>Unbricked</strong>
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
            border: "1px solid rgba(255,255,255,0.15)",
            color: undoCount === 0 ? "#555" : "#aaa",
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
            border: "1px solid rgba(255,255,255,0.15)",
            color: redoCount === 0 ? "#555" : "#aaa",
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
            border: "1px solid rgba(255,255,255,0.15)",
            color: "#aaa",
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
            border: "1px solid rgba(255,255,255,0.15)",
            color: "#aaa",
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
            border: "1px solid rgba(255,255,255,0.15)",
            color: "#aaa",
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
            setState(sampleProject.state);
            void spaceNav.navigateTo(sampleProject.state.manifest.rootSpaceId);
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
          }}
          style={{
            marginLeft: 6,
            background: "none",
            border: "1px solid rgba(255,255,255,0.15)",
            color: "#aaa",
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
          colorLayerTextures={colorLayerTextures}
          segmentDisplayMode={segmentDisplayMode}
          onToggleSegmentDisplay={() => { setSegmentDisplayMode((m) => m === "masked" ? "colored" : "masked"); }}
          revealActive={revealActive}
          onRevealDone={() => { setRevealActive(false); }}
          imageAspect={imageAspect}
          onImportImage={() => { void handleImportImage(); }}
          onAiEdit={(prompt, strength) => { void handleAiEdit(prompt, strength); }}
          aiRunning={aiRunning}
          aiError={aiError}
          onAddSlice={handleAddSlice}
          isMaskActiveFn={isMaskActiveFn}
          isMaskInvertedFn={isMaskInvertedFn}
          onInvertMask={(index) => { void handleInvertMask(index); }}
          aiEditModelId={preferences.defaultAiEditModelId}
          onChangeAiEditModel={(id) => { handleChangePreference("defaultAiEditModelId", id); }}
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
        {!opProgress && lastOpResult && !slicingImageUrl && !isTabulaRasa && (
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
              color: lastOpResult.maskCount === 0 ? "#fb4" : "#6e6",
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
        {!opProgress && maskCandidates.length > 0 && !slicingImageUrl && !isTabulaRasa && (
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
              color: "#8cf",
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
