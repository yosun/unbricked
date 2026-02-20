import { describe, expect, it } from "vitest";
import {
  createSpaceAIHistory,
  ensureHistoryGraphForSlice,
  addOpResultToGraph,
  getSeedPathIds,
  getPathIdForState,
  getPathHeadStateId,
  getAncestryPath,
  getChildStates,
  getOpEdgeBetween,
  setDisplayCursor,
  setOperationCursor,
  recomputeCaches,
  serializeAIHistory,
  deserializeAIHistory,
  makeStateId,
  makeOpId,
} from "./historyGraph";
import type { SliceHistoryGraph, SpaceAIHistory } from "./aiHistorySchema";

describe("makeStateId / makeOpId", () => {
  it("generates hstate_ prefixed IDs", () => {
    const id = makeStateId();
    expect(id).toMatch(/^hstate_/);
  });

  it("generates hop_ prefixed IDs", () => {
    const id = makeOpId();
    expect(id).toMatch(/^hop_/);
  });

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 20 }, () => makeStateId()));
    expect(ids.size).toBe(20);
  });
});

describe("createSpaceAIHistory", () => {
  it("creates empty history without document source image", () => {
    const h = createSpaceAIHistory();
    expect(h.version).toBe(1);
    expect(h.slices).toEqual({});
    expect(h.documentSourceImageId).toBeUndefined();
  });

  it("creates history with document source image", () => {
    const h = createSpaceAIHistory("payload_abc" as any);
    expect(h.documentSourceImageId).toBe("payload_abc");
  });
});

describe("ensureHistoryGraphForSlice", () => {
  it("creates a new slice graph with root state", () => {
    const h = createSpaceAIHistory();
    const updated = ensureHistoryGraphForSlice(h, "slice1", { image: "p1" as any });
    const graph = updated.slices["slice1"]!;

    expect(graph).toBeDefined();
    expect(graph.sliceId).toBe("slice1");
    expect(graph.rootStateId).toBeTruthy();
    expect(graph.displayStateId).toBe(graph.rootStateId);
    expect(graph.operationStateId).toBe(graph.rootStateId);

    const rootNode = graph.states[graph.rootStateId]!;
    expect(rootNode.parentStateId).toBeNull();
    expect(rootNode.parentOpId).toBeNull();
    expect(rootNode.seedPathId).toBeNull();
    expect(rootNode.assetRefs.image).toBe("p1");
    expect(rootNode.meta.label).toBe("Slice Root");
  });

  it("is idempotent for existing slice", () => {
    const h = createSpaceAIHistory();
    const h1 = ensureHistoryGraphForSlice(h, "slice1", { image: "p1" as any });
    const h2 = ensureHistoryGraphForSlice(h1, "slice1", { image: "p2" as any });
    expect(h2).toBe(h1); // same reference
    expect(h2.slices["slice1"]!.states[h2.slices["slice1"]!.rootStateId]!.assetRefs.image).toBe("p1"); // not p2
  });
});

describe("addOpResultToGraph", () => {
  function makeTestGraph(): SliceHistoryGraph {
    const h = createSpaceAIHistory();
    const updated = ensureHistoryGraphForSlice(h, "s1", { image: "img0" as any });
    return updated.slices["s1"]!;
  }

  it("adds a single-output operation from root", () => {
    const graph = makeTestGraph();
    const result = addOpResultToGraph(graph, {
      inputStateId: graph.rootStateId,
      opType: "img2img",
      outputAssets: [{ image: "img1" as any }],
      summary: { model: "flux-dev", prompt: "make it blue" },
    });

    expect(result.newStateIds).toHaveLength(1);
    expect(result.opId).toMatch(/^hop_/);

    const newGraph = result.graph;
    const newState = newGraph.states[result.newStateIds[0]!]!;
    expect(newState.parentStateId).toBe(graph.rootStateId);
    expect(newState.parentOpId).toBe(result.opId);
    expect(newState.seedPathId).toBe(newState.stateId); // new seed path from root
    expect(newState.meta.opType).toBe("img2img");

    // Cursors moved to new state
    expect(newGraph.displayStateId).toBe(newState.stateId);
    expect(newGraph.operationStateId).toBe(newState.stateId);

    // Seed paths updated
    expect(getSeedPathIds(newGraph)).toContain(newState.stateId);
  });

  it("creates a new seed path for each operation from root", () => {
    const graph = makeTestGraph();
    const r1 = addOpResultToGraph(graph, {
      inputStateId: graph.rootStateId,
      opType: "img2img",
      outputAssets: [{ image: "img1" as any }],
    });
    const r2 = addOpResultToGraph(r1.graph, {
      inputStateId: graph.rootStateId,
      opType: "img2img",
      outputAssets: [{ image: "img2" as any }],
    });

    const seeds = getSeedPathIds(r2.graph);
    expect(seeds).toHaveLength(2);
    expect(seeds).toContain(r1.newStateIds[0]);
    expect(seeds).toContain(r2.newStateIds[0]);
  });

  it("extends existing seed path when op is not from root", () => {
    const graph = makeTestGraph();
    const r1 = addOpResultToGraph(graph, {
      inputStateId: graph.rootStateId,
      opType: "img2img",
      outputAssets: [{ image: "img1" as any }],
    });
    const r2 = addOpResultToGraph(r1.graph, {
      inputStateId: r1.newStateIds[0]!,
      opType: "bgRemove",
      outputAssets: [{ image: "img2" as any }],
    });

    const seeds = getSeedPathIds(r2.graph);
    expect(seeds).toHaveLength(1); // still one path

    const extState = r2.graph.states[r2.newStateIds[0]!]!;
    expect(extState.seedPathId).toBe(r1.newStateIds[0]); // inherits from parent
  });

  it("handles multi-output operations", () => {
    const graph = makeTestGraph();
    const result = addOpResultToGraph(graph, {
      inputStateId: graph.rootStateId,
      opType: "img2img",
      outputAssets: [{ image: "a" as any }, { image: "b" as any }],
    });

    expect(result.newStateIds).toHaveLength(2);
    const seeds = getSeedPathIds(result.graph);
    expect(seeds).toHaveLength(2); // each output becomes a seed path
  });

  it("throws for invalid input state", () => {
    const graph = makeTestGraph();
    expect(() =>
      addOpResultToGraph(graph, {
        inputStateId: "nonexistent",
        opType: "img2img",
        outputAssets: [{ image: "x" as any }],
      }),
    ).toThrow("not found");
  });
});

describe("getSeedPathIds", () => {
  it("returns empty for root-only graph", () => {
    const h = createSpaceAIHistory();
    const updated = ensureHistoryGraphForSlice(h, "s", {});
    expect(getSeedPathIds(updated.slices["s"]!)).toEqual([]);
  });
});

describe("getPathIdForState", () => {
  it("returns null for root", () => {
    const h = ensureHistoryGraphForSlice(createSpaceAIHistory(), "s", {});
    const g = h.slices["s"]!;
    expect(getPathIdForState(g, g.rootStateId)).toBeNull();
  });

  it("returns correct path for child", () => {
    const h = ensureHistoryGraphForSlice(createSpaceAIHistory(), "s", {});
    const g = h.slices["s"]!;
    const r = addOpResultToGraph(g, {
      inputStateId: g.rootStateId,
      opType: "img2img",
      outputAssets: [{ image: "x" as any }],
    });
    expect(getPathIdForState(r.graph, r.newStateIds[0]!)).toBe(r.newStateIds[0]);
  });
});

describe("getPathHeadStateId", () => {
  it("returns head of a multi-step path", () => {
    const h = ensureHistoryGraphForSlice(createSpaceAIHistory(), "s", {});
    const g = h.slices["s"]!;
    const r1 = addOpResultToGraph(g, {
      inputStateId: g.rootStateId,
      opType: "img2img",
      outputAssets: [{ image: "x" as any }],
    });
    const r2 = addOpResultToGraph(r1.graph, {
      inputStateId: r1.newStateIds[0]!,
      opType: "bgRemove",
      outputAssets: [{ image: "y" as any }],
    });
    const pathId = r1.newStateIds[0]!;
    expect(getPathHeadStateId(r2.graph, pathId)).toBe(r2.newStateIds[0]);
  });
});

describe("getAncestryPath", () => {
  it("returns [root] for root state", () => {
    const h = ensureHistoryGraphForSlice(createSpaceAIHistory(), "s", {});
    const g = h.slices["s"]!;
    expect(getAncestryPath(g, g.rootStateId)).toEqual([g.rootStateId]);
  });

  it("returns full path from root to leaf", () => {
    const h = ensureHistoryGraphForSlice(createSpaceAIHistory(), "s", {});
    const g = h.slices["s"]!;
    const r1 = addOpResultToGraph(g, {
      inputStateId: g.rootStateId,
      opType: "img2img",
      outputAssets: [{ image: "x" as any }],
    });
    const r2 = addOpResultToGraph(r1.graph, {
      inputStateId: r1.newStateIds[0]!,
      opType: "bgRemove",
      outputAssets: [{ image: "y" as any }],
    });
    const ancestry = getAncestryPath(r2.graph, r2.newStateIds[0]!);
    expect(ancestry).toEqual([g.rootStateId, r1.newStateIds[0], r2.newStateIds[0]]);
  });
});

describe("getChildStates", () => {
  it("returns children of root", () => {
    const h = ensureHistoryGraphForSlice(createSpaceAIHistory(), "s", {});
    const g = h.slices["s"]!;
    const r = addOpResultToGraph(g, {
      inputStateId: g.rootStateId,
      opType: "img2img",
      outputAssets: [{ image: "x" as any }, { image: "y" as any }],
    });
    const children = getChildStates(r.graph, g.rootStateId);
    expect(children).toHaveLength(2);
  });
});

describe("getOpEdgeBetween", () => {
  it("finds edge between connected states", () => {
    const h = ensureHistoryGraphForSlice(createSpaceAIHistory(), "s", {});
    const g = h.slices["s"]!;
    const r = addOpResultToGraph(g, {
      inputStateId: g.rootStateId,
      opType: "maskInvert",
      outputAssets: [{ image: "x" as any }],
    });
    const edge = getOpEdgeBetween(r.graph, g.rootStateId, r.newStateIds[0]!);
    expect(edge).not.toBeNull();
    expect(edge!.opType).toBe("maskInvert");
    expect(edge!.opId).toBe(r.opId);
  });

  it("returns null for unconnected states", () => {
    const h = ensureHistoryGraphForSlice(createSpaceAIHistory(), "s", {});
    const g = h.slices["s"]!;
    expect(getOpEdgeBetween(g, g.rootStateId, "nonexistent")).toBeNull();
  });
});

describe("cursor setters", () => {
  it("setDisplayCursor updates displayStateId", () => {
    const h = ensureHistoryGraphForSlice(createSpaceAIHistory(), "s", {});
    const g = h.slices["s"]!;
    const r = addOpResultToGraph(g, {
      inputStateId: g.rootStateId,
      opType: "img2img",
      outputAssets: [{ image: "x" as any }],
    });
    const updated = setDisplayCursor(r.graph, g.rootStateId);
    expect(updated.displayStateId).toBe(g.rootStateId);
  });

  it("setOperationCursor updates operationStateId", () => {
    const h = ensureHistoryGraphForSlice(createSpaceAIHistory(), "s", {});
    const g = h.slices["s"]!;
    const r = addOpResultToGraph(g, {
      inputStateId: g.rootStateId,
      opType: "img2img",
      outputAssets: [{ image: "x" as any }],
    });
    const updated = setOperationCursor(r.graph, g.rootStateId);
    expect(updated.operationStateId).toBe(g.rootStateId);
  });

  it("ignores invalid state IDs", () => {
    const h = ensureHistoryGraphForSlice(createSpaceAIHistory(), "s", {});
    const g = h.slices["s"]!;
    expect(setDisplayCursor(g, "bogus")).toBe(g);
    expect(setOperationCursor(g, "bogus")).toBe(g);
  });
});

describe("recomputeCaches", () => {
  it("rebuilds seedPathIds and pathHeadStateIds", () => {
    const h = ensureHistoryGraphForSlice(createSpaceAIHistory(), "s", {});
    const g = h.slices["s"]!;
    const r1 = addOpResultToGraph(g, {
      inputStateId: g.rootStateId,
      opType: "img2img",
      outputAssets: [{ image: "a" as any }],
    });
    const r2 = addOpResultToGraph(r1.graph, {
      inputStateId: r1.newStateIds[0]!,
      opType: "bgRemove",
      outputAssets: [{ image: "b" as any }],
    });

    // Clear caches and recompute
    const { seedPathIds: _s, pathHeadStateIds: _h, ...rest } = r2.graph;
    const stripped: SliceHistoryGraph = rest as SliceHistoryGraph;
    const recomputed = recomputeCaches(stripped);
    expect(recomputed.seedPathIds).toEqual([r1.newStateIds[0]]);
    // The head should be one of the states in the path (either r1 or r2 - both valid
    // since timestamps may be identical within the same millisecond)
    const headId = recomputed.pathHeadStateIds![r1.newStateIds[0]!]!;
    const headNode = recomputed.states[headId]!;
    expect(headNode.seedPathId).toBe(r1.newStateIds[0]);
  });
});

describe("serialize / deserialize", () => {
  it("round-trips SpaceAIHistory", () => {
    const h = createSpaceAIHistory();
    const h1 = ensureHistoryGraphForSlice(h, "s1", { image: "p1" as any });
    const g = h1.slices["s1"]!;
    const r = addOpResultToGraph(g, {
      inputStateId: g.rootStateId,
      opType: "img2img",
      outputAssets: [{ image: "p2" as any }],
      summary: { model: "flux-dev", prompt: "hello" },
    });
    const final: SpaceAIHistory = {
      ...h1,
      slices: { ...h1.slices, s1: r.graph },
    };

    const serialized = serializeAIHistory(final);
    expect(typeof serialized.json).toBe("string");

    const deserialized = deserializeAIHistory(serialized);
    expect(deserialized).not.toBeNull();
    expect(deserialized!.version).toBe(1);
    expect(Object.keys(deserialized!.slices)).toEqual(["s1"]);
    expect(deserialized!.slices["s1"]!.rootStateId).toBe(g.rootStateId);
  });

  it("returns null for invalid data", () => {
    expect(deserializeAIHistory({})).toBeNull();
    expect(deserializeAIHistory({ json: "not json" })).toBeNull();
    expect(deserializeAIHistory({ json: JSON.stringify({ version: 2, slices: {} }) })).toBeNull();
  });
});
