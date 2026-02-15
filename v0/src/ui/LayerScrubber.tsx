import React, { useCallback, useEffect, useRef, useState } from "react";

interface LayerScrubberProps {
  layerCount: number;
  selectedIndex: number | null;
  layerOrder: number[];
  onPreview: (index: number | null) => void;
  onCommit: (index: number) => void;
  onPreviewOrder: (order: number[] | null) => void;
  onCommitOrder: (order: number[]) => void;
}

/** Distinct hue per logical layer (matches SpaceViewport). */
function layerColor(layerIdx: number, layerCount: number): string {
  const hue = Math.round((layerIdx / Math.max(layerCount, 1)) * 360);
  return `hsl(${String(hue)}, 55%, 65%)`;
}

function posToPct(posIdx: number, layerCount: number): number {
  return layerCount > 1 ? ((layerCount - 1 - posIdx) / (layerCount - 1)) * 100 : 50;
}

export default function LayerScrubber(props: LayerScrubberProps): React.JSX.Element {
  const {
    layerCount,
    selectedIndex,
    layerOrder,
    onPreview,
    onCommit,
    onPreviewOrder,
    onCommitOrder,
  } = props;
  const railRef = useRef<HTMLDivElement>(null);

  // Drag state: which tick is being dragged (by posIdx), and the live order
  const [dragPosIdx, setDragPosIdx] = useState<number | null>(null);
  // Pixel offset of the dragged tick from its home position (continuous visual feedback)
  const [dragOffsetPx, setDragOffsetPx] = useState(0);
  const dragStartY = useRef(0);
  const currentOrder = useRef(layerOrder);
  const originalOrder = useRef(layerOrder);
  const activePointerId = useRef<number | null>(null);
  // Suppress the rail click that fires after a drag-release
  const justFinishedDrag = useRef(false);

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
  const handleTickPointerDown = useCallback(
    (posIdx: number, e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      // Capture on the rail container so move/up handlers fire
      activePointerId.current = e.pointerId;
      if (railRef.current) {
        railRef.current.setPointerCapture(e.pointerId);
      }
      setDragPosIdx(posIdx);
      setDragOffsetPx(0);
      dragStartY.current = e.clientY;
      currentOrder.current = [...layerOrder];
      originalOrder.current = [...layerOrder];
      // Also select this layer
      const logicalIdx = layerOrder[posIdx] ?? posIdx;
      onPreview(logicalIdx);
    },
    [layerOrder, onPreview],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (dragPosIdx === null || !railRef.current) return;
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
          if (item === undefined) return;
          newOrder.splice(targetPos, 0, item);
          currentOrder.current = newOrder;
          setDragPosIdx(targetPos);
          dragStartY.current = e.clientY;
          setDragOffsetPx(0);
          onPreviewOrder(newOrder);
        }
      }
    },
    [dragPosIdx, layerCount, onPreviewOrder],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (dragPosIdx === null) return;
      e.stopPropagation();

      const movedOrder = currentOrder.current;
      const logicalIdx = movedOrder[dragPosIdx] ?? dragPosIdx;

      // Compare against the order captured at drag-start, NOT the current prop
      // (which includes the preview and would always match movedOrder).
      const orderChanged = !movedOrder.every((v, i) => v === originalOrder.current[i]);

      activePointerId.current = null;
      justFinishedDrag.current = true;
      setDragPosIdx(null);
      setDragOffsetPx(0);
      onPreview(null);

      // Commit BEFORE clearing preview to avoid bounce-back:
      // clearing previewOrder reverts effectiveOrder to persisted (old) order,
      // so the commit must land first.
      if (orderChanged) {
        onCommitOrder(movedOrder);
      }
      onPreviewOrder(null);
      // Always commit selection
      onCommit(logicalIdx);
    },
    [dragPosIdx, onPreview, onCommit, onPreviewOrder, onCommitOrder],
  );

  const handlePointerCancel = useCallback(() => {
    activePointerId.current = null;
    setDragPosIdx(null);
    setDragOffsetPx(0);
    onPreview(null);
    onPreviewOrder(null);
  }, [onPreview, onPreviewOrder]);

  // Handle click on rail background (not on a tick): select nearest layer
  const handleRailClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // After a drag-release the browser also fires a click — ignore it
      if (justFinishedDrag.current) {
        justFinishedDrag.current = false;
        return;
      }
      if (!railRef.current) return;
      // Only act if click was on the rail itself, not a tick
      if (e.target !== railRef.current && e.target !== railRef.current.querySelector("[data-rail-track]")) return;
      const rect = railRef.current.getBoundingClientRect();
      const ratio = (e.clientY - rect.top) / rect.height;
      const continuous = (1 - ratio) * (layerCount - 1);
      const posIdx = Math.max(0, Math.min(layerCount - 1, Math.round(continuous)));
      const logicalIdx = layerOrder[posIdx] ?? posIdx;
      onCommit(logicalIdx);
    },
    [layerCount, layerOrder, onCommit],
  );

  return (
    <div
      ref={railRef}
      onClick={handleRailClick}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      style={{
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
      }}
    >
      {/* Rail track */}
      <div
        data-rail-track=""
        style={{
          position: "absolute",
          left: "50%",
          top: 0,
          bottom: 0,
          width: 4,
          borderRadius: 2,
          background: "var(--scrubber-rail, rgba(255,255,255,0.1))",
          transform: "translateX(-50%)",
          pointerEvents: "none",
        }}
      />

      {/* Draggable layer ticks */}
      {Array.from({ length: layerCount }, (_, posIdx) => {
        const pct = posToPct(posIdx, layerCount);
        const logicalIdx = displayOrder[posIdx] ?? posIdx;
        const isSelected = logicalIdx === selectedIndex;
        const isDragging = posIdx === dragPosIdx;
        const color = layerColor(logicalIdx, layerCount);

        return (
          <div
            key={logicalIdx}
            onPointerDown={(e) => { handleTickPointerDown(posIdx, e); }}
            style={{
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
            }}
          >
            {/* Wide colored bar — the draggable tick */}
            <div
              style={{
                position: "absolute",
                left: 2,
                right: 2,
                height: isSelected ? 6 : 4,
                borderRadius: 3,
                background: isSelected ? "var(--scrubber-active, #7ec8e3)" : color,
                opacity: isDragging ? 1 : (isSelected ? 0.9 : 0.5),
                transition: isDragging ? "none" : "all 0.15s",
                boxShadow: isDragging ? "0 0 8px rgba(126, 200, 227, 0.5)" : "none",
              }}
            />
            {/* Layer label on the tick */}
            <span
              style={{
                position: "absolute",
                right: "100%",
                marginRight: 4,
                fontSize: 10,
                color: isSelected ? "var(--scrubber-active)" : "var(--hud-muted)",
                fontWeight: isSelected ? 600 : 400,
                whiteSpace: "nowrap",
                pointerEvents: "none",
                opacity: isDragging || isSelected ? 1 : 0,
                transition: "opacity 0.15s",
              }}
            >
              L{logicalIdx}
            </span>
          </div>
        );
      })}
    </div>
  );
}
