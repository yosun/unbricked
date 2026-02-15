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
