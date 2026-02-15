import React, { useCallback, useRef, useState } from "react";

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

  const [localOpacity, setLocalOpacity] = useState(opacity);
  const dragging = useRef(false);

  // Sync local opacity when layerIndex or persisted value changes (and not dragging)
  const prevLayerRef = useRef(layerIndex);
  const prevOpacityRef = useRef(opacity);
  if (prevLayerRef.current !== layerIndex || (!dragging.current && prevOpacityRef.current !== opacity)) {
    prevLayerRef.current = layerIndex;
    prevOpacityRef.current = opacity;
    setLocalOpacity(opacity);
  }

  const handleOpacityInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = Number(e.target.value);
      setLocalOpacity(val);
      dragging.current = true;
      onPreviewOpacity(val);
    },
    [onPreviewOpacity],
  );

  const handleOpacityCommit = useCallback(() => {
    dragging.current = false;
    onPreviewOpacity(null);
    onCommitOpacity(layerIndex, localOpacity);
  }, [layerIndex, localOpacity, onPreviewOpacity, onCommitOpacity]);

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
        background: "var(--hud-bg, rgba(22, 22, 42, 0.85))",
        border: "1px solid var(--hud-border, rgba(255,255,255,0.1))",
        color: "var(--hud-text, #ccc)",
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
          border: "1px solid var(--hud-border, rgba(255,255,255,0.15))",
          color: isHidden ? "var(--hud-muted, #666)" : "var(--hud-text, #ccc)",
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
          background: isSolo ? "var(--hud-active, rgba(126,200,227,0.25))" : "none",
          border: "1px solid var(--hud-border, rgba(255,255,255,0.15))",
          color: isSolo ? "var(--scrubber-active, #7ec8e3)" : "var(--hud-text, #ccc)",
          borderRadius: 4,
          padding: "2px 7px",
          cursor: "pointer",
          fontSize: 13,
        }}
      >
        S
      </button>

      {/* Opacity slider */}
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={localOpacity}
        onChange={handleOpacityInput}
        onPointerUp={handleOpacityCommit}
        onKeyUp={handleOpacityCommit}
        style={{
          width: 80,
          accentColor: "var(--scrubber-active, #7ec8e3)",
          cursor: "pointer",
        }}
        title={`Opacity: ${String(Math.round(localOpacity * 100))}%`}
      />
      <span style={{ opacity: 0.5, minWidth: 30, textAlign: "right" }}>
        {Math.round(localOpacity * 100)}%
      </span>
    </div>
  );
}
