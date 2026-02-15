import type { GraphPatch, GraphPatchOp, JsonValue, PatchOpKind } from "./types";
import { makeId } from "./ids";

export function newPatch(args: { baseRevision: number; ops: GraphPatchOp[] }): GraphPatch {
  return {
    id: makeId("patch"),
    kind: "GraphPatch",
    baseRevision: args.baseRevision,
    createdAt: new Date().toISOString(),
    ops: args.ops,
  };
}

export function putOp(objectKind: PatchOpKind, id: string, value: JsonValue): GraphPatchOp {
  return { op: "put", objectKind, id, value };
}

export function delOp(objectKind: PatchOpKind, id: string): GraphPatchOp {
  return { op: "del", objectKind, id };
}
