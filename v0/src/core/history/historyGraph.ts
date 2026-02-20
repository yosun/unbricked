// ═══════════════════════════════════════════════════════
// History Graph — Pure helpers for per-slice AI history DAG
// ═══════════════════════════════════════════════════════

import { makeId } from "../ids";
import type { PayloadId, OperatorRunId } from "../types";
import type {
  OpType,
  StateNode,
  OpEdge,
  SliceHistoryGraph,
  SpaceAIHistory,
} from "./aiHistorySchema";
import { SPACE_AI_HISTORY_SCHEMA } from "./aiHistorySchema";

// Re-export schema constant for convenience
export { SPACE_AI_HISTORY_SCHEMA };

// ──────────────────────────────────────────────────────
// ID generation helpers
// ──────────────────────────────────────────────────────
export function makeStateId(): string {
  return makeId("hstate" as "hstate");
}

export function makeOpId(): string {
  return makeId("hop" as "hop");
}

// ──────────────────────────────────────────────────────
// Create fresh SpaceAIHistory
// ──────────────────────────────────────────────────────
export function createSpaceAIHistory(
  documentSourceImageId?: PayloadId,
): SpaceAIHistory {
  const result: SpaceAIHistory = {
    version: 1,
    slices: {},
  };
  if (documentSourceImageId !== undefined) {
    result.documentSourceImageId = documentSourceImageId;
  }
  return result;
}

// ──────────────────────────────────────────────────────
// Ensure a SliceHistoryGraph exists for a given slice
// ──────────────────────────────────────────────────────
export function ensureHistoryGraphForSlice(
  history: SpaceAIHistory,
  sliceId: string,
  rootAssets: {
    image?: PayloadId;
    mask?: PayloadId;
    thumb?: PayloadId;
    glb?: PayloadId;
  },
): SpaceAIHistory {
  if (history.slices[sliceId]) return history;

  const rootStateId = makeStateId();
  const rootNode: StateNode = {
    stateId: rootStateId,
    sliceId,
    assetRefs: { ...rootAssets },
    parentStateId: null,
    parentOpId: null,
    seedPathId: null,
    meta: {
      label: "Slice Root",
      createdAt: new Date().toISOString(),
    },
  };

  const graph: SliceHistoryGraph = {
    sliceId,
    rootStateId,
    states: { [rootStateId]: rootNode },
    ops: {},
    displayStateId: rootStateId,
    operationStateId: rootStateId,
    seedPathIds: [],
    pathHeadStateIds: {},
  };

  return {
    ...history,
    slices: { ...history.slices, [sliceId]: graph },
  };
}

// ──────────────────────────────────────────────────────
// Add an operation result to the graph
// ──────────────────────────────────────────────────────
export interface AddOpResultInput {
  inputStateId: string;
  opType: OpType;
  operatorRunId?: OperatorRunId;
  outputAssets: Array<{
    image?: PayloadId;
    mask?: PayloadId;
    thumb?: PayloadId;
    glb?: PayloadId;
  }>;
  summary?: { model?: string; prompt?: string };
  sliceIndex?: number;
}

export interface AddOpResult {
  graph: SliceHistoryGraph;
  newStateIds: string[];
  opId: string;
}

export function addOpResultToGraph(
  graph: SliceHistoryGraph,
  input: AddOpResultInput,
): AddOpResult {
  const {
    inputStateId,
    opType,
    operatorRunId,
    outputAssets,
    summary,
    sliceIndex,
  } = input;

  const inputNode = graph.states[inputStateId];
  if (!inputNode) {
    throw new Error(`Input state ${inputStateId} not found in graph`);
  }

  const isFromRoot = inputStateId === graph.rootStateId;
  const opId = makeOpId();
  const newStateIds: string[] = [];

  const newStates = { ...graph.states };
  const newOps = { ...graph.ops };
  let newSeedPathIds = graph.seedPathIds ? [...graph.seedPathIds] : getSeedPathIds(graph);
  let newPathHeadStateIds = { ...(graph.pathHeadStateIds ?? {}) };

  for (const assets of outputAssets) {
    const stateId = makeStateId();
    newStateIds.push(stateId);

    // Determine seedPathId for this new node
    let seedPathId: string;
    if (isFromRoot) {
      // New seed path: this state IS the path root
      seedPathId = stateId;
      newSeedPathIds.push(stateId);
    } else {
      // Extends existing path: inherit seedPathId from input
      seedPathId = inputNode.seedPathId ?? stateId;
    }

    const newNode: StateNode = {
      stateId,
      sliceId: graph.sliceId,
      ...(sliceIndex !== undefined ? { sliceIndex } : {}),
      assetRefs: { ...assets },
      parentStateId: inputStateId,
      parentOpId: opId,
      seedPathId,
      meta: {
        label: `AI: ${opType}`,
        createdAt: new Date().toISOString(),
        opType,
      },
    };
    newStates[stateId] = newNode;

    // Update path head: always set to the latest state in the path
    newPathHeadStateIds[seedPathId] = stateId;
  }

  const opEdge: OpEdge = {
    opId,
    sliceId: graph.sliceId,
    ...(sliceIndex !== undefined ? { sliceIndex } : {}),
    opType,
    ...(operatorRunId !== undefined ? { operatorRunId } : {}),
    inputStateId,
    outputStateIds: newStateIds,
    ...(summary ? { summary } : {}),
    createdAt: new Date().toISOString(),
  };
  newOps[opId] = opEdge;

  const updatedGraph: SliceHistoryGraph = {
    ...graph,
    states: newStates,
    ops: newOps,
    // Move both cursors to first output by default
    displayStateId: newStateIds[0] ?? graph.displayStateId,
    operationStateId: newStateIds[0] ?? graph.operationStateId,
    seedPathIds: newSeedPathIds,
    pathHeadStateIds: newPathHeadStateIds,
  };

  return { graph: updatedGraph, newStateIds, opId };
}

// ──────────────────────────────────────────────────────
// Get seed path IDs (children of root)
// ──────────────────────────────────────────────────────
export function getSeedPathIds(graph: SliceHistoryGraph): string[] {
  // Seed paths = direct children of rootStateId
  const children: string[] = [];
  for (const node of Object.values(graph.states)) {
    if (node.parentStateId === graph.rootStateId) {
      children.push(node.stateId);
    }
  }
  // Sort by creation time for stable order
  children.sort((a, b) => {
    const na = graph.states[a];
    const nb = graph.states[b];
    if (!na || !nb) return 0;
    return na.meta.createdAt.localeCompare(nb.meta.createdAt);
  });
  return children;
}

// ──────────────────────────────────────────────────────
// Get the path ID for a given state (which seed path it belongs to)
// ──────────────────────────────────────────────────────
export function getPathIdForState(
  graph: SliceHistoryGraph,
  stateId: string,
): string | null {
  const node = graph.states[stateId];
  if (!node) return null;
  return node.seedPathId;
}

// ──────────────────────────────────────────────────────
// Get path head (latest state in a seed path)
// ──────────────────────────────────────────────────────
export function getPathHeadStateId(
  graph: SliceHistoryGraph,
  pathId: string,
): string {
  // Check cache first
  if (graph.pathHeadStateIds?.[pathId]) {
    return graph.pathHeadStateIds[pathId];
  }
  // Recompute: find deepest descendant in this path
  let head = pathId;
  const states: StateNode[] = Object.values(graph.states);
  for (const n of states) {
    if (n.seedPathId === pathId) {
      // Check if this node is deeper than current head
      if (n.meta.createdAt > (graph.states[head]?.meta.createdAt ?? "")) {
        head = n.stateId;
      }
    }
  }
  return head;
}

// ──────────────────────────────────────────────────────
// Get ancestry path from a state back to root
// ──────────────────────────────────────────────────────
export function getAncestryPath(
  graph: SliceHistoryGraph,
  stateId: string,
): string[] {
  const path: string[] = [];
  let current: string | null = stateId;
  const visited = new Set<string>();
  while (current !== null) {
    if (visited.has(current)) break; // safety: cycle detection
    visited.add(current);
    path.unshift(current);
    const n: StateNode | undefined = graph.states[current];
    if (!n) break;
    current = n.parentStateId;
  }
  return path;
}

// ──────────────────────────────────────────────────────
// Get children of a state
// ──────────────────────────────────────────────────────
export function getChildStates(
  graph: SliceHistoryGraph,
  stateId: string,
): StateNode[] {
  return Object.values(graph.states).filter(
    (n) => n.parentStateId === stateId,
  );
}

// ──────────────────────────────────────────────────────
// Get op edge between two states
// ──────────────────────────────────────────────────────
export function getOpEdgeBetween(
  graph: SliceHistoryGraph,
  inputStateId: string,
  outputStateId: string,
): OpEdge | null {
  for (const op of Object.values(graph.ops)) {
    if (
      op.inputStateId === inputStateId &&
      op.outputStateIds.includes(outputStateId)
    ) {
      return op;
    }
  }
  return null;
}

// ──────────────────────────────────────────────────────
// Cursor setters (return new graph)
// ──────────────────────────────────────────────────────
export function setDisplayCursor(
  graph: SliceHistoryGraph,
  stateId: string,
): SliceHistoryGraph {
  if (!graph.states[stateId]) return graph;
  return { ...graph, displayStateId: stateId };
}

export function setOperationCursor(
  graph: SliceHistoryGraph,
  stateId: string,
): SliceHistoryGraph {
  if (!graph.states[stateId]) return graph;
  return { ...graph, operationStateId: stateId };
}

// ──────────────────────────────────────────────────────
// Recompute caches (seed paths + heads)
// ──────────────────────────────────────────────────────
export function recomputeCaches(
  graph: SliceHistoryGraph,
): SliceHistoryGraph {
  const seedPathIds = getSeedPathIds(graph);
  const pathHeadStateIds: Record<string, string> = {};
  for (const pathId of seedPathIds) {
    pathHeadStateIds[pathId] = getPathHeadStateId(
      { ...graph, pathHeadStateIds: {} }, // clear cache to force recompute
      pathId,
    );
  }
  return { ...graph, seedPathIds, pathHeadStateIds };
}

// ──────────────────────────────────────────────────────
// Serialize / deserialize for Annotation storage
// ──────────────────────────────────────────────────────
export function serializeAIHistory(
  history: SpaceAIHistory,
): Record<string, string> {
  return { json: JSON.stringify(history) };
}

export function deserializeAIHistory(
  data: Record<string, string>,
): SpaceAIHistory | null {
  const raw = data["json"];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SpaceAIHistory;
    if (parsed.version !== 1) return null;
    if (!parsed.slices || typeof parsed.slices !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}
