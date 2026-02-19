import React, { useCallback, useEffect, useRef, useState } from "react";
import { AI_EDIT_MODELS, getAiEditModel } from "../services/falProxy";
import type { Object3DTransform, PivotFace } from "./SpaceViewport";
import { PIVOT_FACES, PIVOT_FACE_LABELS } from "./SpaceViewport";

interface LayerControlsHUDProps {
  layerIndex: number;
  isHidden: boolean;
  isSolo: boolean;
  maskActive: boolean;
  opacity: number;
  onToggleHidden: (index: number) => void;
  onToggleSolo: (index: number) => void;
  onToggleMask: (index: number) => void;
  onInvertMask: (index: number) => void;
  onPreviewOpacity: (value: number | null) => void;
  onCommitOpacity: (index: number, value: number) => void;
  hasImage: boolean;
  onImportImage: () => void;
  onAiEdit: (prompt: string, strength?: number) => void;
  aiRunning: boolean;
  aiError: string | null;
  onAddSlice: () => void;
  aiEditModelId: string;
  onChangeAiEditModel: (id: string) => void;
  onPromptVisibilityChange?: ((visible: boolean) => void) | undefined;
  onGenerate3D: (index: number) => void;
  generating3D: boolean;
  has3DModel: boolean;
  sourceImageHidden: boolean;
  onToggle3DSourceImage: (index: number) => void;
  transformPivot: PivotFace;
  onSetTransformPivot: (face: PivotFace) => void;
  transformMode: "translate" | "rotate" | "scale";
  onSetTransformMode: (mode: "translate" | "rotate" | "scale") => void;
  snapEnabled: boolean;
  onToggleSnap: () => void;
  modelTransform?: Object3DTransform | undefined;
  onApplyTransform: (t: Object3DTransform) => void;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

const txInputStyle: React.CSSProperties = {
  width: 48,
  background: "var(--hud-active)",
  border: "1px solid var(--hud-border-btn)",
  borderRadius: 3,
  padding: "1px 3px",
  color: "var(--hud-text)",
  fontSize: 10,
  fontFamily: "monospace",
  textAlign: "right",
  outline: "none",
};

function TransformInput({
  value,
  step,
  suffix,
  onChange,
}: {
  value: number;
  step: number;
  suffix?: string;
  onChange: (v: number) => void;
}): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");

  const display = suffix ? `${value.toFixed(step < 1 ? 2 : 1)}${suffix}` : value.toFixed(step < 1 ? 2 : 1);

  if (!editing) {
    return (
      <span
        style={{ ...txInputStyle, cursor: "text", userSelect: "none" }}
        onClick={() => { setEditing(true); setText(String(value)); }}
        title="Click to edit"
      >
        {display}
      </span>
    );
  }

  return (
    <input
      type="number"
      step={step}
      value={text}
      autoFocus
      style={txInputStyle}
      onChange={(e) => { setText(e.target.value); }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          const v = parseFloat(text);
          if (Number.isFinite(v)) onChange(v);
          setEditing(false);
        } else if (e.key === "Escape") {
          setEditing(false);
        }
      }}
      onBlur={() => {
        const v = parseFloat(text);
        if (Number.isFinite(v)) onChange(v);
        setEditing(false);
      }}
    />
  );
}

/** Editable transform panel showing position, rotation, scale. */
export function TransformPanel({
  transform,
  onApply,
  style,
}: {
  transform: Object3DTransform;
  onApply: (t: Object3DTransform) => void;
  style?: React.CSSProperties;
}): React.JSX.Element {
  const update = (field: "position" | "rotation" | "scale", axis: 0 | 1 | 2, value: number): void => {
    const next = { ...transform, [field]: [...transform[field]] as [number, number, number] };
    next[field][axis] = parseFloat(value.toFixed(3));
    onApply(next);
  };

  return (
    <div
      style={{
        position: "absolute",
        bottom: "calc(100% + 6px)",
        right: 0,
        display: "grid",
        gridTemplateColumns: "auto 1fr 1fr 1fr",
        gap: "2px 4px",
        padding: "6px 8px",
        borderRadius: 6,
        background: "var(--hud-bg)",
        border: "1px solid var(--hud-border)",
        color: "var(--hud-text)",
        fontSize: 10,
        fontFamily: "monospace",
        whiteSpace: "nowrap",
        zIndex: 14,
        pointerEvents: "auto",
        ...style,
      }}
    >
      <span style={{ opacity: 0.5 }} />
      <span style={{ opacity: 0.5, textAlign: "center" }}>X</span>
      <span style={{ opacity: 0.5, textAlign: "center" }}>Y</span>
      <span style={{ opacity: 0.5, textAlign: "center" }}>Z</span>

      <span style={{ opacity: 0.5 }}>Pos</span>
      {([0, 1, 2] as const).map((i) => (
        <TransformInput key={`p${String(i)}`} value={transform.position[i]} step={0.05} onChange={(v) => { update("position", i, v); }} />
      ))}

      <span style={{ opacity: 0.5 }}>Rot</span>
      {([0, 1, 2] as const).map((i) => (
        <TransformInput key={`r${String(i)}`} value={transform.rotation[i]} step={1} suffix="°" onChange={(v) => { update("rotation", i, v); }} />
      ))}

      <span style={{ opacity: 0.5 }}>Scl</span>
      {([0, 1, 2] as const).map((i) => (
        <TransformInput key={`s${String(i)}`} value={transform.scale[i]} step={0.05} onChange={(v) => { update("scale", i, v); }} />
      ))}
    </div>
  );
}

export default function LayerControlsHUD(props: LayerControlsHUDProps): React.JSX.Element {
  const {
    layerIndex,
    isHidden,
    isSolo,
    maskActive,
    opacity,
    onToggleHidden,
    onToggleSolo,
    onToggleMask,
    onInvertMask,
    onPreviewOpacity,
    onCommitOpacity,
    hasImage,
    onImportImage,
    onAiEdit,
    aiRunning,
    aiError,
    onAddSlice,
    aiEditModelId,
    onChangeAiEditModel,
    onGenerate3D,
    generating3D,
    has3DModel,
    sourceImageHidden,
    onToggle3DSourceImage,
    transformPivot,
    onSetTransformPivot,
    transformMode,
    onSetTransformMode,
    snapEnabled,
    onToggleSnap,
    modelTransform,
    onApplyTransform,
  } = props;

  // Local drag value: null when not dragging (use props instead)
  const [dragValue, setDragValue] = useState<number | null>(null);
  const dragging = useRef(false);
  const commitRef = useRef(0);

  // AI edit prompt panel
  const [showPrompt, _setShowPrompt] = useState(false);
  const setShowPrompt = useCallback((v: boolean | ((prev: boolean) => boolean)) => {
    _setShowPrompt((prev) => {
      const next = typeof v === "function" ? v(prev) : v;
      if (next !== prev) props.onPromptVisibilityChange?.(next);
      return next;
    });
  }, [props.onPromptVisibilityChange]);
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
        zIndex: 15,
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

      {/* Mask active toggle */}
      <button
        type="button"
        onClick={() => { onToggleMask(layerIndex); }}
        title={maskActive ? "Disable mask (operations apply to full image)" : "Enable mask (operations constrained to slice region)"}
        style={{
          background: maskActive ? "var(--hud-active)" : "none",
          border: "1px solid var(--hud-border-btn)",
          color: maskActive ? "var(--scrubber-active)" : "var(--hud-muted)",
          borderRadius: 4,
          padding: "2px 7px",
          cursor: "pointer",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: 0.3,
        }}
      >
        M
      </button>

      {/* Invert mask toggle */}
      {hasImage && (
        <button
          type="button"
          onClick={() => { onInvertMask(layerIndex); }}
          title="Invert mask (swap visible/transparent regions)"
          style={{
            background: "none",
            border: "1px solid var(--hud-border-btn)",
            color: "var(--hud-text)",
            borderRadius: 4,
            padding: "2px 7px",
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: 0.3,
          }}
        >
          ⊘
        </button>
      )}

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

      {/* Generate 3D from this slice */}
      {hasImage && (
        <button
          type="button"
          onClick={() => { onGenerate3D(layerIndex); }}
          disabled={generating3D}
          title={has3DModel ? "3D model loaded" : "Generate 3D object from this slice"}
          style={{
            background: has3DModel ? "var(--hud-active)" : "none",
            border: "1px solid var(--hud-border-btn)",
            color: generating3D ? "var(--hud-muted)" : has3DModel ? "var(--scrubber-active)" : "var(--hud-text)",
            borderRadius: 4,
            padding: "2px 7px",
            cursor: generating3D ? "wait" : "pointer",
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          {generating3D ? "⏳" : "3D"}
        </button>
      )}

      {/* Toggle source image visibility when 3D model is present */}
      {has3DModel && (
        <button
          type="button"
          onClick={() => { onToggle3DSourceImage(layerIndex); }}
          title={sourceImageHidden ? "Show source image" : "Hide source image"}
          style={{
            background: sourceImageHidden ? "var(--hud-active)" : "none",
            border: "1px solid var(--hud-border-btn)",
            color: sourceImageHidden ? "var(--scrubber-active)" : "var(--hud-text)",
            borderRadius: 4,
            padding: "2px 7px",
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          {sourceImageHidden ? "🖼" : "🖼̶"}
        </button>
      )}

      {/* Pivot mode toggle for 3D model transform */}
      {has3DModel && (
        <button
          type="button"
          onClick={() => { onSetTransformPivot(transformPivot === "center" ? "-y" : "center"); }}
          title={transformPivot === "center" ? "Switch to Pivot mode" : "Switch to Center mode"}
          style={{
            background: transformPivot !== "center" ? "var(--hud-active)" : "none",
            border: "1px solid var(--hud-border-btn)",
            color: transformPivot !== "center" ? "var(--scrubber-active)" : "var(--hud-text)",
            borderRadius: 4,
            padding: "2px 7px",
            cursor: "pointer",
            fontSize: 9,
            fontWeight: 600,
          }}
        >
          {transformPivot === "center" ? "Center" : PIVOT_FACE_LABELS[transformPivot]}
        </button>
      )}

      {/* Transform mode buttons (Translate / Rotate / Scale) */}
      {has3DModel && (
        <>
          <span style={{ width: 1, height: 16, background: "var(--hud-border)", margin: "0 2px" }} />
          {(["translate", "rotate", "scale"] as const).map((mode) => {
            const label = mode === "translate" ? "T" : mode === "rotate" ? "R" : "S";
            const active = transformMode === mode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => { onSetTransformMode(mode); }}
                title={`${mode.charAt(0).toUpperCase()}${mode.slice(1)} mode`}
                style={{
                  background: active ? "var(--hud-active)" : "none",
                  border: "1px solid var(--hud-border-btn)",
                  color: active ? "var(--scrubber-active)" : "var(--hud-text)",
                  borderRadius: 4,
                  padding: "2px 7px",
                  cursor: "pointer",
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                {label}
              </button>
            );
          })}
          {/* Snap toggle */}
          <button
            type="button"
            onClick={onToggleSnap}
            title={snapEnabled ? "Disable snapping" : "Enable snapping"}
            style={{
              background: snapEnabled ? "var(--hud-active)" : "none",
              border: "1px solid var(--hud-border-btn)",
              color: snapEnabled ? "var(--scrubber-active)" : "var(--hud-muted)",
              borderRadius: 4,
              padding: "2px 7px",
              cursor: "pointer",
              fontSize: 9,
              fontWeight: 600,
            }}
          >
            ⊞
          </button>
        </>
      )}

      {/* Transform values panel (editable, shows above HUD when 3D model present) */}
      {has3DModel && modelTransform && (
        <TransformPanel transform={modelTransform} onApply={onApplyTransform} />
      )}

      {/* AI prompt panel (shows above the HUD row) */}
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
            maxWidth: "min(360px, 60vw)",
            zIndex: 85,
            pointerEvents: "auto",
          }}
        >
          <label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ opacity: 0.6 }}>Model</span>
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
              color: "var(--btn-primary-text)",
              cursor: aiRunning ? "wait" : "pointer",
              fontWeight: 600,
              fontSize: 12,
            }}
          >
            {aiRunning ? "Running…" : "Run AI Edit"}
          </button>
          {aiError && (
            <div
              style={{
                color: "var(--color-error)",
                fontSize: 11,
                wordBreak: "break-word",
                userSelect: "text",
                cursor: "text",
                maxHeight: 80,
                overflowY: "auto",
              }}
            >
              {aiError}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
