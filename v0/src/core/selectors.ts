import type { Annotation, AnnotationId, Edge, ProjectState, SpaceId } from "./types";

export function findLayerSelection(
  state: ProjectState,
  spaceId: SpaceId,
): { annotationId: AnnotationId; index: number } | null {
  const ann = Object.values(state.annotations).find(
    (a) =>
      a.target.kind === "Space" &&
      a.target.id === spaceId &&
      a.schema === "ui.selection.layerIndex",
  );
  if (!ann) return null;

  const raw = ann.data["layerIndex"];
  if (raw === undefined) return null;

  const n = Number(raw);
  if (!Number.isFinite(n)) return null;

  const idx = Math.trunc(n);
  if (idx < 0) return null;

  const space = state.spaces[spaceId];
  if (!space) return null;

  if (idx >= space.layerCount) return null;

  return { annotationId: ann.id, index: idx };
}

/* ── Layer props ─────────────────────────────────── */

export interface LayerProps {
  annotationId: AnnotationId;
  annotation: Annotation;
}

export function findLayerProps(
  state: ProjectState,
  spaceId: SpaceId,
): LayerProps | null {
  const ann = Object.values(state.annotations).find(
    (a) =>
      a.target.kind === "Space" &&
      a.target.id === spaceId &&
      a.schema === "ui.layers.props",
  );
  if (!ann) return null;
  return { annotationId: ann.id, annotation: ann };
}

export function isHidden(
  props: LayerProps | null,
  index: number,
  layerCount: number,
): boolean {
  if (!props) return false;
  if (index < 0 || index >= layerCount) return false;
  return props.annotation.data[`hidden.${String(index)}`] === "true";
}

/**
 * Whether the mask for a layer is active (operations are constrained to this slice's region).
 * Defaults to `true` — masks are active out of the box.
 */
export function isMaskActive(
  props: LayerProps | null,
  index: number,
  layerCount: number,
): boolean {
  if (!props) return true;
  if (index < 0 || index >= layerCount) return true;
  // Stored as "false" to disable; absent / "true" = active
  return props.annotation.data[`maskActive.${String(index)}`] !== "false";
}

/**
 * Whether the mask for a layer is inverted (foreground/background swapped).
 * Defaults to `false`.
 */
export function isMaskInverted(
  props: LayerProps | null,
  index: number,
  layerCount: number,
): boolean {
  if (!props) return false;
  if (index < 0 || index >= layerCount) return false;
  return props.annotation.data[`maskInverted.${String(index)}`] === "true";
}

export function opacityMultiplier(
  props: LayerProps | null,
  index: number,
  layerCount: number,
): number {
  if (!props) return 1.0;
  if (index < 0 || index >= layerCount) return 1.0;
  const raw = props.annotation.data[`opacity.${String(index)}`];
  if (raw === undefined) return 1.0;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 1.0;
  return Math.max(0, Math.min(1, n));
}

export function soloIndex(
  props: LayerProps | null,
  layerCount: number,
): number | null {
  if (!props) return null;
  const raw = props.annotation.data["solo"];
  if (raw === undefined) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const idx = Math.trunc(n);
  if (idx < 0 || idx >= layerCount) return null;
  return idx;
}

/* ── Layer order ─────────────────────────────────── */

export interface LayerOrder {
  annotationId: AnnotationId;
  order: number[];
}

/**
 * Parse and validate a persisted layer order annotation.
 * Returns `null` if no valid order annotation exists;
 * callers should fall back to the default `[0..layerCount-1]`.
 */
export function findLayerOrder(
  state: ProjectState,
  spaceId: SpaceId,
): LayerOrder | null {
  const ann = Object.values(state.annotations).find(
    (a) =>
      a.target.kind === "Space" &&
      a.target.id === spaceId &&
      a.schema === "ui.layers.order",
  );
  if (!ann) return null;

  const raw = ann.data["order"];
  if (raw === undefined) return null;

  const space = state.spaces[spaceId];
  if (!space) return null;

  const order = parseLayerOrder(raw, space.layerCount);
  if (!order) return null;

  return { annotationId: ann.id, order };
}

/**
 * Parse a comma-separated order string and validate it is a
 * permutation of `[0..layerCount-1]`. Returns `null` if invalid.
 */
export function parseLayerOrder(
  raw: string,
  layerCount: number,
): number[] | null {
  const parts = raw.split(",");
  if (parts.length !== layerCount) return null;

  const order: number[] = [];
  const seen = new Set<number>();
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isFinite(n)) return null;
    const idx = Math.trunc(n);
    if (idx < 0 || idx >= layerCount) return null;
    if (seen.has(idx)) return null;
    seen.add(idx);
    order.push(idx);
  }

  return order;
}

/** Build the default order `[0, 1, 2, ..., layerCount-1]`. */
export function defaultLayerOrder(layerCount: number): number[] {
  return Array.from({ length: layerCount }, (_, i) => i);
}

/** Serialize an order array to the persisted comma-separated string. */
export function serializeOrder(order: number[]): string {
  return order.join(",");
}

/* ── Layer render payload mapping ────────────────── */

export interface LayerRender {
  annotationId: AnnotationId;
  annotation: Annotation;
}

/**
 * Find the "ui.layers.render" annotation for a Space.
 * Returns the annotation (which maps layer indices → payload IDs) or null.
 */
export function findLayerRender(
  state: ProjectState,
  spaceId: SpaceId,
): LayerRender | null {
  const ann = Object.values(state.annotations).find(
    (a) =>
      a.target.kind === "Space" &&
      a.target.id === spaceId &&
      a.schema === "ui.layers.render",
  );
  if (!ann) return null;
  return { annotationId: ann.id, annotation: ann };
}

/**
 * Get the payload ID assigned to a specific layer, or null if none.
 */
export function layerPayloadId(
  render: LayerRender | null,
  index: number,
): string | null {
  if (!render) return null;
  const raw = render.annotation.data[`payload.${String(index)}`];
  if (!raw || raw.length === 0) return null;
  return raw;
}

/* ── Portal edges ────────────────────────────────── */

/**
 * Find all portal edges **from** a given Space.
 * Each portal edge points to a target Space the user can "enter".
 */
export function findPortalEdges(
  state: ProjectState,
  spaceId: SpaceId,
): Edge[] {
  return Object.values(state.edges).filter(
    (e) => e.edgeKind === "portal" && e.from === spaceId,
  );
}
