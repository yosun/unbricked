import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyPatch,
  findLayerSelection,
  findLayerProps,
  findLayerOrder,
  defaultLayerOrder,
  serializeOrder,
  isHidden,
  opacityMultiplier,
  soloIndex,
  makeId,
  newPatch,
  putOp,
  delOp,
  sampleProject,
  loadProjectState,
  saveProjectState,
  clearProjectState,
} from "./core";
import type { AnnotationId, GraphPatch, JsonObject, ProjectState } from "./core";
import SpaceViewport from "./ui/SpaceViewport";
import type { AnimPhase } from "./ui/CameraRig";

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
      return "idle";
    });
  }, []);

  const handleResetView = useCallback(() => {
    setAnimPhase("reset");
  }, []);

  const handleToggleView = useCallback(() => {
    setAnimPhase(isTopDown ? "toIso" : "toTopDown");
  }, [isTopDown]);

  const rootSpaceId = state.manifest.rootSpaceId;
  const rootSpace = state.spaces[rootSpaceId];

  const selection = useMemo(
    () => findLayerSelection(state, rootSpaceId),
    [state, rootSpaceId],
  );

  const effectiveSelectedIndex = previewLayerIndex ?? selection?.index ?? null;

  const layerProps = useMemo(
    () => findLayerProps(state, rootSpaceId),
    [state, rootSpaceId],
  );

  const persistedLayerOrder = useMemo(() => {
    const found = findLayerOrder(state, rootSpaceId);
    return found ? found : null;
  }, [state, rootSpaceId]);

  // Build per-layer visibility/opacity for SpaceViewport
  const layerCount = rootSpace?.layerCount ?? 1;
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
        const existing = findLayerProps(prev, rootSpaceId);
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
          target: { kind: "Space", id: rootSpaceId },
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
    [rootSpaceId, commitPatch],
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
        const existing = findLayerOrder(prev, rootSpaceId);
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
          target: { kind: "Space", id: rootSpaceId },
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
    [rootSpaceId, commitPatch],
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
        const space = prev.spaces[rootSpaceId];
        if (!space || index < 0 || index >= space.layerCount) return null;

        const existing = findLayerSelection(prev, rootSpaceId);
        const annId: AnnotationId = existing
          ? existing.annotationId
          : makeId("annotation");

        const annotationValue: JsonObject = {
          id: annId,
          kind: "Annotation",
          target: { kind: "Space", id: rootSpaceId },
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
    [rootSpaceId, commitPatch],
  );

  const handleClearSelection = useCallback(() => {
    setPreviewOpacity(null);
    commitPatch((prev) => {
      const existing = findLayerSelection(prev, rootSpaceId);
      if (!existing) return null;

      return newPatch({
        baseRevision: prev.revision,
        ops: [delOp("Annotation", existing.annotationId)],
      });
    });
  }, [rootSpaceId, commitPatch]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
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
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [handleClearSelection, handleUndo, handleRedo]);

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
        <span style={{ marginLeft: 10, opacity: 0.5 }}>MVP — 3D-first layerspace</span>
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
        layerOrder={effectiveOrder}
        onPreviewOrder={setPreviewOrder}
        onCommitOrder={handleCommitOrder}
        animPhase={animPhase}
        onAnimDone={handleAnimDone}
      />
    </div>
  );
}
