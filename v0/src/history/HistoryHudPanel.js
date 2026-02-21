import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
// ═══════════════════════════════════════════════════════
// HistoryHudPanel — 3D-anchored subway-map HUD
//
// Floats in screen-space, anchored to a projected slice
// position. Renders the subway SVG expanding rightward
// from the anchor. Collapses to a chip when offscreen.
// ═══════════════════════════════════════════════════════
import { useMemo } from "react";
import { computeHistoryLayout } from "./historyLayout";
import { buildActiveSet, getNode } from "./historyGraph";
/** Compact layout for HUD: smaller spacing than the drawer panel */
const HUD_LAYOUT_OPTS = { xStep: 110, yStep: 70 };
export default function HistoryHudPanel({ anchor, graph, onSelectNode, onClose, operationNodeId, layerIndex, opCount, }) {
    const layout = useMemo(() => computeHistoryLayout(graph, HUD_LAYOUT_OPTS), [graph]);
    const activeSet = useMemo(() => buildActiveSet(graph), [graph]);
    // ── Offscreen: show collapsed chip near closest edge ──
    if (!anchor.visible) {
        return (_jsxs("div", { style: {
                position: "absolute",
                top: 12,
                left: "50%",
                transform: "translateX(-50%)",
                padding: "5px 12px",
                borderRadius: 6,
                background: "var(--hud-bg)",
                border: "1px solid var(--hud-border)",
                color: "var(--hud-text)",
                fontSize: 10,
                fontWeight: 600,
                cursor: "pointer",
                zIndex: 14,
                backdropFilter: "blur(8px)",
                pointerEvents: "auto",
            }, onClick: onClose, title: "Slice is off-screen \u2014 click to dismiss", children: ["\uD83D\uDD70 History \u2014 Layer ", layerIndex, " (", opCount, " op", opCount !== 1 ? "s" : "", ")"] }));
    }
    // ── Visible: render anchored subway map expanding rightward ──
    const pad = 40;
    const svgW = (layout.bbox.maxX - layout.bbox.minX) + pad * 2 + 160;
    const svgH = (layout.bbox.maxY - layout.bbox.minY) + pad * 2;
    const viewBox = `${layout.bbox.minX - pad} ${layout.bbox.minY - pad} ${svgW} ${svgH}`;
    // Panel dimensions — clamp for viewport safety
    const panelW = Math.min(svgW, 520);
    const panelH = Math.max(180, Math.min(svgH + 36, 340));
    // Hub anchor: place hub ring at anchor, panel grows to the right
    const hubR = 6;
    const stubLen = 20;
    return (_jsxs("div", { style: {
            position: "absolute",
            left: anchor.x,
            top: anchor.y,
            zIndex: 14,
            pointerEvents: "none",
            transform: "translate(0, -50%)",
        }, children: [_jsxs("svg", { width: stubLen + hubR * 2 + 4, height: hubR * 2 + 8, style: {
                    position: "absolute",
                    left: -(hubR + 2),
                    top: -(hubR + 4),
                    overflow: "visible",
                    pointerEvents: "none",
                }, children: [_jsx("circle", { cx: hubR + 2, cy: hubR + 4, r: hubR, fill: "currentColor", opacity: 0.85 }), _jsx("circle", { cx: hubR + 2, cy: hubR + 4, r: hubR + 3, fill: "none", stroke: "currentColor", strokeWidth: 1.5, opacity: 0.5 }), _jsx("line", { x1: hubR * 2 + 4, y1: hubR + 4, x2: hubR * 2 + 4 + stubLen, y2: hubR + 4, stroke: "currentColor", strokeWidth: 2, opacity: 0.5 })] }), _jsxs("div", { style: {
                    position: "absolute",
                    left: stubLen + hubR + 6,
                    top: -(panelH / 2),
                    width: panelW,
                    height: panelH,
                    borderRadius: 10,
                    background: "var(--hud-bg)",
                    border: "1px solid var(--hud-border)",
                    backdropFilter: "blur(12px)",
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                    pointerEvents: "auto",
                    boxShadow: "0 4px 24px rgba(0,0,0,0.25)",
                }, children: [_jsxs("div", { style: {
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "6px 10px",
                            borderBottom: "1px solid var(--hud-border)",
                            flexShrink: 0,
                        }, children: [_jsxs("span", { style: {
                                    fontSize: 9,
                                    fontWeight: 600,
                                    color: "var(--hud-text)",
                                    textTransform: "uppercase",
                                    letterSpacing: 0.6,
                                }, children: ["AI History \u2014 Layer ", layerIndex] }), _jsx("span", { style: { flex: 1 } }), _jsxs("span", { style: { fontSize: 8, color: "var(--hud-muted)" }, children: [opCount, " op", opCount !== 1 ? "s" : ""] }), _jsx("button", { type: "button", onClick: onClose, style: {
                                    background: "none",
                                    border: "none",
                                    color: "var(--hud-muted)",
                                    cursor: "pointer",
                                    fontSize: 12,
                                    padding: "0 3px",
                                    lineHeight: 1,
                                }, children: "\u2715" })] }), _jsx("div", { style: { flex: 1, overflow: "auto", minHeight: 0 }, children: _jsxs("svg", { viewBox: viewBox, width: "100%", height: Math.max(140, svgH), style: { display: "block" }, children: [layout.edges.map((e, idx) => {
                                    const a = layout.nodes[e.from];
                                    const b = layout.nodes[e.to];
                                    if (!a || !b)
                                        return null;
                                    const isActiveEdge = activeSet.has(e.from) && activeSet.has(e.to) && e.kind === "primary";
                                    return (_jsx("path", { d: `M ${a.x} ${a.y} L ${b.x} ${a.y} L ${b.x} ${b.y}`, fill: "none", stroke: "currentColor", strokeWidth: isActiveEdge ? 4 : 2.5, opacity: isActiveEdge ? 1 : 0.5, strokeLinecap: "round", strokeLinejoin: "round" }, idx));
                                }), Object.values(layout.nodes).map((ln) => {
                                    const n = getNode(graph, ln.id);
                                    const isActive = ln.id === graph.activeNodeId;
                                    const onActivePath = activeSet.has(ln.id);
                                    const isOperation = ln.id === operationNodeId;
                                    const r = isActive ? 8 : onActivePath ? 6 : 5;
                                    return (_jsxs("g", { transform: `translate(${ln.x}, ${ln.y})`, style: { cursor: "pointer" }, onClick: () => onSelectNode(ln.id), children: [_jsx("circle", { r: r + 3, fill: "none", stroke: "currentColor", strokeWidth: 1.5, opacity: onActivePath ? 1 : 0.3 }), _jsx("circle", { r: r, fill: "currentColor", opacity: onActivePath ? 1 : 0.6 }), isActive && (_jsx("text", { x: r + 4, y: -r, fontSize: 8, fill: "currentColor", opacity: 0.8, children: "\uD83D\uDC41" })), isOperation && (_jsx("text", { x: r + 4, y: r + 10, fontSize: 8, fill: "currentColor", opacity: 0.8, children: "\u2699" })), _jsx("text", { x: 14, y: -4, fontSize: 11, fill: "currentColor", opacity: 0.9, children: stationTitle(n) }), stationSubtitle(n) && (_jsx("text", { x: 14, y: 10, fontSize: 9, fill: "currentColor", opacity: 0.6, children: stationSubtitle(n) }))] }, ln.id));
                                })] }) })] })] }));
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
