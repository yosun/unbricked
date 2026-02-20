/**
 * Integration test: verifies the full round-trip of AI history through
 * the real applyPatch → findAIHistory → addOpResultToGraph cycle.
 *
 * This mirrors exactly what handleAiEdit does on two sequential edits.
 */
import { describe, it, expect } from "vitest";
import { applyPatch } from "../applyPatch";
import { makeId } from "../ids";
import { findAIHistory, findSliceIds } from "../selectors";
import type {
  ProjectState,
  SpaceId,
  PayloadId,
  AnnotationId,
  GraphPatchOp,
  JsonObject,
} from "../types";
import {
  createSpaceAIHistory,
  ensureHistoryGraphForSlice,
  addOpResultToGraph,
  serializeAIHistory,
  getSeedPathIds,
  getPathHeadStateId,
  getAncestryPath,
  SPACE_AI_HISTORY_SCHEMA,
} from "./historyGraph";

function putOp(
  objectKind: "Annotation" | "Payload",
  id: string,
  value: JsonObject,
): GraphPatchOp {
  return { op: "put" as const, objectKind, id, value };
}

function newPatch(opts: { baseRevision: number; ops: GraphPatchOp[] }) {
  return {
    id: makeId("patch"),
    kind: "GraphPatch" as const,
    baseRevision: opts.baseRevision,
    createdAt: new Date().toISOString(),
    ops: opts.ops,
  };
}

function createMinimalState(): ProjectState {
  const spaceId = makeId("space") as SpaceId;
  const payloadId = makeId("payload") as PayloadId;
  return {
    manifest: {
      kind: "Manifest",
      version: 1,
      rootSpaceId: spaceId,
      objectHashes: {},
    },
    spaces: {
      [spaceId]: {
        id: spaceId,
        kind: "Space",
        name: "Test",
        createdAt: new Date().toISOString(),
        layerCount: 1,
        meta: {},
      },
    },
    edges: {},
    payloads: {
      [payloadId]: {
        id: payloadId,
        kind: "Payload",
        mediaType: "image/png",
        uri: "data:image/png;base64,abc",
        sha256: "abc123",
        bytes: 100,
        meta: { width: "100", height: "100" },
      },
    },
    annotations: {},
    operatorRuns: {},
    revision: 0,
  };
}

/**
 * Simulate what getOrCreateSliceIds + getOrCreateAIHistory + handleAiEdit
 * do inside commitPatch for a single AI edit.
 */
function simulateAiEdit(
  prev: ProjectState,
  spaceId: SpaceId,
  layerIdx: number,
  outputPayloadId: string,
): ProjectState {
  const ops: GraphPatchOp[] = [];

  // 1. getOrCreateSliceIds
  let sliceIds: string[];
  const existingSliceIdsAnn = Object.values(prev.annotations).find(
    (a) => a.target.kind === "Space" && a.target.id === spaceId && a.schema === "ui.layers.sliceIds",
  );

  let sliceIdsAnnId: string;
  if (existingSliceIdsAnn) {
    sliceIds = JSON.parse(existingSliceIdsAnn.data["ids"]!) as string[];
    sliceIdsAnnId = existingSliceIdsAnn.id;
  } else {
    sliceIds = [makeId("slice" as "slice")];
    sliceIdsAnnId = makeId("annotation");
    ops.push(
      putOp("Annotation", sliceIdsAnnId, {
        id: sliceIdsAnnId,
        kind: "Annotation",
        target: { kind: "Space", id: spaceId },
        schema: "ui.layers.sliceIds",
        data: { ids: JSON.stringify(sliceIds) },
        createdAt: new Date().toISOString(),
      }),
    );
  }

  const sliceId = sliceIds[layerIdx]!;

  // 2. getOrCreateAIHistory
  const existingHistResult = findAIHistory(prev, spaceId);
  let history;
  let histAnnId: string;
  if (existingHistResult) {
    history = existingHistResult.history;
    histAnnId = existingHistResult.annotationId;
  } else {
    history = createSpaceAIHistory();
    // Initialize root for each slice
    const existingPid = "img_root";
    history = ensureHistoryGraphForSlice(history, sliceId, {
      image: existingPid as PayloadId,
    });
    histAnnId = makeId("annotation");
    ops.push(
      putOp("Annotation", histAnnId, {
        id: histAnnId,
        kind: "Annotation",
        target: { kind: "Space", id: spaceId },
        schema: SPACE_AI_HISTORY_SCHEMA,
        data: serializeAIHistory(history) as unknown as Record<string, string>,
        createdAt: new Date().toISOString(),
      }),
    );
  }

  // 3. ensureHistoryGraphForSlice (idempotent for existing)
  let updatedHistory = ensureHistoryGraphForSlice(history, sliceId, {
    image: "img_root" as PayloadId,
  });
  const graph = updatedHistory.slices[sliceId]!;

  // 4. addOpResultToGraph
  const result = addOpResultToGraph(graph, {
    inputStateId: graph.operationStateId,
    opType: "img2img",
    outputAssets: [{ image: outputPayloadId as PayloadId }],
    summary: { model: "flux", prompt: "test edit" },
    sliceIndex: layerIdx,
  });

  updatedHistory = {
    ...updatedHistory,
    slices: { ...updatedHistory.slices, [sliceId]: result.graph },
  };

  // 5. buildHistoryPatchOp
  ops.push(
    putOp("Annotation", histAnnId, {
      id: histAnnId,
      kind: "Annotation",
      target: { kind: "Space", id: spaceId },
      schema: SPACE_AI_HISTORY_SCHEMA,
      data: serializeAIHistory(updatedHistory) as unknown as Record<string, string>,
      createdAt: new Date().toISOString(),
    }),
  );

  // Apply patch
  const patch = newPatch({ baseRevision: prev.revision, ops });
  return applyPatch(prev, patch);
}

describe("full round-trip integration: 2 sequential AI edits", () => {
  it("preserves all states through applyPatch → findAIHistory round-trip", () => {
    let state = createMinimalState();
    const spaceId = Object.keys(state.spaces)[0]! as SpaceId;

    // First AI edit
    state = simulateAiEdit(state, spaceId, 0, "output_img_1");

    // Verify after first edit
    const hist1 = findAIHistory(state, spaceId);
    expect(hist1).not.toBeNull();
    const sliceIds1 = findSliceIds(state, spaceId);
    expect(sliceIds1).not.toBeNull();
    const sliceId = sliceIds1!.ids[0]!;
    const graph1 = hist1!.history.slices[sliceId]!;

    expect(Object.keys(graph1.states)).toHaveLength(2); // root + S1
    expect(Object.keys(graph1.ops)).toHaveLength(1);
    expect(graph1.operationStateId).not.toBe(graph1.rootStateId);

    const seeds1 = getSeedPathIds(graph1);
    expect(seeds1).toHaveLength(1);
    const head1 = getPathHeadStateId(graph1, seeds1[0]!);
    expect(head1).toBe(graph1.operationStateId);

    // Second AI edit
    state = simulateAiEdit(state, spaceId, 0, "output_img_2");

    // Verify after second edit
    const hist2 = findAIHistory(state, spaceId);
    expect(hist2).not.toBeNull();
    const graph2 = hist2!.history.slices[sliceId]!;

    // Key assertions: 3 states (root + S1 + S2), 2 ops
    expect(Object.keys(graph2.states)).toHaveLength(3);
    expect(Object.keys(graph2.ops)).toHaveLength(2);

    // Still 1 seed path (sequential, not branching)
    const seeds2 = getSeedPathIds(graph2);
    expect(seeds2).toHaveLength(1);
    expect(seeds2[0]).toBe(seeds1[0]); // same seed path

    // Path head should be the LATEST state (S2), not S1
    const head2 = getPathHeadStateId(graph2, seeds2[0]!);
    expect(head2).not.toBe(head1); // different from S1
    expect(head2).toBe(graph2.operationStateId); // equals S2

    // Full ancestry: root → S1 → S2
    const ancestry = getAncestryPath(graph2, head2);
    expect(ancestry).toHaveLength(3);
    expect(ancestry[0]).toBe(graph2.rootStateId);
    expect(ancestry[2]).toBe(head2);

    // UI-visible nodes (skip root) should be 2
    const uiNodes = ancestry.slice(1);
    expect(uiNodes).toHaveLength(2);
  });

  it("preserves all states after 3 sequential edits through full round-trip", () => {
    let state = createMinimalState();
    const spaceId = Object.keys(state.spaces)[0]! as SpaceId;

    for (let i = 0; i < 3; i++) {
      state = simulateAiEdit(state, spaceId, 0, `output_img_${i + 1}`);
    }

    const hist = findAIHistory(state, spaceId);
    expect(hist).not.toBeNull();
    const sliceIds = findSliceIds(state, spaceId);
    const sliceId = sliceIds!.ids[0]!;
    const graph = hist!.history.slices[sliceId]!;

    // 4 states (root + 3 ops), 3 ops, 1 seed path
    expect(Object.keys(graph.states)).toHaveLength(4);
    expect(Object.keys(graph.ops)).toHaveLength(3);
    expect(getSeedPathIds(graph)).toHaveLength(1);

    // Head should be the latest state
    const seeds = getSeedPathIds(graph);
    const head = getPathHeadStateId(graph, seeds[0]!);
    expect(head).toBe(graph.operationStateId);

    // Full ancestry: root + 3 states = 4 nodes
    const ancestry = getAncestryPath(graph, head);
    expect(ancestry).toHaveLength(4);
    expect(ancestry[0]).toBe(graph.rootStateId);
    expect(ancestry[3]).toBe(head);

    // UI visible (skip root) = 3
    expect(ancestry.slice(1)).toHaveLength(3);
  });
});
