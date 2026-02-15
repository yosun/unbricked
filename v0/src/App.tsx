import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  applyPatch,
  findLayerSelection,
  makeId,
  newPatch,
  putOp,
  delOp,
  sampleProject,
} from "./core";
import type { AnnotationId, JsonObject, ProjectState } from "./core";
import SpaceViewport from "./ui/SpaceViewport";
import type { AnimPhase } from "./ui/CameraRig";

export default function App(): React.JSX.Element {
  const [state, setState] = useState<ProjectState>(sampleProject.state);
  const [previewLayerIndex, setPreviewLayerIndex] = useState<number | null>(null);
  const [animPhase, setAnimPhase] = useState<AnimPhase>("intro");

  const handleAnimDone = useCallback(() => {
    setAnimPhase("idle");
  }, []);

  const handleResetView = useCallback(() => {
    setAnimPhase("reset");
  }, []);
  const rootSpaceId = state.manifest.rootSpaceId;
  const rootSpace = state.spaces[rootSpaceId];

  const selection = useMemo(
    () => findLayerSelection(state, rootSpaceId),
    [state, rootSpaceId],
  );

  const effectiveSelectedIndex = previewLayerIndex ?? selection?.index ?? null;

  const handleSelectLayer = useCallback(
    (index: number) => {
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

        return applyPatch(prev, patch);
      });
    },
    [rootSpaceId],
  );

  const handleClearSelection = useCallback(() => {
    setState((prev) => {
      const existing = findLayerSelection(prev, rootSpaceId);
      if (!existing) return prev;

      const patch = newPatch({
        baseRevision: prev.revision,
        ops: [delOp("Annotation", existing.annotationId)],
      });

      return applyPatch(prev, patch);
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
          onClick={handleResetView}
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
          Reset view
        </button>
      </header>
      <SpaceViewport
        layerCount={rootSpace?.layerCount ?? 1}
        selectedLayerIndex={effectiveSelectedIndex}
        onSelectLayer={handleSelectLayer}
        onPreviewLayer={setPreviewLayerIndex}
        animPhase={animPhase}
        onAnimDone={handleAnimDone}
      />
    </div>
  );
}
