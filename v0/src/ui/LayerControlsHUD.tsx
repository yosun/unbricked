import React, { useCallback, useEffect, useRef, useState } from "react";

interface LayerControlsHUDProps {
  layerIndex: number;
  isHidden: boolean;
  isSolo: boolean;
  opacity: number;
  onToggleHidden: (index: number) => void;
  onToggleSolo: (index: number) => void;
  onPreviewOpacity: (value: number | null) => void;
  onCommitOpacity: (index: number, value: number) => void;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export default function LayerControlsHUD(props: LayerControlsHUDProps): React.JSX.Element {
  const {
    layerIndex,
    isHidden,
    isSolo,
    opacity,
    onToggleHidden,
    onToggleSolo,
    onPreviewOpacity,
    onCommitOpacity,
  } = props;

  // Local drag value: null when not dragging (use props instead)
  const [dragValue, setDragValue] = useState<number | null>(null);
  const dragging = useRef(false);
  const commitRef = useRef(0);

  // Reset drag state when selected layer changes
  useEffect(() => {
    setDragValue(null);
    dragging.current = false;
  }, [layerIndex]);

  // effectiveOpacity: drag value while dragging, persisted prop otherwise.
  // Guard against NaN/undefined leaking from upstream — fall back to 100%.
  const rawOpacity = dragValue ?? opacity;
  const effectiveOpacity = Number.isFinite(rawOpacity) ? clamp01(rawOpacity) : 1;
  const displayPct = Math.round(effectiveOpacity * 100);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = clamp01(Number(e.target.value) / 100);
      setDragValue(v);
      commitRef.current = v;
      onPreviewOpacity(v);
    },
    [onPreviewOpacity],
  );

  const handlePointerDown = useCallback(() => {
    dragging.current = true;
    commitRef.current = effectiveOpacity;
  }, [effectiveOpacity]);

  // Window-level pointerup so commit fires even if pointer leaves the slider
  useEffect(() => {
    const handlePointerUp = (): void => {
      if (!dragging.current) return;
      dragging.current = false;
      const val = commitRef.current;
      setDragValue(null);
      onPreviewOpacity(null);
      onCommitOpacity(layerIndex, val);
    };
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [layerIndex, onPreviewOpacity, onCommitOpacity]);

  return (
    <div
      className="layer-controls-hud"
      style={{
        position: "absolute",
        left: 12,
        bottom: 12,
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 10px",
        borderRadius: 6,
        background: "var(--hud-bg)",
        border: "1px solid var(--hud-border)",
        color: "var(--hud-text)",
        fontSize: 13,
        pointerEvents: "auto",
        zIndex: 10,
        userSelect: "none",
      }}
    >
      <span style={{ opacity: 0.6, marginRight: 2 }}>L{layerIndex}</span>

      {/* Visibility toggle */}
      <button
        type="button"
        onClick={() => { onToggleHidden(layerIndex); }}
        title={isHidden ? "Show layer" : "Hide layer"}
        style={{
          background: "none",
          border: "1px solid var(--hud-border-btn)",
          color: isHidden ? "var(--hud-muted)" : "var(--hud-text)",
          borderRadius: 4,
          padding: "2px 7px",
          cursor: "pointer",
          fontSize: 13,
        }}
      >
        {isHidden ? "◻" : "👁"}
      </button>

      {/* Solo toggle */}
      <button
        type="button"
        onClick={() => { onToggleSolo(layerIndex); }}
        title={isSolo ? "Unsolo" : "Solo this layer"}
        style={{
          background: isSolo ? "var(--hud-active)" : "none",
          border: "1px solid var(--hud-border-btn)",
          color: isSolo ? "var(--scrubber-active)" : "var(--hud-text)",
          borderRadius: 4,
          padding: "2px 7px",
          cursor: "pointer",
          fontSize: 13,
        }}
      >
        S
      </button>

      {/* Opacity slider — 0..100 integer scale */}
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={displayPct}
        onChange={handleChange}
        onPointerDown={handlePointerDown}
        style={{
          width: 80,
          accentColor: "var(--scrubber-active)",
          cursor: "pointer",
        }}
        title={`Opacity: ${String(displayPct)}%`}
      />
      <span style={{ opacity: 0.5, minWidth: 30, textAlign: "right" }}>
        {displayPct}%
      </span>
    </div>
  );
}
