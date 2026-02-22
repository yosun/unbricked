import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useRef, useState } from "react";
/** Distinct hue per logical layer (matches SpaceViewport). */
function layerColor(layerIdx, layerCount) {
    const hue = Math.round((layerIdx / Math.max(layerCount, 1)) * 360);
    return `hsl(${String(hue)}, 55%, 65%)`;
}
function posToPct(posIdx, layerCount) {
    return layerCount > 1 ? ((layerCount - 1 - posIdx) / (layerCount - 1)) * 100 : 50;
}
export default function LayerScrubber(props) {
    const { layerCount, selectedIndex, layerOrder, onPreview, onCommit, onPreviewOrder, onCommitOrder, layerThumbnails, layerGlbUrls, layerNames, onRenameLayer, getSliceHistory, } = props;
    const railRef = useRef(null);
    // Hover state: which tick is being hovered (by posIdx)
    const [hoveredPosIdx, setHoveredPosIdx] = useState(null);
    // Drag state: which tick is being dragged (by posIdx), and the live order
    const [dragPosIdx, setDragPosIdx] = useState(null);
    // Mirror as ref so handlePointerUp never sees a stale closure value
    const dragPosIdxRef = useRef(null);
    // Pixel offset of the dragged tick from its home position (continuous visual feedback)
    const [dragOffsetPx, setDragOffsetPx] = useState(0);
    const dragStartY = useRef(0);
    const currentOrder = useRef(layerOrder);
    const originalOrder = useRef(layerOrder);
    const activePointerId = useRef(null);
    // Suppress the rail click that fires after a drag-release
    const justFinishedDrag = useRef(false);
    // Inline rename state
    const [renamingIdx, setRenamingIdx] = useState(null);
    const [renameText, setRenameText] = useState("");
    const renameInputRef = useRef(null);
    // Sync ref with prop only when idle (no drag in progress).
    // Using useEffect avoids overwriting with a stale prop during the
    // render triggered by setDragPosIdx(null) — at that point the
    // committed order hasn't propagated back as a new prop yet.
    useEffect(() => {
        if (dragPosIdx === null) {
            currentOrder.current = layerOrder;
        }
    }, [layerOrder, dragPosIdx]);
    const displayOrder = dragPosIdx !== null ? currentOrder.current : layerOrder;
    // Handle tick pointer down: start drag-reorder for that tick
    const handleTickPointerDown = useCallback((posIdx, e) => {
        e.preventDefault();
        e.stopPropagation();
        // Capture on the rail container so move/up handlers fire
        activePointerId.current = e.pointerId;
        if (railRef.current) {
            railRef.current.setPointerCapture(e.pointerId);
        }
        dragPosIdxRef.current = posIdx;
        setDragPosIdx(posIdx);
        setDragOffsetPx(0);
        dragStartY.current = e.clientY;
        currentOrder.current = [...layerOrder];
        originalOrder.current = [...layerOrder];
        // Also select this layer
        const logicalIdx = layerOrder[posIdx] ?? posIdx;
        onPreview(logicalIdx);
    }, [layerOrder, onPreview]);
    const handlePointerMove = useCallback((e) => {
        if (dragPosIdx === null || !railRef.current)
            return;
        e.stopPropagation();
        const rect = railRef.current.getBoundingClientRect();
        const slotH = layerCount > 1 ? rect.height / (layerCount - 1) : rect.height;
        const deltaY = e.clientY - dragStartY.current;
        // Continuously move the tick visually to follow the pointer
        setDragOffsetPx(deltaY);
        const THRESHOLD = slotH * 0.5;
        // Only re-slot when the drag crosses the threshold
        if (Math.abs(deltaY) >= THRESHOLD) {
            // In visual space: moving down = lower posIdx (top of rail = highest posIdx)
            // deltaY > 0 means cursor moved down → posIdx decreases
            const direction = deltaY > 0 ? -1 : 1;
            const targetPos = Math.max(0, Math.min(layerCount - 1, dragPosIdx + direction));
            if (targetPos !== dragPosIdx) {
                const newOrder = [...currentOrder.current];
                const [item] = newOrder.splice(dragPosIdx, 1);
                if (item === undefined)
                    return;
                newOrder.splice(targetPos, 0, item);
                currentOrder.current = newOrder;
                dragPosIdxRef.current = targetPos;
                setDragPosIdx(targetPos);
                dragStartY.current = e.clientY;
                setDragOffsetPx(0);
                onPreviewOrder(newOrder);
            }
        }
    }, [dragPosIdx, layerCount, onPreviewOrder]);
    const handlePointerUp = useCallback((e) => {
        // Use ref to avoid stale-closure issues when pointerup fires
        // in the same frame as pointerdown (fast clicks / touch devices).
        const posIdx = dragPosIdxRef.current;
        if (posIdx === null)
            return;
        e.stopPropagation();
        const movedOrder = currentOrder.current;
        const logicalIdx = movedOrder[posIdx] ?? posIdx;
        // Compare against the order captured at drag-start, NOT the current prop
        // (which includes the preview and would always match movedOrder).
        const orderChanged = !movedOrder.every((v, i) => v === originalOrder.current[i]);
        activePointerId.current = null;
        dragPosIdxRef.current = null;
        justFinishedDrag.current = true;
        setDragPosIdx(null);
        setDragOffsetPx(0);
        // Commit selection BEFORE clearing preview so effectiveSelectedIndex
        // never drops to null (which would unmount the LayerControlsHUD).
        if (orderChanged) {
            onCommitOrder(movedOrder);
        }
        onCommit(logicalIdx);
        // Now safe to clear transient preview state
        onPreview(null);
        onPreviewOrder(null);
    }, [onPreview, onCommit, onPreviewOrder, onCommitOrder]);
    const handlePointerCancel = useCallback(() => {
        activePointerId.current = null;
        dragPosIdxRef.current = null;
        setDragPosIdx(null);
        setDragOffsetPx(0);
        onPreview(null);
        onPreviewOrder(null);
    }, [onPreview, onPreviewOrder]);
    // Handle click on rail background (not on a tick): select nearest layer
    const handleRailClick = useCallback((e) => {
        // After a drag-release the browser also fires a click — ignore it
        if (justFinishedDrag.current) {
            justFinishedDrag.current = false;
            return;
        }
        if (!railRef.current)
            return;
        // Only act if click was on the rail itself, not a tick
        if (e.target !== railRef.current && e.target !== railRef.current.querySelector("[data-rail-track]"))
            return;
        const rect = railRef.current.getBoundingClientRect();
        const ratio = (e.clientY - rect.top) / rect.height;
        const continuous = (1 - ratio) * (layerCount - 1);
        const posIdx = Math.max(0, Math.min(layerCount - 1, Math.round(continuous)));
        const logicalIdx = layerOrder[posIdx] ?? posIdx;
        onCommit(logicalIdx);
    }, [layerCount, layerOrder, onCommit]);
    return (_jsxs("div", { ref: railRef, onClick: handleRailClick, onPointerMove: handlePointerMove, onPointerUp: handlePointerUp, onPointerCancel: handlePointerCancel, style: {
            position: "absolute",
            right: 12,
            top: "10%",
            bottom: "10%",
            width: 64,
            cursor: "pointer",
            touchAction: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10,
        }, children: [_jsx("div", { "data-rail-track": "", style: {
                    position: "absolute",
                    left: "50%",
                    top: 0,
                    bottom: 0,
                    width: 4,
                    borderRadius: 2,
                    background: "var(--control-bg)",
                    transform: "translateX(-50%)",
                    pointerEvents: "none",
                } }), Array.from({ length: layerCount }, (_, posIdx) => {
                const pct = posToPct(posIdx, layerCount);
                const logicalIdx = displayOrder[posIdx] ?? posIdx;
                const isSelected = logicalIdx === selectedIndex;
                const isDragging = posIdx === dragPosIdx;
                const color = layerColor(logicalIdx, layerCount);
                return (_jsxs("div", { onPointerDown: (e) => { handleTickPointerDown(posIdx, e); }, onPointerEnter: () => { setHoveredPosIdx(posIdx); }, onPointerLeave: () => { setHoveredPosIdx((prev) => prev === posIdx ? null : prev); }, style: {
                        position: "absolute",
                        top: `${String(pct)}%`,
                        left: 0,
                        right: 0,
                        height: 20,
                        transform: isDragging
                            ? `translateY(calc(-50% + ${String(dragOffsetPx)}px))`
                            : "translateY(-50%)",
                        display: "flex",
                        alignItems: "center",
                        cursor: isDragging ? "grabbing" : "grab",
                        zIndex: isDragging ? 20 : 1,
                        transition: isDragging ? "none" : "transform 0.15s ease-out",
                    }, children: [_jsx("div", { style: {
                                position: "absolute",
                                left: 2,
                                right: 2,
                                height: isSelected ? 6 : 4,
                                borderRadius: 3,
                                background: isSelected ? "var(--scrubber-active)" : color,
                                opacity: isDragging ? 1 : (isSelected ? 0.9 : 0.5),
                                transition: isDragging ? "none" : "all 0.15s",
                                boxShadow: isDragging ? "0 0 8px var(--shadow-medium)" : "none",
                            } }), (() => {
                            const graph = getSliceHistory?.(logicalIdx);
                            if (!graph)
                                return null;
                            const opsCount = Object.keys(graph.ops).length;
                            if (opsCount === 0)
                                return null;
                            return (_jsx("div", { style: {
                                    position: "absolute",
                                    left: "100%",
                                    marginLeft: 4,
                                    fontSize: 8,
                                    fontWeight: 700,
                                    lineHeight: "14px",
                                    minWidth: 14,
                                    height: 14,
                                    padding: "0 3px",
                                    borderRadius: 7,
                                    background: "var(--scrubber-active)",
                                    color: "var(--btn-primary-text)",
                                    textAlign: "center",
                                    pointerEvents: "none",
                                    opacity: isDragging || isSelected || posIdx === hoveredPosIdx ? 1 : 0.6,
                                    transition: "opacity 0.15s",
                                }, title: `${String(opsCount)} AI op${opsCount > 1 ? "s" : ""}`, children: opsCount }));
                        })(), _jsxs("div", { onDoubleClick: (e) => {
                                e.stopPropagation();
                                setRenamingIdx(logicalIdx);
                                setRenameText(layerNames[logicalIdx] ?? `Layer ${String(logicalIdx)}`);
                                setTimeout(() => { renameInputRef.current?.select(); }, 0);
                            }, style: {
                                position: "absolute",
                                right: "100%",
                                marginRight: 4,
                                display: "flex",
                                alignItems: "center",
                                gap: 4,
                                pointerEvents: isDragging || isSelected || posIdx === hoveredPosIdx ? "auto" : "none",
                                opacity: isDragging || isSelected || posIdx === hoveredPosIdx ? 1 : 0,
                                transition: "opacity 0.15s",
                            }, children: [layerThumbnails[logicalIdx] && (_jsxs("div", { style: { position: "relative", flexShrink: 0 }, children: [_jsx("img", { src: layerThumbnails[logicalIdx], alt: "", style: {
                                                width: 24,
                                                height: 24,
                                                borderRadius: "50%",
                                                objectFit: "contain",
                                                background: "var(--hud-active)",
                                                border: isSelected
                                                    ? "1px solid var(--scrubber-active)"
                                                    : `1px solid ${color}`,
                                            } }), logicalIdx in layerGlbUrls && (_jsx("span", { style: {
                                                position: "absolute",
                                                bottom: -2,
                                                right: -2,
                                                fontSize: 6,
                                                fontWeight: 700,
                                                lineHeight: 1,
                                                padding: "1px 2px",
                                                borderRadius: 2,
                                                background: "var(--scrubber-active)",
                                                color: "var(--btn-primary-text)",
                                            }, children: "3D" }))] })), renamingIdx === logicalIdx ? (_jsx("input", { ref: renameInputRef, type: "text", value: renameText, onChange: (e) => { setRenameText(e.target.value); }, onBlur: () => {
                                        onRenameLayer(logicalIdx, renameText);
                                        setRenamingIdx(null);
                                    }, onKeyDown: (e) => {
                                        e.stopPropagation();
                                        if (e.key === "Enter") {
                                            onRenameLayer(logicalIdx, renameText);
                                            setRenamingIdx(null);
                                        }
                                        else if (e.key === "Escape") {
                                            setRenamingIdx(null);
                                        }
                                    }, style: {
                                        fontSize: 10,
                                        width: 64,
                                        background: "var(--hud-active)",
                                        border: "1px solid var(--scrubber-active)",
                                        borderRadius: 3,
                                        padding: "1px 4px",
                                        color: "var(--hud-text)",
                                        outline: "none",
                                        textAlign: "right",
                                    } })) : (_jsxs("span", { style: {
                                        fontSize: 10,
                                        color: isSelected ? "var(--scrubber-active)" : "var(--hud-muted)",
                                        fontWeight: isSelected ? 600 : 400,
                                        whiteSpace: "nowrap",
                                        cursor: "default",
                                    }, title: "Double-click to rename", children: [layerNames[logicalIdx] ?? `L${String(logicalIdx)}`, !layerThumbnails[logicalIdx] && logicalIdx in layerGlbUrls ? " 3D" : ""] }))] })] }, logicalIdx));
            })] }));
}
