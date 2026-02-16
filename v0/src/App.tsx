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
} from "./core";
import type { AnnotationId, Edge, GraphPatch, GraphPatchOp, JsonObject, PayloadId, ProjectState, SpaceId } from "./core";
import { findPortalEdges } from "./core";
import { runImg2Img, fetchImageBlob } from "./services/falProxy";
import SpaceViewport from "./ui/SpaceViewport";
import SpaceAddressHUD from "./slice8/SpaceAddressHUD";
import { useSpaceNav } from "./slice8/useSpaceNav";
import PortalOverlay from "./ui/PortalOverlay";
import ViewModeSwitcher from "./ui/ViewModeSwitcher";
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

  const rootSpaceId = state.manifest.rootSpaceId;
  const spaceNav = useSpaceNav(rootSpaceId);
  const activeSpaceId = spaceNav.current;

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
    const result: Array<{ visible: boolean; opacity: number }> = [];
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

      result.push({ visible, opacity: finalOpacity });
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

  /** Build a map of layerIndex → payload URI for texture rendering. */
  const layerTextures = useMemo(() => {
    const result: Record<number, string> = {};
    for (let i = 0; i < layerCount; i++) {
      const pid = layerPayloadId(layerRender, i);
      if (pid) {
        const payload = state.payloads[pid as PayloadId];
        if (payload) {
          result[i] = payload.uri;
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

  /** Run AI img2img on the selected layer's current image. */
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

        // Call the proxy
        const result = await runImg2Img(
          {
            imageDataUrl: payload.uri,
            prompt,
            strength: strength ?? 0.75,
          },
          controller.signal,
        );

        const firstImage = result.images[0];
        if (!firstImage) throw new Error("fal.ai returned no images");
        const outputImageUrl = firstImage.url;

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
          operator: "fal.img2img",
          status: "succeeded",
          createdAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          inputs: [{ kind: "Payload", id: inputPayloadId }],
          outputs: [{ kind: "Payload", id: outPayloadId }],
          params: {
            prompt,
            strength: String(strength ?? 0.75),
            proxyRoute: "fal-ai/flux/dev/image-to-image",
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
    [effectiveSelectedIndex, layerRender, state.payloads, emitRenderUpdate],
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
        {import.meta.env.DEV && (
          <button
            type="button"
            onClick={() => {
              clearProjectState();
              setState(sampleProject.state);
              pastRef.current = [];
              futureRef.current = [];
              setUndoCount(0);
              setRedoCount(0);
              setPreviewLayerIndex(null);
              setPreviewOpacity(null);
              setPreviewOrder(null);
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
        )}
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
          imageAspect={imageAspect}
          onImportImage={() => { void handleImportImage(); }}
          onAiEdit={(prompt, strength) => { void handleAiEdit(prompt, strength); }}
          aiRunning={aiRunning}
          aiError={aiError}
          onAddSlice={handleAddSlice}
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
      </div>
    </div>
  );
}
