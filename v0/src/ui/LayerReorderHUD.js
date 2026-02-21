import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useRef, useState } from "react";
const ITEM_H = 32;
/** Distinct hue per logical layer (matches SpaceViewport). */
function layerColor(layerIdx, layerCount) {
    const hue = Math.round((layerIdx / Math.max(layerCount, 1)) * 360);
    return `hsl(${String(hue)}, 55%, 65%)`;
}
export default function LayerReorderHUD(props) {
    const { layerCount, order, selectedLayerIndex, onPreviewOrder, onCommitOrder, } = props;
    const [dragIndex, setDragIndex] = useState(null);
    const containerRef = useRef(null);
    const startY = useRef(0);
    const currentOrder = useRef(order);
    // Update currentOrder ref when order prop changes (but not during drag)
    if (dragIndex === null) {
        currentOrder.current = order;
    }
    // We display top-to-bottom = highest stack position first.
    // "viewIndex" is the row index in the visual list (0 = top row = highest position).
    // Conversion: viewIndex = layerCount - 1 - posIdx, posIdx = layerCount - 1 - viewIndex
    const handlePointerDown = useCallback((viewIndex, e) => {
        e.preventDefault();
        e.stopPropagation();
        e.target.setPointerCapture(e.pointerId);
        setDragIndex(viewIndex);
        startY.current = e.clientY;
        currentOrder.current = [...order];
    }, [order]);
    const handlePointerMove = useCallback((e) => {
        if (dragIndex === null || !containerRef.current)
            return;
        e.stopPropagation();
        const deltaY = e.clientY - startY.current;
        // Require 60% of a row height before swapping — adds friction so
        // single-slot moves don't fire too eagerly.
        const THRESHOLD = ITEM_H * 0.6;
        const absDelta = Math.abs(deltaY);
        if (absDelta < THRESHOLD)
            return;
        // Only move one slot at a time, in the drag direction
        const direction = deltaY > 0 ? 1 : -1;
        const targetView = Math.max(0, Math.min(layerCount - 1, dragIndex + direction));
        if (targetView !== dragIndex) {
            // Convert view indices to position indices in the order array
            const fromPos = layerCount - 1 - dragIndex;
            const toPos = layerCount - 1 - targetView;
            const newOrder = [...currentOrder.current];
            const [item] = newOrder.splice(fromPos, 1);
            if (item === undefined)
                return;
            newOrder.splice(toPos, 0, item);
            currentOrder.current = newOrder;
            setDragIndex(targetView);
            // Reset anchor to current cursor position so the threshold
            // must be exceeded again for the next swap.
            startY.current = e.clientY;
            onPreviewOrder(newOrder);
        }
    }, [dragIndex, layerCount, onPreviewOrder]);
    const handlePointerUp = useCallback((e) => {
        if (dragIndex === null)
            return;
        e.stopPropagation();
        const finalOrder = currentOrder.current;
        setDragIndex(null);
        onPreviewOrder(null);
        onCommitOrder(finalOrder);
    }, [dragIndex, onPreviewOrder, onCommitOrder]);
    const handlePointerCancel = useCallback(() => {
        setDragIndex(null);
        onPreviewOrder(null);
    }, [onPreviewOrder]);
    const displayOrder = currentOrder.current;
    return (_jsxs("div", { ref: containerRef, onPointerMove: handlePointerMove, onPointerUp: handlePointerUp, onPointerCancel: handlePointerCancel, style: {
            position: "absolute",
            left: 12,
            top: 60,
            width: 72,
            display: "flex",
            flexDirection: "column",
            gap: 2,
            padding: "6px 0",
            borderRadius: 8,
            background: "var(--hud-bg)",
            border: "1px solid var(--hud-border)",
            zIndex: 10,
            userSelect: "none",
            touchAction: "none",
        }, children: [_jsx("div", { style: {
                    fontSize: 9,
                    textTransform: "uppercase",
                    letterSpacing: 1,
                    color: "var(--hud-muted)",
                    padding: "0 8px 4px",
                }, children: "Order" }), Array.from({ length: layerCount }, (_, viewIdx) => {
                // viewIdx 0 = top row = highest stack position
                const posIdx = layerCount - 1 - viewIdx;
                const layerIdx = displayOrder[posIdx] ?? posIdx;
                const isSelected = layerIdx === selectedLayerIndex;
                const isDragging = viewIdx === dragIndex;
                const color = layerColor(layerIdx, layerCount);
                return (_jsxs("div", { onPointerDown: (e) => {
                        handlePointerDown(viewIdx, e);
                    }, style: {
                        height: ITEM_H,
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "0 8px",
                        cursor: isDragging ? "grabbing" : "grab",
                        borderRadius: 4,
                        background: isDragging
                            ? "var(--hud-active)"
                            : isSelected
                                ? "var(--hud-active)"
                                : "transparent",
                        border: isDragging
                            ? "1px solid var(--scrubber-active)"
                            : "1px solid transparent",
                        transition: isDragging ? "none" : "background 0.15s",
                    }, children: [_jsx("span", { style: {
                                fontSize: 11,
                                lineHeight: 1,
                                color: "var(--hud-muted)",
                                cursor: "inherit",
                            }, children: "\u283F" }), _jsx("span", { style: {
                                width: 10,
                                height: 10,
                                borderRadius: 2,
                                background: color,
                                flexShrink: 0,
                            } }), _jsxs("span", { style: {
                                fontSize: 12,
                                color: isSelected
                                    ? "var(--scrubber-active)"
                                    : "var(--hud-text)",
                                fontWeight: isSelected ? 600 : 400,
                            }, children: ["L", layerIdx] })] }, layerIdx));
            })] }));
}
