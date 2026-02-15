import React, { useCallback, useRef } from "react";

interface LayerScrubberProps {
  layerCount: number;
  selectedIndex: number | null;
  onPreview: (index: number | null) => void;
  onCommit: (index: number) => void;
}

function clampIndex(raw: number, layerCount: number): number {
  return Math.max(0, Math.min(layerCount - 1, Math.round(raw)));
}

function yToIndex(
  clientY: number,
  rect: DOMRect,
  layerCount: number,
): number {
  const ratio = (clientY - rect.top) / rect.height;
  // top of rail = last layer index, bottom = 0 (spatial: higher index = higher y)
  const continuous = (1 - ratio) * (layerCount - 1);
  return clampIndex(continuous, layerCount);
}

export default function LayerScrubber(props: LayerScrubberProps): React.JSX.Element {
  const { layerCount, selectedIndex, onPreview, onCommit } = props;
  const railRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!railRef.current) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      dragging.current = true;
      const idx = yToIndex(e.clientY, railRef.current.getBoundingClientRect(), layerCount);
      onPreview(idx);
    },
    [layerCount, onPreview],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging.current || !railRef.current) return;
      const idx = yToIndex(e.clientY, railRef.current.getBoundingClientRect(), layerCount);
      onPreview(idx);
    },
    [layerCount, onPreview],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!railRef.current) return;
      dragging.current = false;
      const idx = yToIndex(e.clientY, railRef.current.getBoundingClientRect(), layerCount);
      onPreview(null);
      onCommit(idx);
    },
    [layerCount, onPreview, onCommit],
  );

  // Compute thumb position as a percentage from top (top = highest index)
  const thumbPct =
    selectedIndex !== null && layerCount > 1
      ? ((layerCount - 1 - selectedIndex) / (layerCount - 1)) * 100
      : null;

  // Tick marks for each layer
  const ticks = Array.from({ length: layerCount }, (_, i) => {
    const pct = layerCount > 1 ? ((layerCount - 1 - i) / (layerCount - 1)) * 100 : 50;
    return (
      <div
        key={i}
        style={{
          position: "absolute",
          top: `${String(pct)}%`,
          left: 0,
          right: 0,
          height: 2,
          borderRadius: 1,
          background:
            i === selectedIndex
              ? "var(--scrubber-active, #7ec8e3)"
              : "var(--scrubber-tick, rgba(255,255,255,0.18))",
          transform: "translateY(-1px)",
          transition: "background 0.15s",
        }}
      />
    );
  });

  return (
    <div
      ref={railRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        dragging.current = false;
        onPreview(null);
      }}
      style={{
        position: "absolute",
        right: 12,
        top: "15%",
        bottom: "15%",
        width: 24,
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
        style={{
          position: "absolute",
          left: "50%",
          top: 0,
          bottom: 0,
          width: 4,
          borderRadius: 2,
          background: "var(--scrubber-rail, rgba(255,255,255,0.1))",
          transform: "translateX(-50%)",
        }}
      />

      {/* Tick marks */}
      {ticks}

      {/* Thumb */}
      {thumbPct !== null && (
        <div
          style={{
            position: "absolute",
            top: `${String(thumbPct)}%`,
            left: "50%",
            width: 14,
            height: 14,
            borderRadius: "50%",
            background: "var(--scrubber-active, #7ec8e3)",
            border: "2px solid rgba(255,255,255,0.5)",
            transform: "translate(-50%, -50%)",
            transition: dragging.current ? "none" : "top 0.15s ease-out",
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
}
