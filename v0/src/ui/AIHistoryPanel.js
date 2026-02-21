import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { getSeedPathIds, getPathHeadStateId, getAncestryPath, getChildStates } from "../core/history/historyGraph";
/**
 * Universal AI History panel — shows per-slice DAG for the selected layer.
 * Layout: left anchor (Root + Current), right side (N seed path lanes).
 */
export default function AIHistoryPanel({ layerIndex, graph, payloads, onSetDisplayCursor, onSetOperationCursor, onClose, documentSourceImageId, style: containerStyle, }) {
    const [expandedPath, setExpandedPath] = useState(null);
    const seedPaths = getSeedPathIds(graph);
    const rootNode = graph.states[graph.rootStateId];
    // Thumbnail helper — resolve from node asset refs
    const thumbUrl = (node) => {
        if (!node)
            return null;
        const pid = node.assetRefs.thumb ?? node.assetRefs.image;
        if (!pid || !payloads)
            return null;
        return payloads[pid]?.uri ?? null;
    };
    // Resolve document source image URI
    const sourceImageUrl = documentSourceImageId && payloads
        ? (payloads[documentSourceImageId]?.uri ?? null)
        : null;
    // Station label derived from the parent op edge
    const stationLabel = (node) => {
        const op = node.parentOpId ? graph.ops[node.parentOpId] : undefined;
        const opType = op?.opType ?? node.meta.opType;
        const model = op?.summary?.model;
        return [opType, model].filter(Boolean).join(" · ");
    };
    // Cursor badges
    const cursorBadges = (stateId) => (_jsxs(_Fragment, { children: [stateId === graph.displayStateId && (_jsx("span", { style: { position: "absolute", top: 0, right: 1, fontSize: 8 }, children: "\uD83D\uDC41" })), stateId === graph.operationStateId && (_jsx("span", { style: { position: "absolute", bottom: 0, right: 1, fontSize: 8 }, children: "\u2699" }))] }));
    // Thumbnail box with optional ⚙ gear overlay
    const ThumbBox = ({ node, size = 48, active = false, onClick, onSetOperationCursor: onGear, label, children, imgUrl, }) => {
        const url = imgUrl !== undefined ? imgUrl : thumbUrl(node);
        return (_jsxs("div", { style: { textAlign: "center", flexShrink: 0 }, children: [_jsxs("div", { onClick: onClick, style: {
                        width: size,
                        height: size,
                        borderRadius: 5,
                        overflow: "hidden",
                        border: active ? "2px solid var(--scrubber-active)" : "1px solid var(--hud-border-btn)",
                        cursor: onClick ? "pointer" : "default",
                        position: "relative",
                        background: "var(--hud-active)",
                    }, children: [url && (_jsx("img", { src: url, alt: "", style: { width: "100%", height: "100%", objectFit: "cover" } })), node && cursorBadges(node.stateId), children, onGear && (_jsx("button", { type: "button", onClick: (e) => { e.stopPropagation(); onGear(); }, title: "Use as input for next AI op", className: "ai-history-gear", style: {
                                position: "absolute",
                                bottom: 1,
                                left: 1,
                                width: 14,
                                height: 14,
                                borderRadius: 3,
                                border: "none",
                                background: "rgba(0,0,0,0.55)",
                                color: "#fff",
                                fontSize: 8,
                                lineHeight: "14px",
                                textAlign: "center",
                                cursor: "pointer",
                                padding: 0,
                                opacity: 0,
                                transition: "opacity 0.12s",
                            }, children: "\u2699" }))] }), label && (_jsx("div", { style: { fontSize: 7, color: "var(--hud-muted)", marginTop: 2, maxWidth: size, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: label }))] }));
    };
    return (_jsxs("div", { style: {
            position: "absolute",
            left: 12,
            right: 12,
            bottom: 12,
            height: 240,
            borderRadius: 10,
            background: "var(--hud-bg)",
            border: "1px solid var(--hud-border)",
            zIndex: 12,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            backdropFilter: "blur(12px)",
            ...containerStyle,
        }, 
        /* Show ⚙ gear on hover over any ThumbBox */
        onMouseOver: (e) => {
            const target = e.target.closest(".ai-history-gear");
            if (!target)
                return;
            target.style.opacity = "1";
        }, children: [_jsx("style", { children: `.ai-history-gear { opacity: 0 !important; } div:hover > .ai-history-gear { opacity: 1 !important; }` }), _jsxs("div", { style: {
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 12px",
                    borderBottom: "1px solid var(--hud-border)",
                    flexShrink: 0,
                }, children: [_jsxs("span", { style: { fontSize: 10, fontWeight: 600, color: "var(--hud-text)", textTransform: "uppercase", letterSpacing: 0.8 }, children: ["AI History \u2014 Layer ", layerIndex] }), _jsx("span", { style: { flex: 1 } }), _jsxs("span", { style: { fontSize: 9, color: "var(--hud-muted)" }, children: [Object.keys(graph.ops).length, " op", Object.keys(graph.ops).length !== 1 ? "s" : "", " \u00B7 ", seedPaths.length, " path", seedPaths.length !== 1 ? "s" : ""] }), _jsx("button", { type: "button", onClick: onClose, style: {
                            background: "none",
                            border: "none",
                            color: "var(--hud-muted)",
                            cursor: "pointer",
                            fontSize: 14,
                            padding: "0 4px",
                        }, children: "\u2715" })] }), _jsxs("div", { style: { flex: 1, display: "flex", gap: 0, minHeight: 0, overflow: "hidden" }, children: [_jsx("div", { style: {
                            flexShrink: 0,
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: 8,
                            padding: "10px 14px",
                            borderRight: "1px solid var(--hud-border)",
                        }, children: _jsxs("div", { style: { display: "flex", gap: 8, alignItems: "flex-start" }, children: [_jsx(ThumbBox, { size: 44, imgUrl: sourceImageUrl, label: "Source Image" }), _jsx(ThumbBox, { node: rootNode, size: 44, active: graph.displayStateId === graph.rootStateId, onClick: () => { onSetDisplayCursor(layerIndex, graph.rootStateId); }, onSetOperationCursor: () => { onSetOperationCursor(layerIndex, graph.rootStateId); }, label: "Slice Root" })] }) }), _jsx("div", { style: { flex: 1, overflowY: "auto", padding: "8px 10px" }, children: seedPaths.length === 0 ? (_jsx("div", { style: { fontSize: 10, color: "var(--hud-muted)", padding: 12, textAlign: "center" }, children: "No AI operations yet. Run an AI edit to create seed paths." })) : (_jsx("div", { style: { display: "flex", flexDirection: "column", gap: 8 }, children: seedPaths.map((pathId, pathIdx) => {
                                const headId = getPathHeadStateId(graph, pathId);
                                const isExpanded = expandedPath === pathId;
                                // Get full path for this seed lane
                                const pathAncestry = getAncestryPath(graph, headId);
                                // Skip root (first element) for display
                                const pathNodes = pathAncestry.slice(1);
                                // Is the current display state on this path?
                                const displayNode = graph.states[graph.displayStateId];
                                const pathForDisplay = displayNode?.seedPathId === pathId;
                                return (_jsxs("div", { children: [_jsxs("div", { style: {
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 4,
                                                marginBottom: 4,
                                            }, children: [_jsxs("span", { style: {
                                                        fontSize: 8,
                                                        fontWeight: 700,
                                                        color: pathForDisplay ? "var(--scrubber-active)" : "var(--hud-muted)",
                                                        textTransform: "uppercase",
                                                        letterSpacing: 0.5,
                                                    }, children: ["Path ", pathIdx + 1, " (", pathNodes.length, " op", pathNodes.length !== 1 ? "s" : "", ")"] }), pathForDisplay && (_jsx("span", { style: { fontSize: 7, color: "var(--scrubber-active)" }, children: "\u25CF active" })), _jsx("button", { type: "button", onClick: () => { setExpandedPath(isExpanded ? null : pathId); }, style: {
                                                        background: "none",
                                                        border: "none",
                                                        color: "var(--hud-muted)",
                                                        cursor: "pointer",
                                                        fontSize: 9,
                                                        padding: "0 2px",
                                                    }, children: isExpanded ? "▼" : "▶" })] }), !isExpanded && (_jsx("div", { style: { display: "flex", gap: 4, overflowX: "auto", paddingBottom: 2 }, children: pathNodes.map((stateId) => {
                                                const node = graph.states[stateId];
                                                if (!node)
                                                    return null;
                                                const isDisplay = stateId === graph.displayStateId;
                                                const lbl = stationLabel(node);
                                                return (_jsx(ThumbBox, { node: node, size: 36, active: isDisplay, onClick: () => { onSetDisplayCursor(layerIndex, stateId); }, onSetOperationCursor: () => { onSetOperationCursor(layerIndex, stateId); }, children: lbl && (_jsx("span", { style: {
                                                            position: "absolute", bottom: 0, left: 0, right: 0,
                                                            fontSize: 5, textAlign: "center",
                                                            background: "rgba(0,0,0,0.6)", color: "#fff",
                                                            lineHeight: "8px",
                                                        }, children: lbl })) }, stateId));
                                            }) })), isExpanded && (_jsx("div", { style: { display: "flex", flexDirection: "column", gap: 3, paddingLeft: 4 }, children: pathNodes.map((stateId) => {
                                                const node = graph.states[stateId];
                                                if (!node)
                                                    return null;
                                                const isDisplay = stateId === graph.displayStateId;
                                                const lbl = stationLabel(node);
                                                // Children count for branching indicator
                                                const children = getChildStates(graph, stateId);
                                                return (_jsxs("div", { style: {
                                                        display: "flex",
                                                        alignItems: "center",
                                                        gap: 6,
                                                        padding: "3px 4px",
                                                        borderRadius: 4,
                                                        background: isDisplay ? "var(--hud-active)" : "transparent",
                                                        cursor: "pointer",
                                                    }, onClick: () => { onSetDisplayCursor(layerIndex, stateId); }, children: [_jsx(ThumbBox, { node: node, size: 32, active: isDisplay, onSetOperationCursor: () => { onSetOperationCursor(layerIndex, stateId); } }), _jsxs("div", { style: { flex: 1, minWidth: 0 }, children: [_jsx("div", { style: {
                                                                        fontSize: 10,
                                                                        color: isDisplay ? "var(--scrubber-active)" : "var(--hud-text)",
                                                                        fontWeight: isDisplay ? 600 : 400,
                                                                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                                                    }, children: lbl || node.meta.label }), _jsx("div", { style: { fontSize: 8, color: "var(--hud-muted)", display: "flex", gap: 4 }, children: children.length > 1 && _jsxs("span", { children: ["(", children.length, " branches)"] }) })] })] }, stateId));
                                            }) }))] }, pathId));
                            }) })) })] })] }));
}
