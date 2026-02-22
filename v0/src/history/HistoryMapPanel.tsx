// ═══════════════════════════════════════════════════════
// Subway-Map AI History — SVG Renderer + Interactions
// ═══════════════════════════════════════════════════════

import React, { useMemo } from "react";
import type { HistoryGraph, HistoryNodeId } from "./historyTypes";
import { computeHistoryLayout } from "./historyLayout";
import { buildActiveSet, getNode } from "./historyGraph";

interface Props {
  graph: HistoryGraph;
  onSelectNode: (id: HistoryNodeId) => void;
  /** Optional: node with ⚙ operation cursor */
  operationNodeId?: HistoryNodeId;
}

export default function HistoryMapPanel({ graph, onSelectNode, operationNodeId }: Props): React.JSX.Element {
  const layout = useMemo(() => computeHistoryLayout(graph), [graph]);
  const activeSet = useMemo(() => buildActiveSet(graph), [graph]);

  const pad = 60;
  const w = (layout.bbox.maxX - layout.bbox.minX) + pad * 2 + 240;
  const h = (layout.bbox.maxY - layout.bbox.minY) + pad * 2;
  const viewBox = `${layout.bbox.minX - pad} ${layout.bbox.minY - pad} ${w} ${h}`;

  return (
    <div style={{ width: "100%", height: "100%", overflow: "auto" }}>
      <svg viewBox={viewBox} width="100%" height={Math.max(260, h)} style={{ display: "block" }}>
        {/* Edges */}
        {layout.edges.map((e, idx) => {
          const a = layout.nodes[e.from];
          const b = layout.nodes[e.to];
          if (!a || !b) return null;

          const isActiveEdge = activeSet.has(e.from) && activeSet.has(e.to) && e.kind === "primary";
          const strokeWidth = isActiveEdge ? 5 : 3;
          const opacity = isActiveEdge ? 1 : 0.55;

          // Subway-style L-turn: horizontal then vertical
          const d = `M ${a.x} ${a.y} L ${b.x} ${a.y} L ${b.x} ${b.y}`;

          return (
            <path
              key={idx}
              d={d}
              fill="none"
              stroke="currentColor"
              strokeWidth={strokeWidth}
              opacity={opacity}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}

        {/* Stations */}
        {Object.values(layout.nodes).map((ln) => {
          const n = getNode(graph, ln.id);
          const isActive = ln.id === graph.activeNodeId;
          const onActivePath = activeSet.has(ln.id);
          const isOperation = ln.id === operationNodeId;

          const r = isActive ? 10 : onActivePath ? 8 : 7;

          return (
            <g
              key={ln.id}
              transform={`translate(${ln.x}, ${ln.y})`}
              style={{ cursor: "pointer" }}
              onClick={() => onSelectNode(ln.id)}
            >
              {/* outer ring */}
              <circle r={r + 4} fill="none" stroke="currentColor" strokeWidth={2} opacity={onActivePath ? 1 : 0.35} />
              {/* dot */}
              <circle r={r} fill="currentColor" opacity={onActivePath ? 1 : 0.65} />

              {/* 👁 display cursor badge */}
              {isActive && (
                <text x={r + 6} y={-r - 2} fontSize={10} fill="currentColor" opacity={0.8}>👁</text>
              )}
              {/* ⚙ operation cursor badge */}
              {isOperation && (
                <text x={r + 6} y={r + 12} fontSize={10} fill="currentColor" opacity={0.8}>⚙</text>
              )}
              {/* 3D badge */}
              {n.has3D && (
                <g transform={`translate(${-r - 2}, ${-r - 6})`}>
                  <rect width={18} height={11} rx={3} fill="#2299ff" />
                  <text x={9} y={8.5} fontSize={7} fontWeight={700} fill="#fff" textAnchor="middle">3D</text>
                </g>
              )}

              {/* labels */}
              <text x={16} y={-6} fontSize={13} fill="currentColor" opacity={0.92}>
                {stationTitle(n)}
              </text>
              {stationSubtitle(n) && (
                <text x={16} y={12} fontSize={11} fill="currentColor" opacity={0.65}>
                  {stationSubtitle(n)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function stationTitle(n: ReturnType<typeof getNode>): string {
  if (n.type === "source") return "Source Image";
  if (n.type === "root") return "Slice Root";
  return n.label ?? n.op?.kind ?? "Op";
}

function stationSubtitle(n: ReturnType<typeof getNode>): string | undefined {
  if (n.type !== "op") return undefined;
  return n.subtitle ?? n.op?.model;
}
