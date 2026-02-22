import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyPatch, findLayerSelection, findLayerProps, findLayerOrder, findLayerRender, findLayerGlb, layerPayloadId, defaultLayerOrder, serializeOrder, isHidden, isMaskActive, isMaskInverted, opacityMultiplier, soloIndex, layerName, makeId, newPatch, putOp, delOp, sha256Hex, sampleProject, createSampleProject, loadProjectState, rehydrateBlobs, saveProjectState, clearProjectState, getOperation, loadPreferences, savePreferences, } from "./core";
import { findPortalEdges, findAIHistory, findSliceIds } from "./core";
import { createSpaceAIHistory, ensureHistoryGraphForSlice, addOpResultToGraph, setDisplayCursor, setOperationCursor, serializeAIHistory, SPACE_AI_HISTORY_SCHEMA, } from "./core/history/historyGraph";
import { runTextToImg, runNanoBananaEdit, runFlux2Edit, runInpainting, extractSliceMaskForInpaint, fetchImageBlob, invertAlpha, invertMaskWithOriginal, getAiEditModel, combineMasksToOriginal, refitAiResult, runImageTo3D, runBackgroundRemoval } from "./services/falProxy";
import { runOperation } from "./services/operationRunner";
import SpaceViewport from "./ui/SpaceViewport";
import SpaceAddressHUD from "./slice8/SpaceAddressHUD";
import { useSpaceNav } from "./slice8/useSpaceNav";
import PortalOverlay from "./ui/PortalOverlay";
import ViewModeSwitcher from "./ui/ViewModeSwitcher";
import TabulaRasa from "./ui/TabulaRasa";
import ImageIngestPanel from "./ui/ImageIngestPanel";
import OperationProgressHUD from "./ui/OperationProgressHUD";
import SlicingOverlay from "./ui/SlicingOverlay";
import SettingsPanel from "./ui/SettingsPanel";
import MaskPickerPanel from "./ui/MaskPickerPanel";
import { useUIStyle } from "./ui/uiStyleStore";
const MAX_UNDO = 100;
export default function App() {
    const [state, setState] = useState(() => loadProjectState() ?? sampleProject.state);
    // Rehydrate large blobs from IndexedDB after initial sync load
    useEffect(() => {
        let cancelled = false;
        void rehydrateBlobs(state).then((rehydrated) => {
            if (!cancelled && rehydrated !== state) {
                setState(rehydrated);
            }
        });
        return () => { cancelled = true; };
        // Only run once on mount
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const pastRef = useRef([]);
    const futureRef = useRef([]);
    const [undoCount, setUndoCount] = useState(0);
    const [redoCount, setRedoCount] = useState(0);
    const [previewLayerIndex, setPreviewLayerIndex] = useState(null);
    const [previewOpacity, setPreviewOpacity] = useState(null);
    const [previewOrder, setPreviewOrder] = useState(null);
    const [animPhase, setAnimPhase] = useState("intro");
    const [isTopDown, setIsTopDown] = useState(false);
    const [viewMode, setViewMode] = useState("universal");
    const [peekLayers, setPeekLayers] = useState(false);
    const [peekRail, setPeekRail] = useState(false);
    // ── Tabula Rasa / Ingest / Settings state ──
    const [showIngest, setShowIngest] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [preferences, setPreferences] = useState(loadPreferences);
    const [opProgress, setOpProgress] = useState(null);
    const [opLabel, setOpLabel] = useState("");
    /** Last completed operation result — persists after HUD is dismissed so the user can recall it. */
    const [lastOpResult, setLastOpResult] = useState(null);
    /** Image URL shown in the slicing overlay while the initial operation runs. */
    const [slicingImageUrl, setSlicingImageUrl] = useState(null);
    /** Stores the last ingest context so the Retry button can re-run the operation without re-ingesting. */
    const lastIngestRef = useRef(null);
    /** Segment display mode: masked original or colored silhouettes. */
    const [segmentDisplayMode, setSegmentDisplayMode] = useState("masked");
    /** Reveal animation: triggers when new slices are added after segmentation. */
    const [revealActive, setRevealActive] = useState(false);
    /** SAM2 mask candidates from the last segmentation — for the mask picker. */
    const [maskCandidates, setMaskCandidates] = useState([]);
    /** Whether the mask picker panel is visible. */
    const [showMaskPicker, setShowMaskPicker] = useState(false);
    /** Whether a combine operation is in progress. */
    const [combining, setCombining] = useState(false);
    /** Layer index currently generating 3D (null when idle). */
    const [generating3DLayer, setGenerating3DLayer] = useState(null);
    /** GLB data URLs keyed by layer index — when a layer has a 3D model. */
    const [layerGlbUrls, setLayerGlbUrls] = useState({});
    /** Set of layer indices whose source image is hidden during/after 3D generation. */
    const [threeDSourceHidden, setThreeDSourceHidden] = useState(new Set());
    /** Is the project in "tabula rasa" state — no meaningful content yet? */
    const isTabulaRasa = useMemo(() => {
        return Object.keys(state.payloads).length === 0;
    }, [state.payloads]);
    /* ── Way-of-Code style template ─────────────── */
    const template = useUIStyle((s) => s.template);
    // Chrome visibility is driven via DOM class to avoid re-rendering the entire App
    const headerRef = useRef(null);
    useEffect(() => {
        const unsub = useUIStyle.subscribe((s) => {
            const show = s.template.ui.showChrome || s.chromeVisible;
            headerRef.current?.parentElement?.classList.toggle("chrome-visible", show);
        });
        // Set initial state
        const s = useUIStyle.getState();
        const show = s.template.ui.showChrome || s.chromeVisible;
        headerRef.current?.parentElement?.classList.toggle("chrome-visible", show);
        return unsub;
    }, []);
    const rootSpaceId = state.manifest.rootSpaceId;
    const spaceNav = useSpaceNav(rootSpaceId);
    const activeSpaceId = spaceNav.current;
    // Keep navigation aligned with the current root space after resets.
    useEffect(() => {
        void spaceNav.navigateTo(rootSpaceId);
    }, [rootSpaceId, spaceNav]);
    // Trigger camera transition whenever the active space changes (covers browser back/forward)
    const prevActiveRef = useRef(activeSpaceId);
    useEffect(() => {
        if (activeSpaceId !== prevActiveRef.current) {
            prevActiveRef.current = activeSpaceId;
            setAnimPhase("spaceTransition");
        }
    }, [activeSpaceId]);
    /** Central commit: applies a patch, pushes to undo stack, clears redo, persists. */
    const commitPatch = useCallback((patchBuilder) => {
        setState((prev) => {
            try {
                const patch = patchBuilder(prev);
                if (!patch)
                    return prev;
                const next = applyPatch(prev, patch);
                pastRef.current = [...pastRef.current.slice(-(MAX_UNDO - 1)), prev];
                futureRef.current = [];
                saveProjectState(next);
                // Schedule counter updates outside of setState
                queueMicrotask(() => {
                    setUndoCount(pastRef.current.length);
                    setRedoCount(0);
                });
                return next;
            }
            catch (err) {
                console.error("[commitPatch] FAILED:", err);
                return prev;
            }
        });
    }, []);
    const handleUndo = useCallback(() => {
        setState((prev) => {
            const past = pastRef.current;
            const restored = past[past.length - 1];
            if (!restored)
                return prev;
            pastRef.current = past.slice(0, -1);
            futureRef.current = [prev, ...futureRef.current];
            saveProjectState(restored);
            queueMicrotask(() => {
                setUndoCount(pastRef.current.length);
                setRedoCount(futureRef.current.length);
            });
            return restored;
        });
    }, []);
    const handleRedo = useCallback(() => {
        setState((prev) => {
            const future = futureRef.current;
            const restored = future[0];
            if (!restored)
                return prev;
            futureRef.current = future.slice(1);
            pastRef.current = [...pastRef.current, prev];
            saveProjectState(restored);
            queueMicrotask(() => {
                setUndoCount(pastRef.current.length);
                setRedoCount(futureRef.current.length);
            });
            return restored;
        });
    }, []);
    const handleAnimDone = useCallback(() => {
        setAnimPhase((prev) => {
            if (prev === "toTopDown")
                setIsTopDown(true);
            else if (prev === "toIso" || prev === "intro")
                setIsTopDown(false);
            // reset ends at iso
            else if (prev === "reset")
                setIsTopDown(false);
            // space transition ends at iso
            else if (prev === "spaceTransition")
                setIsTopDown(false);
            return "idle";
        });
    }, []);
    const handleResetView = useCallback(() => {
        setAnimPhase("reset");
    }, []);
    const handleToggleView = useCallback(() => {
        setAnimPhase(isTopDown ? "toIso" : "toTopDown");
    }, [isTopDown]);
    /** Switch view mode, clearing all transient preview state so views don't conflict. */
    const handleSetViewMode = useCallback((mode) => {
        setPreviewLayerIndex(null);
        setPreviewOpacity(null);
        setPreviewOrder(null);
        setViewMode(mode);
    }, []);
    /** Navigate to a different space via portal entry. Camera transition handled by activeSpaceId effect. */
    const handleNavigateToSpace = useCallback((spaceId) => {
        if (!state.spaces[spaceId])
            return; // target must exist
        void spaceNav.navigateTo(spaceId);
    }, [state.spaces, spaceNav]);
    // activeSpaceId comes from spaceNav (declared above); rootSpaceId also above
    const activeSpace = state.spaces[activeSpaceId];
    const selection = useMemo(() => findLayerSelection(state, activeSpaceId), [state, activeSpaceId]);
    const effectiveSelectedIndex = previewLayerIndex ?? selection?.index ?? null;
    const layerProps = useMemo(() => findLayerProps(state, activeSpaceId), [state, activeSpaceId]);
    const persistedLayerOrder = useMemo(() => {
        const found = findLayerOrder(state, activeSpaceId);
        return found ? found : null;
    }, [state, activeSpaceId]);
    // Build per-layer visibility/opacity for SpaceViewport
    const layerCount = activeSpace?.layerCount ?? 1;
    // Clean up stale React state when layerCount decreases (e.g. via undo)
    useEffect(() => {
        setLayerGlbUrls((prev) => {
            const stale = Object.keys(prev).filter((k) => Number(k) >= layerCount);
            if (stale.length === 0)
                return prev;
            const next = { ...prev };
            for (const k of stale) {
                URL.revokeObjectURL(next[Number(k)]);
                delete next[Number(k)];
            }
            return next;
        });
        setThreeDSourceHidden((prev) => {
            let changed = false;
            const next = new Set();
            for (const idx of prev) {
                if (idx >= layerCount) {
                    changed = true;
                    continue;
                }
                next.add(idx);
            }
            return changed ? next : prev;
        });
    }, [layerCount]);
    const effectiveOrder = previewOrder ?? persistedLayerOrder?.order ?? defaultLayerOrder(layerCount);
    const solo = soloIndex(layerProps, layerCount);
    /** Build a map of layer index → user-assigned name (or default). */
    const layerNames = useMemo(() => {
        const result = {};
        for (let i = 0; i < layerCount; i++) {
            result[i] = layerName(layerProps, i) ?? `Layer ${String(i)}`;
        }
        return result;
    }, [layerCount, layerProps]);
    const layerVisibility = useMemo(() => {
        const result = [];
        for (let i = 0; i < layerCount; i++) {
            let visible = true;
            if (solo !== null) {
                visible = i === solo;
            }
            else if (isHidden(layerProps, i, layerCount)) {
                visible = false;
            }
            const selected = i === effectiveSelectedIndex;
            const baseOpacity = selected ? 0.30 : 0.10;
            let mult = opacityMultiplier(layerProps, i, layerCount);
            // Use preview opacity for the selected layer while dragging
            if (selected && previewOpacity !== null) {
                mult = previewOpacity;
            }
            const finalOpacity = baseOpacity * mult;
            // Texture opacity: user's multiplier directly (not mixed with base tint)
            const texOpacity = !visible ? Math.max(mult * 0.35, 0.06) : mult;
            result.push({ visible, opacity: finalOpacity, textureOpacity: texOpacity });
        }
        return result;
    }, [layerCount, solo, layerProps, effectiveSelectedIndex, previewOpacity]);
    /* ── Layer props helpers ──────────────────────── */
    const emitPropsUpdate = useCallback((updater) => {
        commitPatch((prev) => {
            const existing = findLayerProps(prev, activeSpaceId);
            const annId = existing
                ? existing.annotationId
                : makeId("annotation");
            const currentData = existing ? { ...existing.annotation.data } : {};
            const newData = updater(currentData);
            // If no keys remain, delete the annotation entirely
            if (Object.keys(newData).length === 0 && existing) {
                return newPatch({
                    baseRevision: prev.revision,
                    ops: [delOp("Annotation", annId)],
                });
            }
            const annotationValue = {
                id: annId,
                kind: "Annotation",
                target: { kind: "Space", id: activeSpaceId },
                schema: "ui.layers.props",
                data: newData,
                createdAt: new Date().toISOString(),
            };
            return newPatch({
                baseRevision: prev.revision,
                ops: [putOp("Annotation", annId, annotationValue)],
            });
        });
    }, [activeSpaceId, commitPatch]);
    const handleToggleHidden = useCallback((index) => {
        emitPropsUpdate((data) => {
            const key = `hidden.${String(index)}`;
            if (data[key] === "true") {
                return Object.fromEntries(Object.entries(data).filter(([k]) => k !== key));
            }
            return { ...data, [key]: "true" };
        });
    }, [emitPropsUpdate]);
    const handleToggleSolo = useCallback((index) => {
        emitPropsUpdate((data) => {
            if (data["solo"] === String(index)) {
                return Object.fromEntries(Object.entries(data).filter(([k]) => k !== "solo"));
            }
            return { ...data, solo: String(index) };
        });
    }, [emitPropsUpdate]);
    /** Rename a layer (set or clear the user-assigned name). */
    const handleRenameLayer = useCallback((index, name) => {
        emitPropsUpdate((data) => {
            const key = `name.${String(index)}`;
            const trimmed = name.trim();
            // If the name equals the default, remove it
            if (!trimmed || trimmed === `Layer ${String(index)}`) {
                return Object.fromEntries(Object.entries(data).filter(([k]) => k !== key));
            }
            return { ...data, [key]: trimmed };
        });
    }, [emitPropsUpdate]);
    const handleToggleMask = useCallback((index) => {
        emitPropsUpdate((data) => {
            const key = `maskActive.${String(index)}`;
            const currently = data[key] !== "false"; // default true
            if (currently) {
                return { ...data, [key]: "false" };
            }
            return Object.fromEntries(Object.entries(data).filter(([k]) => k !== key));
        });
    }, [emitPropsUpdate]);
    const handleCommitOrder = useCallback((order) => {
        // If it's the default order, delete the annotation instead
        const isDefault = order.every((v, i) => v === i);
        commitPatch((prev) => {
            const existing = findLayerOrder(prev, activeSpaceId);
            if (isDefault) {
                if (!existing)
                    return null;
                return newPatch({
                    baseRevision: prev.revision,
                    ops: [delOp("Annotation", existing.annotationId)],
                });
            }
            const annId = existing
                ? existing.annotationId
                : makeId("annotation");
            const annotationValue = {
                id: annId,
                kind: "Annotation",
                target: { kind: "Space", id: activeSpaceId },
                schema: "ui.layers.order",
                data: { order: serializeOrder(order) },
                createdAt: new Date().toISOString(),
            };
            return newPatch({
                baseRevision: prev.revision,
                ops: [putOp("Annotation", annId, annotationValue)],
            });
        });
    }, [activeSpaceId, commitPatch]);
    const handleCommitOpacity = useCallback((index, value) => {
        setPreviewOpacity(null);
        emitPropsUpdate((data) => {
            const key = `opacity.${String(index)}`;
            if (Math.abs(value - 1.0) < 0.01) {
                return Object.fromEntries(Object.entries(data).filter(([k]) => k !== key));
            }
            return { ...data, [key]: String(value) };
        });
    }, [emitPropsUpdate]);
    const handleSelectLayer = useCallback((index) => {
        setPreviewOpacity(null);
        commitPatch((prev) => {
            const space = prev.spaces[activeSpaceId];
            if (!space || index < 0 || index >= space.layerCount)
                return null;
            const existing = findLayerSelection(prev, activeSpaceId);
            const annId = existing
                ? existing.annotationId
                : makeId("annotation");
            const annotationValue = {
                id: annId,
                kind: "Annotation",
                target: { kind: "Space", id: activeSpaceId },
                schema: "ui.selection.layerIndex",
                data: { layerIndex: String(index) },
                createdAt: new Date().toISOString(),
            };
            return newPatch({
                baseRevision: prev.revision,
                ops: [putOp("Annotation", annId, annotationValue)],
            });
        });
    }, [activeSpaceId, commitPatch]);
    const handleClearSelection = useCallback(() => {
        setPreviewOpacity(null);
        commitPatch((prev) => {
            const existing = findLayerSelection(prev, activeSpaceId);
            if (!existing)
                return null;
            return newPatch({
                baseRevision: prev.revision,
                ops: [delOp("Annotation", existing.annotationId)],
            });
        });
    }, [activeSpaceId, commitPatch]);
    /** Add a new slice (layer) to the active space and select it. */
    const handleAddSlice = useCallback(() => {
        commitPatch((prev) => {
            const space = prev.spaces[activeSpaceId];
            if (!space)
                return null;
            const newCount = space.layerCount + 1;
            const newLayerIdx = space.layerCount; // 0-based, so old count = new index
            const ops = [];
            // 1. Update space with incremented layerCount
            const updatedSpace = {
                ...space,
                layerCount: newCount,
            };
            ops.push(putOp("Space", activeSpaceId, updatedSpace));
            // 2. Extend layer order if one exists (append new index at top)
            const existingOrder = findLayerOrder(prev, activeSpaceId);
            if (existingOrder) {
                const newOrder = [...existingOrder.order, newLayerIdx];
                const orderAnnotation = {
                    id: existingOrder.annotationId,
                    kind: "Annotation",
                    target: { kind: "Space", id: activeSpaceId },
                    schema: "ui.layers.order",
                    data: { order: serializeOrder(newOrder) },
                    createdAt: new Date().toISOString(),
                };
                ops.push(putOp("Annotation", existingOrder.annotationId, orderAnnotation));
            }
            // 3. Select the new layer
            const existingSel = findLayerSelection(prev, activeSpaceId);
            const selAnnId = existingSel
                ? existingSel.annotationId
                : makeId("annotation");
            const selAnnotation = {
                id: selAnnId,
                kind: "Annotation",
                target: { kind: "Space", id: activeSpaceId },
                schema: "ui.selection.layerIndex",
                data: { layerIndex: String(newLayerIdx) },
                createdAt: new Date().toISOString(),
            };
            ops.push(putOp("Annotation", selAnnId, selAnnotation));
            return newPatch({ baseRevision: prev.revision, ops });
        });
    }, [activeSpaceId, commitPatch]);
    /** Delete a layer (slice) from the active space.
     *  Decrements layerCount, re-indexes all annotation data so that
     *  higher-indexed layers shift down to fill the gap, and cleans
     *  up local React state (GLB urls, 3D source hidden set).
     *  When a segment slice (index > 0) is deleted, automatically runs
     *  inpainting on the base image to fill the removed area. */
    const handleDeleteSlice = useCallback((deleteIdx) => {
        // ── Vars to capture inside commitPatch for async inpainting ──
        let capturedOrigUri;
        let capturedOrigPid;
        let capturedDeletedUri;
        let capturedDeletedCrop;
        commitPatch((prev) => {
            const space = prev.spaces[activeSpaceId];
            if (!space)
                return null;
            if (space.layerCount <= 1)
                return null; // can't delete last layer
            if (deleteIdx < 0 || deleteIdx >= space.layerCount)
                return null;
            // Capture data for async inpainting before the patch removes it
            const renderForCapture = findLayerRender(prev, activeSpaceId);
            if (renderForCapture) {
                const origPid0 = renderForCapture.annotation.data["payload.0"];
                if (origPid0) {
                    const origP = prev.payloads[origPid0];
                    capturedOrigUri = origP?.uri;
                    capturedOrigPid = origPid0;
                }
                const delPid = renderForCapture.annotation.data[`payload.${String(deleteIdx)}`];
                if (delPid) {
                    const delP = prev.payloads[delPid];
                    capturedDeletedUri = delP?.uri;
                    if (delP?.meta.cropX !== undefined) {
                        capturedDeletedCrop = {
                            cropX: Number(delP.meta.cropX),
                            cropY: Number(delP.meta.cropY),
                            cropW: Number(delP.meta.cropW),
                            cropH: Number(delP.meta.cropH),
                            origW: Number(delP.meta.origW),
                            origH: Number(delP.meta.origH),
                        };
                    }
                }
            }
            const oldCount = space.layerCount;
            const newCount = oldCount - 1;
            const ops = [];
            // Helper: shift layer index past the deleted one
            const shift = (i) => (i > deleteIdx ? i - 1 : i);
            // 1. Update space with decremented layerCount
            ops.push(putOp("Space", activeSpaceId, { ...space, layerCount: newCount }));
            // 2. Re-index render annotation (payload.{i} → PayloadId)
            const existingRender = findLayerRender(prev, activeSpaceId);
            // Capture the deleted layer's payload ID for cleanup
            const deletedPayloadId = existingRender?.annotation.data[`payload.${String(deleteIdx)}`];
            if (existingRender) {
                const newData = {};
                for (let i = 0; i < oldCount; i++) {
                    if (i === deleteIdx)
                        continue;
                    const pid = existingRender.annotation.data[`payload.${String(i)}`];
                    if (pid)
                        newData[`payload.${String(shift(i))}`] = pid;
                }
                // Remove the deleted layer's Payload entity if it's no longer used
                if (deletedPayloadId) {
                    const stillUsed = Object.values(newData).includes(deletedPayloadId);
                    if (!stillUsed) {
                        ops.push(delOp("Payload", deletedPayloadId));
                    }
                }
                ops.push(putOp("Annotation", existingRender.annotationId, {
                    id: existingRender.annotationId,
                    kind: "Annotation",
                    target: { kind: "Space", id: activeSpaceId },
                    schema: "ui.layers.render",
                    data: newData,
                    createdAt: new Date().toISOString(),
                }));
            }
            // 3. Re-index layer order
            const existingOrder = findLayerOrder(prev, activeSpaceId);
            if (existingOrder) {
                const newOrder = existingOrder.order
                    .filter((i) => i !== deleteIdx)
                    .map(shift);
                ops.push(putOp("Annotation", existingOrder.annotationId, {
                    id: existingOrder.annotationId,
                    kind: "Annotation",
                    target: { kind: "Space", id: activeSpaceId },
                    schema: "ui.layers.order",
                    data: { order: serializeOrder(newOrder) },
                    createdAt: new Date().toISOString(),
                }));
            }
            // 4. Re-index layer props (hidden.{i}, maskActive.{i}, etc.)
            const existingProps = findLayerProps(prev, activeSpaceId);
            if (existingProps) {
                const newData = {};
                const prefixes = ["hidden", "maskActive", "maskInverted", "opacity", "name"];
                for (const [key, val] of Object.entries(existingProps.annotation.data)) {
                    // Check if this is a per-layer key (prefix.N)
                    const dot = key.lastIndexOf(".");
                    if (dot === -1) {
                        // Non-indexed key like "solo"
                        if (key === "solo") {
                            const soloIdx = Number(val);
                            if (Number.isFinite(soloIdx)) {
                                if (soloIdx === deleteIdx)
                                    continue; // clear solo if deleted
                                newData[key] = String(shift(soloIdx));
                            }
                        }
                        else {
                            newData[key] = val;
                        }
                        continue;
                    }
                    const prefix = key.slice(0, dot);
                    const idxStr = key.slice(dot + 1);
                    const idx = Number(idxStr);
                    if (!prefixes.includes(prefix) || !Number.isFinite(idx)) {
                        newData[key] = val;
                        continue;
                    }
                    if (idx === deleteIdx)
                        continue; // drop deleted layer props
                    newData[`${prefix}.${String(shift(idx))}`] = val;
                }
                ops.push(putOp("Annotation", existingProps.annotationId, {
                    id: existingProps.annotationId,
                    kind: "Annotation",
                    target: { kind: "Space", id: activeSpaceId },
                    schema: "ui.layers.props",
                    data: newData,
                    createdAt: new Date().toISOString(),
                }));
            }
            // 5. Re-index GLB annotation (glb.{i} → PayloadId)
            const existingGlb = findLayerGlb(prev, activeSpaceId);
            if (existingGlb) {
                const newData = {};
                for (let i = 0; i < oldCount; i++) {
                    if (i === deleteIdx)
                        continue;
                    const pid = existingGlb.annotation.data[`glb.${String(i)}`];
                    if (pid)
                        newData[`glb.${String(shift(i))}`] = pid;
                }
                if (Object.keys(newData).length === 0) {
                    ops.push(delOp("Annotation", existingGlb.annotationId));
                }
                else {
                    ops.push(putOp("Annotation", existingGlb.annotationId, {
                        id: existingGlb.annotationId,
                        kind: "Annotation",
                        target: { kind: "Space", id: activeSpaceId },
                        schema: "ui.layers.glb",
                        data: newData,
                        createdAt: new Date().toISOString(),
                    }));
                }
            }
            // 6. Re-index slice IDs (array of stable IDs)
            const existingSliceIds = findSliceIds(prev, activeSpaceId);
            const deletedSliceId = existingSliceIds?.ids[deleteIdx];
            if (existingSliceIds) {
                const newIds = existingSliceIds.ids.filter((_, i) => i !== deleteIdx);
                ops.push(putOp("Annotation", existingSliceIds.annotationId, {
                    id: existingSliceIds.annotationId,
                    kind: "Annotation",
                    target: { kind: "Space", id: activeSpaceId },
                    schema: "ui.layers.sliceIds",
                    data: { ids: JSON.stringify(newIds) },
                    createdAt: new Date().toISOString(),
                }));
            }
            // 6b. Remove the deleted slice's graph from AI history
            if (deletedSliceId) {
                const existingHist = findAIHistory(prev, activeSpaceId);
                if (existingHist && existingHist.history.slices[deletedSliceId]) {
                    const updatedSlices = { ...existingHist.history.slices };
                    delete updatedSlices[deletedSliceId];
                    const updatedHistory = {
                        ...existingHist.history,
                        slices: updatedSlices,
                    };
                    ops.push(putOp("Annotation", existingHist.annotationId, {
                        id: existingHist.annotationId,
                        kind: "Annotation",
                        target: { kind: "Space", id: activeSpaceId },
                        schema: SPACE_AI_HISTORY_SCHEMA,
                        data: serializeAIHistory(updatedHistory),
                        createdAt: new Date().toISOString(),
                    }));
                }
            }
            // 7. Update selection
            const existingSel = findLayerSelection(prev, activeSpaceId);
            const newSelectedIdx = deleteIdx >= newCount ? newCount - 1 : deleteIdx > 0 ? deleteIdx - 1 : 0;
            const selAnnId = existingSel
                ? existingSel.annotationId
                : makeId("annotation");
            ops.push(putOp("Annotation", selAnnId, {
                id: selAnnId,
                kind: "Annotation",
                target: { kind: "Space", id: activeSpaceId },
                schema: "ui.selection.layerIndex",
                data: { layerIndex: String(newSelectedIdx) },
                createdAt: new Date().toISOString(),
            }));
            return newPatch({ baseRevision: prev.revision, ops });
        });
        // Clean up local React state by re-indexing
        setLayerGlbUrls((prev) => {
            const next = {};
            for (const [key, url] of Object.entries(prev)) {
                const idx = Number(key);
                if (idx === deleteIdx) {
                    URL.revokeObjectURL(url); // free blob URL
                    continue;
                }
                next[idx > deleteIdx ? idx - 1 : idx] = url;
            }
            return next;
        });
        setThreeDSourceHidden((prev) => {
            const next = new Set();
            for (const idx of prev) {
                if (idx === deleteIdx)
                    continue;
                next.add(idx > deleteIdx ? idx - 1 : idx);
            }
            return next;
        });
        // ── Inpaint the deleted slice's area on the base image ──
        if (deleteIdx > 0 && capturedOrigUri && capturedDeletedUri) {
            const spaceId = activeSpaceId;
            const inpaintOrigPid = capturedOrigPid;
            const inpaintOrigUri = capturedOrigUri;
            const inpaintDeletedUri = capturedDeletedUri;
            const inpaintDeletedCrop = capturedDeletedCrop;
            void (async () => {
                try {
                    console.info("[Inpaint-on-delete] Creating mask from deleted slice…");
                    const maskDataUrl = await extractSliceMaskForInpaint(inpaintDeletedUri, inpaintDeletedCrop);
                    console.info("[Inpaint-on-delete] Running inpainting…");
                    // Get original image dimensions to preserve aspect ratio.
                    // Clamp to the valid API range (512–2048).
                    const origPayload = state.payloads[inpaintOrigPid];
                    const origW = origPayload ? Number(origPayload.meta.width) : 0;
                    const origH = origPayload ? Number(origPayload.meta.height) : 0;
                    let inpaintImageSize;
                    if (origW > 0 && origH > 0) {
                        let w = origW;
                        let h = origH;
                        const longest = Math.max(w, h);
                        if (longest > 2048) {
                            const s = 2048 / longest;
                            w = Math.round(w * s);
                            h = Math.round(h * s);
                        }
                        const shortest = Math.min(w, h);
                        if (shortest < 512) {
                            const s = 512 / shortest;
                            w = Math.round(w * s);
                            h = Math.round(h * s);
                        }
                        w = Math.max(512, Math.min(2048, w));
                        h = Math.max(512, Math.min(2048, h));
                        inpaintImageSize = { width: w, height: h };
                    }
                    const inpaintResult = await runInpainting({
                        imageDataUrl: inpaintOrigUri,
                        maskDataUrl,
                        prompt: "fill in the background naturally, seamless, high quality",
                        strength: 0.95,
                        outputFormat: "png",
                        ...(inpaintImageSize ? { imageSize: inpaintImageSize } : {}),
                    });
                    const firstImg = inpaintResult.images[0];
                    if (!firstImg)
                        throw new Error("Inpainting returned no images");
                    // Fetch and convert to data URL
                    const { blob: ipBlob, buffer: ipBuffer } = await fetchImageBlob(firstImg.url);
                    const ipHash = await sha256Hex(ipBuffer);
                    let ipDataUrl;
                    if (firstImg.url.startsWith("data:")) {
                        ipDataUrl = firstImg.url;
                    }
                    else {
                        ipDataUrl = await new Promise((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onload = () => { resolve(reader.result); };
                            reader.onerror = () => { reject(new Error("Failed to convert inpaint blob to data URL")); };
                            reader.readAsDataURL(ipBlob);
                        });
                    }
                    const ipBitmap = await createImageBitmap(ipBlob);
                    const ipW = ipBitmap.width;
                    const ipH = ipBitmap.height;
                    ipBitmap.close();
                    // Add the inpainted image as a new layer above layer 0
                    const ipPayloadId = makeId("payload");
                    commitPatch((prev) => {
                        const space = prev.spaces[spaceId];
                        if (!space)
                            return null;
                        const newLayerIdx = space.layerCount;
                        const newCount = space.layerCount + 1;
                        const ops = [];
                        // Payload
                        ops.push(putOp("Payload", ipPayloadId, {
                            id: ipPayloadId,
                            kind: "Payload",
                            mediaType: "image/png",
                            uri: ipDataUrl,
                            sha256: ipHash,
                            bytes: ipBuffer.byteLength,
                            meta: { width: String(ipW), height: String(ipH) },
                        }));
                        // Increment layerCount
                        ops.push(putOp("Space", spaceId, { ...space, layerCount: newCount }));
                        // Add to render annotation
                        const existingRender = findLayerRender(prev, spaceId);
                        if (existingRender) {
                            const newData = { ...existingRender.annotation.data };
                            newData[`payload.${String(newLayerIdx)}`] = ipPayloadId;
                            ops.push(putOp("Annotation", existingRender.annotationId, {
                                id: existingRender.annotationId,
                                kind: "Annotation",
                                target: { kind: "Space", id: spaceId },
                                schema: "ui.layers.render",
                                data: newData,
                                createdAt: new Date().toISOString(),
                            }));
                        }
                        // Add to layer order (insert right above layer 0 — below everything else)
                        const existingOrder = findLayerOrder(prev, spaceId);
                        if (existingOrder) {
                            const order = [...existingOrder.order];
                            // Find where layer 0 is in the visual order and insert after it
                            const zeroPos = order.indexOf(0);
                            if (zeroPos !== -1) {
                                order.splice(zeroPos + 1, 0, newLayerIdx);
                            }
                            else {
                                // Layer 0 not in order — insert at the beginning (bottom)
                                order.unshift(newLayerIdx);
                            }
                            ops.push(putOp("Annotation", existingOrder.annotationId, {
                                id: existingOrder.annotationId,
                                kind: "Annotation",
                                target: { kind: "Space", id: spaceId },
                                schema: "ui.layers.order",
                                data: { order: serializeOrder(order) },
                                createdAt: new Date().toISOString(),
                            }));
                        }
                        else {
                            // No persisted order — build default and insert new layer at position 1
                            const order = defaultLayerOrder(space.layerCount); // existing layers
                            order.splice(1, 0, newLayerIdx); // insert right above layer 0
                            const orderAnnId = makeId("annotation");
                            ops.push(putOp("Annotation", orderAnnId, {
                                id: orderAnnId,
                                kind: "Annotation",
                                target: { kind: "Space", id: spaceId },
                                schema: "ui.layers.order",
                                data: { order: serializeOrder(order) },
                                createdAt: new Date().toISOString(),
                            }));
                        }
                        // Set layer name
                        const existingProps = findLayerProps(prev, spaceId);
                        if (existingProps) {
                            const newData = { ...existingProps.annotation.data };
                            newData[`name.${String(newLayerIdx)}`] = "Inpainted";
                            ops.push(putOp("Annotation", existingProps.annotationId, {
                                id: existingProps.annotationId,
                                kind: "Annotation",
                                target: { kind: "Space", id: spaceId },
                                schema: "ui.layers.props",
                                data: newData,
                                createdAt: new Date().toISOString(),
                            }));
                        }
                        // OperatorRun for provenance
                        const oprunId = makeId("oprun");
                        ops.push(putOp("OperatorRun", oprunId, {
                            id: oprunId,
                            kind: "OperatorRun",
                            operator: "fal.inpainting",
                            status: "succeeded",
                            createdAt: new Date().toISOString(),
                            finishedAt: new Date().toISOString(),
                            inputs: [{ kind: "Payload", id: inpaintOrigPid }],
                            outputs: [{ kind: "Payload", id: ipPayloadId }],
                            params: {
                                prompt: "fill in the background naturally, seamless, high quality",
                                proxyRoute: "fal-ai/flux-lora/inpainting",
                                trigger: "slice-delete",
                            },
                        }));
                        return newPatch({ baseRevision: prev.revision, ops });
                    });
                    console.info("[Inpaint-on-delete] Added inpainted layer successfully");
                }
                catch (err) {
                    console.error("[Inpaint-on-delete] Failed:", err);
                }
            })();
        }
    }, [activeSpaceId, commitPatch]);
    /* ── AI / Import state ───────────────────────────── */
    const [aiEditingLayers, setAiEditingLayers] = useState(() => new Set());
    const aiRunning = aiEditingLayers.size > 0;
    const [aiErrors, setAiErrors] = useState({});
    const [aiPromptOpen, setAiPromptOpen] = useState(false);
    const abortRefs = useRef({});
    const abortRef = useRef(null);
    const layerRender = useMemo(() => findLayerRender(state, activeSpaceId), [state, activeSpaceId]);
    /** Restore persisted GLB 3D models on load / space change. */
    const layerGlbAnnotation = useMemo(() => findLayerGlb(state, activeSpaceId), [state, activeSpaceId]);
    useEffect(() => {
        const glb = layerGlbAnnotation;
        if (!glb)
            return;
        const urls = {};
        const hiddenSet = new Set();
        for (const [key, payloadId] of Object.entries(glb.annotation.data)) {
            if (!key.startsWith("glb."))
                continue;
            const idx = Number(key.slice(4));
            if (!Number.isFinite(idx))
                continue;
            const payload = state.payloads[payloadId];
            if (!payload)
                continue;
            // Convert the data URL to a blob URL for Three.js
            fetch(payload.uri)
                .then((r) => r.blob())
                .then((blob) => {
                const blobUrl = URL.createObjectURL(blob);
                setLayerGlbUrls((prev) => ({ ...prev, [idx]: blobUrl }));
                setThreeDSourceHidden((prev) => new Set(prev).add(idx));
            })
                .catch((err) => {
                console.warn(`[3D] Failed to restore GLB for layer ${String(idx)}:`, err);
            });
            urls[idx] = "pending"; // mark as known so we don't lose track
            hiddenSet.add(idx);
        }
        // Immediately set the hidden set so source textures are suppressed
        if (hiddenSet.size > 0) {
            setThreeDSourceHidden(hiddenSet);
        }
        // Only run when the annotation identity changes (load / space switch)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [layerGlbAnnotation?.annotationId]);
    /** Portal edges from the current space. */
    const portalEdges = useMemo(() => findPortalEdges(state, activeSpaceId), [state, activeSpaceId]);
    /** Build a map of layerIndex → payload URI for texture rendering.
     *  When maskActive is false for a slice layer, fall back to the
     *  original image (layer 0) so the user sees the unmasked original.
     *  When a layer's source image is hidden (3D mode), skip its texture.
     *  After segmentation, layer 0's texture is suppressed in the viewport
     *  so that deleting a segment truly removes the visual content instead
     *  of being "filled in" by the base image underneath. */
    const layerTextures = useMemo(() => {
        const result = {};
        // Resolve the original image URI from layer 0 for mask-off fallback
        const origPid = layerPayloadId(layerRender, 0);
        const origUri = origPid ? state.payloads[origPid]?.uri : undefined;
        // Detect segmented state: if any layer > 0 has a segmentIndex payload,
        // then layer 0 is the base image from segmentation and should be suppressed.
        let hasSegments = false;
        for (let i = 1; i < layerCount; i++) {
            const pid = layerPayloadId(layerRender, i);
            const p = pid ? state.payloads[pid] : undefined;
            if (p?.meta.segmentIndex !== undefined) {
                hasSegments = true;
                break;
            }
        }
        for (let i = 0; i < layerCount; i++) {
            // Skip texture for layers whose 3D model is active.
            // During 3D generation, keep showing the source image as a placeholder.
            if (threeDSourceHidden.has(i) && generating3DLayer !== i)
                continue;
            // Suppress layer 0 texture when segment layers exist above it,
            // UNLESS layer 0 is the only layer (no segments to compose).
            if (i === 0 && hasSegments && layerCount > 1)
                continue;
            const pid = layerPayloadId(layerRender, i);
            const payload = pid ? state.payloads[pid] : undefined;
            const maskOn = isMaskActive(layerProps, i, layerCount);
            // When mask is OFF on a slice layer whose payload is still the
            // original segmentation mask, show the full original image instead.
            // AI-edited payloads (no segmentIndex) always show their own URI.
            const isOriginalMask = payload?.meta.segmentIndex !== undefined;
            if (!maskOn && i > 0 && origUri && isOriginalMask) {
                result[i] = origUri;
                continue;
            }
            if (payload) {
                result[i] = payload.uri;
            }
        }
        return result;
    }, [layerCount, layerRender, state.payloads, layerProps, threeDSourceHidden, generating3DLayer]);
    /** Build a map of layerIndex → payload URI for panel thumbnails.
     *  Unlike layerTextures, this always includes textures even when
     *  the source image is hidden (3D mode) so thumbnails stay visible. */
    const layerThumbnails = useMemo(() => {
        const result = {};
        const origPid = layerPayloadId(layerRender, 0);
        const origUri = origPid ? state.payloads[origPid]?.uri : undefined;
        for (let i = 0; i < layerCount; i++) {
            const pid = layerPayloadId(layerRender, i);
            const payload = pid ? state.payloads[pid] : undefined;
            const maskOn = isMaskActive(layerProps, i, layerCount);
            const isOriginalMask = payload?.meta.segmentIndex !== undefined;
            if (!maskOn && i > 0 && origUri && isOriginalMask) {
                result[i] = origUri;
                continue;
            }
            if (payload) {
                result[i] = payload.uri;
            }
        }
        return result;
    }, [layerCount, layerRender, state.payloads, layerProps]);
    const layerCropInfo = useMemo(() => {
        const result = {};
        for (let i = 0; i < layerCount; i++) {
            // Always use the CURRENT render payload's crop info so the plane
            // geometry matches the displayed texture (prevents aspect distortion
            // after AI edits that produce differently-shaped crops).
            const pid = layerPayloadId(layerRender, i);
            if (!pid)
                continue;
            const payload = state.payloads[pid];
            if (!payload)
                continue;
            const m = payload.meta;
            const cx = Number(m.cropX);
            const cy = Number(m.cropY);
            const cw = Number(m.cropW);
            const ch = Number(m.cropH);
            const ow = Number(m.origW);
            const oh = Number(m.origH);
            if (ow > 0 && oh > 0 && cw > 0 && ch > 0 && (cw < ow || ch < oh)) {
                result[i] = { cropX: cx, cropY: cy, cropW: cw, cropH: ch, origW: ow, origH: oh };
            }
        }
        return result;
    }, [layerCount, layerRender, state.payloads]);
    /** Build a map of layerIndex → colored-segment URI for the "colored" display mode. */
    const colorLayerTextures = useMemo(() => {
        const result = {};
        for (let i = 0; i < layerCount; i++) {
            const pid = layerPayloadId(layerRender, i);
            if (pid) {
                const payload = state.payloads[pid];
                if (payload) {
                    // Layer 0 is always the original image (no colored variant)
                    const colorUri = i > 0 ? payload.meta["colorUri"] : undefined;
                    if (colorUri) {
                        result[i] = colorUri;
                    }
                    else {
                        result[i] = payload.uri;
                    }
                }
            }
        }
        return result;
    }, [layerCount, layerRender, state.payloads]);
    /** Derive aspect ratio (width/height) from the first payload that has dimensions. */
    const imageAspect = useMemo(() => {
        // 1. Prefer the document source image (original import before segmentation)
        //    so the prism shape stays stable after AI edits change layer dimensions.
        const docSrcId = findAIHistory(state, activeSpaceId)?.history.documentSourceImageId;
        if (docSrcId) {
            const docPayload = state.payloads[docSrcId];
            if (docPayload) {
                const dw = Number(docPayload.meta.width);
                const dh = Number(docPayload.meta.height);
                if (dw > 0 && dh > 0)
                    return dw / dh;
            }
        }
        // 2. Fall back to origW/origH from any layer's crop metadata (stable original dims).
        for (let i = 0; i < layerCount; i++) {
            const pid = layerPayloadId(layerRender, i);
            if (!pid)
                continue;
            const payload = state.payloads[pid];
            if (!payload)
                continue;
            const ow = Number(payload.meta.origW);
            const oh = Number(payload.meta.origH);
            if (ow > 0 && oh > 0)
                return ow / oh;
            const w = Number(payload.meta.width);
            const h = Number(payload.meta.height);
            if (w > 0 && h > 0)
                return w / h;
        }
        return null;
    }, [layerCount, layerRender, state, activeSpaceId]);
    /** Keyframe preview: composite all visible/display-state layers top-down into a single image. */
    const [keyframePreviewUrl, setKeyframePreviewUrl] = useState(null);
    useEffect(() => {
        // Only build if we have textures
        const textureEntries = Object.entries(layerTextures);
        if (textureEntries.length === 0) {
            setKeyframePreviewUrl(null);
            return;
        }
        let cancelled = false;
        void (async () => {
            try {
                // Load all visible layer images
                const images = [];
                await Promise.all(textureEntries.map(async ([idxStr, uri]) => {
                    const idx = Number(idxStr);
                    const vis = layerVisibility[idx];
                    if (vis && !vis.visible)
                        return; // skip hidden layers
                    const img = new Image();
                    img.src = uri;
                    await new Promise((resolve, reject) => {
                        img.onload = () => { resolve(); };
                        img.onerror = () => { reject(new Error("img load failed")); };
                    });
                    if (!cancelled)
                        images.push({ idx, img });
                }));
                if (cancelled || images.length === 0)
                    return;
                // Find max dimensions
                let maxW = 0, maxH = 0;
                for (const { img } of images) {
                    if (img.naturalWidth > maxW)
                        maxW = img.naturalWidth;
                    if (img.naturalHeight > maxH)
                        maxH = img.naturalHeight;
                }
                if (maxW === 0 || maxH === 0)
                    return;
                // Cap size for performance
                const scale = Math.min(1, 200 / Math.max(maxW, maxH));
                const cW = Math.round(maxW * scale);
                const cH = Math.round(maxH * scale);
                const canvas = document.createElement("canvas");
                canvas.width = cW;
                canvas.height = cH;
                const ctx = canvas.getContext("2d");
                if (!ctx)
                    return;
                // Sort by order (bottom to top)
                images.sort((a, b) => {
                    const posA = effectiveOrder.indexOf(a.idx);
                    const posB = effectiveOrder.indexOf(b.idx);
                    return posA - posB;
                });
                // Draw each layer using its crop info if available
                for (const { idx, img } of images) {
                    const vis = layerVisibility[idx];
                    const texOpacity = vis ? vis.textureOpacity : 1;
                    ctx.globalAlpha = texOpacity;
                    const crop = layerCropInfo[idx];
                    if (crop && crop.origW > 0 && crop.origH > 0) {
                        const sx = (crop.cropX / crop.origW) * cW;
                        const sy = (crop.cropY / crop.origH) * cH;
                        const sw = (crop.cropW / crop.origW) * cW;
                        const sh = (crop.cropH / crop.origH) * cH;
                        ctx.drawImage(img, sx, sy, sw, sh);
                    }
                    else {
                        ctx.drawImage(img, 0, 0, cW, cH);
                    }
                }
                if (!cancelled) {
                    setKeyframePreviewUrl(canvas.toDataURL("image/png"));
                }
            }
            catch {
                // Silently ignore — keyframe preview is optional
            }
        })();
        return () => { cancelled = true; };
    }, [layerTextures, layerVisibility, effectiveOrder, layerCropInfo]);
    /* ── Keyframe AI composite (Flux2 Flash Edit) ──── */
    const [compositeResultUrl, setCompositeResultUrl] = useState(null);
    const [compositeBusy, setCompositeBusy] = useState(false);
    /** Build a higher-res keyframe composite (up to 1024px) for AI editing. */
    const buildHiResKeyframe = useCallback(async () => {
        const textureEntries = Object.entries(layerTextures);
        if (textureEntries.length === 0)
            return null;
        const images = [];
        await Promise.all(textureEntries.map(async ([idxStr, uri]) => {
            const idx = Number(idxStr);
            const vis = layerVisibility[idx];
            if (vis && !vis.visible)
                return;
            const img = new Image();
            img.src = uri;
            await new Promise((resolve, reject) => {
                img.onload = () => { resolve(); };
                img.onerror = () => { reject(new Error("img load failed")); };
            });
            images.push({ idx, img });
        }));
        if (images.length === 0)
            return null;
        let maxW = 0, maxH = 0;
        for (const { img } of images) {
            if (img.naturalWidth > maxW)
                maxW = img.naturalWidth;
            if (img.naturalHeight > maxH)
                maxH = img.naturalHeight;
        }
        if (maxW === 0 || maxH === 0)
            return null;
        const scale = Math.min(1, 1024 / Math.max(maxW, maxH));
        const cW = Math.round(maxW * scale);
        const cH = Math.round(maxH * scale);
        const canvas = document.createElement("canvas");
        canvas.width = cW;
        canvas.height = cH;
        const ctx = canvas.getContext("2d");
        if (!ctx)
            return null;
        images.sort((a, b) => {
            const posA = effectiveOrder.indexOf(a.idx);
            const posB = effectiveOrder.indexOf(b.idx);
            return posA - posB;
        });
        for (const { idx, img } of images) {
            const vis = layerVisibility[idx];
            const texOpacity = vis ? vis.textureOpacity : 1;
            ctx.globalAlpha = texOpacity;
            const crop = layerCropInfo[idx];
            if (crop && crop.origW > 0 && crop.origH > 0) {
                const sx = (crop.cropX / crop.origW) * cW;
                const sy = (crop.cropY / crop.origH) * cH;
                const sw = (crop.cropW / crop.origW) * cW;
                const sh = (crop.cropH / crop.origH) * cH;
                ctx.drawImage(img, sx, sy, sw, sh);
            }
            else {
                ctx.drawImage(img, 0, 0, cW, cH);
            }
        }
        return canvas.toDataURL("image/png");
    }, [layerTextures, layerVisibility, effectiveOrder, layerCropInfo]);
    const handleCompositeKeyframe = useCallback(async () => {
        setCompositeBusy(true);
        try {
            const hiRes = await buildHiResKeyframe();
            if (!hiRes) {
                setCompositeBusy(false);
                return;
            }
            const result = await runFlux2Edit({
                imageDataUrls: [hiRes],
                prompt: "composite this image so it looks perfect",
            });
            const outputUrl = result.images[0]?.url;
            if (outputUrl) {
                // Fetch the result and convert to data URL to avoid CORS issues
                const resp = await fetch(outputUrl);
                const blob = await resp.blob();
                const dataUrl = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => { resolve(reader.result); };
                    reader.onerror = () => { reject(new Error("Failed to read composite result")); };
                    reader.readAsDataURL(blob);
                });
                setCompositeResultUrl(dataUrl);
            }
        }
        catch (err) {
            console.error("[Composite Keyframe] error:", err);
        }
        finally {
            setCompositeBusy(false);
        }
    }, [buildHiResKeyframe]);
    /**
     * Helper: emit a render-mapping update patch.
     * Takes the current render annotation (or creates one) and applies an updater.
     */
    const emitRenderUpdate = useCallback((updater, extraOps) => {
        commitPatch((prev) => {
            const existing = findLayerRender(prev, activeSpaceId);
            const annId = existing
                ? existing.annotationId
                : makeId("annotation");
            const currentData = existing ? { ...existing.annotation.data } : {};
            const newData = updater(currentData);
            const annotationValue = {
                id: annId,
                kind: "Annotation",
                target: { kind: "Space", id: activeSpaceId },
                schema: "ui.layers.render",
                data: newData,
                createdAt: new Date().toISOString(),
            };
            const ops = [
                ...(extraOps ?? []),
                putOp("Annotation", annId, annotationValue),
            ];
            return newPatch({ baseRevision: prev.revision, ops });
        });
    }, [activeSpaceId, commitPatch]);
    /* ── AI History helpers ───────────────────────── */
    /** Get or initialize stable slice IDs for the active space. */
    const getOrCreateSliceIds = useCallback((prev, spaceId) => {
        const existing = findSliceIds(prev, spaceId);
        if (existing) {
            const space = prev.spaces[spaceId];
            const count = space?.layerCount ?? 0;
            // Extend if needed (new layers added)
            if (existing.ids.length >= count) {
                return { sliceIds: existing.ids, ops: [] };
            }
            const extended = [...existing.ids];
            while (extended.length < count) {
                extended.push(makeId("slice"));
            }
            const ann = {
                id: existing.annotationId,
                kind: "Annotation",
                target: { kind: "Space", id: spaceId },
                schema: "ui.layers.sliceIds",
                data: { ids: JSON.stringify(extended) },
                createdAt: new Date().toISOString(),
            };
            return { sliceIds: extended, ops: [putOp("Annotation", existing.annotationId, ann)] };
        }
        // Create new
        const space = prev.spaces[spaceId];
        const count = space?.layerCount ?? 1;
        const ids = [];
        for (let i = 0; i < count; i++) {
            ids.push(makeId("slice"));
        }
        const annId = makeId("annotation");
        const ann = {
            id: annId,
            kind: "Annotation",
            target: { kind: "Space", id: spaceId },
            schema: "ui.layers.sliceIds",
            data: { ids: JSON.stringify(ids) },
            createdAt: new Date().toISOString(),
        };
        return { sliceIds: ids, ops: [putOp("Annotation", annId, ann)] };
    }, []);
    /** Get or initialize the AI history for the active space. */
    const getOrCreateAIHistory = useCallback((prev, spaceId, sliceIds) => {
        const existing = findAIHistory(prev, spaceId);
        if (existing) {
            return { history: existing.history, annotationId: existing.annotationId, ops: [] };
        }
        // Initialize: create root state for each slice that has a render payload
        let history = createSpaceAIHistory();
        const render = findLayerRender(prev, spaceId);
        for (let i = 0; i < sliceIds.length; i++) {
            const sliceId = sliceIds[i];
            const pid = layerPayloadId(render, i);
            if (pid) {
                history = ensureHistoryGraphForSlice(history, sliceId, {
                    image: pid,
                });
            }
        }
        const annId = makeId("annotation");
        const ann = {
            id: annId,
            kind: "Annotation",
            target: { kind: "Space", id: spaceId },
            schema: SPACE_AI_HISTORY_SCHEMA,
            data: serializeAIHistory(history),
            createdAt: new Date().toISOString(),
        };
        return { history, annotationId: annId, ops: [putOp("Annotation", annId, ann)] };
    }, []);
    /** Commit an AI history update as a patch operation. */
    const buildHistoryPatchOp = useCallback((history, annotationId, spaceId) => {
        const ann = {
            id: annotationId,
            kind: "Annotation",
            target: { kind: "Space", id: spaceId },
            schema: SPACE_AI_HISTORY_SCHEMA,
            data: serializeAIHistory(history),
            createdAt: new Date().toISOString(),
        };
        return putOp("Annotation", annotationId, ann);
    }, []);
    /** Current AI history for the active space (memoized). */
    const aiHistory = useMemo(() => findAIHistory(state, activeSpaceId), [state, activeSpaceId]);
    /** Current slice IDs for the active space (memoized). */
    const sliceIdsResult = useMemo(() => findSliceIds(state, activeSpaceId), [state, activeSpaceId]);
    /** Get the sliceId for a given layer index. */
    const getSliceIdForLayer = useCallback((layerIndex) => {
        if (!sliceIdsResult)
            return null;
        return sliceIdsResult.ids[layerIndex] ?? null;
    }, [sliceIdsResult]);
    /** Get the SliceHistoryGraph for a given layer index. */
    const getSliceHistory = useCallback((layerIndex) => {
        const sliceId = getSliceIdForLayer(layerIndex);
        if (!sliceId || !aiHistory)
            return null;
        return aiHistory.history.slices[sliceId] ?? null;
    }, [getSliceIdForLayer, aiHistory]);
    /** Set the display cursor for a slice (by layer index) and update render annotation. */
    const handleSetDisplayCursor = useCallback((layerIndex, stateId) => {
        // \u2500\u2500 Resolve GLB presence for the target state (outside commitPatch) \u2500\u2500
        // Look up the state node in the current project state so we can toggle 3D model display.
        const sliceIds = getOrCreateSliceIds(state, activeSpaceId).sliceIds;
        const sliceId = sliceIds[layerIndex];
        if (sliceId) {
            const hist = getOrCreateAIHistory(state, activeSpaceId, sliceIds).history;
            const graph = hist.slices[sliceId];
            const targetState = graph?.states[stateId];
            if (targetState?.assetRefs.glb) {
                // Target state has a 3D model \u2014 show it
                const glbPid = targetState.assetRefs.glb;
                const glbPayload = state.payloads[glbPid];
                if (glbPayload) {
                    fetch(glbPayload.uri)
                        .then((r) => r.blob())
                        .then((blob) => {
                        const blobUrl = URL.createObjectURL(blob);
                        setLayerGlbUrls((prev) => ({ ...prev, [layerIndex]: blobUrl }));
                        setThreeDSourceHidden((prev) => new Set(prev).add(layerIndex));
                    })
                        .catch(() => { });
                }
            }
            else {
                // Target state has no 3D model \u2014 remove any active GLB for this layer
                setLayerGlbUrls((prev) => {
                    if (!(layerIndex in prev))
                        return prev;
                    const next = { ...prev };
                    delete next[layerIndex];
                    return next;
                });
                setThreeDSourceHidden((prev) => {
                    if (!prev.has(layerIndex))
                        return prev;
                    const next = new Set(prev);
                    next.delete(layerIndex);
                    return next;
                });
            }
        }
        commitPatch((prev) => {
            const { sliceIds: sIds, ops: sliceOps } = getOrCreateSliceIds(prev, activeSpaceId);
            const sId = sIds[layerIndex];
            if (!sId)
                return null;
            const { history, annotationId, ops: histOps } = getOrCreateAIHistory(prev, activeSpaceId, sIds);
            const g = history.slices[sId];
            if (!g)
                return null;
            const stateNode = g.states[stateId];
            if (!stateNode)
                return null;
            const updatedGraph = setDisplayCursor(g, stateId);
            const updatedHistory = {
                ...history,
                slices: { ...history.slices, [sId]: updatedGraph },
            };
            const allOps = [...sliceOps, ...histOps];
            allOps.push(buildHistoryPatchOp(updatedHistory, annotationId, activeSpaceId));
            // Update render annotation to reflect new display state
            if (stateNode.assetRefs.image) {
                const existing = findLayerRender(prev, activeSpaceId);
                const annId = existing ? existing.annotationId : makeId("annotation");
                const currentData = existing ? { ...existing.annotation.data } : {};
                currentData[`payload.${String(layerIndex)}`] = stateNode.assetRefs.image;
                const renderAnn = {
                    id: annId,
                    kind: "Annotation",
                    target: { kind: "Space", id: activeSpaceId },
                    schema: "ui.layers.render",
                    data: currentData,
                    createdAt: new Date().toISOString(),
                };
                allOps.push(putOp("Annotation", annId, renderAnn));
            }
            return newPatch({ baseRevision: prev.revision, ops: allOps });
        });
    }, [activeSpaceId, state, commitPatch, getOrCreateSliceIds, getOrCreateAIHistory, buildHistoryPatchOp]);
    /** Set the operation cursor for a slice (by layer index). */
    const handleSetOperationCursor = useCallback((layerIndex, stateId) => {
        commitPatch((prev) => {
            const { sliceIds, ops: sliceOps } = getOrCreateSliceIds(prev, activeSpaceId);
            const sliceId = sliceIds[layerIndex];
            if (!sliceId)
                return null;
            const { history, annotationId, ops: histOps } = getOrCreateAIHistory(prev, activeSpaceId, sliceIds);
            const graph = history.slices[sliceId];
            if (!graph)
                return null;
            const updatedGraph = setOperationCursor(graph, stateId);
            const updatedHistory = {
                ...history,
                slices: { ...history.slices, [sliceId]: updatedGraph },
            };
            const allOps = [...sliceOps, ...histOps];
            allOps.push(buildHistoryPatchOp(updatedHistory, annotationId, activeSpaceId));
            return newPatch({ baseRevision: prev.revision, ops: allOps });
        });
    }, [activeSpaceId, commitPatch, getOrCreateSliceIds, getOrCreateAIHistory, buildHistoryPatchOp]);
    /**
     * Invert mask: flip the alpha channel of the layer's current image,
     * creating a new payload with inverted transparency on a **new** slice.
     * The original slice retains its current image.
     */
    const handleInvertMask = useCallback(async (index) => {
        const pid = layerPayloadId(layerRender, index);
        if (!pid)
            return;
        const payload = state.payloads[pid];
        if (!payload)
            return;
        try {
            // Find the original (full) image for correct RGB compositing.
            // PNG round-tripping loses RGB for transparent pixels, so we need
            // the original to provide clean pixels in the inverted region.
            const origPid = layerPayloadId(layerRender, 0);
            const origPayload = origPid ? state.payloads[origPid] : undefined;
            let invertedUrl;
            let invertedCrop;
            if (origPayload && index > 0) {
                // Pass source crop info so the cropped mask is placed correctly
                // in the full-size canvas before inverting.
                const srcCrop = layerCropInfo[index];
                const result = await invertMaskWithOriginal(origPayload.uri, payload.uri, undefined, srcCrop);
                invertedUrl = result.dataUrl;
                invertedCrop = result.crop;
            }
            else {
                invertedUrl = await invertAlpha(payload.uri);
            }
            const encoder = new TextEncoder();
            const bytes = encoder.encode(invertedUrl);
            const hash = await sha256Hex(bytes.buffer);
            // Build new meta: start from source, override crop with inverted bounds
            const baseMeta = { ...(payload.meta ?? {}) };
            if (invertedCrop) {
                baseMeta.width = String(invertedCrop.cropW);
                baseMeta.height = String(invertedCrop.cropH);
                baseMeta.cropX = String(invertedCrop.cropX);
                baseMeta.cropY = String(invertedCrop.cropY);
                baseMeta.cropW = String(invertedCrop.cropW);
                baseMeta.cropH = String(invertedCrop.cropH);
                baseMeta.origW = String(invertedCrop.origW);
                baseMeta.origH = String(invertedCrop.origH);
            }
            else if (invertedCrop === undefined && origPayload && index > 0) {
                // Inverted to nothing — remove crop fields
                delete baseMeta.cropX;
                delete baseMeta.cropY;
                delete baseMeta.cropW;
                delete baseMeta.cropH;
                delete baseMeta.origW;
                delete baseMeta.origH;
            }
            const newPayloadId = makeId("payload");
            const newPayloadValue = {
                id: newPayloadId,
                kind: "Payload",
                mediaType: "image/png",
                uri: invertedUrl,
                sha256: hash,
                bytes: bytes.byteLength,
                meta: {
                    ...baseMeta,
                    invertedFrom: pid,
                },
            };
            // Create a new slice with the inverted payload, keeping the original slice intact
            commitPatch((prev) => {
                const space = prev.spaces[activeSpaceId];
                if (!space)
                    return null;
                const patchOps = [putOp("Payload", newPayloadId, newPayloadValue)];
                const newLayerIdx = space.layerCount;
                const newCount = space.layerCount + 1;
                // 1. Increment layerCount
                const updatedSpace = { ...space, layerCount: newCount };
                patchOps.push(putOp("Space", activeSpaceId, updatedSpace));
                // 2. Extend layer order — insert new slice right above the source slice
                const existingOrder = findLayerOrder(prev, activeSpaceId);
                if (existingOrder) {
                    const orderArr = [...existingOrder.order];
                    const sourcePos = orderArr.indexOf(index);
                    if (sourcePos >= 0) {
                        orderArr.splice(sourcePos + 1, 0, newLayerIdx);
                    }
                    else {
                        orderArr.push(newLayerIdx);
                    }
                    const orderAnnotation = {
                        id: existingOrder.annotationId,
                        kind: "Annotation",
                        target: { kind: "Space", id: activeSpaceId },
                        schema: "ui.layers.order",
                        data: { order: serializeOrder(orderArr) },
                        createdAt: new Date().toISOString(),
                    };
                    patchOps.push(putOp("Annotation", existingOrder.annotationId, orderAnnotation));
                }
                // 3. Select the new slice
                const existingSel = findLayerSelection(prev, activeSpaceId);
                const selAnnId = existingSel
                    ? existingSel.annotationId
                    : makeId("annotation");
                const selAnnotation = {
                    id: selAnnId,
                    kind: "Annotation",
                    target: { kind: "Space", id: activeSpaceId },
                    schema: "ui.selection.layerIndex",
                    data: { layerIndex: String(newLayerIdx) },
                    createdAt: new Date().toISOString(),
                };
                patchOps.push(putOp("Annotation", selAnnId, selAnnotation));
                // 4. AI history for the new slice
                const { sliceIds, ops: sliceOps } = getOrCreateSliceIds(prev, activeSpaceId);
                patchOps.push(...sliceOps);
                // The new slice needs a sliceId; re-derive after bumping count
                const newSliceIds = [...sliceIds];
                while (newSliceIds.length < newCount) {
                    newSliceIds.push(makeId("slice"));
                }
                const newSliceId = newSliceIds[newLayerIdx];
                if (newSliceId) {
                    const { history, annotationId, ops: histOps } = getOrCreateAIHistory(prev, activeSpaceId, newSliceIds);
                    patchOps.push(...histOps);
                    const rootAssets = { image: newPayloadId };
                    let updatedHistory = ensureHistoryGraphForSlice(history, newSliceId, rootAssets);
                    const graph = updatedHistory.slices[newSliceId];
                    const result = addOpResultToGraph(graph, {
                        inputStateId: graph.operationStateId,
                        opType: "maskInvert",
                        outputAssets: [{ image: newPayloadId }],
                        sliceIndex: newLayerIdx,
                    });
                    updatedHistory = { ...updatedHistory, slices: { ...updatedHistory.slices, [newSliceId]: result.graph } };
                    patchOps.push(buildHistoryPatchOp(updatedHistory, annotationId, activeSpaceId));
                }
                // 5. Render annotation: assign inverted payload to the new slice
                const existing = findLayerRender(prev, activeSpaceId);
                const annId = existing ? existing.annotationId : makeId("annotation");
                const currentData = existing ? { ...existing.annotation.data } : {};
                currentData[`payload.${String(newLayerIdx)}`] = newPayloadId;
                patchOps.push(putOp("Annotation", annId, {
                    id: annId, kind: "Annotation",
                    target: { kind: "Space", id: activeSpaceId },
                    schema: "ui.layers.render", data: currentData,
                    createdAt: new Date().toISOString(),
                }));
                return newPatch({ baseRevision: prev.revision, ops: patchOps });
            });
            // Set maskInverted flag on the new slice (it is the inverted result)
            emitPropsUpdate((data) => {
                // Find the new layer index — it's layerCount at patch time
                const space = state.spaces[activeSpaceId];
                const newIdx = space ? space.layerCount : index;
                return { ...data, [`maskInverted.${String(newIdx)}`]: "true" };
            });
        }
        catch (err) {
            console.error("[InvertMask] failed:", err);
        }
    }, [layerRender, state.payloads, state.spaces, commitPatch, activeSpaceId, emitPropsUpdate, layerCropInfo, getOrCreateSliceIds, getOrCreateAIHistory, buildHistoryPatchOp]);
    /** Combine user-selected masks into a new layer. */
    const handleCombineMasks = useCallback(async (maskUrls) => {
        if (maskUrls.length === 0)
            return;
        setCombining(true);
        try {
            // Get original image from layer 0
            const origPid = layerPayloadId(layerRender, 0);
            const origPayload = origPid ? state.payloads[origPid] : undefined;
            if (!origPayload) {
                console.error("[CombineMasks] No original image found on layer 0");
                return;
            }
            const { dataUrl: combinedUrl, crop } = await combineMasksToOriginal(maskUrls, origPayload.uri);
            const encoder = new TextEncoder();
            const bytes = encoder.encode(combinedUrl);
            const hash = await sha256Hex(bytes.buffer);
            const newPayloadId = makeId("payload");
            const payloadValue = {
                id: newPayloadId,
                kind: "Payload",
                mediaType: "image/png",
                uri: combinedUrl,
                sha256: hash,
                bytes: bytes.byteLength,
                meta: {
                    source: "mask-picker-combine",
                    width: String(crop.cropW),
                    height: String(crop.cropH),
                    cropX: String(crop.cropX),
                    cropY: String(crop.cropY),
                    cropW: String(crop.cropW),
                    cropH: String(crop.cropH),
                    origW: String(crop.origW),
                    origH: String(crop.origH),
                },
            };
            // Add new layer and assign the combined payload
            commitPatch((prev) => {
                const space = prev.spaces[activeSpaceId];
                if (!space)
                    return null;
                const newCount = space.layerCount + 1;
                const newLayerIdx = space.layerCount;
                const ops = [];
                // Update space layerCount
                ops.push(putOp("Space", activeSpaceId, { ...space, layerCount: newCount }));
                // Add the payload
                ops.push(putOp("Payload", newPayloadId, payloadValue));
                // Extend layer order
                const existingOrder = findLayerOrder(prev, activeSpaceId);
                if (existingOrder) {
                    const newOrder = [...existingOrder.order, newLayerIdx];
                    ops.push(putOp("Annotation", existingOrder.annotationId, {
                        id: existingOrder.annotationId,
                        kind: "Annotation",
                        target: { kind: "Space", id: activeSpaceId },
                        schema: "ui.layers.order",
                        data: { order: serializeOrder(newOrder) },
                        createdAt: new Date().toISOString(),
                    }));
                }
                // Assign payload to the new layer in render
                const existing = findLayerRender(prev, activeSpaceId);
                const annId = existing ? existing.annotationId : makeId("annotation");
                const currentData = existing ? { ...existing.annotation.data } : {};
                currentData[`payload.${String(newLayerIdx)}`] = newPayloadId;
                ops.push(putOp("Annotation", annId, {
                    id: annId,
                    kind: "Annotation",
                    target: { kind: "Space", id: activeSpaceId },
                    schema: "ui.layers.render",
                    data: currentData,
                    createdAt: new Date().toISOString(),
                }));
                // Select the new layer
                const existingSel = findLayerSelection(prev, activeSpaceId);
                const selAnnId = existingSel ? existingSel.annotationId : makeId("annotation");
                ops.push(putOp("Annotation", selAnnId, {
                    id: selAnnId,
                    kind: "Annotation",
                    target: { kind: "Space", id: activeSpaceId },
                    schema: "ui.selection.layerIndex",
                    data: { layerIndex: String(newLayerIdx) },
                    createdAt: new Date().toISOString(),
                }));
                // Record in AI history: create a new slice with maskCombine root
                const { sliceIds, ops: sliceOps } = getOrCreateSliceIds(prev, activeSpaceId);
                // Extend sliceIds for the new layer
                const extendedSliceIds = [...sliceIds];
                const newSliceId = makeId("hslice");
                extendedSliceIds[newLayerIdx] = newSliceId;
                ops.push(...sliceOps);
                // Update sliceIds annotation with extended array
                const existingSliceIdsResult = findSliceIds(prev, activeSpaceId);
                const sliceIdsAnnId = existingSliceIdsResult ? existingSliceIdsResult.annotationId : makeId("annotation");
                ops.push(putOp("Annotation", sliceIdsAnnId, {
                    id: sliceIdsAnnId,
                    kind: "Annotation",
                    target: { kind: "Space", id: activeSpaceId },
                    schema: "ui.layers.sliceIds",
                    data: { ids: extendedSliceIds.join(",") },
                    createdAt: new Date().toISOString(),
                }));
                const { history, annotationId: histAnnId, ops: histOps } = getOrCreateAIHistory(prev, activeSpaceId, extendedSliceIds);
                ops.push(...histOps);
                // Ensure graph for the new slice with the combined payload as root
                const updatedHistory = ensureHistoryGraphForSlice(history, newSliceId, { image: newPayloadId });
                ops.push(buildHistoryPatchOp(updatedHistory, histAnnId, activeSpaceId));
                return newPatch({ baseRevision: prev.revision, ops });
            });
            setShowMaskPicker(false);
        }
        catch (err) {
            console.error("[CombineMasks] failed:", err);
        }
        finally {
            setCombining(false);
        }
    }, [layerRender, state.payloads, activeSpaceId, commitPatch, getOrCreateSliceIds, getOrCreateAIHistory, buildHistoryPatchOp]);
    /** Toggle source-image visibility for a layer that has a 3D model. */
    const handleToggle3DSourceImage = useCallback((index) => {
        setThreeDSourceHidden((prev) => {
            const next = new Set(prev);
            if (next.has(index)) {
                next.delete(index);
            }
            else {
                next.add(index);
            }
            return next;
        });
    }, []);
    /** Generate a 3D object from a segmented layer using SAM-3. */
    const handleGenerate3D = useCallback(async (index) => {
        if (generating3DLayer !== null)
            return; // already running
        const pid = layerPayloadId(layerRender, index);
        if (!pid)
            return;
        const payload = state.payloads[pid];
        if (!payload)
            return;
        // Capture the current display state for the slice so the 3D model
        // is recorded against the node the user is actually viewing.
        const sliceGraph = getSliceHistory(index);
        const capturedDisplayStateId = sliceGraph?.displayStateId ?? null;
        const capturedImagePid = pid;
        setGenerating3DLayer(index);
        // Hide the source image by default during generation
        setThreeDSourceHidden((prev) => new Set(prev).add(index));
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        try {
            // Determine which image to send to SAM-3 and build a matching mask.
            // The image is the slice's current visible texture (reflecting AI edits
            // and history navigation). The mask is derived from the visible image's
            // alpha channel at the same resolution so image_url and mask_urls align.
            const visibleUri = layerTextures[index] ?? payload.uri;
            const imageUrl = visibleUri;
            // Load the visible image to derive its mask
            const visImg = await new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => { resolve(img); };
                img.onerror = reject;
                img.src = visibleUri;
            });
            const visW = visImg.naturalWidth;
            const visH = visImg.naturalHeight;
            // Read pixel data from visible image
            const tmpCanvas = document.createElement("canvas");
            tmpCanvas.width = visW;
            tmpCanvas.height = visH;
            const tCtx = tmpCanvas.getContext("2d");
            if (!tCtx)
                throw new Error("Canvas 2D context unavailable");
            tCtx.drawImage(visImg, 0, 0);
            const visData = tCtx.getImageData(0, 0, visW, visH);
            // Build binary mask at the same resolution as the visible image:
            // white where alpha > 128, black elsewhere.
            const maskCanvas = document.createElement("canvas");
            maskCanvas.width = visW;
            maskCanvas.height = visH;
            const mCtx = maskCanvas.getContext("2d");
            if (!mCtx)
                throw new Error("Canvas 2D context unavailable");
            mCtx.fillStyle = "#000000";
            mCtx.fillRect(0, 0, visW, visH);
            const maskImgData = mCtx.getImageData(0, 0, visW, visH);
            const md = maskImgData.data;
            const vd = visData.data;
            // Check if the image has meaningful alpha (any pixel with alpha < 250)
            let hasAlpha = false;
            for (let i = 3; i < vd.length; i += 4) {
                if ((vd[i] ?? 255) < 250) {
                    hasAlpha = true;
                    break;
                }
            }
            if (hasAlpha) {
                for (let i = 0; i < vd.length; i += 4) {
                    if ((vd[i + 3] ?? 0) > 128) {
                        md[i] = 255;
                        md[i + 1] = 255;
                        md[i + 2] = 255;
                        md[i + 3] = 255;
                    }
                }
            }
            else {
                // Fully opaque image (e.g. full scene or mask-off): fill mask white
                for (let i = 0; i < md.length; i += 4) {
                    md[i] = 255;
                    md[i + 1] = 255;
                    md[i + 2] = 255;
                    md[i + 3] = 255;
                }
            }
            mCtx.putImageData(maskImgData, 0, 0);
            const maskDataUrl = maskCanvas.toDataURL("image/png");
            const result = await runImageTo3D({
                imageUrl,
                maskUrls: [maskDataUrl],
                exportTexturedGlb: true,
            }, controller.signal);
            // Get the GLB URL from the response
            const glbRef = result.model_glb;
            let glbUrl;
            if (typeof glbRef === "string") {
                glbUrl = glbRef;
            }
            else if (glbRef && typeof glbRef === "object" && "url" in glbRef) {
                glbUrl = glbRef.url;
            }
            if (!glbUrl) {
                console.warn("[3D] No GLB returned; falling back to splat");
                // Could use gaussian_splat as a fallback here, but GLB is preferred
                setGenerating3DLayer(null);
                return;
            }
            // Fetch GLB and convert to base64 data URL for persistence
            const glbResponse = await fetch(glbUrl, { signal: controller.signal });
            const glbBlob = await glbResponse.blob();
            const glbDataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => { resolve(reader.result); };
                reader.onerror = reject;
                reader.readAsDataURL(glbBlob);
            });
            // Create a blob URL for Three.js rendering
            const glbBlobUrl = URL.createObjectURL(glbBlob);
            setLayerGlbUrls((prev) => ({ ...prev, [index]: glbBlobUrl }));
            // Persist the GLB as a Payload + annotation in project state
            const encoder = new TextEncoder();
            const glbBytes = encoder.encode(glbDataUrl);
            const glbHash = await sha256Hex(glbBytes.buffer);
            const glbPayloadId = makeId("payload");
            const glbPayloadValue = {
                id: glbPayloadId,
                kind: "Payload",
                mediaType: "model/gltf-binary",
                uri: glbDataUrl,
                sha256: glbHash,
                bytes: glbBytes.byteLength,
                meta: {
                    source: "sam3-image-to-3d",
                    layerIndex: String(index),
                },
            };
            commitPatch((prev) => {
                const ops = [];
                ops.push(putOp("Payload", glbPayloadId, glbPayloadValue));
                const existing = findLayerGlb(prev, activeSpaceId);
                const annId = existing ? existing.annotationId : makeId("annotation");
                const currentData = existing ? { ...existing.annotation.data } : {};
                currentData[`glb.${String(index)}`] = glbPayloadId;
                ops.push(putOp("Annotation", annId, {
                    id: annId,
                    kind: "Annotation",
                    target: { kind: "Space", id: activeSpaceId },
                    schema: "ui.layers.glb",
                    data: currentData,
                    createdAt: new Date().toISOString(),
                }));
                // Record in AI history
                const { sliceIds, ops: sliceOps } = getOrCreateSliceIds(prev, activeSpaceId);
                const sliceId = sliceIds[index];
                ops.push(...sliceOps);
                if (sliceId) {
                    const { history, annotationId: histAnnId, ops: histOps } = getOrCreateAIHistory(prev, activeSpaceId, sliceIds);
                    ops.push(...histOps);
                    const existingPid = layerPayloadId(findLayerRender(prev, activeSpaceId), index);
                    const rootAssets = {};
                    if (existingPid)
                        rootAssets.image = existingPid;
                    let updatedHistory = ensureHistoryGraphForSlice(history, sliceId, rootAssets);
                    const graph = updatedHistory.slices[sliceId];
                    // Use the display state captured at invocation time so the 3D
                    // model is linked to the node the user was viewing, not the
                    // operation cursor (which may differ after history navigation).
                    const inputStateId = capturedDisplayStateId && graph.states[capturedDisplayStateId]
                        ? capturedDisplayStateId
                        : graph.displayStateId;
                    // The output node keeps the same image as the source node and
                    // attaches the new GLB.
                    const sourceImagePid = (capturedImagePid ?? existingPid ?? glbPayloadId);
                    const histResult = addOpResultToGraph(graph, {
                        inputStateId,
                        opType: "imageTo3D",
                        outputAssets: [{ image: sourceImagePid, glb: glbPayloadId }],
                        summary: { model: "sam3" },
                        sliceIndex: index,
                    });
                    updatedHistory = { ...updatedHistory, slices: { ...updatedHistory.slices, [sliceId]: histResult.graph } };
                    ops.push(buildHistoryPatchOp(updatedHistory, histAnnId, activeSpaceId));
                }
                return newPatch({ baseRevision: prev.revision, ops });
            });
            console.info(`[3D] GLB model loaded and persisted for layer ${String(index)}`);
        }
        catch (err) {
            if (err instanceof DOMException && err.name === "AbortError")
                return;
            const msg = err instanceof Error ? err.message : "3D generation failed";
            console.error("[3D] failed:", msg);
            // Un-hide source on failure
            setThreeDSourceHidden((prev) => {
                const next = new Set(prev);
                next.delete(index);
                return next;
            });
        }
        finally {
            setGenerating3DLayer(null);
            abortRef.current = null;
        }
    }, [generating3DLayer, layerRender, state.payloads, commitPatch, activeSpaceId, layerTextures, getOrCreateSliceIds, getOrCreateAIHistory, buildHistoryPatchOp, getSliceHistory]);
    /** Import an image file into the selected layer. */
    const handleImportImage = useCallback(async () => {
        if (effectiveSelectedIndex === null)
            return;
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        const file = await new Promise((resolve) => {
            input.onchange = () => { resolve(input.files?.[0] ?? null); };
            input.click();
        });
        if (!file)
            return;
        const buffer = await file.arrayBuffer();
        const hash = await sha256Hex(buffer);
        // Convert to data URL for self-contained storage
        const reader = new FileReader();
        const dataUrl = await new Promise((resolve, reject) => {
            reader.onload = () => { resolve(reader.result); };
            reader.onerror = () => { reject(new Error("Failed to read file")); };
            reader.readAsDataURL(file);
        });
        // Read image natural dimensions
        const { w: imgW, h: imgH } = await new Promise((resolve) => {
            const img = new Image();
            img.onload = () => { resolve({ w: img.naturalWidth, h: img.naturalHeight }); };
            img.onerror = () => { resolve({ w: 0, h: 0 }); };
            img.src = dataUrl;
        });
        const payloadId = makeId("payload");
        const payloadValue = {
            id: payloadId,
            kind: "Payload",
            mediaType: file.type || "image/png",
            uri: dataUrl,
            sha256: hash,
            bytes: buffer.byteLength,
            meta: {
                ...(imgW > 0 && imgH > 0 ? { width: String(imgW), height: String(imgH) } : {}),
            },
        };
        const layerIdx = effectiveSelectedIndex;
        commitPatch((prev) => {
            const patchOps = [putOp("Payload", payloadId, payloadValue)];
            const { sliceIds, ops: sliceOps } = getOrCreateSliceIds(prev, activeSpaceId);
            const sliceId = sliceIds[layerIdx];
            patchOps.push(...sliceOps);
            if (sliceId) {
                const { history, annotationId, ops: histOps } = getOrCreateAIHistory(prev, activeSpaceId, sliceIds);
                patchOps.push(...histOps);
                const existingPid = layerPayloadId(findLayerRender(prev, activeSpaceId), layerIdx);
                const rootAssets = {};
                if (existingPid)
                    rootAssets.image = existingPid;
                let updatedHistory = ensureHistoryGraphForSlice(history, sliceId, rootAssets);
                const graph = updatedHistory.slices[sliceId];
                const result = addOpResultToGraph(graph, {
                    inputStateId: graph.operationStateId,
                    opType: "import",
                    outputAssets: [{ image: payloadId }],
                    sliceIndex: layerIdx,
                });
                updatedHistory = { ...updatedHistory, slices: { ...updatedHistory.slices, [sliceId]: result.graph } };
                patchOps.push(buildHistoryPatchOp(updatedHistory, annotationId, activeSpaceId));
            }
            // Render annotation update
            const existing = findLayerRender(prev, activeSpaceId);
            const annId = existing ? existing.annotationId : makeId("annotation");
            const currentData = existing ? { ...existing.annotation.data } : {};
            currentData[`payload.${String(layerIdx)}`] = payloadId;
            patchOps.push(putOp("Annotation", annId, {
                id: annId, kind: "Annotation",
                target: { kind: "Space", id: activeSpaceId },
                schema: "ui.layers.render", data: currentData,
                createdAt: new Date().toISOString(),
            }));
            return newPatch({ baseRevision: prev.revision, ops: patchOps });
        });
    }, [effectiveSelectedIndex, commitPatch, activeSpaceId, getOrCreateSliceIds, getOrCreateAIHistory, buildHistoryPatchOp]);
    /** Run AI edit on a specific layer's current image using the preferred model. */
    const handleAiEditForLayer = useCallback(async (layerIndex, prompt, strength) => {
        setAiErrors((prev) => { const next = { ...prev }; delete next[layerIndex]; return next; });
        setAiEditingLayers((prev) => new Set(prev).add(layerIndex));
        // Cancel any in-flight request for this layer
        abortRefs.current[layerIndex]?.abort();
        const controller = new AbortController();
        abortRefs.current[layerIndex] = controller;
        try {
            // Get the target layer's image
            const pid = layerPayloadId(layerRender, layerIndex);
            if (!pid) {
                throw new Error("No image on this layer. Import an image first.");
            }
            const payload = state.payloads[pid];
            if (!payload) {
                throw new Error("Payload not found in project state.");
            }
            // Use the *visible* texture (accounts for mask-off fallback, inversions,
            // combined masks, etc.) so the AI receives what the user actually sees.
            const visibleUri = layerTextures[layerIndex] ?? payload.uri;
            const inputPayloadId = pid;
            const modelDef = getAiEditModel(preferences.defaultAiEditModelId);
            // Preserve source dimensions so the AI output matches the input aspect ratio.
            // The Flux 2 API requires image_size width/height between 512 and 2048.
            const srcW = Number(payload.meta.width);
            const srcH = Number(payload.meta.height);
            let sourceImageSize;
            if (srcW > 0 && srcH > 0) {
                let w = srcW;
                let h = srcH;
                // Scale down if either dimension exceeds 2048
                const longest = Math.max(w, h);
                if (longest > 2048) {
                    const scale = 2048 / longest;
                    w = Math.round(w * scale);
                    h = Math.round(h * scale);
                }
                // Scale up if either dimension is below 512
                const shortest = Math.min(w, h);
                if (shortest < 512) {
                    const scale = 512 / shortest;
                    w = Math.round(w * scale);
                    h = Math.round(h * scale);
                }
                // Clamp to valid range
                w = Math.max(512, Math.min(2048, w));
                h = Math.max(512, Math.min(2048, h));
                sourceImageSize = { width: w, height: h };
            }
            // Run the selected model
            let result;
            if (modelDef.id === "nano-banana") {
                result = await runNanoBananaEdit({ imageDataUrls: [visibleUri], prompt }, controller.signal);
            }
            else {
                result = await runFlux2Edit({ imageDataUrls: [visibleUri], prompt, ...(sourceImageSize ? { imageSize: sourceImageSize } : {}) }, controller.signal);
            }
            const firstImage = result.images[0];
            if (!firstImage)
                throw new Error("fal.ai returned no images");
            let outputImageUrl = firstImage.url;
            // Preserve the raw AI output URL for mask regeneration
            const rawAiOutputUrl = outputImageUrl;
            // If the visible input was the masked payload (not the full original
            // fallback), check if the AI result still fits the original mask shape.
            // If not, run background removal to create a fresh segment.
            const maskOn = isMaskActive(layerProps, layerIndex, layerCount);
            const sentMaskedInput = maskOn && layerIndex > 0;
            // Parse source crop metadata if present
            const srcCrop = payload.meta.cropX !== undefined
                ? {
                    cropX: Number(payload.meta.cropX),
                    cropY: Number(payload.meta.cropY),
                    cropW: Number(payload.meta.cropW),
                    cropH: Number(payload.meta.cropH),
                    origW: Number(payload.meta.origW),
                    origH: Number(payload.meta.origH),
                }
                : undefined;
            let finalCrop = srcCrop;
            let wasRefit = false;
            if (sentMaskedInput) {
                // Use refitAiResult: measures mask fit, and if the AI output
                // doesn't match the original shape, runs background removal +
                // tight crop to create a proper new segment.
                const refit = await refitAiResult(outputImageUrl, visibleUri, srcCrop, controller.signal);
                outputImageUrl = refit.dataUrl;
                finalCrop = refit.crop;
                wasRefit = refit.wasRefit;
            }
            // Fetch the output image to compute sha256 + bytes
            const { blob: outBlob, buffer: outBuffer } = await fetchImageBlob(outputImageUrl, controller.signal);
            const outHash = await sha256Hex(outBuffer);
            // Always convert to a data URL so Three.js TextureLoader can use it
            // (remote fal.ai URLs hit CORS / expiry issues).
            if (!outputImageUrl.startsWith("data:")) {
                outputImageUrl = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => { resolve(reader.result); };
                    reader.onerror = () => { reject(new Error("Failed to convert blob to data URL")); };
                    reader.readAsDataURL(outBlob);
                });
            }
            const outPayloadId = makeId("payload");
            // Build crop metadata from refitAiResult (may differ from source if refit)
            const cropMeta = {};
            if (finalCrop) {
                cropMeta.cropX = String(finalCrop.cropX);
                cropMeta.cropY = String(finalCrop.cropY);
                cropMeta.cropW = String(finalCrop.cropW);
                cropMeta.cropH = String(finalCrop.cropH);
                cropMeta.origW = String(finalCrop.origW);
                cropMeta.origH = String(finalCrop.origH);
            }
            // Use the actual output image dimensions for width/height meta
            const outImgBitmap = await createImageBitmap(outBlob);
            const outW = outImgBitmap.width;
            const outH = outImgBitmap.height;
            outImgBitmap.close();
            const outPayloadValue = {
                id: outPayloadId,
                kind: "Payload",
                mediaType: outBlob.type || "image/png",
                uri: outputImageUrl,
                sha256: outHash,
                bytes: outBuffer.byteLength,
                meta: {
                    width: String(outW),
                    height: String(outH),
                    ...cropMeta,
                },
            };
            // Create OperatorRun for AI edit provenance
            const oprunId = makeId("oprun");
            const oprunValue = {
                id: oprunId,
                kind: "OperatorRun",
                operator: `fal.${modelDef.id}`,
                status: "succeeded",
                createdAt: new Date().toISOString(),
                finishedAt: new Date().toISOString(),
                inputs: [{ kind: "Payload", id: inputPayloadId }],
                outputs: [{ kind: "Payload", id: outPayloadId }],
                params: {
                    prompt,
                    ...(modelDef.hasStrength ? { strength: String(strength ?? 0.75) } : {}),
                    proxyRoute: modelDef.proxyRoute,
                    maskApplied: String(sentMaskedInput),
                    maskRefit: String(wasRefit),
                },
            };
            const patchOps = [
                putOp("Payload", outPayloadId, outPayloadValue),
                putOp("OperatorRun", oprunId, oprunValue),
            ];
            let finalPayloadId = outPayloadId;
            // Mask regeneration: run BiRefNet on the raw AI output to produce
            // a fresh segmentation mask. This prevents stale mask halos when
            // the AI shifts object boundaries.
            if (sentMaskedInput) {
                console.info("[Mask Regen] Running BiRefNet on raw AI output for fresh mask…");
                const bgRemovedUrl = await runBackgroundRemoval(rawAiOutputUrl, controller.signal);
                // Tight-crop the bg-removed result
                const { blob: bgBlob } = await fetchImageBlob(bgRemovedUrl, controller.signal);
                const bgBitmap = await createImageBitmap(bgBlob);
                const bgW = bgBitmap.width;
                const bgH = bgBitmap.height;
                const bgCanvas = document.createElement("canvas");
                bgCanvas.width = bgW;
                bgCanvas.height = bgH;
                const bgCtx = bgCanvas.getContext("2d");
                if (!bgCtx)
                    throw new Error("Canvas 2D context unavailable");
                bgCtx.drawImage(bgBitmap, 0, 0);
                const bgImgData = bgCtx.getImageData(0, 0, bgW, bgH);
                const bgData = bgImgData.data;
                bgBitmap.close();
                let minX = bgW, minY = bgH, maxX = 0, maxY = 0;
                for (let i = 3; i < bgData.length; i += 4) {
                    if ((bgData[i] ?? 0) > 10) {
                        const pIdx = (i - 3) / 4;
                        const px = pIdx % bgW;
                        const py = Math.floor(pIdx / bgW);
                        if (px < minX)
                            minX = px;
                        if (px > maxX)
                            maxX = px;
                        if (py < minY)
                            minY = py;
                        if (py > maxY)
                            maxY = py;
                    }
                }
                let regenUrl;
                let regenCrop;
                if (maxX >= minX && maxY >= minY) {
                    const cX = minX, cY = minY;
                    const cW = maxX - minX + 1, cH = maxY - minY + 1;
                    const cropCanvas = document.createElement("canvas");
                    cropCanvas.width = cW;
                    cropCanvas.height = cH;
                    const cropCtx = cropCanvas.getContext("2d");
                    if (!cropCtx)
                        throw new Error("Canvas 2D context unavailable");
                    cropCtx.drawImage(bgCanvas, cX, cY, cW, cH, 0, 0, cW, cH);
                    regenUrl = cropCanvas.toDataURL("image/png");
                    // Map crop back to original image coordinates if source had crop
                    if (srcCrop) {
                        const scaleX = srcCrop.cropW / bgW;
                        const scaleY = srcCrop.cropH / bgH;
                        regenCrop = {
                            cropX: srcCrop.cropX + Math.round(cX * scaleX),
                            cropY: srcCrop.cropY + Math.round(cY * scaleY),
                            cropW: Math.round(cW * scaleX),
                            cropH: Math.round(cH * scaleY),
                            origW: srcCrop.origW,
                            origH: srcCrop.origH,
                        };
                    }
                    else {
                        regenCrop = { cropX: cX, cropY: cY, cropW: cW, cropH: cH, origW: bgW, origH: bgH };
                    }
                }
                else {
                    regenUrl = bgRemovedUrl;
                    regenCrop = srcCrop;
                }
                // Build mask-regen payload
                const regenEncoder = new TextEncoder();
                const regenBytes = regenEncoder.encode(regenUrl);
                const regenHash = await sha256Hex(regenBytes.buffer);
                const regenPayloadId = makeId("payload");
                const regenCropMeta = {};
                if (regenCrop) {
                    regenCropMeta.cropX = String(regenCrop.cropX);
                    regenCropMeta.cropY = String(regenCrop.cropY);
                    regenCropMeta.cropW = String(regenCrop.cropW);
                    regenCropMeta.cropH = String(regenCrop.cropH);
                    regenCropMeta.origW = String(regenCrop.origW);
                    regenCropMeta.origH = String(regenCrop.origH);
                }
                const { blob: regenBlob } = await fetchImageBlob(regenUrl, controller.signal);
                const regenBitmap = await createImageBitmap(regenBlob);
                const regenW = regenBitmap.width;
                const regenH = regenBitmap.height;
                regenBitmap.close();
                const regenPayloadValue = {
                    id: regenPayloadId,
                    kind: "Payload",
                    mediaType: "image/png",
                    uri: regenUrl,
                    sha256: regenHash,
                    bytes: regenBytes.byteLength,
                    meta: {
                        width: String(regenW),
                        height: String(regenH),
                        sourcePayloadId: outPayloadId,
                        ...regenCropMeta,
                    },
                };
                // OperatorRun for mask regeneration (separate from AI edit)
                const maskRegenOprunId = makeId("oprun");
                const maskRegenOprunValue = {
                    id: maskRegenOprunId,
                    kind: "OperatorRun",
                    operator: "birefnet.mask-regen",
                    status: "succeeded",
                    createdAt: new Date().toISOString(),
                    finishedAt: new Date().toISOString(),
                    inputs: [{ kind: "Payload", id: outPayloadId }],
                    outputs: [{ kind: "Payload", id: regenPayloadId }],
                    params: {
                        proxyRoute: "fal-ai/birefnet",
                        sourceOperatorRunId: oprunId,
                    },
                };
                patchOps.push(putOp("Payload", regenPayloadId, regenPayloadValue));
                patchOps.push(putOp("OperatorRun", maskRegenOprunId, maskRegenOprunValue));
                finalPayloadId = regenPayloadId;
                console.info("[Mask Regen] Fresh mask generated and recorded as separate operation");
            }
            const layerIdx = layerIndex;
            // Record in AI history
            commitPatch((prev) => {
                const { sliceIds, ops: sliceOps } = getOrCreateSliceIds(prev, activeSpaceId);
                const sliceId = sliceIds[layerIdx];
                const allOps = [...patchOps, ...sliceOps];
                if (sliceId) {
                    const { history, annotationId, ops: histOps } = getOrCreateAIHistory(prev, activeSpaceId, sliceIds);
                    allOps.push(...histOps);
                    // Ensure graph exists for this slice
                    const existingPid = layerPayloadId(findLayerRender(prev, activeSpaceId), layerIdx);
                    const rootAssets = {};
                    if (existingPid)
                        rootAssets.image = existingPid;
                    let updatedHistory = ensureHistoryGraphForSlice(history, sliceId, rootAssets);
                    const graph = updatedHistory.slices[sliceId];
                    // Determine the opType
                    const aiOpType = sentMaskedInput ? "img2img" : "img2img";
                    const result = addOpResultToGraph(graph, {
                        inputStateId: graph.operationStateId,
                        opType: aiOpType,
                        operatorRunId: oprunId,
                        outputAssets: [{ image: finalPayloadId }],
                        summary: { model: modelDef.id, prompt },
                        sliceIndex: layerIdx,
                    });
                    updatedHistory = {
                        ...updatedHistory,
                        slices: { ...updatedHistory.slices, [sliceId]: result.graph },
                    };
                    allOps.push(buildHistoryPatchOp(updatedHistory, annotationId, activeSpaceId));
                }
                // Update render annotation
                const existing = findLayerRender(prev, activeSpaceId);
                const annId = existing ? existing.annotationId : makeId("annotation");
                const currentData = existing ? { ...existing.annotation.data } : {};
                currentData[`payload.${String(layerIdx)}`] = finalPayloadId;
                const renderAnn = {
                    id: annId,
                    kind: "Annotation",
                    target: { kind: "Space", id: activeSpaceId },
                    schema: "ui.layers.render",
                    data: currentData,
                    createdAt: new Date().toISOString(),
                };
                allOps.push(putOp("Annotation", annId, renderAnn));
                return newPatch({ baseRevision: prev.revision, ops: allOps });
            });
        }
        catch (err) {
            if (err instanceof DOMException && err.name === "AbortError")
                return;
            const msg = err instanceof Error ? err.message : "Unknown error";
            setAiErrors((prev) => ({ ...prev, [layerIndex]: msg }));
        }
        finally {
            setAiEditingLayers((prev) => { const next = new Set(prev); next.delete(layerIndex); return next; });
            delete abortRefs.current[layerIndex];
        }
    }, [layerRender, state.payloads, commitPatch, activeSpaceId, preferences.defaultAiEditModelId, layerProps, layerCount, layerTextures, getOrCreateSliceIds, getOrCreateAIHistory, buildHistoryPatchOp]);
    /** Run AI edit on the selected layer (backward-compat wrapper). */
    const handleAiEdit = useCallback((prompt, strength) => {
        if (effectiveSelectedIndex === null)
            return;
        void handleAiEditForLayer(effectiveSelectedIndex, prompt, strength);
    }, [effectiveSelectedIndex, handleAiEditForLayer]);
    /* ── Ingest flow: Tabula Rasa → Image → BrickUI ── */
    /** Proxy function for text-to-image generation via fal.ai */
    const proxyGenerate = useCallback(async (prompt, signal) => {
        const result = await runTextToImg({ prompt }, signal);
        const img = result.images[0];
        if (!img)
            throw new Error("No images returned");
        const out = { url: img.url };
        if (img.width != null)
            out.width = img.width;
        if (img.height != null)
            out.height = img.height;
        return out;
    }, []);
    /** Handle ingest commit: place image in space, run default operation. */
    const handleIngestCommit = useCallback(async (result) => {
        setShowIngest(false);
        const hash = await sha256Hex(result.bytes);
        const payloadId = makeId("payload");
        const payloadValue = {
            id: payloadId,
            kind: "Payload",
            mediaType: result.mediaType,
            uri: result.imageUrl,
            sha256: hash,
            bytes: result.bytes.byteLength,
            meta: {
                ...(result.width > 0 && result.height > 0
                    ? { width: String(result.width), height: String(result.height) }
                    : {}),
                ...(result.prompt ? { prompt: result.prompt } : {}),
            },
        };
        // Place the image on layer 0 of the active space
        const ops = [putOp("Payload", payloadId, payloadValue)];
        // Create/update render annotation to map layer 0 → this payload
        commitPatch((prev) => {
            const existing = findLayerRender(prev, activeSpaceId);
            const annId = existing
                ? existing.annotationId
                : makeId("annotation");
            const currentData = existing ? { ...existing.annotation.data } : {};
            const newData = { ...currentData, "payload.0": payloadId };
            const annotationValue = {
                id: annId,
                kind: "Annotation",
                target: { kind: "Space", id: activeSpaceId },
                schema: "ui.layers.render",
                data: newData,
                createdAt: new Date().toISOString(),
            };
            return newPatch({
                baseRevision: prev.revision,
                ops: [...ops, putOp("Annotation", annId, annotationValue)],
            });
        });
        // Select layer 0
        handleSelectLayer(0);
        // Store context for retry
        lastIngestRef.current = {
            payloadId,
            imageUrl: result.imageUrl,
            width: result.width,
            height: result.height,
            operationId: result.operationId,
            segmentMode: result.segmentMode,
        };
        // Run the default operation
        const op = getOperation(result.operationId);
        if (op && op.id !== "none") {
            setOpLabel(op.label + "…");
            setOpProgress({ phase: "running", label: op.label + "…" });
            // Show the slicing overlay with the ingested image while the operation runs
            setSlicingImageUrl(result.imageUrl);
            // Cancel any previous operation in-flight
            abortRef.current?.abort();
            const controller = new AbortController();
            abortRef.current = controller;
            try {
                // Read the latest state synchronously for context
                const currentState = await new Promise((resolve) => {
                    setState((s) => { resolve(s); return s; });
                });
                const opResult = await runOperation(op, activeSpaceId, payloadId, { state: currentState, imageWidth: result.width, imageHeight: result.height, segmentMode: result.segmentMode }, controller.signal);
                // Commit the operation result + build the render annotation from
                // the latest state (`prev`), so the annotation ID is always correct.
                commitPatch((prev) => {
                    const allOps = [...opResult.ops];
                    // Build the render annotation mapping from prev (latest state)
                    const maskIds = opResult.maskPayloadIds ?? [];
                    // Build a complete payload-per-layer map that includes the segment
                    // payloads being added in this same patch (prev doesn't have them yet).
                    const existing = findLayerRender(prev, activeSpaceId);
                    const annId = existing
                        ? existing.annotationId
                        : makeId("annotation");
                    const currentData = existing ? { ...existing.annotation.data } : {};
                    for (let i = 0; i < maskIds.length; i++) {
                        const pid = maskIds[i];
                        if (pid)
                            currentData[`payload.${String(i + 1)}`] = pid;
                    }
                    if (maskIds.length > 0) {
                        const annotationValue = {
                            id: annId,
                            kind: "Annotation",
                            target: { kind: "Space", id: activeSpaceId },
                            schema: "ui.layers.render",
                            data: currentData,
                            createdAt: new Date().toISOString(),
                        };
                        allOps.push(putOp("Annotation", annId, annotationValue));
                    }
                    // Initialize AI history with root states for each slice.
                    // We must use the segment payload IDs directly (from currentData)
                    // because they are being added in this same patch and won't be
                    // visible via findLayerRender(prev).
                    const { sliceIds, ops: sliceOps } = getOrCreateSliceIds(prev, activeSpaceId);
                    allOps.push(...sliceOps);
                    const existingHist = findAIHistory(prev, activeSpaceId);
                    let history;
                    let histAnnId;
                    let histOps;
                    if (existingHist) {
                        history = existingHist.history;
                        histAnnId = existingHist.annotationId;
                        histOps = [];
                    }
                    else {
                        history = createSpaceAIHistory();
                        // Use currentData (which includes the segment payloads) to
                        // initialize each slice's root state with the correct image.
                        for (let i = 0; i < sliceIds.length; i++) {
                            const sliceId = sliceIds[i];
                            const pid = currentData[`payload.${String(i)}`];
                            if (pid) {
                                history = ensureHistoryGraphForSlice(history, sliceId, {
                                    image: pid,
                                });
                            }
                        }
                        histAnnId = makeId("annotation");
                        const ann = {
                            id: histAnnId,
                            kind: "Annotation",
                            target: { kind: "Space", id: activeSpaceId },
                            schema: SPACE_AI_HISTORY_SCHEMA,
                            data: serializeAIHistory(history),
                            createdAt: new Date().toISOString(),
                        };
                        histOps = [putOp("Annotation", histAnnId, ann)];
                    }
                    allOps.push(...histOps);
                    // Set documentSourceImageId to the layer-0 payload (source image)
                    const updatedHistory = {
                        ...history,
                        documentSourceImageId: payloadId,
                    };
                    allOps.push(buildHistoryPatchOp(updatedHistory, histAnnId, activeSpaceId));
                    return newPatch({ baseRevision: prev.revision, ops: allOps });
                });
                // Dismiss the slicing overlay — reveals the expanded layers
                setSlicingImageUrl(null);
                const mc = opResult.maskCount ?? 0;
                // Store mask candidates for the picker
                if (opResult.maskCandidates && opResult.maskCandidates.length > 0) {
                    setMaskCandidates(opResult.maskCandidates);
                }
                // Trigger reveal animation when new slices are produced
                if (mc > 0) {
                    setRevealActive(true);
                }
                if (mc === 0) {
                    const warning = "No slices produced — segmentation returned 0 segments. Try a different image or retry.";
                    setOpProgress({
                        phase: "succeeded-warning",
                        oprunId: opResult.oprunId,
                        ops: opResult.ops,
                        warning,
                    });
                    setLastOpResult({ label: opLabel, maskCount: 0, warning });
                }
                else {
                    setOpProgress({ phase: "succeeded", oprunId: opResult.oprunId, ops: opResult.ops, maskCount: mc });
                    setLastOpResult({ label: opLabel, maskCount: mc });
                    // Auto-dismiss after a few seconds
                    setTimeout(() => { setOpProgress(null); }, 3000);
                }
            }
            catch (err) {
                if (err instanceof DOMException && err.name === "AbortError")
                    return;
                const msg = err instanceof Error ? err.message : "Operation failed";
                setOpProgress({ phase: "failed", error: msg });
                setSlicingImageUrl(null);
            }
            finally {
                abortRef.current = null;
            }
        }
    }, [activeSpaceId, commitPatch, handleSelectLayer, getOrCreateSliceIds, getOrCreateAIHistory, buildHistoryPatchOp]);
    /** Update a preference and persist. */
    const handleChangePreference = useCallback((key, value) => {
        setPreferences((prev) => {
            const next = { ...prev, [key]: value };
            savePreferences(next);
            return next;
        });
    }, []);
    // Helper functions for LayersPanel (needs layerProps + layerCount)
    const isHiddenFn = useCallback((index) => isHidden(layerProps, index, layerCount), [layerProps, layerCount]);
    const persistedOpacityFn = useCallback((index) => opacityMultiplier(layerProps, index, layerCount), [layerProps, layerCount]);
    const isMaskActiveFn = useCallback((index) => isMaskActive(layerProps, index, layerCount), [layerProps, layerCount]);
    const isMaskInvertedFn = useCallback((index) => isMaskInverted(layerProps, index, layerCount), [layerProps, layerCount]);
    // Layer stepping with [ / ]
    const handleStepLayer = useCallback((direction) => {
        const current = effectiveSelectedIndex ?? 0;
        const next = Math.max(0, Math.min(layerCount - 1, current + direction));
        handleSelectLayer(next);
    }, [effectiveSelectedIndex, layerCount, handleSelectLayer]);
    useEffect(() => {
        const onKeyDown = (e) => {
            // Don't intercept if typing in an input
            const tag = e.target.tagName;
            if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT")
                return;
            if (e.key === "Escape") {
                handleClearSelection();
                return;
            }
            const mod = e.metaKey || e.ctrlKey;
            if (mod && e.key === "z" && !e.shiftKey) {
                e.preventDefault();
                handleUndo();
            }
            else if (mod && e.key === "z" && e.shiftKey) {
                e.preventDefault();
                handleRedo();
            }
            else if (mod && e.key === "y") {
                e.preventDefault();
                handleRedo();
            }
            // View mode switching: 1 / 2 / 3
            if (!mod && e.key === "1") {
                handleSetViewMode("universal");
                return;
            }
            if (!mod && e.key === "2") {
                handleSetViewMode("layers");
                return;
            }
            if (!mod && e.key === "3") {
                handleSetViewMode("minimalist");
                return;
            }
            // Layer stepping: [ / ]
            if (e.key === "[") {
                handleStepLayer(-1);
                return;
            }
            if (e.key === "]") {
                handleStepLayer(1);
                return;
            }
            // Delete selected layer: Delete / Backspace
            if ((e.key === "Delete" || e.key === "Backspace") && effectiveSelectedIndex !== null && layerCount > 1) {
                e.preventDefault();
                handleDeleteSlice(effectiveSelectedIndex);
                return;
            }
            // Peek overlays: hold Tab = layers, hold Shift = rail
            if (e.key === "Tab" && !mod) {
                e.preventDefault();
                setPeekLayers(true);
                return;
            }
            if (e.key === "Shift" && !e.repeat) {
                setPeekRail(true);
                return;
            }
        };
        const onKeyUp = (e) => {
            if (e.key === "Tab") {
                setPeekLayers(false);
            }
            if (e.key === "Shift") {
                setPeekRail(false);
            }
        };
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("keyup", onKeyUp);
        };
    }, [handleClearSelection, handleUndo, handleRedo, handleStepLayer, handleSetViewMode, handleDeleteSlice, effectiveSelectedIndex, layerCount]);
    return (_jsxs("div", { className: "app-shell", style: { height: "100%", display: "grid", gridTemplateRows: "0px 1fr" }, children: [_jsxs("header", { ref: headerRef, style: {
                    display: "flex",
                    alignItems: "center",
                    padding: "0 12px",
                    background: template.colors.background,
                    color: template.colors.foreground,
                    borderBottom: `1px solid ${template.colors.accent}22`,
                    overflow: "hidden",
                    opacity: 0,
                    pointerEvents: "none",
                }, children: [_jsx("strong", { style: { color: "var(--hud-text)" }, children: "Unbricked" }), _jsx("span", { style: { marginLeft: 10 }, children: _jsx(ViewModeSwitcher, { current: viewMode, onChange: handleSetViewMode }) }), _jsx("button", { type: "button", onClick: handleUndo, disabled: undoCount === 0, style: {
                            marginLeft: "auto",
                            background: "none",
                            border: "1px solid var(--hud-border-btn)",
                            color: undoCount === 0 ? "var(--hud-muted)" : "var(--hud-text)",
                            padding: "4px 10px",
                            borderRadius: 4,
                            cursor: undoCount === 0 ? "default" : "pointer",
                            fontSize: 13,
                        }, children: "Undo" }), _jsx("button", { type: "button", onClick: handleRedo, disabled: redoCount === 0, style: {
                            marginLeft: 6,
                            background: "none",
                            border: "1px solid var(--hud-border-btn)",
                            color: redoCount === 0 ? "var(--hud-muted)" : "var(--hud-text)",
                            padding: "4px 10px",
                            borderRadius: 4,
                            cursor: redoCount === 0 ? "default" : "pointer",
                            fontSize: 13,
                        }, children: "Redo" }), _jsx("button", { type: "button", onClick: handleToggleView, disabled: animPhase !== "idle", style: {
                            marginLeft: 6,
                            background: "none",
                            border: "1px solid var(--hud-border-btn)",
                            color: "var(--hud-text)",
                            padding: "4px 10px",
                            borderRadius: 4,
                            cursor: "pointer",
                            fontSize: 13,
                        }, children: isTopDown ? "3D view" : "Top-down" }), _jsx("button", { type: "button", onClick: handleResetView, disabled: animPhase !== "idle", style: {
                            marginLeft: 6,
                            background: "none",
                            border: "1px solid var(--hud-border-btn)",
                            color: "var(--hud-text)",
                            padding: "4px 10px",
                            borderRadius: 4,
                            cursor: "pointer",
                            fontSize: 13,
                        }, children: "Reset view" }), _jsx("button", { type: "button", onClick: () => { setShowSettings((v) => !v); }, style: {
                            marginLeft: 6,
                            background: showSettings ? "var(--hud-active)" : "none",
                            border: "1px solid var(--hud-border-btn)",
                            color: "var(--hud-text)",
                            padding: "4px 10px",
                            borderRadius: 4,
                            cursor: "pointer",
                            fontSize: 13,
                        }, children: "\u2699" }), _jsx("button", { type: "button", onClick: () => {
                            clearProjectState();
                            const fresh = createSampleProject();
                            setState(fresh.state);
                            const newRoot = fresh.state.manifest.rootSpaceId;
                            void spaceNav.navigateTo(newRoot, { replace: true });
                            spaceNav.setOrigin(newRoot);
                            pastRef.current = [];
                            futureRef.current = [];
                            setUndoCount(0);
                            setRedoCount(0);
                            setPreviewLayerIndex(null);
                            setPreviewOpacity(null);
                            setPreviewOrder(null);
                            setOpProgress(null);
                            setLastOpResult(null);
                            setSlicingImageUrl(null);
                            setMaskCandidates([]);
                            setShowMaskPicker(false);
                            setGenerating3DLayer(null);
                            setLayerGlbUrls({});
                            setThreeDSourceHidden(new Set());
                        }, style: {
                            marginLeft: 6,
                            background: "none",
                            border: "1px solid var(--hud-border-btn)",
                            color: "var(--hud-text)",
                            padding: "4px 10px",
                            borderRadius: 4,
                            cursor: "pointer",
                            fontSize: 13,
                            opacity: 0.6,
                        }, children: "Reset project" })] }), _jsxs("div", { style: { position: "relative", overflow: "hidden" }, children: [_jsx(SpaceViewport, { layerCount: layerCount, selectedLayerIndex: effectiveSelectedIndex, onSelectLayer: handleSelectLayer, onPreviewLayer: setPreviewLayerIndex, layerVisibility: layerVisibility, soloIndex: solo, onToggleHidden: handleToggleHidden, onToggleSolo: handleToggleSolo, onToggleMask: handleToggleMask, maskActive: effectiveSelectedIndex !== null ? isMaskActive(layerProps, effectiveSelectedIndex, layerCount) : true, onPreviewOpacity: setPreviewOpacity, onCommitOpacity: handleCommitOpacity, persistedOpacity: effectiveSelectedIndex !== null ? opacityMultiplier(layerProps, effectiveSelectedIndex, layerCount) : 1.0, persistedOpacityFn: persistedOpacityFn, isHiddenFn: isHiddenFn, layerOrder: effectiveOrder, onPreviewOrder: setPreviewOrder, onCommitOrder: handleCommitOrder, animPhase: animPhase, onAnimDone: handleAnimDone, viewMode: viewMode, peekLayers: peekLayers, peekRail: peekRail, onClearSelection: handleClearSelection, layerTextures: layerTextures, layerThumbnails: layerThumbnails, layerNames: layerNames, onRenameLayer: handleRenameLayer, colorLayerTextures: colorLayerTextures, layerCropInfo: layerCropInfo, segmentDisplayMode: segmentDisplayMode, onToggleSegmentDisplay: () => { setSegmentDisplayMode((m) => m === "masked" ? "colored" : "masked"); }, revealActive: revealActive, onRevealDone: () => { setRevealActive(false); }, imageAspect: imageAspect, onImportImage: () => { void handleImportImage(); }, onAiEdit: (prompt, strength) => { void handleAiEdit(prompt, strength); }, onAiEditForLayer: (layerIndex, prompt, strength) => { void handleAiEditForLayer(layerIndex, prompt, strength); }, aiEditingLayers: aiEditingLayers, aiErrors: aiErrors, onPromptVisibilityChange: setAiPromptOpen, onAddSlice: handleAddSlice, onDeleteSlice: handleDeleteSlice, isMaskActiveFn: isMaskActiveFn, isMaskInvertedFn: isMaskInvertedFn, onInvertMask: (index) => { void handleInvertMask(index); }, aiEditModelId: preferences.defaultAiEditModelId, onChangeAiEditModel: (id) => { handleChangePreference("defaultAiEditModelId", id); }, onGenerate3D: (index) => { void handleGenerate3D(index); }, generating3DLayer: generating3DLayer, layerGlbUrls: layerGlbUrls, threeDSourceHidden: threeDSourceHidden, onToggle3DSourceImage: handleToggle3DSourceImage, getSliceHistory: getSliceHistory, onSetDisplayCursor: handleSetDisplayCursor, onSetOperationCursor: handleSetOperationCursor, payloads: state.payloads, keyframePreviewUrl: keyframePreviewUrl, onCompositeKeyframe: () => { void handleCompositeKeyframe(); }, compositeResultUrl: compositeResultUrl, compositeBusy: compositeBusy, documentSourceImageId: aiHistory?.history.documentSourceImageId }), _jsx(SpaceAddressHUD, { fallbackSpaceId: rootSpaceId, spaces: state.spaces }), _jsx(PortalOverlay, { portalEdges: portalEdges, spaces: state.spaces, onEnter: handleNavigateToSpace }), isTabulaRasa && !showIngest && (_jsx(TabulaRasa, { onTap: () => { setShowIngest(true); } })), showIngest && (_jsx(ImageIngestPanel, { defaultOperationId: preferences.defaultImageOperationId, onCommit: (result) => void handleIngestCommit(result), onCancel: () => { setShowIngest(false); }, proxyGenerate: proxyGenerate })), slicingImageUrl && opProgress && opProgress.phase === "running" && (_jsx(SlicingOverlay, { imageUrl: slicingImageUrl, label: opLabel })), opProgress && !slicingImageUrl && (_jsx(OperationProgressHUD, { progress: opProgress, operationLabel: opLabel, onRetry: () => {
                            setOpProgress(null);
                            if (lastIngestRef.current) {
                                const ctx = lastIngestRef.current;
                                const op = getOperation(ctx.operationId);
                                if (op && op.id !== "none") {
                                    setOpLabel(op.label + "…");
                                    setOpProgress({ phase: "running", label: op.label + "…" });
                                    setSlicingImageUrl(ctx.imageUrl);
                                    abortRef.current?.abort();
                                    const controller = new AbortController();
                                    abortRef.current = controller;
                                    void (async () => {
                                        try {
                                            const currentState = await new Promise((resolve) => {
                                                setState((s) => { resolve(s); return s; });
                                            });
                                            const opResult = await runOperation(op, activeSpaceId, ctx.payloadId, { state: currentState, imageWidth: ctx.width, imageHeight: ctx.height, segmentMode: ctx.segmentMode }, controller.signal);
                                            commitPatch((prev) => {
                                                const allOps = [...opResult.ops];
                                                const maskIds = opResult.maskPayloadIds ?? [];
                                                // Build the complete payload-per-layer map including
                                                // segment payloads being added in this same patch.
                                                const existing = findLayerRender(prev, activeSpaceId);
                                                const annId = existing ? existing.annotationId : makeId("annotation");
                                                const currentData = existing ? { ...existing.annotation.data } : {};
                                                for (let i = 0; i < maskIds.length; i++) {
                                                    const pid = maskIds[i];
                                                    if (pid)
                                                        currentData[`payload.${String(i + 1)}`] = pid;
                                                }
                                                if (maskIds.length > 0) {
                                                    const annotationValue = {
                                                        id: annId,
                                                        kind: "Annotation",
                                                        target: { kind: "Space", id: activeSpaceId },
                                                        schema: "ui.layers.render",
                                                        data: currentData,
                                                        createdAt: new Date().toISOString(),
                                                    };
                                                    allOps.push(putOp("Annotation", annId, annotationValue));
                                                }
                                                // Initialize AI history with root states (retry path)
                                                // Use currentData (includes segment payloads from this patch)
                                                const { sliceIds: retrySliceIds, ops: retrySliceOps } = getOrCreateSliceIds(prev, activeSpaceId);
                                                allOps.push(...retrySliceOps);
                                                const existingRetryHist = findAIHistory(prev, activeSpaceId);
                                                let retryHist;
                                                let retryHistAnnId;
                                                let retryHistOps;
                                                if (existingRetryHist) {
                                                    retryHist = existingRetryHist.history;
                                                    retryHistAnnId = existingRetryHist.annotationId;
                                                    retryHistOps = [];
                                                }
                                                else {
                                                    retryHist = createSpaceAIHistory();
                                                    for (let i = 0; i < retrySliceIds.length; i++) {
                                                        const sliceId = retrySliceIds[i];
                                                        const pid = currentData[`payload.${String(i)}`];
                                                        if (pid) {
                                                            retryHist = ensureHistoryGraphForSlice(retryHist, sliceId, {
                                                                image: pid,
                                                            });
                                                        }
                                                    }
                                                    retryHistAnnId = makeId("annotation");
                                                    const ann = {
                                                        id: retryHistAnnId,
                                                        kind: "Annotation",
                                                        target: { kind: "Space", id: activeSpaceId },
                                                        schema: SPACE_AI_HISTORY_SCHEMA,
                                                        data: serializeAIHistory(retryHist),
                                                        createdAt: new Date().toISOString(),
                                                    };
                                                    retryHistOps = [putOp("Annotation", retryHistAnnId, ann)];
                                                }
                                                allOps.push(...retryHistOps);
                                                const updatedRetryHist = { ...retryHist, documentSourceImageId: ctx.payloadId };
                                                allOps.push(buildHistoryPatchOp(updatedRetryHist, retryHistAnnId, activeSpaceId));
                                                return newPatch({ baseRevision: prev.revision, ops: allOps });
                                            });
                                            setSlicingImageUrl(null);
                                            const mc = opResult.maskCount ?? 0;
                                            if (opResult.maskCandidates && opResult.maskCandidates.length > 0) {
                                                setMaskCandidates(opResult.maskCandidates);
                                            }
                                            if (mc > 0)
                                                setRevealActive(true);
                                            if (mc === 0) {
                                                const warning = "No slices produced — segmentation returned 0 segments. Try a different image or retry.";
                                                setOpProgress({ phase: "succeeded-warning", oprunId: opResult.oprunId, ops: opResult.ops, warning });
                                                setLastOpResult({ label: op.label, maskCount: 0, warning });
                                            }
                                            else {
                                                setOpProgress({ phase: "succeeded", oprunId: opResult.oprunId, ops: opResult.ops, maskCount: mc });
                                                setLastOpResult({ label: op.label, maskCount: mc });
                                                setTimeout(() => { setOpProgress(null); }, 3000);
                                            }
                                        }
                                        catch (err) {
                                            if (err instanceof DOMException && err.name === "AbortError")
                                                return;
                                            const msg = err instanceof Error ? err.message : "Operation failed";
                                            setOpProgress({ phase: "failed", error: msg });
                                            setSlicingImageUrl(null);
                                        }
                                        finally {
                                            abortRef.current = null;
                                        }
                                    })();
                                    return;
                                }
                            }
                            // Fallback: re-open ingest if no retry context
                            setShowIngest(true);
                        }, onDismiss: () => { setOpProgress(null); } })), !opProgress && !aiRunning && !aiPromptOpen && lastOpResult && !slicingImageUrl && !isTabulaRasa && (_jsxs("button", { type: "button", onClick: () => {
                            if (lastOpResult.maskCount === 0 && lastOpResult.warning) {
                                setOpProgress({
                                    phase: "succeeded-warning",
                                    oprunId: "",
                                    ops: [],
                                    warning: lastOpResult.warning,
                                });
                            }
                            else {
                                setOpProgress({
                                    phase: "succeeded",
                                    oprunId: "",
                                    ops: [],
                                    maskCount: lastOpResult.maskCount,
                                });
                                setTimeout(() => { setOpProgress(null); }, 3000);
                            }
                        }, title: "Last segmentation result", style: {
                            position: "absolute",
                            bottom: 60,
                            left: "50%",
                            transform: "translateX(-50%)",
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "4px 12px",
                            background: "var(--hud-bg)",
                            border: "1px solid var(--hud-border)",
                            borderRadius: 6,
                            color: lastOpResult.maskCount === 0 ? "var(--color-warning)" : "var(--color-success)",
                            fontSize: 12,
                            cursor: "pointer",
                            zIndex: 79,
                            backdropFilter: "blur(8px)",
                            opacity: 0.7,
                        }, children: [_jsx("span", { style: { fontSize: 14 }, children: lastOpResult.maskCount === 0 ? "⚠" : "✓" }), _jsx("span", { children: lastOpResult.maskCount === 0 ? "0 slices" : `${String(lastOpResult.maskCount)} slices` })] })), !opProgress && !aiRunning && !aiPromptOpen && maskCandidates.length > 0 && !slicingImageUrl && !isTabulaRasa && (_jsxs("button", { type: "button", onClick: () => { setShowMaskPicker(true); }, title: "Pick & combine masks", style: {
                            position: "absolute",
                            bottom: 60,
                            left: "50%",
                            transform: "translateX(80px)",
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            padding: "4px 10px",
                            background: "var(--hud-bg)",
                            border: "1px solid var(--hud-border)",
                            borderRadius: 6,
                            color: "var(--scrubber-active)",
                            fontSize: 12,
                            cursor: "pointer",
                            zIndex: 79,
                            backdropFilter: "blur(8px)",
                        }, children: [_jsx("span", { style: { fontSize: 14 }, children: "\uD83C\uDFAD" }), _jsxs("span", { children: ["Masks (", String(maskCandidates.length), ")"] })] })), showMaskPicker && maskCandidates.length > 0 && (_jsx(MaskPickerPanel, { candidates: maskCandidates, onCombine: handleCombineMasks, onClose: () => { setShowMaskPicker(false); }, combining: combining })), showSettings && (_jsx(SettingsPanel, { preferences: preferences, onChangePreference: handleChangePreference, onClose: () => { setShowSettings(false); } }))] })] }));
}
