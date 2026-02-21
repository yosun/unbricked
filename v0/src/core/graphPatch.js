import { makeId } from "./ids";
export function newPatch(args) {
    return {
        id: makeId("patch"),
        kind: "GraphPatch",
        baseRevision: args.baseRevision,
        createdAt: new Date().toISOString(),
        ops: args.ops,
    };
}
export function putOp(objectKind, id, value) {
    return { op: "put", objectKind, id, value };
}
export function delOp(objectKind, id) {
    return { op: "del", objectKind, id };
}
