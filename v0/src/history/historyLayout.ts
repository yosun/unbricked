// ═══════════════════════════════════════════════════════
// Subway-Map AI History — DAG → Layout Engine
// ═══════════════════════════════════════════════════════

import type { HistoryGraph, HistoryNodeId } from "./historyTypes";
import { buildActiveSet, getBranchChildIds, getPrimaryChildId, getActiveLineage } from "./historyGraph";

export interface LayoutNode {
  id: HistoryNodeId;
  x: number;
  y: number;
  depth: number;       // step index on primary / lineage
  lane: number;        // 0 = main line, +/- for branches
}

export interface LayoutEdge {
  from: HistoryNodeId;
  to: HistoryNodeId;
  kind: "primary" | "branch";
}

export interface HistoryLayout {
  nodes: Record<HistoryNodeId, LayoutNode>;
  edges: LayoutEdge[];
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}

export interface LayoutOpts {
  xStep?: number;      // horizontal distance between stations
  yStep?: number;      // vertical distance between lanes
  laneGap?: number;    // extra space for readability
  maxBranchDepth?: number;
}

export function computeHistoryLayout(g: HistoryGraph, opts: LayoutOpts = {}): HistoryLayout {
  const xStep = opts.xStep ?? 140;
  const yStep = opts.yStep ?? 90;
  const laneGap = opts.laneGap ?? 0;
  const maxBranchDepth = opts.maxBranchDepth ?? 6;

  const nodes: Record<HistoryNodeId, LayoutNode> = {};
  const edges: LayoutEdge[] = [];

  // 1) Main line: active lineage (root → active)
  const lineage = getActiveLineage(g);
  lineage.forEach((n, i) => {
    nodes[n.id] = { id: n.id, x: i * xStep, y: 0, depth: i, lane: 0 };
    if (i > 0) edges.push({ from: lineage[i - 1]!.id, to: n.id, kind: "primary" });
  });

  // 2) Attach branches off each lineage station
  lineage.forEach((station, i) => {
    const branchChildren = getBranchChildIds(g, station.id);
    branchChildren.forEach((childId, bIndex) => {
      const lane = laneFromIndex(bIndex);
      placeBranchChain({
        g, nodes, edges,
        startFromId: station.id,
        childId,
        baseX: i * xStep,
        lane, xStep, yStep, laneGap,
        maxDepth: maxBranchDepth,
      });
    });
  });

  // 3) BBox
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of Object.values(nodes)) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x);
    maxY = Math.max(maxY, n.y);
  }
  if (!isFinite(minX)) minX = minY = maxX = maxY = 0;

  return { nodes, edges, bbox: { minX, minY, maxX, maxY } };
}

function laneFromIndex(i: number): number {
  // 0 → +1, 1 → -1, 2 → +2, 3 → -2, ...
  const k = Math.floor(i / 2) + 1;
  return i % 2 === 0 ? +k : -k;
}

function placeBranchChain(args: {
  g: HistoryGraph;
  nodes: Record<HistoryNodeId, LayoutNode>;
  edges: LayoutEdge[];
  startFromId: HistoryNodeId;
  childId: HistoryNodeId;
  baseX: number;
  lane: number;
  xStep: number;
  yStep: number;
  laneGap: number;
  maxDepth: number;
}): void {
  const { g, nodes, edges, startFromId, childId, baseX, lane, xStep, yStep, laneGap, maxDepth } = args;
  const startY = lane * (yStep + laneGap);

  edges.push({ from: startFromId, to: childId, kind: "branch" });

  let cur: HistoryNodeId | undefined = childId;
  let depth = 1;

  while (cur && depth <= maxDepth) {
    if (!nodes[cur]) {
      nodes[cur] = { id: cur, x: baseX + depth * xStep, y: startY, depth, lane };
    }

    const next = getPrimaryChildId(g, cur);
    if (!next) break;

    // If next node is already on main line, draw merge edge and stop.
    if (nodes[next]?.lane === 0) {
      edges.push({ from: cur, to: next, kind: "branch" });
      break;
    }

    edges.push({ from: cur, to: next, kind: "branch" });
    cur = next;
    depth++;
  }
}
