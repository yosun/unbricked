import { describe, expect, it } from "vitest";
import { applyPatch } from "./applyPatch";
import { newPatch, putOp, delOp } from "./graphPatch";
import { makeId } from "./ids";
import { findLayerSelection, findLayerProps, isHidden, opacityMultiplier, soloIndex } from "./selectors";
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

describe("applyPatch — layer props annotation", () => {
  const baseState = sampleProject.state;
  const rootSpaceId = baseState.manifest.rootSpaceId;

  function makePropsAnnotation(annId: string, data: Record<string, string>): JsonObject {
    return {
      id: annId,
      kind: "Annotation",
      target: { kind: "Space", id: rootSpaceId },
      schema: "ui.layers.props",
      data,
      createdAt: new Date().toISOString(),
    };
  }

  it("creates a props annotation via put", () => {
    const annId = makeId("annotation");
    const patch = newPatch({
      baseRevision: baseState.revision,
      ops: [putOp("Annotation", annId, makePropsAnnotation(annId, { "hidden.2": "true" }))],
    });

    const next = applyPatch(baseState, patch);
    const props = findLayerProps(next, rootSpaceId);
    expect(props).not.toBeNull();
    if (!props) throw new Error("props missing");
    expect(props.annotationId).toBe(annId);
    expect(isHidden(props, 2)).toBe(true);
    expect(isHidden(props, 0)).toBe(false);
  });

  it("overwrites props annotation with same id", () => {
    const annId = makeId("annotation");

    const patch1 = newPatch({
      baseRevision: baseState.revision,
      ops: [putOp("Annotation", annId, makePropsAnnotation(annId, { "hidden.1": "true" }))],
    });
    const state1 = applyPatch(baseState, patch1);

    const patch2 = newPatch({
      baseRevision: state1.revision,
      ops: [putOp("Annotation", annId, makePropsAnnotation(annId, { "hidden.3": "true", "opacity.1": "0.5" }))],
    });
    const state2 = applyPatch(state1, patch2);

    const props = findLayerProps(state2, rootSpaceId);
    expect(props).not.toBeNull();
    // hidden.1 should be gone (key not present after overwrite)
    expect(isHidden(props, 1)).toBe(false);
    expect(isHidden(props, 3)).toBe(true);
    expect(opacityMultiplier(props, 1)).toBeCloseTo(0.5);
  });

  it("clears props annotation via del", () => {
    const annId = makeId("annotation");

    const patch1 = newPatch({
      baseRevision: baseState.revision,
      ops: [putOp("Annotation", annId, makePropsAnnotation(annId, { solo: "2" }))],
    });
    const state1 = applyPatch(baseState, patch1);
    expect(findLayerProps(state1, rootSpaceId)).not.toBeNull();

    const patch2 = newPatch({
      baseRevision: state1.revision,
      ops: [delOp("Annotation", annId)],
    });
    const state2 = applyPatch(state1, patch2);
    expect(findLayerProps(state2, rootSpaceId)).toBeNull();
  });

  it("clears keys by rewriting data without them", () => {
    const annId = makeId("annotation");

    const patch1 = newPatch({
      baseRevision: baseState.revision,
      ops: [putOp("Annotation", annId, makePropsAnnotation(annId, { "hidden.0": "true", solo: "3" }))],
    });
    const state1 = applyPatch(baseState, patch1);

    const props1 = findLayerProps(state1, rootSpaceId);
    expect(isHidden(props1, 0)).toBe(true);
    expect(soloIndex(props1)).toBe(3);

    // Rewrite without those keys
    const patch2 = newPatch({
      baseRevision: state1.revision,
      ops: [putOp("Annotation", annId, makePropsAnnotation(annId, {}))],
    });
    const state2 = applyPatch(state1, patch2);

    const props2 = findLayerProps(state2, rootSpaceId);
    expect(props2).not.toBeNull();
    expect(isHidden(props2, 0)).toBe(false);
    expect(soloIndex(props2)).toBeNull();
  });
});

describe("selectors — layer props parsing", () => {
  const baseState = sampleProject.state;
  const rootSpaceId = baseState.manifest.rootSpaceId;

  it("missing props annotation → defaults", () => {
    const props = findLayerProps(baseState, rootSpaceId);
    expect(props).toBeNull();
    // With null props, helpers return defaults
    expect(isHidden(null, 0)).toBe(false);
    expect(opacityMultiplier(null, 0)).toBe(1.0);
    expect(soloIndex(null)).toBeNull();
  });

  it("invalid solo value → ignored", () => {
    const annId = makeId("annotation");
    const patch = newPatch({
      baseRevision: baseState.revision,
      ops: [putOp("Annotation", annId, {
        id: annId,
        kind: "Annotation",
        target: { kind: "Space", id: rootSpaceId },
        schema: "ui.layers.props",
        data: { solo: "NaN" },
        createdAt: new Date().toISOString(),
      })],
    });
    const next = applyPatch(baseState, patch);
    const props = findLayerProps(next, rootSpaceId);
    expect(soloIndex(props)).toBeNull();
  });

  it("invalid opacity value → defaults to 1.0", () => {
    const annId = makeId("annotation");
    const patch = newPatch({
      baseRevision: baseState.revision,
      ops: [putOp("Annotation", annId, {
        id: annId,
        kind: "Annotation",
        target: { kind: "Space", id: rootSpaceId },
        schema: "ui.layers.props",
        data: { "opacity.2": "garbage" },
        createdAt: new Date().toISOString(),
      })],
    });
    const next = applyPatch(baseState, patch);
    const props = findLayerProps(next, rootSpaceId);
    expect(opacityMultiplier(props, 2)).toBe(1.0);
  });

  it("opacity clamped to [0,1] for rendering", () => {
    const annId = makeId("annotation");
    const patch = newPatch({
      baseRevision: baseState.revision,
      ops: [putOp("Annotation", annId, {
        id: annId,
        kind: "Annotation",
        target: { kind: "Space", id: rootSpaceId },
        schema: "ui.layers.props",
        data: { "opacity.0": "1.5", "opacity.1": "-0.3" },
        createdAt: new Date().toISOString(),
      })],
    });
    const next = applyPatch(baseState, patch);
    const props = findLayerProps(next, rootSpaceId);
    expect(opacityMultiplier(props, 0)).toBe(1.0);
    expect(opacityMultiplier(props, 1)).toBe(0);
  });

  it("negative solo → ignored", () => {
    const annId = makeId("annotation");
    const patch = newPatch({
      baseRevision: baseState.revision,
      ops: [putOp("Annotation", annId, {
        id: annId,
        kind: "Annotation",
        target: { kind: "Space", id: rootSpaceId },
        schema: "ui.layers.props",
        data: { solo: "-1" },
        createdAt: new Date().toISOString(),
      })],
    });
    const next = applyPatch(baseState, patch);
    const props = findLayerProps(next, rootSpaceId);
    expect(soloIndex(props)).toBeNull();
  });

  it("valid keys parse correctly", () => {
    const annId = makeId("annotation");
    const patch = newPatch({
      baseRevision: baseState.revision,
      ops: [putOp("Annotation", annId, {
        id: annId,
        kind: "Annotation",
        target: { kind: "Space", id: rootSpaceId },
        schema: "ui.layers.props",
        data: { "hidden.3": "true", "opacity.4": "0.7", solo: "2" },
        createdAt: new Date().toISOString(),
      })],
    });
    const next = applyPatch(baseState, patch);
    const props = findLayerProps(next, rootSpaceId);
    expect(props).not.toBeNull();
    expect(isHidden(props, 3)).toBe(true);
    expect(isHidden(props, 0)).toBe(false);
    expect(opacityMultiplier(props, 4)).toBeCloseTo(0.7);
    expect(opacityMultiplier(props, 0)).toBe(1.0);
    expect(soloIndex(props)).toBe(2);
  });
});
