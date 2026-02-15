import { describe, expect, it } from "vitest";
import { applyPatch } from "./applyPatch";
import { newPatch, putOp, delOp } from "./graphPatch";
import { makeId } from "./ids";
import { findLayerSelection, findLayerProps, isHidden, opacityMultiplier, soloIndex } from "./selectors";
import { sampleProject } from "./sampleProject";
import type { AnnotationId, JsonObject } from "./types";

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
  const rootSpace = baseState.spaces[rootSpaceId];
  if (!rootSpace) throw new Error("root space missing");
  const layerCount = rootSpace.layerCount;

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
    expect(isHidden(props, 2, layerCount)).toBe(true);
    expect(isHidden(props, 0, layerCount)).toBe(false);
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
    expect(isHidden(props, 1, layerCount)).toBe(false);
    expect(isHidden(props, 3, layerCount)).toBe(true);
    expect(opacityMultiplier(props, 1, layerCount)).toBeCloseTo(0.5);
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
    expect(isHidden(props1, 0, layerCount)).toBe(true);
    expect(soloIndex(props1, layerCount)).toBe(3);

    // Rewrite without those keys
    const patch2 = newPatch({
      baseRevision: state1.revision,
      ops: [putOp("Annotation", annId, makePropsAnnotation(annId, {}))],
    });
    const state2 = applyPatch(state1, patch2);

    const props2 = findLayerProps(state2, rootSpaceId);
    expect(props2).not.toBeNull();
    expect(isHidden(props2, 0, layerCount)).toBe(false);
    expect(soloIndex(props2, layerCount)).toBeNull();
  });
});

describe("selectors — layer props parsing", () => {
  const baseState = sampleProject.state;
  const rootSpaceId = baseState.manifest.rootSpaceId;
  const rootSpace = baseState.spaces[rootSpaceId];
  if (!rootSpace) throw new Error("root space missing");
  const layerCount = rootSpace.layerCount;

  it("missing props annotation → defaults", () => {
    const props = findLayerProps(baseState, rootSpaceId);
    expect(props).toBeNull();
    // With null props, helpers return defaults
    expect(isHidden(null, 0, layerCount)).toBe(false);
    expect(opacityMultiplier(null, 0, layerCount)).toBe(1.0);
    expect(soloIndex(null, layerCount)).toBeNull();
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
    expect(soloIndex(props, layerCount)).toBeNull();
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
    expect(opacityMultiplier(props, 2, layerCount)).toBe(1.0);
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
    expect(opacityMultiplier(props, 0, layerCount)).toBe(1.0);
    expect(opacityMultiplier(props, 1, layerCount)).toBe(0);
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
    expect(soloIndex(props, layerCount)).toBeNull();
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
    expect(isHidden(props, 3, layerCount)).toBe(true);
    expect(isHidden(props, 0, layerCount)).toBe(false);
    expect(opacityMultiplier(props, 4, layerCount)).toBeCloseTo(0.7);
    expect(opacityMultiplier(props, 0, layerCount)).toBe(1.0);
    expect(soloIndex(props, layerCount)).toBe(2);
  });

  it("out-of-range solo → ignored (behaves as no solo)", () => {
    const annId = makeId("annotation");
    const patch = newPatch({
      baseRevision: baseState.revision,
      ops: [putOp("Annotation", annId, {
        id: annId,
        kind: "Annotation",
        target: { kind: "Space", id: rootSpaceId },
        schema: "ui.layers.props",
        data: { solo: "99" },
        createdAt: new Date().toISOString(),
      })],
    });
    const next = applyPatch(baseState, patch);
    const props = findLayerProps(next, rootSpaceId);
    expect(props).not.toBeNull();
    // solo=99 is out of range for layerCount=7 → ignored
    expect(soloIndex(props, layerCount)).toBeNull();
  });

  it("out-of-range hidden index → ignored", () => {
    const annId = makeId("annotation");
    const patch = newPatch({
      baseRevision: baseState.revision,
      ops: [putOp("Annotation", annId, {
        id: annId,
        kind: "Annotation",
        target: { kind: "Space", id: rootSpaceId },
        schema: "ui.layers.props",
        data: { "hidden.99": "true" },
        createdAt: new Date().toISOString(),
      })],
    });
    const next = applyPatch(baseState, patch);
    const props = findLayerProps(next, rootSpaceId);
    // index 99 is out of range → isHidden returns false
    expect(isHidden(props, 99, layerCount)).toBe(false);
    // valid indices still report not-hidden
    expect(isHidden(props, 0, layerCount)).toBe(false);
  });
});

describe("applyPatch — snapshot isolation (undo/redo safety)", () => {
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

  it("mutating returned state does not affect the original", () => {
    const annId = makeId("annotation");
    const patch = newPatch({
      baseRevision: baseState.revision,
      ops: [putOp("Annotation", annId, makeSelectionAnnotation(annId, 2))],
    });

    const next = applyPatch(baseState, patch);

    // Mutate the returned state's annotations map
    const bogusId = makeId("annotation");
    next.annotations[bogusId as AnnotationId] = {
      id: bogusId as AnnotationId,
      kind: "Annotation",
      target: { kind: "Space", id: rootSpaceId },
      schema: "bogus",
      data: {},
      createdAt: new Date().toISOString(),
    };

    // Original must be untouched
    expect(baseState.annotations[bogusId as AnnotationId]).toBeUndefined();
    expect(Object.keys(baseState.annotations)).toHaveLength(0);
  });

  it("mutating the original state after patch does not affect the returned state", () => {
    const annId = makeId("annotation");
    const patch = newPatch({
      baseRevision: baseState.revision,
      ops: [putOp("Annotation", annId, makeSelectionAnnotation(annId, 3))],
    });

    const next = applyPatch(baseState, patch);
    const annotationCountBefore = Object.keys(next.annotations).length;

    // Mutate the original's spaces map (shallow copy should protect next)
    const bogusSpaceId = makeId("space");
    (baseState.spaces as Record<string, unknown>)[bogusSpaceId] = { fake: true };

    // next.spaces must not contain the bogus entry
    expect((next.spaces as Record<string, unknown>)[bogusSpaceId]).toBeUndefined();
    expect(Object.keys(next.annotations)).toHaveLength(annotationCountBefore);

    // Cleanup: remove the bogus entry we added to baseState
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete (baseState.spaces as Record<string, unknown>)[bogusSpaceId];
  });

  it("chained patches produce independent snapshots (undo stack simulation)", () => {
    const annId = makeId("annotation");

    // Simulate: commit 1 → select layer 0
    const patch1 = newPatch({
      baseRevision: baseState.revision,
      ops: [putOp("Annotation", annId, makeSelectionAnnotation(annId, 0))],
    });
    const state1 = applyPatch(baseState, patch1);

    // Simulate: commit 2 → select layer 3
    const patch2 = newPatch({
      baseRevision: state1.revision,
      ops: [putOp("Annotation", annId, makeSelectionAnnotation(annId, 3))],
    });
    const state2 = applyPatch(state1, patch2);

    // Simulate: commit 3 → select layer 5
    const patch3 = newPatch({
      baseRevision: state2.revision,
      ops: [putOp("Annotation", annId, makeSelectionAnnotation(annId, 5))],
    });
    const state3 = applyPatch(state2, patch3);

    // All three snapshots should be independent
    const sel1 = findLayerSelection(state1, rootSpaceId);
    const sel2 = findLayerSelection(state2, rootSpaceId);
    const sel3 = findLayerSelection(state3, rootSpaceId);

    expect(sel1?.index).toBe(0);
    expect(sel2?.index).toBe(3);
    expect(sel3?.index).toBe(5);

    // Mutate state3's annotation data directly
    state3.annotations[annId as AnnotationId].data["layerIndex"] = "999";

    // state1 and state2 must be unaffected
    expect(findLayerSelection(state1, rootSpaceId)?.index).toBe(0);
    expect(findLayerSelection(state2, rootSpaceId)?.index).toBe(3);
  });

  it("deleting from one snapshot does not affect another", () => {
    const annId = makeId("annotation");

    const patch1 = newPatch({
      baseRevision: baseState.revision,
      ops: [putOp("Annotation", annId, makeSelectionAnnotation(annId, 4))],
    });
    const state1 = applyPatch(baseState, patch1);

    // Delete from state1's annotations
    const patch2 = newPatch({
      baseRevision: state1.revision,
      ops: [delOp("Annotation", annId)],
    });
    const state2 = applyPatch(state1, patch2);

    // state1 should still have the annotation (undo target)
    expect(findLayerSelection(state1, rootSpaceId)?.index).toBe(4);
    // state2 should not
    expect(findLayerSelection(state2, rootSpaceId)).toBeNull();
  });

  it("space mutations in one snapshot do not leak to another", () => {
    const annId = makeId("annotation");

    const patch = newPatch({
      baseRevision: baseState.revision,
      ops: [putOp("Annotation", annId, makeSelectionAnnotation(annId, 1))],
    });
    const next = applyPatch(baseState, patch);

    // Both share the same rootSpaceId, but the spaces maps are different objects
    expect(next.spaces).not.toBe(baseState.spaces);

    // Mutate next.spaces
    const rootSpace = next.spaces[rootSpaceId];
    next.spaces[rootSpaceId] = { ...rootSpace, name: "mutated" };

    // baseState must be unaffected
    expect(baseState.spaces[rootSpaceId].name).toBe("Root Space");
  });
});
