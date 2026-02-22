import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useRef, useState } from "react";
import { AI_EDIT_MODELS, getAiEditModel } from "../services/falProxy";
import { PIVOT_FACES, PIVOT_FACE_LABELS } from "./SpaceViewport";
import { TransformPanel } from "./LayerControlsHUD";
import { getSeedPathIds, getPathHeadStateId, getAncestryPath } from "../core/history/historyGraph";
const ITEM_H = 56;
function layerColor(layerIdx, layerCount) {
    const hue = Math.round((layerIdx / Math.max(layerCount, 1)) * 360);
    return `hsl(${String(hue)}, 55%, 65%)`;
}
function clamp01(v) {
    return Math.max(0, Math.min(1, v));
}
export default function LayersPanel(props) {
    const { layerCount, order, selectedLayerIndex, soloIndex, isHidden, isMaskActive, isMaskInverted, persistedOpacity, onSelectLayer, onToggleHidden, onToggleSolo, onToggleMask, onInvertMask, onPreviewOpacity, onCommitOpacity, onPreviewOrder, onCommitOrder, onImportImage, onAiEdit, aiEditingLayers, aiErrors, onAddSlice, onDeleteSlice, layerTextures, layerThumbnails, layerNames, onRenameLayer, aiEditModelId, onChangeAiEditModel, onGenerate3D, generating3DLayer, layerGlbUrls, threeDSourceHidden, onToggle3DSourceImage, transformPivot, onSetTransformPivot, getSliceHistory: getSliceHistoryProp, onSetDisplayCursor: onSetDisplayCursorProp, onSetOperationCursor: onSetOperationCursorProp, payloads: payloadsProp, transformMode, onSetTransformMode, snapEnabled, onToggleSnap, modelTransform, onApplyTransform, } = props;
    /* ── Drag reorder state ──────────────────────── */
    const [dragViewIdx, setDragViewIdx] = useState(null);
    const containerRef = useRef(null);
    const startY = useRef(0);
    const currentOrder = useRef(order);
    const originalOrder = useRef(order);
    const activePointerId = useRef(null);
    // Sync ref with prop only when idle — same pattern as LayerScrubber.
    useEffect(() => {
        if (dragViewIdx === null) {
            currentOrder.current = order;
        }
    }, [order, dragViewIdx]);
    /* ── Per-layer inline opacity editing ───────── */
    const [editingOpacityLayer, setEditingOpacityLayer] = useState(null);
    /* ── Per-layer AI prompt ───────── */
    const [showAiPromptLayer, setShowAiPromptLayer] = useState(null);
    const [promptText, setPromptText] = useState("");
    const [strength, setStrength] = useState(0.75);
    /** Which layer's history panel is open (by layer index), or null */
    const [historyPanelLayer, setHistoryPanelLayer] = useState(null);
    /** Which seed path is selected in the history panel */
    const [selectedPathId, setSelectedPathId] = useState(null);
    // Inline rename state
    const [renamingIdx, setRenamingIdx] = useState(null);
    const [renameText, setRenameText] = useState("");
    const renameInputRef = useRef(null);
    const handleDragPointerDown = useCallback((viewIdx, e) => {
        e.preventDefault();
        e.stopPropagation();
        // Capture on the panel container so move/up handlers fire
        activePointerId.current = e.pointerId;
        if (containerRef.current) {
            containerRef.current.setPointerCapture(e.pointerId);
        }
        setDragViewIdx(viewIdx);
        startY.current = e.clientY;
        currentOrder.current = [...order];
        originalOrder.current = [...order];
    }, [order]);
    const handlePointerMove = useCallback((e) => {
        if (dragViewIdx === null)
            return;
        e.stopPropagation();
        const THRESHOLD = ITEM_H * 0.6;
        const deltaY = e.clientY - startY.current;
        if (Math.abs(deltaY) < THRESHOLD)
            return;
        const direction = deltaY > 0 ? 1 : -1;
        const targetView = Math.max(0, Math.min(layerCount - 1, dragViewIdx + direction));
        if (targetView !== dragViewIdx) {
            const fromPos = layerCount - 1 - dragViewIdx;
            const toPos = layerCount - 1 - targetView;
            const newOrder = [...currentOrder.current];
            const [item] = newOrder.splice(fromPos, 1);
            if (item === undefined)
                return;
            newOrder.splice(toPos, 0, item);
            currentOrder.current = newOrder;
            setDragViewIdx(targetView);
            startY.current = e.clientY;
            onPreviewOrder(newOrder);
        }
    }, [dragViewIdx, layerCount, onPreviewOrder]);
    const handlePointerUp = useCallback((e) => {
        if (dragViewIdx === null)
            return;
        e.stopPropagation();
        activePointerId.current = null;
        const finalOrder = currentOrder.current;
        // Compare against the order captured at drag-start, NOT the current prop
        // (which includes the preview and would always match finalOrder).
        const orderChanged = !finalOrder.every((v, i) => v === originalOrder.current[i]);
        setDragViewIdx(null);
        // Commit BEFORE clearing preview to avoid bounce-back
        if (orderChanged) {
            onCommitOrder(finalOrder);
        }
        onPreviewOrder(null);
    }, [dragViewIdx, onPreviewOrder, onCommitOrder]);
    const displayOrder = dragViewIdx !== null ? currentOrder.current : order;
    return (_jsxs(_Fragment, { children: [_jsxs("div", { ref: containerRef, onPointerMove: handlePointerMove, onPointerUp: handlePointerUp, onPointerCancel: () => {
                    setDragViewIdx(null);
                    onPreviewOrder(null);
                }, className: "layers-panel", style: {
                    position: "absolute",
                    right: 12,
                    top: 56,
                    bottom: 12,
                    width: 240,
                    display: "flex",
                    flexDirection: "column",
                    borderRadius: 10,
                    background: "var(--hud-bg)",
                    border: "1px solid var(--hud-border)",
                    zIndex: 10,
                    userSelect: "none",
                    touchAction: "none",
                    overflow: "hidden",
                }, children: [_jsxs("div", { style: {
                            padding: "10px 12px 8px",
                            fontSize: 11,
                            textTransform: "uppercase",
                            letterSpacing: 1.2,
                            color: "var(--hud-muted)",
                            borderBottom: "1px solid var(--hud-border)",
                            flexShrink: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                        }, children: ["Layers", _jsx("button", { type: "button", onClick: onAddSlice, title: "Add a new slice", style: {
                                    background: "none",
                                    border: "1px solid var(--hud-border-btn)",
                                    color: "var(--hud-text)",
                                    borderRadius: 4,
                                    padding: "1px 7px",
                                    cursor: "pointer",
                                    fontSize: 14,
                                    lineHeight: 1,
                                }, children: "\uFF0B" })] }), _jsx("div", { style: { flex: 1, overflowY: "auto", padding: "4px 0" }, children: Array.from({ length: layerCount }, (_, viewIdx) => {
                            const posIdx = layerCount - 1 - viewIdx;
                            const layerIdx = displayOrder[posIdx] ?? posIdx;
                            const isSelected = layerIdx === selectedLayerIndex;
                            const isDragging = viewIdx === dragViewIdx;
                            const hidden = isHidden(layerIdx);
                            const isSolo = soloIndex === layerIdx;
                            const color = layerColor(layerIdx, layerCount);
                            const opacity = persistedOpacity(layerIdx);
                            return (_jsxs("div", { onClick: () => { onSelectLayer(layerIdx); }, style: {
                                    minHeight: ITEM_H,
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                    padding: "4px 8px",
                                    cursor: "pointer",
                                    borderRadius: 4,
                                    margin: "0 4px",
                                    background: isDragging
                                        ? "var(--hud-active)"
                                        : isSelected
                                            ? "var(--hud-active)"
                                            : "transparent",
                                    border: isDragging
                                        ? "1px solid var(--scrubber-active)"
                                        : "1px solid transparent",
                                    transition: isDragging ? "none" : "background 0.12s",
                                }, children: [_jsx("span", { onPointerDown: (e) => { handleDragPointerDown(viewIdx, e); }, style: {
                                            fontSize: 11,
                                            lineHeight: 1,
                                            color: "var(--hud-muted)",
                                            cursor: isDragging ? "grabbing" : "grab",
                                            padding: "2px 0",
                                            flexShrink: 0,
                                            alignSelf: "center",
                                        }, children: "\u283F" }), _jsxs("div", { style: { position: "relative", flexShrink: 0, width: 36, height: 36 }, children: [layerThumbnails[layerIdx] ? (_jsx("img", { src: layerThumbnails[layerIdx], alt: `Layer ${String(layerIdx)}`, className: generating3DLayer === layerIdx ? "generating-3d-glow" : undefined, style: {
                                                    width: 36,
                                                    height: 36,
                                                    borderRadius: 4,
                                                    objectFit: "cover",
                                                    background: "var(--hud-active)",
                                                    opacity: hidden ? 0.3 : 1,
                                                    border: isSelected
                                                        ? "1.5px solid var(--scrubber-active)"
                                                        : `1.5px solid ${color}`,
                                                } })) : (_jsx("span", { style: {
                                                    display: "block",
                                                    width: 36,
                                                    height: 36,
                                                    borderRadius: 4,
                                                    background: color,
                                                    opacity: hidden ? 0.3 : 1,
                                                } })), layerIdx in layerGlbUrls && (_jsx("span", { style: {
                                                    position: "absolute",
                                                    bottom: -2,
                                                    right: -2,
                                                    fontSize: 7,
                                                    fontWeight: 700,
                                                    lineHeight: 1,
                                                    padding: "1px 3px",
                                                    borderRadius: 3,
                                                    background: "var(--scrubber-active)",
                                                    color: "var(--btn-primary-text)",
                                                    pointerEvents: "none",
                                                }, children: "3D" }))] }), _jsxs("div", { style: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }, children: [_jsxs("div", { style: { display: "flex", alignItems: "center", gap: 4 }, children: [renamingIdx === layerIdx ? (_jsx("input", { ref: renameInputRef, type: "text", value: renameText, onClick: (e) => { e.stopPropagation(); }, onChange: (e) => { setRenameText(e.target.value); }, onBlur: () => {
                                                            onRenameLayer(layerIdx, renameText);
                                                            setRenamingIdx(null);
                                                        }, onKeyDown: (e) => {
                                                            e.stopPropagation();
                                                            if (e.key === "Enter") {
                                                                onRenameLayer(layerIdx, renameText);
                                                                setRenamingIdx(null);
                                                            }
                                                            else if (e.key === "Escape") {
                                                                setRenamingIdx(null);
                                                            }
                                                        }, style: {
                                                            fontSize: 12,
                                                            flex: 1,
                                                            minWidth: 0,
                                                            background: "var(--hud-active)",
                                                            border: "1px solid var(--scrubber-active)",
                                                            borderRadius: 3,
                                                            padding: "1px 4px",
                                                            color: "var(--hud-text)",
                                                            outline: "none",
                                                        } })) : (_jsx("span", { onDoubleClick: (e) => {
                                                            e.stopPropagation();
                                                            setRenamingIdx(layerIdx);
                                                            setRenameText(layerNames[layerIdx] ?? `Layer ${String(layerIdx)}`);
                                                            setTimeout(() => { renameInputRef.current?.select(); }, 0);
                                                        }, title: "Double-click to rename", style: {
                                                            fontSize: 12,
                                                            color: isSelected ? "var(--scrubber-active)" : "var(--hud-text)",
                                                            fontWeight: isSelected ? 600 : 400,
                                                            flex: 1,
                                                            minWidth: 0,
                                                            overflow: "hidden",
                                                            textOverflow: "ellipsis",
                                                            whiteSpace: "nowrap",
                                                            opacity: hidden ? 0.4 : 1,
                                                            cursor: "default",
                                                        }, children: layerNames[layerIdx] ?? `Layer ${String(layerIdx)}` })), (() => {
                                                        const graph = getSliceHistoryProp?.(layerIdx);
                                                        if (!graph)
                                                            return null;
                                                        const opsCount = Object.keys(graph.ops).length;
                                                        if (opsCount === 0)
                                                            return null;
                                                        return (_jsx("button", { type: "button", onClick: (e) => {
                                                                e.stopPropagation();
                                                                setHistoryPanelLayer(historyPanelLayer === layerIdx ? null : layerIdx);
                                                                setSelectedPathId(null);
                                                            }, title: `${String(opsCount)} AI op${opsCount > 1 ? "s" : ""}`, style: {
                                                                background: historyPanelLayer === layerIdx ? "var(--scrubber-active)" : "var(--hud-active)",
                                                                border: "1px solid var(--hud-border-btn)",
                                                                borderRadius: 8,
                                                                padding: "0 5px",
                                                                fontSize: 9,
                                                                fontWeight: 700,
                                                                color: historyPanelLayer === layerIdx ? "var(--btn-primary-text)" : "var(--scrubber-active)",
                                                                cursor: "pointer",
                                                                lineHeight: "16px",
                                                                flexShrink: 0,
                                                            }, children: opsCount }));
                                                    })(), _jsxs("span", { onClick: (e) => {
                                                            e.stopPropagation();
                                                            setEditingOpacityLayer(editingOpacityLayer === layerIdx ? null : layerIdx);
                                                        }, style: {
                                                            fontSize: 10,
                                                            color: "var(--hud-muted)",
                                                            cursor: "pointer",
                                                            flexShrink: 0,
                                                        }, title: "Click to adjust opacity", children: [Math.round(opacity * 100), "%"] })] }), _jsxs("div", { style: { display: "flex", alignItems: "center", gap: 2, justifyContent: "flex-end" }, children: [_jsx("button", { type: "button", onClick: (e) => { e.stopPropagation(); onToggleHidden(layerIdx); }, title: hidden ? "Show" : "Hide", style: {
                                                            background: "none",
                                                            border: "none",
                                                            color: hidden ? "var(--hud-muted)" : "var(--hud-text)",
                                                            cursor: "pointer",
                                                            fontSize: 11,
                                                            padding: "1px 3px",
                                                            flexShrink: 0,
                                                            opacity: hidden ? 0.5 : 0.8,
                                                        }, children: hidden ? "◻" : "👁" }), _jsx("button", { type: "button", onClick: (e) => { e.stopPropagation(); onToggleSolo(layerIdx); }, title: isSolo ? "Unsolo" : "Solo", style: {
                                                            background: isSolo ? "var(--hud-active)" : "none",
                                                            border: "none",
                                                            color: isSolo ? "var(--scrubber-active)" : "var(--hud-muted)",
                                                            cursor: "pointer",
                                                            fontSize: 10,
                                                            fontWeight: 600,
                                                            padding: "1px 3px",
                                                            borderRadius: 3,
                                                            flexShrink: 0,
                                                        }, children: "S" }), _jsx("button", { type: "button", onClick: (e) => { e.stopPropagation(); onToggleMask(layerIdx); }, title: isMaskActive(layerIdx) ? "Disable mask" : "Enable mask", style: {
                                                            background: isMaskActive(layerIdx) ? "var(--hud-active)" : "none",
                                                            border: "none",
                                                            color: isMaskActive(layerIdx) ? "var(--scrubber-active)" : "var(--hud-muted)",
                                                            cursor: "pointer",
                                                            fontSize: 9,
                                                            fontWeight: 600,
                                                            padding: "1px 3px",
                                                            borderRadius: 3,
                                                            flexShrink: 0,
                                                        }, children: "M" }), layerIdx in layerTextures && (_jsx("button", { type: "button", onClick: (e) => { e.stopPropagation(); onInvertMask(layerIdx); }, title: isMaskInverted(layerIdx) ? "Revert mask (original)" : "Invert mask", style: {
                                                            background: isMaskInverted(layerIdx) ? "var(--hud-active)" : "none",
                                                            border: "none",
                                                            color: isMaskInverted(layerIdx) ? "var(--scrubber-active)" : "var(--hud-muted)",
                                                            cursor: "pointer",
                                                            fontSize: 9,
                                                            fontWeight: 600,
                                                            padding: "1px 3px",
                                                            borderRadius: 3,
                                                            flexShrink: 0,
                                                        }, children: "\u2298" })), layerIdx in layerTextures && (_jsx("button", { type: "button", onClick: (e) => { e.stopPropagation(); onGenerate3D(layerIdx); }, disabled: generating3DLayer === layerIdx, title: layerIdx in layerGlbUrls ? "3D model loaded" : "Generate 3D from this slice", style: {
                                                            background: layerIdx in layerGlbUrls ? "var(--hud-active)" : "none",
                                                            border: "none",
                                                            color: generating3DLayer === layerIdx
                                                                ? "var(--hud-muted)"
                                                                : layerIdx in layerGlbUrls
                                                                    ? "var(--scrubber-active)"
                                                                    : "var(--hud-muted)",
                                                            cursor: generating3DLayer === layerIdx ? "wait" : "pointer",
                                                            fontSize: 8,
                                                            fontWeight: 600,
                                                            padding: "1px 3px",
                                                            borderRadius: 3,
                                                            flexShrink: 0,
                                                        }, children: generating3DLayer === layerIdx ? "⏳" : "3D" })), layerIdx in layerGlbUrls && (_jsx("button", { type: "button", onClick: (e) => { e.stopPropagation(); onToggle3DSourceImage(layerIdx); }, title: threeDSourceHidden.has(layerIdx) ? "Show source image" : "Hide source image", style: {
                                                            background: threeDSourceHidden.has(layerIdx) ? "var(--hud-active)" : "none",
                                                            border: "none",
                                                            color: threeDSourceHidden.has(layerIdx) ? "var(--scrubber-active)" : "var(--hud-muted)",
                                                            cursor: "pointer",
                                                            fontSize: 9,
                                                            padding: "1px 3px",
                                                            borderRadius: 3,
                                                            flexShrink: 0,
                                                        }, children: "\uD83D\uDDBC" })), layerCount > 1 && (_jsx("button", { type: "button", onClick: (e) => { e.stopPropagation(); onDeleteSlice(layerIdx); }, title: "Delete layer", style: {
                                                            background: "none",
                                                            border: "none",
                                                            color: "var(--hud-muted)",
                                                            cursor: "pointer",
                                                            fontSize: 10,
                                                            padding: "1px 3px",
                                                            borderRadius: 3,
                                                            flexShrink: 0,
                                                            opacity: 0.6,
                                                        }, children: "\uD83D\uDDD1" }))] })] })] }, layerIdx));
                        }) }), selectedLayerIndex !== null && selectedLayerIndex in layerGlbUrls && (_jsxs("div", { style: { flexShrink: 0, borderTop: "1px solid var(--hud-border)" }, children: [_jsx("div", { style: {
                                    padding: "5px 10px 4px",
                                    fontSize: 9,
                                    textTransform: "uppercase",
                                    letterSpacing: 1,
                                    color: "var(--hud-muted)",
                                    borderBottom: "1px solid var(--hud-border)",
                                }, children: "Transform" }), _jsx("div", { style: { display: "flex", gap: 0, borderBottom: "1px solid var(--hud-border)" }, children: ["translate", "rotate", "scale"].map((mode) => {
                                    const label = mode === "translate" ? "Move" : mode === "rotate" ? "Rotate" : "Scale";
                                    const icon = mode === "translate" ? "⤡" : mode === "rotate" ? "↻" : "⤢";
                                    const active = transformMode === mode;
                                    return (_jsxs("button", { type: "button", onClick: () => { onSetTransformMode(mode); }, title: `${label} (${mode[0].toUpperCase()})`, style: {
                                            flex: 1,
                                            display: "flex",
                                            flexDirection: "column",
                                            alignItems: "center",
                                            gap: 1,
                                            background: active ? "var(--hud-active)" : "none",
                                            border: "none",
                                            borderRight: "1px solid var(--hud-border)",
                                            color: active ? "var(--scrubber-active)" : "var(--hud-text)",
                                            padding: "5px 2px 4px",
                                            cursor: "pointer",
                                            fontSize: 13,
                                        }, children: [_jsx("span", { children: icon }), _jsx("span", { style: { fontSize: 7, fontWeight: 600, letterSpacing: 0.5 }, children: label })] }, mode));
                                }) }), _jsxs("div", { style: { borderBottom: "1px solid var(--hud-border)", padding: "5px 10px" }, children: [_jsxs("div", { style: { display: "flex", alignItems: "center", gap: 6 }, children: [_jsx("span", { style: { fontSize: 9, color: "var(--hud-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, flexShrink: 0 }, children: "Pivot" }), _jsxs("div", { style: { display: "flex", gap: 0, flex: 1, borderRadius: 4, overflow: "hidden", border: "1px solid var(--hud-border-btn)" }, children: [_jsx("button", { type: "button", onClick: () => { onSetTransformPivot("center"); }, style: {
                                                            flex: 1,
                                                            background: transformPivot === "center" ? "var(--hud-active)" : "none",
                                                            border: "none",
                                                            color: transformPivot === "center" ? "var(--scrubber-active)" : "var(--hud-text)",
                                                            padding: "3px 0",
                                                            cursor: "pointer",
                                                            fontSize: 9,
                                                            fontWeight: 600,
                                                        }, children: "Center" }), _jsx("button", { type: "button", onClick: () => { if (transformPivot === "center")
                                                            onSetTransformPivot("-y"); }, style: {
                                                            flex: 1,
                                                            background: transformPivot !== "center" ? "var(--hud-active)" : "none",
                                                            border: "none",
                                                            borderLeft: "1px solid var(--hud-border-btn)",
                                                            color: transformPivot !== "center" ? "var(--scrubber-active)" : "var(--hud-text)",
                                                            padding: "3px 0",
                                                            cursor: "pointer",
                                                            fontSize: 9,
                                                            fontWeight: 600,
                                                        }, children: "Pivot" })] })] }), transformPivot !== "center" && (_jsxs("div", { style: { marginTop: 6 }, children: [_jsx("div", { style: { fontSize: 8, color: "var(--hud-muted)", marginBottom: 4, fontStyle: "italic" }, children: "Select bounding box face for pivot:" }), _jsx("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 2 }, children: (PIVOT_FACES.filter((f) => f !== "center")).map((f) => {
                                                    const active = transformPivot === f;
                                                    return (_jsx("button", { type: "button", onClick: () => { onSetTransformPivot(f); }, style: {
                                                            background: active ? "var(--hud-active)" : "none",
                                                            border: active ? "1px solid var(--scrubber-active)" : "1px solid var(--hud-border-btn)",
                                                            color: active ? "var(--scrubber-active)" : "var(--hud-text)",
                                                            borderRadius: 3,
                                                            padding: "3px 2px",
                                                            cursor: "pointer",
                                                            fontSize: 8,
                                                            fontWeight: active ? 700 : 500,
                                                        }, children: PIVOT_FACE_LABELS[f] }, f));
                                                }) })] }))] }), _jsxs("button", { type: "button", onClick: onToggleSnap, title: snapEnabled ? "Disable snapping" : "Enable snapping", style: {
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                    width: "100%",
                                    background: "none",
                                    border: "none",
                                    borderBottom: modelTransform ? "1px solid var(--hud-border)" : "none",
                                    color: snapEnabled ? "var(--scrubber-active)" : "var(--hud-muted)",
                                    padding: "5px 10px",
                                    cursor: "pointer",
                                    fontSize: 10,
                                    fontWeight: 600,
                                }, children: [_jsx("span", { style: {
                                            width: 14,
                                            height: 14,
                                            borderRadius: 3,
                                            border: `1.5px solid ${snapEnabled ? "var(--scrubber-active)" : "var(--hud-muted)"}`,
                                            background: snapEnabled ? "var(--hud-active)" : "none",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            fontSize: 8,
                                            flexShrink: 0,
                                        }, children: snapEnabled ? "✓" : "" }), "Snap to Grid"] }), modelTransform && (_jsx("div", { style: { padding: "4px 6px 6px" }, children: _jsx(TransformPanel, { transform: modelTransform, onApply: onApplyTransform, style: { position: "static", bottom: "auto", right: "auto", padding: "2px 4px", border: "none", background: "none" } }) }))] })), historyPanelLayer !== null && (() => {
                        const graph = getSliceHistoryProp?.(historyPanelLayer);
                        if (!graph)
                            return null;
                        const seedPaths = getSeedPathIds(graph);
                        const rootNode = graph.states[graph.rootStateId];
                        const displayNode = graph.states[graph.displayStateId];
                        const operationNode = graph.states[graph.operationStateId];
                        // Get thumbnail URL helper
                        const thumbUrl = (node) => {
                            if (!node)
                                return null;
                            const thumbPid = node.assetRefs.thumb ?? node.assetRefs.image;
                            if (!thumbPid || !payloadsProp)
                                return null;
                            return payloadsProp[thumbPid]?.uri ?? null;
                        };
                        // Get ancestry for the selected path
                        const activePath = selectedPathId ?? (seedPaths.length > 0 ? seedPaths[0] : null);
                        const activeHead = activePath ? getPathHeadStateId(graph, activePath) : null;
                        const ancestryIds = activeHead ? getAncestryPath(graph, activeHead) : [];
                        return (_jsxs("div", { style: {
                                flexShrink: 0,
                                borderTop: "1px solid var(--hud-border)",
                                maxHeight: 300,
                                overflowY: "auto",
                            }, children: [_jsxs("div", { style: {
                                        padding: "8px 10px",
                                        borderBottom: "1px solid var(--hud-border)",
                                        display: "flex",
                                        gap: 8,
                                        alignItems: "center",
                                    }, children: [_jsxs("div", { style: { textAlign: "center" }, children: [_jsxs("div", { onClick: () => {
                                                        if (rootNode)
                                                            onSetDisplayCursorProp?.(historyPanelLayer, rootNode.stateId);
                                                    }, style: {
                                                        width: 36, height: 36, borderRadius: "50%", overflow: "hidden",
                                                        border: graph.displayStateId === graph.rootStateId ? "2px solid var(--scrubber-active)" : "1px solid var(--hud-border-btn)",
                                                        cursor: "pointer",
                                                        position: "relative",
                                                        background: "var(--hud-active)",
                                                    }, children: [thumbUrl(rootNode) && (_jsx("img", { src: thumbUrl(rootNode), alt: "Root", style: { width: "100%", height: "100%", objectFit: "contain", background: "var(--hud-active)" } })), graph.displayStateId === graph.rootStateId && (_jsx("span", { style: { position: "absolute", top: 0, right: 1, fontSize: 8 }, children: "\uD83D\uDC41" })), graph.operationStateId === graph.rootStateId && (_jsx("span", { style: { position: "absolute", bottom: 0, right: 1, fontSize: 8 }, children: "\u2699" }))] }), _jsx("div", { style: { fontSize: 7, color: "var(--hud-muted)", marginTop: 2 }, children: "Root" })] }), _jsx("span", { style: { fontSize: 10, color: "var(--hud-muted)" }, children: "\u2192" }), _jsxs("div", { style: { textAlign: "center" }, children: [_jsxs("div", { style: {
                                                        width: 36, height: 36, borderRadius: "50%", overflow: "hidden",
                                                        border: "2px solid var(--scrubber-active)",
                                                        background: "var(--hud-active)",
                                                        position: "relative",
                                                    }, children: [thumbUrl(displayNode) && (_jsx("img", { src: thumbUrl(displayNode), alt: "Current", style: { width: "100%", height: "100%", objectFit: "contain", background: "var(--hud-active)" } })), _jsx("span", { style: { position: "absolute", top: 0, right: 1, fontSize: 8 }, children: "\uD83D\uDC41" }), graph.operationStateId === graph.displayStateId && (_jsx("span", { style: { position: "absolute", bottom: 0, right: 1, fontSize: 8 }, children: "\u2699" }))] }), _jsx("div", { style: { fontSize: 7, color: "var(--hud-muted)", marginTop: 2 }, children: "Current" })] }), _jsx("div", { style: { flex: 1 } }), _jsx("button", { type: "button", onClick: () => { setHistoryPanelLayer(null); }, style: {
                                                background: "none", border: "none", color: "var(--hud-muted)",
                                                cursor: "pointer", fontSize: 12,
                                            }, children: "\u2715" })] }), seedPaths.length > 0 && (_jsxs("div", { style: {
                                        padding: "6px 10px",
                                        borderBottom: "1px solid var(--hud-border)",
                                    }, children: [_jsxs("div", { style: { fontSize: 8, color: "var(--hud-muted)", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 }, children: ["Seed Paths (", String(seedPaths.length), ") \u00B7 ", Object.keys(graph.ops).length, " op", Object.keys(graph.ops).length !== 1 ? "s" : ""] }), _jsx("div", { style: { display: "flex", gap: 4, flexWrap: "wrap" }, children: seedPaths.map((pathId) => {
                                                const headId = getPathHeadStateId(graph, pathId);
                                                const headNode = graph.states[headId];
                                                const isCurrentPath = activePath === pathId;
                                                const displayInPath = displayNode?.seedPathId === pathId;
                                                const opInPath = operationNode?.seedPathId === pathId;
                                                return (_jsxs("div", { onClick: () => {
                                                        setSelectedPathId(pathId);
                                                        if (headNode)
                                                            onSetDisplayCursorProp?.(historyPanelLayer, headId);
                                                    }, style: {
                                                        width: 40, height: 40, borderRadius: "50%", overflow: "hidden",
                                                        border: isCurrentPath
                                                            ? "2px solid var(--scrubber-active)"
                                                            : displayInPath
                                                                ? "2px solid var(--scrubber-active)"
                                                                : "1px solid var(--hud-border-btn)",
                                                        cursor: "pointer",
                                                        position: "relative",
                                                        background: "var(--hud-active)",
                                                        flexShrink: 0,
                                                    }, title: `Path ${pathId.slice(0, 8)}${displayInPath ? " (current)" : ""}`, children: [thumbUrl(headNode) && (_jsx("img", { src: thumbUrl(headNode), alt: "Head", style: { width: "100%", height: "100%", objectFit: "contain", background: "var(--hud-active)" } })), displayInPath && (_jsx("span", { style: { position: "absolute", top: 0, right: 1, fontSize: 7 }, children: "\uD83D\uDC41" })), opInPath && (_jsx("span", { style: { position: "absolute", bottom: 0, right: 1, fontSize: 7 }, children: "\u2699" })), headNode?.meta.opType && (_jsx("span", { style: {
                                                                position: "absolute", bottom: 0, left: 0, right: 0,
                                                                fontSize: 6, textAlign: "center",
                                                                background: "rgba(0,0,0,0.6)", color: "#fff",
                                                                padding: "0 1px", lineHeight: "10px",
                                                            }, children: headNode.meta.opType }))] }, pathId));
                                            }) })] })), ancestryIds.length > 0 && (_jsxs("div", { style: { padding: "6px 10px" }, children: [_jsxs("div", { style: { fontSize: 8, color: "var(--hud-muted)", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 }, children: ["Path History (", ancestryIds.length - 1, " op", ancestryIds.length - 1 !== 1 ? "s" : "", ")"] }), _jsx("div", { style: { display: "flex", flexDirection: "column", gap: 3 }, children: ancestryIds.map((stateId) => {
                                                const node = graph.states[stateId];
                                                if (!node)
                                                    return null;
                                                const isDisplay = stateId === graph.displayStateId;
                                                const isOp = stateId === graph.operationStateId;
                                                return (_jsxs("div", { style: {
                                                        display: "flex", alignItems: "center", gap: 6,
                                                        padding: "3px 4px", borderRadius: 4,
                                                        background: isDisplay ? "var(--hud-active)" : "transparent",
                                                        cursor: "pointer",
                                                    }, onClick: () => {
                                                        onSetDisplayCursorProp?.(historyPanelLayer, stateId);
                                                    }, children: [_jsxs("div", { style: {
                                                                width: 28, height: 28, borderRadius: "50%", overflow: "hidden", flexShrink: 0,
                                                                border: isDisplay ? "1.5px solid var(--scrubber-active)" : "1px solid var(--hud-border-btn)",
                                                                background: "var(--hud-active)",
                                                                position: "relative",
                                                            }, children: [thumbUrl(node) && (_jsx("img", { src: thumbUrl(node), alt: "", style: { width: "100%", height: "100%", objectFit: "contain", background: "var(--hud-active)" } })), isDisplay && _jsx("span", { style: { position: "absolute", top: -1, right: 0, fontSize: 7 }, children: "\uD83D\uDC41" }), isOp && _jsx("span", { style: { position: "absolute", bottom: -1, right: 0, fontSize: 7 }, children: "\u2699" })] }), _jsxs("div", { style: { flex: 1, minWidth: 0 }, children: [_jsx("div", { style: {
                                                                        fontSize: 10,
                                                                        color: isDisplay ? "var(--scrubber-active)" : "var(--hud-text)",
                                                                        fontWeight: isDisplay ? 600 : 400,
                                                                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                                                    }, children: node.meta.label }), node.meta.opType && (_jsx("div", { style: { fontSize: 8, color: "var(--hud-muted)" }, children: node.meta.opType }))] }), !isOp && stateId !== graph.rootStateId && (_jsx("button", { type: "button", onClick: (e) => {
                                                                e.stopPropagation();
                                                                onSetOperationCursorProp?.(historyPanelLayer, stateId);
                                                            }, title: "Use as input for next AI op", style: {
                                                                background: "none", border: "1px solid var(--hud-border-btn)",
                                                                borderRadius: 3, padding: "1px 4px", fontSize: 7,
                                                                color: "var(--hud-muted)", cursor: "pointer", flexShrink: 0,
                                                            }, children: "\u2699 Use" }))] }, stateId));
                                            }) })] }))] }));
                    })(), editingOpacityLayer !== null && (_jsxs("div", { style: {
                            padding: "8px 12px",
                            borderTop: "1px solid var(--hud-border)",
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            flexShrink: 0,
                        }, children: [_jsxs("span", { style: { fontSize: 11, color: "var(--hud-muted)" }, children: [layerNames[editingOpacityLayer] ?? `L${String(editingOpacityLayer)}`, " opacity"] }), _jsx("input", { type: "range", min: 0, max: 100, step: 1, value: Math.round(persistedOpacity(editingOpacityLayer) * 100), onChange: (e) => {
                                    const v = clamp01(Number(e.target.value) / 100);
                                    onPreviewOpacity(v);
                                }, onPointerUp: (e) => {
                                    const v = clamp01(Number(e.target.value) / 100);
                                    onPreviewOpacity(null);
                                    onCommitOpacity(editingOpacityLayer, v);
                                }, style: {
                                    flex: 1,
                                    accentColor: "var(--scrubber-active)",
                                    cursor: "pointer",
                                } }), _jsxs("span", { style: { fontSize: 10, color: "var(--hud-muted)", minWidth: 28, textAlign: "right" }, children: [Math.round(persistedOpacity(editingOpacityLayer) * 100), "%"] })] }))] }), selectedLayerIndex !== null && (_jsxs("div", { style: {
                    position: "absolute",
                    right: 12,
                    top: 12,
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    zIndex: 10,
                    alignItems: "flex-end",
                }, children: [_jsxs("div", { style: { display: "flex", gap: 4 }, children: [_jsx("button", { type: "button", onClick: onImportImage, title: "Import image onto this layer", style: {
                                    width: 36,
                                    height: 36,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    borderRadius: 8,
                                    background: "var(--hud-bg)",
                                    border: "1px solid var(--hud-border)",
                                    color: "var(--hud-text)",
                                    cursor: "pointer",
                                    fontSize: 16,
                                    backdropFilter: "blur(8px)",
                                }, children: "\uD83D\uDCE5" }), selectedLayerIndex in layerTextures && (_jsx("button", { type: "button", onClick: () => { onGenerate3D(selectedLayerIndex); }, disabled: generating3DLayer === selectedLayerIndex, title: selectedLayerIndex in layerGlbUrls ? "3D model loaded" : "Generate 3D from this slice", style: {
                                    width: 36,
                                    height: 36,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    borderRadius: 8,
                                    background: selectedLayerIndex in layerGlbUrls ? "var(--hud-active)" : "var(--hud-bg)",
                                    border: selectedLayerIndex in layerGlbUrls
                                        ? "1px solid var(--scrubber-active)"
                                        : "1px solid var(--hud-border)",
                                    color: generating3DLayer === selectedLayerIndex
                                        ? "var(--hud-muted)"
                                        : selectedLayerIndex in layerGlbUrls
                                            ? "var(--scrubber-active)"
                                            : "var(--hud-text)",
                                    cursor: generating3DLayer === selectedLayerIndex ? "wait" : "pointer",
                                    fontSize: 12,
                                    fontWeight: 700,
                                    backdropFilter: "blur(8px)",
                                }, children: generating3DLayer === selectedLayerIndex ? "⏳" : "3D" })), selectedLayerIndex in layerGlbUrls && (_jsx("button", { type: "button", onClick: () => { onToggle3DSourceImage(selectedLayerIndex); }, title: threeDSourceHidden.has(selectedLayerIndex) ? "Show source image" : "Hide source image", style: {
                                    width: 36,
                                    height: 36,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    borderRadius: 8,
                                    background: threeDSourceHidden.has(selectedLayerIndex) ? "var(--hud-active)" : "var(--hud-bg)",
                                    border: threeDSourceHidden.has(selectedLayerIndex)
                                        ? "1px solid var(--scrubber-active)"
                                        : "1px solid var(--hud-border)",
                                    color: threeDSourceHidden.has(selectedLayerIndex) ? "var(--scrubber-active)" : "var(--hud-text)",
                                    cursor: "pointer",
                                    fontSize: 16,
                                    backdropFilter: "blur(8px)",
                                }, children: "\uD83D\uDDBC" })), selectedLayerIndex in layerTextures && (_jsx("button", { type: "button", onClick: () => { setShowAiPromptLayer(showAiPromptLayer === selectedLayerIndex ? null : selectedLayerIndex); }, disabled: false, title: "AI Edit (img2img)", style: {
                                    width: 36,
                                    height: 36,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    borderRadius: 8,
                                    background: showAiPromptLayer === selectedLayerIndex ? "var(--hud-active)" : "var(--hud-bg)",
                                    border: showAiPromptLayer === selectedLayerIndex
                                        ? "1px solid var(--scrubber-active)"
                                        : "1px solid var(--hud-border)",
                                    color: aiEditingLayers.has(selectedLayerIndex) ? "var(--hud-muted)" : "var(--scrubber-active)",
                                    cursor: "pointer",
                                    fontSize: 16,
                                    backdropFilter: "blur(8px)",
                                }, children: aiEditingLayers.has(selectedLayerIndex) ? "⏳" : "✨" }))] }), showAiPromptLayer !== null && (_jsxs("div", { style: {
                            width: 220,
                            padding: "10px 12px",
                            borderRadius: 8,
                            background: "var(--hud-bg)",
                            border: "1px solid var(--hud-border)",
                            backdropFilter: "blur(12px)",
                            display: "flex",
                            flexDirection: "column",
                            gap: 6,
                            fontSize: 12,
                        }, children: [_jsxs("label", { style: { display: "flex", flexDirection: "column", gap: 2 }, children: [_jsx("span", { style: { opacity: 0.6, fontSize: 11 }, children: "Model" }), _jsx("select", { value: aiEditModelId, onChange: (e) => { onChangeAiEditModel(e.target.value); }, style: {
                                            background: "var(--hud-active)",
                                            border: "1px solid var(--hud-border-btn)",
                                            borderRadius: 4,
                                            padding: "4px 6px",
                                            color: "var(--hud-text)",
                                            fontSize: 12,
                                            outline: "none",
                                        }, children: AI_EDIT_MODELS.map((m) => (_jsx("option", { value: m.id, children: m.label }, m.id))) })] }), _jsxs("label", { style: { display: "flex", flexDirection: "column", gap: 2 }, children: [_jsxs("span", { style: { opacity: 0.6, fontSize: 11 }, children: ["Prompt (", layerNames[showAiPromptLayer] ?? `L${String(showAiPromptLayer)}`, ")"] }), _jsx("input", { type: "text", value: promptText, onChange: (e) => { setPromptText(e.target.value); }, onKeyDown: (e) => {
                                            e.stopPropagation();
                                            if (e.key === "Enter" && promptText.trim() && !aiEditingLayers.has(showAiPromptLayer)) {
                                                onAiEdit(promptText.trim(), strength);
                                            }
                                        }, placeholder: "Describe the edit...", style: {
                                            background: "var(--hud-active)",
                                            border: "1px solid var(--hud-border-btn)",
                                            borderRadius: 4,
                                            padding: "4px 6px",
                                            color: "var(--hud-text)",
                                            fontSize: 12,
                                            outline: "none",
                                        } })] }), getAiEditModel(aiEditModelId).hasStrength && (_jsxs("label", { style: { display: "flex", alignItems: "center", gap: 6 }, children: [_jsx("span", { style: { opacity: 0.6, minWidth: 52 }, children: "Strength" }), _jsx("input", { type: "range", min: 0, max: 100, step: 1, value: Math.round(strength * 100), onChange: (e) => { setStrength(Number(e.target.value) / 100); }, onKeyDown: (e) => { e.stopPropagation(); }, style: { flex: 1, accentColor: "var(--scrubber-active)", cursor: "pointer" } }), _jsxs("span", { style: { opacity: 0.5, minWidth: 30, textAlign: "right" }, children: [Math.round(strength * 100), "%"] })] })), _jsx("button", { type: "button", disabled: !promptText.trim() || aiEditingLayers.has(showAiPromptLayer), onClick: () => {
                                    if (promptText.trim())
                                        onAiEdit(promptText.trim(), strength);
                                }, style: {
                                    background: aiEditingLayers.has(showAiPromptLayer) ? "var(--hud-muted)" : "var(--scrubber-active)",
                                    border: "none",
                                    borderRadius: 4,
                                    padding: "5px 10px",
                                    color: "var(--btn-primary-text)",
                                    cursor: aiEditingLayers.has(showAiPromptLayer) ? "wait" : "pointer",
                                    fontWeight: 600,
                                    fontSize: 12,
                                }, children: aiEditingLayers.has(showAiPromptLayer) ? "Running…" : "Run AI Edit" }), aiErrors[showAiPromptLayer] && (_jsx("div", { style: { color: "var(--color-error)", fontSize: 11, wordBreak: "break-word" }, children: aiErrors[showAiPromptLayer] }))] }))] }))] }));
}
