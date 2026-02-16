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
  hasImage: boolean;
  onImportImage: () => void;
  onAiEdit: (prompt: string, strength?: number) => void;
  aiRunning: boolean;
  aiError: string | null;
  onAddSlice: () => void;
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
    hasImage,
    onImportImage,
    onAiEdit,
    aiRunning,
    aiError,
    onAddSlice,
  } = props;

  // Local drag value: null when not dragging (use props instead)
  const [dragValue, setDragValue] = useState<number | null>(null);
  const dragging = useRef(false);
  const commitRef = useRef(0);

  // AI edit prompt panel
  const [showPrompt, setShowPrompt] = useState(false);
  const [promptText, setPromptText] = useState("");
  const [strength, setStrength] = useState(0.75);

  // Reset drag state and close prompt when selected layer changes
  useEffect(() => {
    setDragValue(null);
    dragging.current = false;
    setShowPrompt(false);
    setPromptText("");
    setStrength(0.75);
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
        left: "50%",
        bottom: 12,
        transform: "translateX(-50%)",
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
        data-testid="opacity-slider"
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

      {/* Separator */}
      <span style={{ width: 1, height: 16, background: "var(--hud-border)", margin: "0 2px" }} />

      {/* Add Slice */}
      <button
        type="button"
        onClick={onAddSlice}
        title="Add a new slice"
        style={{
          background: "none",
          border: "1px solid var(--hud-border-btn)",
          color: "var(--hud-text)",
          borderRadius: 4,
          padding: "2px 7px",
          cursor: "pointer",
          fontSize: 13,
        }}
      >
        ＋
      </button>

      {/* Import Image */}
      <button
        type="button"
        onClick={onImportImage}
        title="Import image onto this layer"
        style={{
          background: "none",
          border: "1px solid var(--hud-border-btn)",
          color: "var(--hud-text)",
          borderRadius: 4,
          padding: "2px 7px",
          cursor: "pointer",
          fontSize: 13,
        }}
      >
        📥
      </button>

      {/* AI Edit toggle */}
      {hasImage && (
        <button
          type="button"
          onClick={() => { setShowPrompt((v) => !v); }}
          disabled={aiRunning}
          title="AI Edit (img2img)"
          style={{
            background: showPrompt ? "var(--hud-active)" : "none",
            border: "1px solid var(--hud-border-btn)",
            color: aiRunning ? "var(--hud-muted)" : "var(--scrubber-active)",
            borderRadius: 4,
            padding: "2px 7px",
            cursor: aiRunning ? "wait" : "pointer",
            fontSize: 13,
          }}
        >
          {aiRunning ? "⏳" : "✨"}
        </button>
      )}

      {/* AI prompt panel (shows below the HUD row) */}
      {showPrompt && (
        <div
          style={{
            position: "absolute",
            bottom: "calc(100% + 6px)",
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            flexDirection: "column",
            gap: 6,
            padding: "8px 10px",
            borderRadius: 6,
            background: "var(--hud-bg)",
            border: "1px solid var(--hud-border)",
            color: "var(--hud-text)",
            fontSize: 12,
            minWidth: 240,
            pointerEvents: "auto",
          }}
        >
          <label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ opacity: 0.6 }}>Prompt</span>
            <input
              type="text"
              value={promptText}
              onChange={(e) => { setPromptText(e.target.value); }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter" && promptText.trim() && !aiRunning) {
                  onAiEdit(promptText.trim(), strength);
                }
              }}
              placeholder="Describe the edit..."
              style={{
                background: "rgba(255,255,255,0.08)",
                border: "1px solid var(--hud-border-btn)",
                borderRadius: 4,
                padding: "4px 6px",
                color: "var(--hud-text)",
                fontSize: 12,
                outline: "none",
              }}
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ opacity: 0.6, minWidth: 52 }}>Strength</span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(strength * 100)}
              onChange={(e) => { setStrength(Number(e.target.value) / 100); }}
              onKeyDown={(e) => { e.stopPropagation(); }}
              style={{ flex: 1, accentColor: "var(--scrubber-active)", cursor: "pointer" }}
            />
            <span style={{ opacity: 0.5, minWidth: 30, textAlign: "right" }}>
              {Math.round(strength * 100)}%
            </span>
          </label>
          <button
            type="button"
            disabled={!promptText.trim() || aiRunning}
            onClick={() => {
              if (promptText.trim()) onAiEdit(promptText.trim(), strength);
            }}
            style={{
              background: aiRunning ? "var(--hud-muted)" : "var(--scrubber-active)",
              border: "none",
              borderRadius: 4,
              padding: "5px 10px",
              color: "#111",
              cursor: aiRunning ? "wait" : "pointer",
              fontWeight: 600,
              fontSize: 12,
            }}
          >
            {aiRunning ? "Running…" : "Run AI Edit"}
          </button>
          {aiError && (
            <div style={{ color: "#e55", fontSize: 11, wordBreak: "break-word" }}>
              {aiError}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
