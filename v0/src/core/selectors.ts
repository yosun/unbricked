import type { AnnotationId, ProjectState, SpaceId } from "./types";

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
