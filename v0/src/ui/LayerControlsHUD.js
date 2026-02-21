import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useRef, useState } from "react";
import { AI_EDIT_MODELS, getAiEditModel } from "../services/falProxy";
import { PIVOT_FACE_LABELS } from "./SpaceViewport";
function clamp01(v) {
    return Math.max(0, Math.min(1, v));
}
const txInputStyle = {
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
function TransformInput({ value, step, suffix, onChange, }) {
    const [editing, setEditing] = useState(false);
    const [text, setText] = useState("");
    const display = suffix ? `${value.toFixed(step < 1 ? 2 : 1)}${suffix}` : value.toFixed(step < 1 ? 2 : 1);
    if (!editing) {
        return (_jsx("span", { style: { ...txInputStyle, cursor: "text", userSelect: "none" }, onClick: () => { setEditing(true); setText(String(value)); }, title: "Click to edit", children: display }));
    }
    return (_jsx("input", { type: "number", step: step, value: text, autoFocus: true, style: txInputStyle, onChange: (e) => { setText(e.target.value); }, onKeyDown: (e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
                const v = parseFloat(text);
                if (Number.isFinite(v))
                    onChange(v);
                setEditing(false);
            }
            else if (e.key === "Escape") {
                setEditing(false);
            }
        }, onBlur: () => {
            const v = parseFloat(text);
            if (Number.isFinite(v))
                onChange(v);
            setEditing(false);
        } }));
}
/** Editable transform panel showing position, rotation, scale. */
export function TransformPanel({ transform, onApply, style, }) {
    const update = (field, axis, value) => {
        const next = { ...transform, [field]: [...transform[field]] };
        next[field][axis] = parseFloat(value.toFixed(3));
        onApply(next);
    };
    return (_jsxs("div", { style: {
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
        }, children: [_jsx("span", { style: { opacity: 0.5 } }), _jsx("span", { style: { opacity: 0.5, textAlign: "center" }, children: "X" }), _jsx("span", { style: { opacity: 0.5, textAlign: "center" }, children: "Y" }), _jsx("span", { style: { opacity: 0.5, textAlign: "center" }, children: "Z" }), _jsx("span", { style: { opacity: 0.5 }, children: "Pos" }), [0, 1, 2].map((i) => (_jsx(TransformInput, { value: transform.position[i], step: 0.05, onChange: (v) => { update("position", i, v); } }, `p${String(i)}`))), _jsx("span", { style: { opacity: 0.5 }, children: "Rot" }), [0, 1, 2].map((i) => (_jsx(TransformInput, { value: transform.rotation[i], step: 1, suffix: "\u00B0", onChange: (v) => { update("rotation", i, v); } }, `r${String(i)}`))), _jsx("span", { style: { opacity: 0.5 }, children: "Scl" }), [0, 1, 2].map((i) => (_jsx(TransformInput, { value: transform.scale[i], step: 0.05, onChange: (v) => { update("scale", i, v); } }, `s${String(i)}`)))] }));
}
export default function LayerControlsHUD(props) {
    const { layerIndex, isHidden, isSolo, maskActive, opacity, onToggleHidden, onToggleSolo, onToggleMask, onInvertMask, onPreviewOpacity, onCommitOpacity, hasImage, onImportImage, onAiEdit, aiRunning, aiError, onAddSlice, aiEditModelId, onChangeAiEditModel, onGenerate3D, generating3D, has3DModel, sourceImageHidden, onToggle3DSourceImage, transformPivot, onSetTransformPivot, transformMode, onSetTransformMode, snapEnabled, onToggleSnap, modelTransform, onApplyTransform, } = props;
    // Local drag value: null when not dragging (use props instead)
    const [dragValue, setDragValue] = useState(null);
    const dragging = useRef(false);
    const commitRef = useRef(0);
    // AI edit prompt panel
    const [showPrompt, _setShowPrompt] = useState(false);
    const setShowPrompt = useCallback((v) => {
        _setShowPrompt((prev) => {
            const next = typeof v === "function" ? v(prev) : v;
            if (next !== prev)
                props.onPromptVisibilityChange?.(next);
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
    const handleChange = useCallback((e) => {
        const v = clamp01(Number(e.target.value) / 100);
        setDragValue(v);
        commitRef.current = v;
        onPreviewOpacity(v);
    }, [onPreviewOpacity]);
    const handlePointerDown = useCallback(() => {
        dragging.current = true;
        commitRef.current = effectiveOpacity;
    }, [effectiveOpacity]);
    // Window-level pointerup so commit fires even if pointer leaves the slider
    useEffect(() => {
        const handlePointerUp = () => {
            if (!dragging.current)
                return;
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
    return (_jsxs("div", { className: "layer-controls-hud", style: {
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
        }, children: [_jsxs("span", { style: { opacity: 0.6, marginRight: 2 }, children: ["L", layerIndex] }), _jsx("button", { type: "button", onClick: () => { onToggleHidden(layerIndex); }, title: isHidden ? "Show layer" : "Hide layer", style: {
                    background: "none",
                    border: "1px solid var(--hud-border-btn)",
                    color: isHidden ? "var(--hud-muted)" : "var(--hud-text)",
                    borderRadius: 4,
                    padding: "2px 7px",
                    cursor: "pointer",
                    fontSize: 13,
                }, children: isHidden ? "◻" : "👁" }), _jsx("button", { type: "button", onClick: () => { onToggleSolo(layerIndex); }, title: isSolo ? "Unsolo" : "Solo this layer", style: {
                    background: isSolo ? "var(--hud-active)" : "none",
                    border: "1px solid var(--hud-border-btn)",
                    color: isSolo ? "var(--scrubber-active)" : "var(--hud-text)",
                    borderRadius: 4,
                    padding: "2px 7px",
                    cursor: "pointer",
                    fontSize: 13,
                }, children: "S" }), _jsx("button", { type: "button", onClick: () => { onToggleMask(layerIndex); }, title: maskActive ? "Disable mask (operations apply to full image)" : "Enable mask (operations constrained to slice region)", style: {
                    background: maskActive ? "var(--hud-active)" : "none",
                    border: "1px solid var(--hud-border-btn)",
                    color: maskActive ? "var(--scrubber-active)" : "var(--hud-muted)",
                    borderRadius: 4,
                    padding: "2px 7px",
                    cursor: "pointer",
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: 0.3,
                }, children: "M" }), hasImage && (_jsx("button", { type: "button", onClick: () => { onInvertMask(layerIndex); }, title: "Invert mask (swap visible/transparent regions)", style: {
                    background: "none",
                    border: "1px solid var(--hud-border-btn)",
                    color: "var(--hud-text)",
                    borderRadius: 4,
                    padding: "2px 7px",
                    cursor: "pointer",
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: 0.3,
                }, children: "\u2298" })), _jsx("input", { "data-testid": "opacity-slider", type: "range", min: 0, max: 100, step: 1, value: displayPct, onChange: handleChange, onPointerDown: handlePointerDown, style: {
                    width: 80,
                    accentColor: "var(--scrubber-active)",
                    cursor: "pointer",
                }, title: `Opacity: ${String(displayPct)}%` }), _jsxs("span", { style: { opacity: 0.5, minWidth: 30, textAlign: "right" }, children: [displayPct, "%"] }), _jsx("span", { style: { width: 1, height: 16, background: "var(--hud-border)", margin: "0 2px" } }), _jsx("button", { type: "button", onClick: onAddSlice, title: "Add a new slice", style: {
                    background: "none",
                    border: "1px solid var(--hud-border-btn)",
                    color: "var(--hud-text)",
                    borderRadius: 4,
                    padding: "2px 7px",
                    cursor: "pointer",
                    fontSize: 13,
                }, children: "\uFF0B" }), _jsx("button", { type: "button", onClick: onImportImage, title: "Import image onto this layer", style: {
                    background: "none",
                    border: "1px solid var(--hud-border-btn)",
                    color: "var(--hud-text)",
                    borderRadius: 4,
                    padding: "2px 7px",
                    cursor: "pointer",
                    fontSize: 13,
                }, children: "\uD83D\uDCE5" }), hasImage && (_jsx("button", { type: "button", onClick: () => { setShowPrompt((v) => !v); }, disabled: aiRunning, title: "AI Edit (img2img)", style: {
                    background: showPrompt ? "var(--hud-active)" : "none",
                    border: "1px solid var(--hud-border-btn)",
                    color: aiRunning ? "var(--hud-muted)" : "var(--scrubber-active)",
                    borderRadius: 4,
                    padding: "2px 7px",
                    cursor: aiRunning ? "wait" : "pointer",
                    fontSize: 13,
                }, children: aiRunning ? "⏳" : "✨" })), hasImage && (_jsx("button", { type: "button", onClick: () => { onGenerate3D(layerIndex); }, disabled: generating3D, title: has3DModel ? "3D model loaded" : "Generate 3D object from this slice", style: {
                    background: has3DModel ? "var(--hud-active)" : "none",
                    border: "1px solid var(--hud-border-btn)",
                    color: generating3D ? "var(--hud-muted)" : has3DModel ? "var(--scrubber-active)" : "var(--hud-text)",
                    borderRadius: 4,
                    padding: "2px 7px",
                    cursor: generating3D ? "wait" : "pointer",
                    fontSize: 11,
                    fontWeight: 600,
                }, children: generating3D ? "⏳" : "3D" })), has3DModel && (_jsx("button", { type: "button", onClick: () => { onToggle3DSourceImage(layerIndex); }, title: sourceImageHidden ? "Show source image" : "Hide source image", style: {
                    background: sourceImageHidden ? "var(--hud-active)" : "none",
                    border: "1px solid var(--hud-border-btn)",
                    color: sourceImageHidden ? "var(--scrubber-active)" : "var(--hud-text)",
                    borderRadius: 4,
                    padding: "2px 7px",
                    cursor: "pointer",
                    fontSize: 11,
                    fontWeight: 600,
                }, children: sourceImageHidden ? "🖼" : "🖼̶" })), has3DModel && (_jsx("button", { type: "button", onClick: () => { onSetTransformPivot(transformPivot === "center" ? "-y" : "center"); }, title: transformPivot === "center" ? "Switch to Pivot mode" : "Switch to Center mode", style: {
                    background: transformPivot !== "center" ? "var(--hud-active)" : "none",
                    border: "1px solid var(--hud-border-btn)",
                    color: transformPivot !== "center" ? "var(--scrubber-active)" : "var(--hud-text)",
                    borderRadius: 4,
                    padding: "2px 7px",
                    cursor: "pointer",
                    fontSize: 9,
                    fontWeight: 600,
                }, children: transformPivot === "center" ? "Center" : PIVOT_FACE_LABELS[transformPivot] })), has3DModel && (_jsxs(_Fragment, { children: [_jsx("span", { style: { width: 1, height: 16, background: "var(--hud-border)", margin: "0 2px" } }), ["translate", "rotate", "scale"].map((mode) => {
                        const label = mode === "translate" ? "T" : mode === "rotate" ? "R" : "S";
                        const active = transformMode === mode;
                        return (_jsx("button", { type: "button", onClick: () => { onSetTransformMode(mode); }, title: `${mode.charAt(0).toUpperCase()}${mode.slice(1)} mode`, style: {
                                background: active ? "var(--hud-active)" : "none",
                                border: "1px solid var(--hud-border-btn)",
                                color: active ? "var(--scrubber-active)" : "var(--hud-text)",
                                borderRadius: 4,
                                padding: "2px 7px",
                                cursor: "pointer",
                                fontSize: 11,
                                fontWeight: 600,
                            }, children: label }, mode));
                    }), _jsx("button", { type: "button", onClick: onToggleSnap, title: snapEnabled ? "Disable snapping" : "Enable snapping", style: {
                            background: snapEnabled ? "var(--hud-active)" : "none",
                            border: "1px solid var(--hud-border-btn)",
                            color: snapEnabled ? "var(--scrubber-active)" : "var(--hud-muted)",
                            borderRadius: 4,
                            padding: "2px 7px",
                            cursor: "pointer",
                            fontSize: 9,
                            fontWeight: 600,
                        }, children: "\u229E" })] })), has3DModel && modelTransform && (_jsx(TransformPanel, { transform: modelTransform, onApply: onApplyTransform })), showPrompt && (_jsxs("div", { style: {
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
                }, children: [_jsxs("label", { style: { display: "flex", flexDirection: "column", gap: 2 }, children: [_jsx("span", { style: { opacity: 0.6 }, children: "Model" }), _jsx("select", { value: aiEditModelId, onChange: (e) => { onChangeAiEditModel(e.target.value); }, style: {
                                    background: "var(--hud-active)",
                                    border: "1px solid var(--hud-border-btn)",
                                    borderRadius: 4,
                                    padding: "4px 6px",
                                    color: "var(--hud-text)",
                                    fontSize: 12,
                                    outline: "none",
                                }, children: AI_EDIT_MODELS.map((m) => (_jsx("option", { value: m.id, children: m.label }, m.id))) })] }), _jsxs("label", { style: { display: "flex", flexDirection: "column", gap: 2 }, children: [_jsx("span", { style: { opacity: 0.6 }, children: "Prompt" }), _jsx("input", { type: "text", value: promptText, onChange: (e) => { setPromptText(e.target.value); }, onKeyDown: (e) => {
                                    e.stopPropagation();
                                    if (e.key === "Enter" && promptText.trim() && !aiRunning) {
                                        onAiEdit(promptText.trim(), strength);
                                    }
                                }, placeholder: "Describe the edit...", style: {
                                    background: "var(--hud-active)",
                                    border: "1px solid var(--hud-border-btn)",
                                    borderRadius: 4,
                                    padding: "4px 6px",
                                    color: "var(--hud-text)",
                                    fontSize: 12,
                                    outline: "none",
                                } })] }), getAiEditModel(aiEditModelId).hasStrength && (_jsxs("label", { style: { display: "flex", alignItems: "center", gap: 6 }, children: [_jsx("span", { style: { opacity: 0.6, minWidth: 52 }, children: "Strength" }), _jsx("input", { type: "range", min: 0, max: 100, step: 1, value: Math.round(strength * 100), onChange: (e) => { setStrength(Number(e.target.value) / 100); }, onKeyDown: (e) => { e.stopPropagation(); }, style: { flex: 1, accentColor: "var(--scrubber-active)", cursor: "pointer" } }), _jsxs("span", { style: { opacity: 0.5, minWidth: 30, textAlign: "right" }, children: [Math.round(strength * 100), "%"] })] })), _jsx("button", { type: "button", disabled: !promptText.trim() || aiRunning, onClick: () => {
                            if (promptText.trim())
                                onAiEdit(promptText.trim(), strength);
                        }, style: {
                            background: aiRunning ? "var(--hud-muted)" : "var(--scrubber-active)",
                            border: "none",
                            borderRadius: 4,
                            padding: "5px 10px",
                            color: "var(--btn-primary-text)",
                            cursor: aiRunning ? "wait" : "pointer",
                            fontWeight: 600,
                            fontSize: 12,
                        }, children: aiRunning ? "Running…" : "Run AI Edit" }), aiError && (_jsx("div", { style: {
                            color: "var(--color-error)",
                            fontSize: 11,
                            wordBreak: "break-word",
                            userSelect: "text",
                            cursor: "text",
                            maxHeight: 80,
                            overflowY: "auto",
                        }, children: aiError }))] }))] }));
}
