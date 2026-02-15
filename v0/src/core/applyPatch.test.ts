import { describe, expect, it } from "vitest";
import { applyPatch } from "./applyPatch";
import { newPatch, putOp, delOp } from "./graphPatch";
import { makeId } from "./ids";
import { findLayerSelection } from "./selectors";
import { sampleProject } from "./sampleProject";
import type { JsonObject } from "./types";

describe("applyPatch — selection annotation", () => {
  const baseState = sampleProject.state;
  const rootSpaceId = baseState.manifest.rootSpaceId;

  function makeSelectionAnnotation(annId: string, layerIndex: number): JsonObject {
    return {
      id: annId,
      kind: "Annotation",
      target: { kind: "Space", id: rootSpaceId },
      schema: "ui.selection.layerIndex",
      data: { layerIndex: String(layerIndex) },
      createdAt: new Date().toISOString(),
    };
  }

  it("creates a selection annotation via put", () => {
    const annId = makeId("annotation");
    const patch = newPatch({
      baseRevision: baseState.revision,
      ops: [putOp("Annotation", annId, makeSelectionAnnotation(annId, 3))],
    });

    const next = applyPatch(baseState, patch);

    expect(next.revision).toBe(baseState.revision + 1);
    const ann = next.annotations[annId];
    if (!ann) throw new Error("annotation missing");
    expect(ann.schema).toBe("ui.selection.layerIndex");
    expect(ann.data["layerIndex"]).toBe("3");

    const sel = findLayerSelection(next, rootSpaceId);
    if (!sel) throw new Error("selection missing");
    expect(sel.index).toBe(3);
    expect(sel.annotationId).toBe(annId);
  });

  it("overwrites selection annotation with same id", () => {
    const annId = makeId("annotation");

    const patch1 = newPatch({
      baseRevision: baseState.revision,
      ops: [putOp("Annotation", annId, makeSelectionAnnotation(annId, 2))],
    });
    const state1 = applyPatch(baseState, patch1);

    const patch2 = newPatch({
      baseRevision: state1.revision,
      ops: [putOp("Annotation", annId, makeSelectionAnnotation(annId, 5))],
    });
    const state2 = applyPatch(state1, patch2);

    expect(Object.keys(state2.annotations)).toHaveLength(1);

    const sel = findLayerSelection(state2, rootSpaceId);
    if (!sel) throw new Error("selection missing");
    expect(sel.index).toBe(5);
  });

  it("clears selection annotation via del", () => {
    const annId = makeId("annotation");

    const patch1 = newPatch({
      baseRevision: baseState.revision,
      ops: [putOp("Annotation", annId, makeSelectionAnnotation(annId, 4))],
    });
    const state1 = applyPatch(baseState, patch1);
    expect(findLayerSelection(state1, rootSpaceId)).not.toBeNull();

    const patch2 = newPatch({
      baseRevision: state1.revision,
      ops: [delOp("Annotation", annId)],
    });
    const state2 = applyPatch(state1, patch2);

    expect(findLayerSelection(state2, rootSpaceId)).toBeNull();
    expect(Object.keys(state2.annotations)).toHaveLength(0);
  });

  it("rejects out-of-range layer index in findLayerSelection", () => {
    const annId = makeId("annotation");

    const patch = newPatch({
      baseRevision: baseState.revision,
      ops: [putOp("Annotation", annId, makeSelectionAnnotation(annId, 99))],
    });
    const next = applyPatch(baseState, patch);

    expect(next.annotations[annId]).toBeDefined();
    expect(findLayerSelection(next, rootSpaceId)).toBeNull();
  });

  it("rejects negative layer index in findLayerSelection", () => {
    const annId = makeId("annotation");

    const patch = newPatch({
      baseRevision: baseState.revision,
      ops: [putOp("Annotation", annId, makeSelectionAnnotation(annId, -1))],
    });
    const next = applyPatch(baseState, patch);

    expect(findLayerSelection(next, rootSpaceId)).toBeNull();
  });
});
