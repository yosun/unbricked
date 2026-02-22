import { deserializeAIHistory } from "./history/historyGraph";
import { SPACE_AI_HISTORY_SCHEMA } from "./history/aiHistorySchema";
export function findLayerSelection(state, spaceId) {
    const ann = Object.values(state.annotations).find((a) => a.target.kind === "Space" &&
        a.target.id === spaceId &&
        a.schema === "ui.selection.layerIndex");
    if (!ann)
        return null;
    const raw = ann.data["layerIndex"];
    if (raw === undefined)
        return null;
    const n = Number(raw);
    if (!Number.isFinite(n))
        return null;
    const idx = Math.trunc(n);
    if (idx < 0)
        return null;
    const space = state.spaces[spaceId];
    if (!space)
        return null;
    if (idx >= space.layerCount)
        return null;
    return { annotationId: ann.id, index: idx };
}
export function findLayerProps(state, spaceId) {
    const ann = Object.values(state.annotations).find((a) => a.target.kind === "Space" &&
        a.target.id === spaceId &&
        a.schema === "ui.layers.props");
    if (!ann)
        return null;
    return { annotationId: ann.id, annotation: ann };
}
export function isHidden(props, index, layerCount) {
    if (!props)
        return false;
    if (index < 0 || index >= layerCount)
        return false;
    return props.annotation.data[`hidden.${String(index)}`] === "true";
}
/**
 * Whether the mask for a layer is active (operations are constrained to this slice's region).
 * Defaults to `true` — masks are active out of the box.
 */
export function isMaskActive(props, index, layerCount) {
    if (!props)
        return true;
    if (index < 0 || index >= layerCount)
        return true;
    // Stored as "false" to disable; absent / "true" = active
    return props.annotation.data[`maskActive.${String(index)}`] !== "false";
}
/**
 * Whether the mask for a layer is inverted (foreground/background swapped).
 * Defaults to `false`.
 */
export function isMaskInverted(props, index, layerCount) {
    if (!props)
        return false;
    if (index < 0 || index >= layerCount)
        return false;
    return props.annotation.data[`maskInverted.${String(index)}`] === "true";
}
export function opacityMultiplier(props, index, layerCount) {
    if (!props)
        return 1.0;
    if (index < 0 || index >= layerCount)
        return 1.0;
    const raw = props.annotation.data[`opacity.${String(index)}`];
    if (raw === undefined)
        return 1.0;
    const n = Number(raw);
    if (!Number.isFinite(n))
        return 1.0;
    return Math.max(0, Math.min(1, n));
}
export function soloIndex(props, layerCount) {
    if (!props)
        return null;
    const raw = props.annotation.data["solo"];
    if (raw === undefined)
        return null;
    const n = Number(raw);
    if (!Number.isFinite(n))
        return null;
    const idx = Math.trunc(n);
    if (idx < 0 || idx >= layerCount)
        return null;
    return idx;
}
/**
 * Get the user-assigned name for a layer, or null if unnamed.
 */
export function layerName(props, index) {
    if (!props)
        return null;
    const raw = props.annotation.data[`name.${String(index)}`];
    if (!raw || raw.length === 0)
        return null;
    return raw;
}
/**
 * Parse and validate a persisted layer order annotation.
 * Returns `null` if no valid order annotation exists;
 * callers should fall back to the default `[0..layerCount-1]`.
 */
export function findLayerOrder(state, spaceId) {
    const ann = Object.values(state.annotations).find((a) => a.target.kind === "Space" &&
        a.target.id === spaceId &&
        a.schema === "ui.layers.order");
    if (!ann)
        return null;
    const raw = ann.data["order"];
    if (raw === undefined)
        return null;
    const space = state.spaces[spaceId];
    if (!space)
        return null;
    const order = parseLayerOrder(raw, space.layerCount);
    if (!order)
        return null;
    return { annotationId: ann.id, order };
}
/**
 * Parse a comma-separated order string and validate it is a
 * permutation of `[0..layerCount-1]`. Returns `null` if invalid.
 */
export function parseLayerOrder(raw, layerCount) {
    const parts = raw.split(",");
    if (parts.length !== layerCount)
        return null;
    const order = [];
    const seen = new Set();
    for (const part of parts) {
        const n = Number(part);
        if (!Number.isFinite(n))
            return null;
        const idx = Math.trunc(n);
        if (idx < 0 || idx >= layerCount)
            return null;
        if (seen.has(idx))
            return null;
        seen.add(idx);
        order.push(idx);
    }
    return order;
}
/** Build the default order `[0, 1, 2, ..., layerCount-1]`. */
export function defaultLayerOrder(layerCount) {
    return Array.from({ length: layerCount }, (_, i) => i);
}
/** Serialize an order array to the persisted comma-separated string. */
export function serializeOrder(order) {
    return order.join(",");
}
/**
 * Find the "ui.layers.render" annotation for a Space.
 * Returns the annotation (which maps layer indices → payload IDs) or null.
 */
export function findLayerRender(state, spaceId) {
    const ann = Object.values(state.annotations).find((a) => a.target.kind === "Space" &&
        a.target.id === spaceId &&
        a.schema === "ui.layers.render");
    if (!ann)
        return null;
    return { annotationId: ann.id, annotation: ann };
}
/**
 * Get the payload ID assigned to a specific layer, or null if none.
 */
export function layerPayloadId(render, index) {
    if (!render)
        return null;
    const raw = render.annotation.data[`payload.${String(index)}`];
    if (!raw || raw.length === 0)
        return null;
    return raw;
}
/**
 * Find the "ui.layers.glb" annotation for a Space.
 * Maps `glb.{index}` → payload ID whose `uri` is a base64 data URL of the GLB file.
 */
export function findLayerGlb(state, spaceId) {
    const ann = Object.values(state.annotations).find((a) => a.target.kind === "Space" &&
        a.target.id === spaceId &&
        a.schema === "ui.layers.glb");
    if (!ann)
        return null;
    return { annotationId: ann.id, annotation: ann };
}
/**
 * Get the GLB payload ID assigned to a specific layer, or null if none.
 */
export function layerGlbPayloadId(glb, index) {
    if (!glb)
        return null;
    const raw = glb.annotation.data[`glb.${String(index)}`];
    if (!raw || raw.length === 0)
        return null;
    return raw;
}
/* ── Portal edges ────────────────────────────────── */
/**
 * Find all portal edges **from** a given Space.
 * Each portal edge points to a target Space the user can "enter".
 */
export function findPortalEdges(state, spaceId) {
    return Object.values(state.edges).filter((e) => e.edgeKind === "portal" && e.from === spaceId);
}
/**
 * Find the SpaceAIHistory annotation for a Space.
 * Returns the deserialized history + annotation ID, or null if none.
 */
export function findAIHistory(state, spaceId) {
    const ann = Object.values(state.annotations).find((a) => a.target.kind === "Space" &&
        a.target.id === spaceId &&
        a.schema === SPACE_AI_HISTORY_SCHEMA);
    if (!ann)
        return null;
    const history = deserializeAIHistory(ann.data);
    if (!history)
        return null;
    return { annotationId: ann.id, history };
}
/**
 * Find the stable slice ID mapping for a Space.
 * Maps layer indices to stable IDs for history keying.
 */
export function findSliceIds(state, spaceId) {
    const ann = Object.values(state.annotations).find((a) => a.target.kind === "Space" &&
        a.target.id === spaceId &&
        a.schema === "ui.layers.sliceIds");
    if (!ann)
        return null;
    const raw = ann.data["ids"];
    if (!raw)
        return null;
    try {
        const ids = JSON.parse(raw);
        if (!Array.isArray(ids))
            return null;
        return { annotationId: ann.id, ids };
    }
    catch {
        return null;
    }
}
