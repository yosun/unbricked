import React, { useCallback, useEffect, useRef, useState } from "react";

interface LayersPanelProps {
  layerCount: number;
  order: number[];
  selectedLayerIndex: number | null;
  soloIndex: number | null;
  layerVisibility: Array<{ visible: boolean; opacity: number }>;
  isHidden: (index: number) => boolean;
  persistedOpacity: (index: number) => number;
  onSelectLayer: (index: number) => void;
  onToggleHidden: (index: number) => void;
  onToggleSolo: (index: number) => void;
  onPreviewOpacity: (value: number | null) => void;
  onCommitOpacity: (index: number, value: number) => void;
  onPreviewOrder: (order: number[] | null) => void;
  onCommitOrder: (order: number[]) => void;
  onImportImage: () => void;
  onAiEdit: (prompt: string, strength?: number) => void;
  aiRunning: boolean;
  aiError: string | null;
  onAddSlice: () => void;
  layerTextures: Record<number, string>;
}

const ITEM_H = 40;

function layerColor(layerIdx: number, layerCount: number): string {
  const hue = Math.round((layerIdx / Math.max(layerCount, 1)) * 360);
  return `hsl(${String(hue)}, 55%, 65%)`;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export default function LayersPanel(props: LayersPanelProps): React.JSX.Element {
  const {
    layerCount,
    order,
    selectedLayerIndex,
    soloIndex,
    isHidden,
    persistedOpacity,
    onSelectLayer,
    onToggleHidden,
    onToggleSolo,
    onPreviewOpacity,
    onCommitOpacity,
    onPreviewOrder,
    onCommitOrder,
    onImportImage,
    onAiEdit,
    aiRunning,
    aiError,
    onAddSlice,
    layerTextures,
  } = props;

  /* ── Drag reorder state ──────────────────────── */
  const [dragViewIdx, setDragViewIdx] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const currentOrder = useRef(order);
  const originalOrder = useRef(order);
  const activePointerId = useRef<number | null>(null);

  // Sync ref with prop only when idle — same pattern as LayerScrubber.
  useEffect(() => {
    if (dragViewIdx === null) {
      currentOrder.current = order;
    }
  }, [order, dragViewIdx]);

  /* ── Per-layer inline opacity editing ───────── */
  const [editingOpacityLayer, setEditingOpacityLayer] = useState<number | null>(null);

  /* ── Per-layer AI prompt ───────── */
  const [showAiPromptLayer, setShowAiPromptLayer] = useState<number | null>(null);
  const [promptText, setPromptText] = useState("");
  const [strength, setStrength] = useState(0.75);

  const handleDragPointerDown = useCallback(
    (viewIdx: number, e: React.PointerEvent<HTMLSpanElement>) => {
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
    },
    [order],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (dragViewIdx === null) return;
      e.stopPropagation();
      const THRESHOLD = ITEM_H * 0.6;
      const deltaY = e.clientY - startY.current;
      if (Math.abs(deltaY) < THRESHOLD) return;

      const direction = deltaY > 0 ? 1 : -1;
      const targetView = Math.max(0, Math.min(layerCount - 1, dragViewIdx + direction));
      if (targetView !== dragViewIdx) {
        const fromPos = layerCount - 1 - dragViewIdx;
        const toPos = layerCount - 1 - targetView;
        const newOrder = [...currentOrder.current];
        const [item] = newOrder.splice(fromPos, 1);
        if (item === undefined) return;
        newOrder.splice(toPos, 0, item);
        currentOrder.current = newOrder;
        setDragViewIdx(targetView);
        startY.current = e.clientY;
        onPreviewOrder(newOrder);
      }
    },
    [dragViewIdx, layerCount, onPreviewOrder],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (dragViewIdx === null) return;
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
    },
    [dragViewIdx, onPreviewOrder, onCommitOrder],
  );

  const displayOrder = dragViewIdx !== null ? currentOrder.current : order;

  return (
    <div
      ref={containerRef}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        setDragViewIdx(null);
        onPreviewOrder(null);
      }}
      className="layers-panel"
      style={{
        position: "absolute",
        right: 12,
        top: 12,
        bottom: 12,
        width: 220,
        display: "flex",
        flexDirection: "column",
        borderRadius: 10,
        background: "var(--hud-bg)",
        border: "1px solid var(--hud-border)",
        zIndex: 10,
        userSelect: "none",
        touchAction: "none",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
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
        }}
      >
        Layers
        <button
          type="button"
          onClick={onAddSlice}
          title="Add a new slice"
          style={{
            background: "none",
            border: "1px solid var(--hud-border-btn, rgba(255,255,255,0.15))",
            color: "var(--hud-text)",
            borderRadius: 4,
            padding: "1px 7px",
            cursor: "pointer",
            fontSize: 14,
            lineHeight: 1,
          }}
        >
          ＋
        </button>
      </div>

      {/* Layer list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
        {Array.from({ length: layerCount }, (_, viewIdx) => {
          const posIdx = layerCount - 1 - viewIdx;
          const layerIdx = displayOrder[posIdx] ?? posIdx;
          const isSelected = layerIdx === selectedLayerIndex;
          const isDragging = viewIdx === dragViewIdx;
          const hidden = isHidden(layerIdx);
          const isSolo = soloIndex === layerIdx;
          const color = layerColor(layerIdx, layerCount);
          const opacity = persistedOpacity(layerIdx);

          return (
            <div
              key={layerIdx}
              onClick={() => { onSelectLayer(layerIdx); }}
              style={{
                height: ITEM_H,
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "0 8px",
                cursor: "pointer",
                borderRadius: 4,
                margin: "0 4px",
                background: isDragging
                  ? "var(--hud-active)"
                  : isSelected
                    ? "rgba(126, 200, 227, 0.15)"
                    : "transparent",
                border: isDragging
                  ? "1px solid var(--scrubber-active)"
                  : "1px solid transparent",
                transition: isDragging ? "none" : "background 0.12s",
              }}
            >
              {/* Drag handle */}
              <span
                onPointerDown={(e) => { handleDragPointerDown(viewIdx, e); }}
                style={{
                  fontSize: 11,
                  lineHeight: 1,
                  color: "var(--hud-muted)",
                  cursor: isDragging ? "grabbing" : "grab",
                  padding: "2px 2px",
                  flexShrink: 0,
                }}
              >
                ⠿
              </span>

              {/* Color swatch */}
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 3,
                  background: color,
                  flexShrink: 0,
                  opacity: hidden ? 0.3 : 1,
                }}
              />

              {/* Label */}
              <span
                style={{
                  fontSize: 12,
                  color: isSelected ? "var(--scrubber-active)" : "var(--hud-text)",
                  fontWeight: isSelected ? 600 : 400,
                  flex: 1,
                  minWidth: 0,
                  opacity: hidden ? 0.4 : 1,
                }}
              >
                Layer {layerIdx}
              </span>

              {/* Visibility toggle */}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onToggleHidden(layerIdx); }}
                title={hidden ? "Show" : "Hide"}
                style={{
                  background: "none",
                  border: "none",
                  color: hidden ? "var(--hud-muted)" : "var(--hud-text)",
                  cursor: "pointer",
                  fontSize: 13,
                  padding: "2px 3px",
                  flexShrink: 0,
                  opacity: hidden ? 0.5 : 0.8,
                }}
              >
                {hidden ? "◻" : "👁"}
              </button>

              {/* Solo toggle */}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onToggleSolo(layerIdx); }}
                title={isSolo ? "Unsolo" : "Solo"}
                style={{
                  background: isSolo ? "var(--hud-active)" : "none",
                  border: "none",
                  color: isSolo ? "var(--scrubber-active)" : "var(--hud-muted)",
                  cursor: "pointer",
                  fontSize: 11,
                  fontWeight: 600,
                  padding: "2px 4px",
                  borderRadius: 3,
                  flexShrink: 0,
                }}
              >
                S
              </button>

              {/* Opacity */}
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingOpacityLayer(editingOpacityLayer === layerIdx ? null : layerIdx);
                }}
                style={{
                  fontSize: 10,
                  color: "var(--hud-muted)",
                  minWidth: 28,
                  textAlign: "right",
                  cursor: "pointer",
                  flexShrink: 0,
                }}
                title="Click to adjust opacity"
              >
                {Math.round(opacity * 100)}%
              </span>

              {/* Import image (selected row only) */}
              {isSelected && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onImportImage(); }}
                  title="Import image onto this layer"
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--hud-text)",
                    cursor: "pointer",
                    fontSize: 13,
                    padding: "2px 3px",
                    flexShrink: 0,
                    opacity: 0.8,
                  }}
                >
                  📥
                </button>
              )}

              {/* AI Edit (selected row with image only) */}
              {isSelected && layerIdx in layerTextures && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setShowAiPromptLayer(showAiPromptLayer === layerIdx ? null : layerIdx); }}
                  disabled={aiRunning}
                  title="AI Edit (img2img)"
                  style={{
                    background: showAiPromptLayer === layerIdx ? "var(--hud-active)" : "none",
                    border: "none",
                    color: aiRunning ? "var(--hud-muted)" : "var(--scrubber-active)",
                    cursor: aiRunning ? "wait" : "pointer",
                    fontSize: 13,
                    padding: "2px 3px",
                    flexShrink: 0,
                  }}
                >
                  {aiRunning ? "⏳" : "✨"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Inline opacity slider when editing */}
      {editingOpacityLayer !== null && (
        <div
          style={{
            padding: "8px 12px",
            borderTop: "1px solid var(--hud-border)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 11, color: "var(--hud-muted)" }}>
            L{editingOpacityLayer} opacity
          </span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(persistedOpacity(editingOpacityLayer) * 100)}
            onChange={(e) => {
              const v = clamp01(Number(e.target.value) / 100);
              onPreviewOpacity(v);
            }}
            onPointerUp={(e) => {
              const v = clamp01(Number((e.target as HTMLInputElement).value) / 100);
              onPreviewOpacity(null);
              onCommitOpacity(editingOpacityLayer, v);
            }}
            style={{
              flex: 1,
              accentColor: "var(--scrubber-active)",
              cursor: "pointer",
            }}
          />
          <span style={{ fontSize: 10, color: "var(--hud-muted)", minWidth: 28, textAlign: "right" }}>
            {Math.round(persistedOpacity(editingOpacityLayer) * 100)}%
          </span>
        </div>
      )}

      {/* AI prompt panel for selected layer */}
      {showAiPromptLayer !== null && (
        <div
          style={{
            padding: "8px 12px",
            borderTop: "1px solid var(--hud-border)",
            display: "flex",
            flexDirection: "column",
            gap: 6,
            flexShrink: 0,
            fontSize: 12,
          }}
        >
          <label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ opacity: 0.6, fontSize: 11 }}>Prompt (L{showAiPromptLayer})</span>
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
                border: "1px solid var(--hud-border-btn, rgba(255,255,255,0.15))",
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
