import { describe, expect, it } from "vitest";
import { applyPatch } from "./applyPatch";
import { newPatch, putOp, delOp } from "./graphPatch";
import { makeId } from "./ids";
import { findLayerSelection, findLayerProps, isHidden, opacityMultiplier, soloIndex, findLayerOrder, parseLayerOrder, defaultLayerOrder, serializeOrder, findLayerRender, layerPayloadId } from "./selectors";
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
    const ann3 = state3.annotations[annId as AnnotationId];
    if (!ann3) throw new Error("annotation missing");
    ann3.data["layerIndex"] = "999";

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
    if (!rootSpace) throw new Error("root space missing");
    next.spaces[rootSpaceId] = { ...rootSpace, name: "mutated" };

    // baseState must be unaffected
    const baseRoot = baseState.spaces[rootSpaceId];
    if (!baseRoot) throw new Error("base root space missing");
    expect(baseRoot.name).toBe("Root Space");
  });
});

describe("applyPatch — layer order annotation", () => {
  const baseState = sampleProject.state;
  const rootSpaceId = baseState.manifest.rootSpaceId;
  const rootSpace = baseState.spaces[rootSpaceId];
  if (!rootSpace) throw new Error("root space missing");

  function makeOrderAnnotation(annId: string, order: string): JsonObject {
    return {
      id: annId,
      kind: "Annotation",
      target: { kind: "Space", id: rootSpaceId },
      schema: "ui.layers.order",
      data: { order },
      createdAt: new Date().toISOString(),
    };
  }

  it("creates an order annotation via put", () => {
    const annId = makeId("annotation");
    const order = "6,5,4,3,2,1,0";
    const patch = newPatch({
      baseRevision: baseState.revision,
      ops: [putOp("Annotation", annId, makeOrderAnnotation(annId, order))],
    });

    const next = applyPatch(baseState, patch);
    const found = findLayerOrder(next, rootSpaceId);
    expect(found).not.toBeNull();
    if (!found) throw new Error("order missing");
    expect(found.annotationId).toBe(annId);
    expect(found.order).toEqual([6, 5, 4, 3, 2, 1, 0]);
  });

  it("overwrites order annotation with same id", () => {
    const annId = makeId("annotation");

    const patch1 = newPatch({
      baseRevision: baseState.revision,
      ops: [putOp("Annotation", annId, makeOrderAnnotation(annId, "6,5,4,3,2,1,0"))],
    });
    const state1 = applyPatch(baseState, patch1);

    const patch2 = newPatch({
      baseRevision: state1.revision,
      ops: [putOp("Annotation", annId, makeOrderAnnotation(annId, "1,0,2,3,4,5,6"))],
    });
    const state2 = applyPatch(state1, patch2);

    const found = findLayerOrder(state2, rootSpaceId);
    if (!found) throw new Error("order missing");
    expect(found.order).toEqual([1, 0, 2, 3, 4, 5, 6]);
  });

  it("clears order annotation via del", () => {
    const annId = makeId("annotation");

    const patch1 = newPatch({
      baseRevision: baseState.revision,
      ops: [putOp("Annotation", annId, makeOrderAnnotation(annId, "6,5,4,3,2,1,0"))],
    });
    const state1 = applyPatch(baseState, patch1);
    expect(findLayerOrder(state1, rootSpaceId)).not.toBeNull();

    const patch2 = newPatch({
      baseRevision: state1.revision,
      ops: [delOp("Annotation", annId)],
    });
    const state2 = applyPatch(state1, patch2);
    expect(findLayerOrder(state2, rootSpaceId)).toBeNull();
  });

  it("invalid order (wrong length) → null", () => {
    const annId = makeId("annotation");
    const patch = newPatch({
      baseRevision: baseState.revision,
      ops: [putOp("Annotation", annId, makeOrderAnnotation(annId, "0,1,2"))],
    });
    const next = applyPatch(baseState, patch);
    expect(findLayerOrder(next, rootSpaceId)).toBeNull();
  });

  it("invalid order (duplicate values) → null", () => {
    const annId = makeId("annotation");
    const patch = newPatch({
      baseRevision: baseState.revision,
      ops: [putOp("Annotation", annId, makeOrderAnnotation(annId, "0,0,2,3,4,5,6"))],
    });
    const next = applyPatch(baseState, patch);
    expect(findLayerOrder(next, rootSpaceId)).toBeNull();
  });

  it("invalid order (out-of-range index) → null", () => {
    const annId = makeId("annotation");
    const patch = newPatch({
      baseRevision: baseState.revision,
      ops: [putOp("Annotation", annId, makeOrderAnnotation(annId, "0,1,2,3,4,5,99"))],
    });
    const next = applyPatch(baseState, patch);
    expect(findLayerOrder(next, rootSpaceId)).toBeNull();
  });

  it("invalid order (NaN values) → null", () => {
    const annId = makeId("annotation");
    const patch = newPatch({
      baseRevision: baseState.revision,
      ops: [putOp("Annotation", annId, makeOrderAnnotation(annId, "0,1,abc,3,4,5,6"))],
    });
    const next = applyPatch(baseState, patch);
    expect(findLayerOrder(next, rootSpaceId)).toBeNull();
  });

  it("missing order key → null", () => {
    const annId = makeId("annotation");
    const patch = newPatch({
      baseRevision: baseState.revision,
      ops: [putOp("Annotation", annId, {
        id: annId,
        kind: "Annotation",
        target: { kind: "Space", id: rootSpaceId },
        schema: "ui.layers.order",
        data: {},
        createdAt: new Date().toISOString(),
      })],
    });
    const next = applyPatch(baseState, patch);
    expect(findLayerOrder(next, rootSpaceId)).toBeNull();
  });
});

describe("selectors — layer order parsing helpers", () => {
  it("parseLayerOrder valid permutation", () => {
    expect(parseLayerOrder("2,0,1", 3)).toEqual([2, 0, 1]);
  });

  it("parseLayerOrder wrong length → null", () => {
    expect(parseLayerOrder("0,1", 3)).toBeNull();
  });

  it("parseLayerOrder duplicate → null", () => {
    expect(parseLayerOrder("0,0,1", 3)).toBeNull();
  });

  it("parseLayerOrder negative → null", () => {
    expect(parseLayerOrder("-1,0,1", 3)).toBeNull();
  });

  it("parseLayerOrder float truncated to int", () => {
    expect(parseLayerOrder("0,1.9,2", 3)).toEqual([0, 1, 2]);
  });

  it("defaultLayerOrder returns identity", () => {
    expect(defaultLayerOrder(5)).toEqual([0, 1, 2, 3, 4]);
  });

  it("serializeOrder round-trips with parseLayerOrder", () => {
    const order = [3, 1, 0, 2];
    const serialized = serializeOrder(order);
    expect(serialized).toBe("3,1,0,2");
    expect(parseLayerOrder(serialized, 4)).toEqual(order);
  });
});

describe("applyPatch — layer render mapping annotation", () => {
  const baseState = sampleProject.state;
  const rootSpaceId = baseState.manifest.rootSpaceId;

  function makeRenderAnnotation(annId: string, data: Record<string, string>): JsonObject {
    return {
      id: annId,
      kind: "Annotation",
      target: { kind: "Space", id: rootSpaceId },
      schema: "ui.layers.render",
      data,
      createdAt: new Date().toISOString(),
    };
  }

  it("no render annotation → null payload for all layers", () => {
    const render = findLayerRender(baseState, rootSpaceId);
    expect(render).toBeNull();
    expect(layerPayloadId(null, 0)).toBeNull();
    expect(layerPayloadId(null, 3)).toBeNull();
  });

  it("creates render annotation with payload mapping", () => {
    const annId = makeId("annotation");
    const payloadId = makeId("payload");

    const payloadValue: JsonObject = {
      id: payloadId,
      kind: "Payload",
      mediaType: "image/png",
      uri: "data:image/png;base64,abc",
      sha256: "deadbeef",
      bytes: 123,
      meta: {},
    };

    const patch = newPatch({
      baseRevision: baseState.revision,
      ops: [
        putOp("Payload", payloadId, payloadValue),
        putOp("Annotation", annId, makeRenderAnnotation(annId, { "payload.2": payloadId })),
      ],
    });

    const next = applyPatch(baseState, patch);
    const render = findLayerRender(next, rootSpaceId);
    expect(render).not.toBeNull();
    if (!render) throw new Error("render missing");
    expect(render.annotationId).toBe(annId);
    expect(layerPayloadId(render, 2)).toBe(payloadId);
    expect(layerPayloadId(render, 0)).toBeNull();
  });

  it("updates render mapping to a new payload (AI edit flow)", () => {
    const annId = makeId("annotation");
    const payloadId1 = makeId("payload");

    const payloadValue1: JsonObject = {
      id: payloadId1,
      kind: "Payload",
      mediaType: "image/png",
      uri: "data:image/png;base64,input",
      sha256: "aaa",
      bytes: 100,
      meta: {},
    };

    const patch1 = newPatch({
      baseRevision: baseState.revision,
      ops: [
        putOp("Payload", payloadId1, payloadValue1),
        putOp("Annotation", annId, makeRenderAnnotation(annId, { "payload.3": payloadId1 })),
      ],
    });
    const state1 = applyPatch(baseState, patch1);

    // Simulate AI edit: new payload + OperatorRun + updated render mapping
    const payloadId2 = makeId("payload");
    const oprunId = makeId("oprun");

    const payloadValue2: JsonObject = {
      id: payloadId2,
      kind: "Payload",
      mediaType: "image/png",
      uri: "https://example.com/output.png",
      sha256: "bbb",
      bytes: 200,
      meta: {},
    };

    const oprunValue: JsonObject = {
      id: oprunId,
      kind: "OperatorRun",
      operator: "fal.img2img",
      status: "succeeded",
      createdAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      inputs: [{ kind: "Payload", id: payloadId1 }],
      outputs: [{ kind: "Payload", id: payloadId2 }],
      params: { prompt: "make it blue", strength: "0.75" },
    };

    const patch2 = newPatch({
      baseRevision: state1.revision,
      ops: [
        putOp("Payload", payloadId2, payloadValue2),
        putOp("OperatorRun", oprunId, oprunValue),
        putOp("Annotation", annId, makeRenderAnnotation(annId, { "payload.3": payloadId2 })),
      ],
    });
    const state2 = applyPatch(state1, patch2);

    // Layer 3 now points to the new payload
    const render = findLayerRender(state2, rootSpaceId);
    expect(render).not.toBeNull();
    if (!render) throw new Error("render missing");
    expect(layerPayloadId(render, 3)).toBe(payloadId2);

    // Both payloads exist
    expect(state2.payloads[payloadId1]).toBeDefined();
    expect(state2.payloads[payloadId2]).toBeDefined();

    // OperatorRun exists with correct provenance
    const oprun = state2.operatorRuns[oprunId];
    expect(oprun).toBeDefined();
    if (!oprun) throw new Error("oprun missing");
    expect(oprun.operator).toBe("fal.img2img");
    expect(oprun.status).toBe("succeeded");
    expect(oprun.inputs).toEqual([{ kind: "Payload", id: payloadId1 }]);
    expect(oprun.outputs).toEqual([{ kind: "Payload", id: payloadId2 }]);
    expect(oprun.params["prompt"]).toBe("make it blue");
  });

  it("clears render annotation via del", () => {
    const annId = makeId("annotation");
    const payloadId = makeId("payload");

    const payloadValue: JsonObject = {
      id: payloadId,
      kind: "Payload",
      mediaType: "image/png",
      uri: "data:image/png;base64,abc",
      sha256: "deadbeef",
      bytes: 123,
      meta: {},
    };

    const patch1 = newPatch({
      baseRevision: baseState.revision,
      ops: [
        putOp("Payload", payloadId, payloadValue),
        putOp("Annotation", annId, makeRenderAnnotation(annId, { "payload.0": payloadId })),
      ],
    });
    const state1 = applyPatch(baseState, patch1);
    expect(findLayerRender(state1, rootSpaceId)).not.toBeNull();

    const patch2 = newPatch({
      baseRevision: state1.revision,
      ops: [delOp("Annotation", annId)],
    });
    const state2 = applyPatch(state1, patch2);
    expect(findLayerRender(state2, rootSpaceId)).toBeNull();
  });

  it("empty payload key → null", () => {
    const annId = makeId("annotation");
    const patch = newPatch({
      baseRevision: baseState.revision,
      ops: [putOp("Annotation", annId, makeRenderAnnotation(annId, { "payload.1": "" }))],
    });
    const next = applyPatch(baseState, patch);
    const render = findLayerRender(next, rootSpaceId);
    expect(render).not.toBeNull();
    expect(layerPayloadId(render, 1)).toBeNull();
  });
});

describe("selectors — layerPayloadId defaults", () => {
  it("null render → null for any index", () => {
    expect(layerPayloadId(null, 0)).toBeNull();
    expect(layerPayloadId(null, 5)).toBeNull();
  });
});
