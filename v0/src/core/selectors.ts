import type { Annotation, AnnotationId, ProjectState, SpaceId } from "./types";

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
