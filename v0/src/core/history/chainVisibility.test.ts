import { describe, expect, it } from "vitest";
import {
  createSpaceAIHistory,
  ensureHistoryGraphForSlice,
  addOpResultToGraph,
  getSeedPathIds,
  getPathHeadStateId,
  getAncestryPath,
  serializeAIHistory,
  deserializeAIHistory,
} from "./historyGraph";

describe("chain visibility bug", () => {
  it("shows all states after 2 sequential edits on same seed path", () => {
    let h = createSpaceAIHistory();
    h = ensureHistoryGraphForSlice(h, "s1", { image: "img0" as any });
    let g = h.slices["s1"]!;

    // First edit from root → creates seed path
    const r1 = addOpResultToGraph(g, {
      inputStateId: g.operationStateId,
      opType: "img2img",
      outputAssets: [{ image: "img1" as any }],
      summary: { model: "flux", prompt: "edit 1" },
    });
    g = r1.graph;

    expect(Object.keys(g.states)).toHaveLength(2); // root + state1
    expect(getSeedPathIds(g)).toHaveLength(1);
    expect(g.operationStateId).toBe(r1.newStateIds[0]);

    // Round-trip through serialization (simulates persistence between ops)
    const ser = serializeAIHistory({ ...h, slices: { s1: g } });
    const des = deserializeAIHistory(ser)!;
    g = des.slices["s1"]!;

    expect(Object.keys(g.states)).toHaveLength(2);
    expect(g.operationStateId).toBe(r1.newStateIds[0]);

    // Second edit from operationStateId (state1) → extends seed path
    const r2 = addOpResultToGraph(g, {
      inputStateId: g.operationStateId,
      opType: "img2img",
      outputAssets: [{ image: "img2" as any }],
      summary: { model: "flux", prompt: "edit 2" },
    });
    g = r2.graph;

    expect(Object.keys(g.states)).toHaveLength(3); // root + state1 + state2
    expect(getSeedPathIds(g)).toHaveLength(1); // still 1 seed path

    // Key assertion: ancestry from head should show ALL 3 states
    const seeds = getSeedPathIds(g);
    const headId = getPathHeadStateId(g, seeds[0]!);
    const ancestry = getAncestryPath(g, headId);

    expect(ancestry).toHaveLength(3); // root, state1, state2
    expect(ancestry[0]).toBe(g.rootStateId);
    expect(ancestry[1]).toBe(r1.newStateIds[0]);
    expect(ancestry[2]).toBe(r2.newStateIds[0]);

    // UI would skip root, so pathNodes = 2
    const pathNodes = ancestry.slice(1);
    expect(pathNodes).toHaveLength(2);
  });

  it("shows all states after 3 sequential edits", () => {
    let h = createSpaceAIHistory();
    h = ensureHistoryGraphForSlice(h, "s1", { image: "p0" as any });
    let g = h.slices["s1"]!;

    const results = [];
    for (let i = 0; i < 3; i++) {
      const r = addOpResultToGraph(g, {
        inputStateId: g.operationStateId,
        opType: "img2img",
        outputAssets: [{ image: `p${i + 1}` as any }],
      });
      g = r.graph;
      results.push(r);

      // Simulate persist round-trip each time
      const ser = serializeAIHistory({ version: 1, slices: { s1: g } });
      g = deserializeAIHistory(ser)!.slices["s1"]!;
    }

    expect(Object.keys(g.states)).toHaveLength(4); // root + 3 states
    expect(getSeedPathIds(g)).toHaveLength(1);

    const headId = getPathHeadStateId(g, getSeedPathIds(g)[0]!);
    const ancestry = getAncestryPath(g, headId);
    expect(ancestry).toHaveLength(4);
    expect(ancestry.slice(1)).toHaveLength(3); // 3 operation results visible
  });
});
