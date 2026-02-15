import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  applyPatch,
  findLayerSelection,
  findLayerProps,
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
import type { AnnotationId, JsonObject, ProjectState } from "./core";
import SpaceViewport from "./ui/SpaceViewport";
import type { AnimPhase } from "./ui/CameraRig";

export default function App(): React.JSX.Element {
  const [state, setState] = useState<ProjectState>(
    () => loadProjectState() ?? sampleProject.state,
  );
  const [previewLayerIndex, setPreviewLayerIndex] = useState<number | null>(null);
  const [previewOpacity, setPreviewOpacity] = useState<number | null>(null);
  const [animPhase, setAnimPhase] = useState<AnimPhase>("intro");
  const [isTopDown, setIsTopDown] = useState(false);

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

  // Build per-layer visibility/opacity for SpaceViewport
  const layerCount = rootSpace?.layerCount ?? 1;
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
      setState((prev) => {
        const existing = findLayerProps(prev, rootSpaceId);
        const annId: AnnotationId = existing
          ? existing.annotationId
          : makeId("annotation");
        const currentData = existing ? { ...existing.annotation.data } : {};
        const newData = updater(currentData);

        // Option B: if no keys remain, delete the annotation entirely
        if (Object.keys(newData).length === 0 && existing) {
          const patch = newPatch({
            baseRevision: prev.revision,
            ops: [delOp("Annotation", annId)],
          });
          const next = applyPatch(prev, patch);
          saveProjectState(next);
          return next;
        }

        const annotationValue: JsonObject = {
          id: annId,
          kind: "Annotation",
          target: { kind: "Space", id: rootSpaceId },
          schema: "ui.layers.props",
          data: newData,
          createdAt: new Date().toISOString(),
        };

        const patch = newPatch({
          baseRevision: prev.revision,
          ops: [putOp("Annotation", annId, annotationValue)],
        });

        const next = applyPatch(prev, patch);
        saveProjectState(next);
        return next;
      });
    },
    [rootSpaceId],
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
      setState((prev) => {
        const space = prev.spaces[rootSpaceId];
        if (!space || index < 0 || index >= space.layerCount) return prev;

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

        const patch = newPatch({
          baseRevision: prev.revision,
          ops: [putOp("Annotation", annId, annotationValue)],
        });

        const next = applyPatch(prev, patch);
        saveProjectState(next);
        return next;
      });
    },
    [rootSpaceId],
  );

  const handleClearSelection = useCallback(() => {
    setPreviewOpacity(null);
    setState((prev) => {
      const existing = findLayerSelection(prev, rootSpaceId);
      if (!existing) return prev;

      const patch = newPatch({
        baseRevision: prev.revision,
        ops: [delOp("Annotation", existing.annotationId)],
      });

      const next = applyPatch(prev, patch);
      saveProjectState(next);
      return next;
    });
  }, [rootSpaceId]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClearSelection();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [handleClearSelection]);

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
          onClick={handleToggleView}
          disabled={animPhase !== "idle"}
          style={{
            marginLeft: "auto",
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
              setPreviewLayerIndex(null);
              setPreviewOpacity(null);
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
        animPhase={animPhase}
        onAnimDone={handleAnimDone}
      />
    </div>
  );
}
