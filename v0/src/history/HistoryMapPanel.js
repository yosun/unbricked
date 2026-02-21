import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// ═══════════════════════════════════════════════════════
// Subway-Map AI History — SVG Renderer + Interactions
// ═══════════════════════════════════════════════════════
import { useMemo } from "react";
import { computeHistoryLayout } from "./historyLayout";
import { buildActiveSet, getNode } from "./historyGraph";
export default function HistoryMapPanel({ graph, onSelectNode, operationNodeId }) {
    const layout = useMemo(() => computeHistoryLayout(graph), [graph]);
    const activeSet = useMemo(() => buildActiveSet(graph), [graph]);
    const pad = 60;
    const w = (layout.bbox.maxX - layout.bbox.minX) + pad * 2 + 240;
    const h = (layout.bbox.maxY - layout.bbox.minY) + pad * 2;
    const viewBox = `${layout.bbox.minX - pad} ${layout.bbox.minY - pad} ${w} ${h}`;
    return (_jsx("div", { style: { width: "100%", height: "100%", overflow: "auto" }, children: _jsxs("svg", { viewBox: viewBox, width: "100%", height: Math.max(260, h), style: { display: "block" }, children: [layout.edges.map((e, idx) => {
                    const a = layout.nodes[e.from];
                    const b = layout.nodes[e.to];
                    if (!a || !b)
                        return null;
                    const isActiveEdge = activeSet.has(e.from) && activeSet.has(e.to) && e.kind === "primary";
                    const strokeWidth = isActiveEdge ? 5 : 3;
                    const opacity = isActiveEdge ? 1 : 0.55;
                    // Subway-style L-turn: horizontal then vertical
                    const d = `M ${a.x} ${a.y} L ${b.x} ${a.y} L ${b.x} ${b.y}`;
                    return (_jsx("path", { d: d, fill: "none", stroke: "currentColor", strokeWidth: strokeWidth, opacity: opacity, strokeLinecap: "round", strokeLinejoin: "round" }, idx));
                }), Object.values(layout.nodes).map((ln) => {
                    const n = getNode(graph, ln.id);
                    const isActive = ln.id === graph.activeNodeId;
                    const onActivePath = activeSet.has(ln.id);
                    const isOperation = ln.id === operationNodeId;
                    const r = isActive ? 10 : onActivePath ? 8 : 7;
                    return (_jsxs("g", { transform: `translate(${ln.x}, ${ln.y})`, style: { cursor: "pointer" }, onClick: () => onSelectNode(ln.id), children: [_jsx("circle", { r: r + 4, fill: "none", stroke: "currentColor", strokeWidth: 2, opacity: onActivePath ? 1 : 0.35 }), _jsx("circle", { r: r, fill: "currentColor", opacity: onActivePath ? 1 : 0.65 }), isActive && (_jsx("text", { x: r + 6, y: -r - 2, fontSize: 10, fill: "currentColor", opacity: 0.8, children: "\uD83D\uDC41" })), isOperation && (_jsx("text", { x: r + 6, y: r + 12, fontSize: 10, fill: "currentColor", opacity: 0.8, children: "\u2699" })), _jsx("text", { x: 16, y: -6, fontSize: 13, fill: "currentColor", opacity: 0.92, children: stationTitle(n) }), stationSubtitle(n) && (_jsx("text", { x: 16, y: 12, fontSize: 11, fill: "currentColor", opacity: 0.65, children: stationSubtitle(n) }))] }, ln.id));
                })] }) }));
}
function stationTitle(n) {
    if (n.type === "source")
        return "Source Image";
    if (n.type === "root")
        return "Slice Root";
    return n.label ?? n.op?.kind ?? "Op";
}
function stationSubtitle(n) {
    if (n.type !== "op")
        return undefined;
    return n.subtitle ?? n.op?.model;
}
