import React, { useCallback, useEffect, useRef, useState } from "react";
import { AI_EDIT_MODELS, getAiEditModel } from "../services/falProxy";

interface LayersPanelProps {
  layerCount: number;
  order: number[];
  selectedLayerIndex: number | null;
  soloIndex: number | null;
  layerVisibility: Array<{ visible: boolean; opacity: number }>;
  isHidden: (index: number) => boolean;
  isMaskActive: (index: number) => boolean;
  isMaskInverted: (index: number) => boolean;
  persistedOpacity: (index: number) => number;
  onSelectLayer: (index: number) => void;
  onToggleHidden: (index: number) => void;
  onToggleSolo: (index: number) => void;
  onToggleMask: (index: number) => void;
  onInvertMask: (index: number) => void;
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
  layerThumbnails: Record<number, string>;
  aiEditModelId: string;
  onChangeAiEditModel: (id: string) => void;
  onGenerate3D: (index: number) => void;
  generating3DLayer: number | null;
  layerGlbUrls: Record<number, string>;
  threeDSourceHidden: Set<number>;
  onToggle3DSourceImage: (index: number) => void;
}

const ITEM_H = 56;

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
    isMaskActive,
    isMaskInverted,
    persistedOpacity,
    onSelectLayer,
    onToggleHidden,
    onToggleSolo,
    onToggleMask,
    onInvertMask,
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
    layerThumbnails,
    aiEditModelId,
    onChangeAiEditModel,
    onGenerate3D,
    generating3DLayer,
    layerGlbUrls,
    threeDSourceHidden,
    onToggle3DSourceImage,
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
    <>
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
            border: "1px solid var(--hud-border-btn)",
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
                  padding: "2px 0",
                  flexShrink: 0,
                  alignSelf: "center",
                }}
              >
                ⠿
              </span>

              {/* Layer thumbnail / color swatch */}
              <div style={{ position: "relative", flexShrink: 0, width: 36, height: 36 }}>
                {layerThumbnails[layerIdx] ? (
                  <img
                    src={layerThumbnails[layerIdx]}
                    alt={`Layer ${String(layerIdx)}`}
                    className={generating3DLayer === layerIdx ? "generating-3d-glow" : undefined}
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 4,
                      objectFit: "cover",
                      opacity: hidden ? 0.3 : 1,
                      border: isSelected
                        ? "1.5px solid var(--scrubber-active)"
                        : `1.5px solid ${color}`,
                    }}
                  />
                ) : (
                  <span
                    style={{
                      display: "block",
                      width: 36,
                      height: 36,
                      borderRadius: 4,
                      background: color,
                      opacity: hidden ? 0.3 : 1,
                    }}
                  />
                )}
                {/* 3D badge */}
                {layerIdx in layerGlbUrls && (
                  <span
                    style={{
                      position: "absolute",
                      bottom: -2,
                      right: -2,
                      fontSize: 7,
                      fontWeight: 700,
                      lineHeight: 1,
                      padding: "1px 3px",
                      borderRadius: 3,
                      background: "var(--scrubber-active)",
                      color: "#111",
                      pointerEvents: "none",
                    }}
                  >
                    3D
                  </span>
                )}
              </div>

              {/* Right side: name row + action buttons row */}
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                {/* Top: label + opacity */}
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span
                    style={{
                      fontSize: 12,
                      color: isSelected ? "var(--scrubber-active)" : "var(--hud-text)",
                      fontWeight: isSelected ? 600 : 400,
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      opacity: hidden ? 0.4 : 1,
                    }}
                  >
                    Layer {layerIdx}
                  </span>
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingOpacityLayer(editingOpacityLayer === layerIdx ? null : layerIdx);
                    }}
                    style={{
                      fontSize: 10,
                      color: "var(--hud-muted)",
                      cursor: "pointer",
                      flexShrink: 0,
                    }}
                    title="Click to adjust opacity"
                  >
                    {Math.round(opacity * 100)}%
                  </span>
                </div>

                {/* Bottom: action buttons */}
                <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
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
                      fontSize: 11,
                      padding: "1px 3px",
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
                      fontSize: 10,
                      fontWeight: 600,
                      padding: "1px 3px",
                      borderRadius: 3,
                      flexShrink: 0,
                    }}
                  >
                    S
                  </button>

                  {/* Mask toggle */}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onToggleMask(layerIdx); }}
                    title={isMaskActive(layerIdx) ? "Disable mask" : "Enable mask"}
                    style={{
                      background: isMaskActive(layerIdx) ? "var(--hud-active)" : "none",
                      border: "none",
                      color: isMaskActive(layerIdx) ? "var(--scrubber-active)" : "var(--hud-muted)",
                      cursor: "pointer",
                      fontSize: 9,
                      fontWeight: 600,
                      padding: "1px 3px",
                      borderRadius: 3,
                      flexShrink: 0,
                    }}
                  >
                    M
                  </button>

                  {/* Invert mask */}
                  {layerIdx in layerTextures && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onInvertMask(layerIdx); }}
                      title={isMaskInverted(layerIdx) ? "Revert mask (original)" : "Invert mask"}
                      style={{
                        background: isMaskInverted(layerIdx) ? "var(--hud-active)" : "none",
                        border: "none",
                        color: isMaskInverted(layerIdx) ? "var(--scrubber-active)" : "var(--hud-muted)",
                        cursor: "pointer",
                        fontSize: 9,
                        fontWeight: 600,
                        padding: "1px 3px",
                        borderRadius: 3,
                        flexShrink: 0,
                      }}
                    >
                      ⊘
                    </button>
                  )}

                  {/* Generate 3D */}
                  {layerIdx in layerTextures && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onGenerate3D(layerIdx); }}
                      disabled={generating3DLayer === layerIdx}
                      title={layerIdx in layerGlbUrls ? "3D model loaded" : "Generate 3D from this slice"}
                      style={{
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
                      }}
                    >
                      {generating3DLayer === layerIdx ? "⏳" : "3D"}
                    </button>
                  )}

                  {/* Toggle source image when 3D model present */}
                  {layerIdx in layerGlbUrls && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onToggle3DSourceImage(layerIdx); }}
                      title={threeDSourceHidden.has(layerIdx) ? "Show source image" : "Hide source image"}
                      style={{
                        background: threeDSourceHidden.has(layerIdx) ? "var(--hud-active)" : "none",
                        border: "none",
                        color: threeDSourceHidden.has(layerIdx) ? "var(--scrubber-active)" : "var(--hud-muted)",
                        cursor: "pointer",
                        fontSize: 9,
                        padding: "1px 3px",
                        borderRadius: 3,
                        flexShrink: 0,
                      }}
                    >
                      🖼
                    </button>
                  )}
                </div>
              </div>

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
    </div>

    {/* ── Floating action panel (left of layers panel) ── */}
    {selectedLayerIndex !== null && (
      <div
        style={{
          position: "absolute",
          right: 260,
          top: 12,
          display: "flex",
          flexDirection: "column",
          gap: 6,
          zIndex: 10,
        }}
      >
        {/* Import image button */}
        <button
          type="button"
          onClick={onImportImage}
          title="Import image onto this layer"
          style={{
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
          }}
        >
          📥
        </button>

        {/* Generate 3D button (only when layer has an image) */}
        {selectedLayerIndex in layerTextures && (
          <button
            type="button"
            onClick={() => { onGenerate3D(selectedLayerIndex); }}
            disabled={generating3DLayer === selectedLayerIndex}
            title={selectedLayerIndex in layerGlbUrls ? "3D model loaded" : "Generate 3D from this slice"}
            style={{
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
            }}
          >
            {generating3DLayer === selectedLayerIndex ? "⏳" : "3D"}
          </button>
        )}

        {/* Toggle source image when 3D model present */}
        {selectedLayerIndex in layerGlbUrls && (
          <button
            type="button"
            onClick={() => { onToggle3DSourceImage(selectedLayerIndex); }}
            title={threeDSourceHidden.has(selectedLayerIndex) ? "Show source image" : "Hide source image"}
            style={{
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
            }}
          >
            🖼
          </button>
        )}

        {/* AI Edit button (only when layer has an image) */}
        {selectedLayerIndex in layerTextures && (
          <button
            type="button"
            onClick={() => { setShowAiPromptLayer(showAiPromptLayer === selectedLayerIndex ? null : selectedLayerIndex); }}
            disabled={aiRunning}
            title="AI Edit (img2img)"
            style={{
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
              color: aiRunning ? "var(--hud-muted)" : "var(--scrubber-active)",
              cursor: aiRunning ? "wait" : "pointer",
              fontSize: 16,
              backdropFilter: "blur(8px)",
            }}
          >
            {aiRunning ? "⏳" : "✨"}
          </button>
        )}

        {/* AI prompt flyout (anchored below the buttons) */}
        {showAiPromptLayer !== null && (
          <div
            style={{
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
            }}
          >
            <label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ opacity: 0.6, fontSize: 11 }}>Model</span>
              <select
                value={aiEditModelId}
                onChange={(e) => { onChangeAiEditModel(e.target.value); }}
                style={{
                  background: "var(--hud-active)",
                  border: "1px solid var(--hud-border-btn)",
                  borderRadius: 4,
                  padding: "4px 6px",
                  color: "var(--hud-text)",
                  fontSize: 12,
                  outline: "none",
                }}
              >
                {AI_EDIT_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </label>
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
                  background: "var(--hud-active)",
                  border: "1px solid var(--hud-border-btn)",
                  borderRadius: 4,
                  padding: "4px 6px",
                  color: "var(--hud-text)",
                  fontSize: 12,
                  outline: "none",
                }}
              />
            </label>
            {getAiEditModel(aiEditModelId).hasStrength && (
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
            )}
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
    )}
    </>
  );
}
