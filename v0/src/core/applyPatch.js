import { AnnotationSchema, EdgeSchema, GraphPatchSchema, OperatorRunSchema, PayloadSchema, SpaceSchema, } from "./schema";
export function applyPatch(state, patchInput) {
    const patch = GraphPatchSchema.parse(patchInput);
    if (patch.baseRevision !== state.revision) {
        throw new Error(`Patch baseRevision mismatch: patch=${patch.baseRevision} state=${state.revision}`);
    }
    const next = {
        ...state,
        spaces: { ...state.spaces },
        edges: { ...state.edges },
        payloads: { ...state.payloads },
        annotations: { ...state.annotations },
        operatorRuns: { ...state.operatorRuns },
        revision: state.revision + 1,
    };
    for (const op of patch.ops) {
        if (op.op === "put") {
            switch (op.objectKind) {
                case "Space": {
                    const parsed = SpaceSchema.parse(op.value);
                    const id = parsed.id;
                    next.spaces[id] = { ...parsed, id };
                    break;
                }
                case "Edge": {
                    const parsed = EdgeSchema.parse(op.value);
                    const id = parsed.id;
                    const edge = {
                        id,
                        kind: "Edge",
                        edgeKind: parsed.edgeKind,
                        from: parsed.from,
                        to: parsed.to,
                        meta: parsed.meta,
                    };
                    if (parsed.operatorRunId !== undefined) {
                        edge.operatorRunId = parsed.operatorRunId;
                    }
                    next.edges[id] = edge;
                    break;
                }
                case "Payload": {
                    const parsed = PayloadSchema.parse(op.value);
                    const id = parsed.id;
                    next.payloads[id] = { ...parsed, id };
                    break;
                }
                case "Annotation": {
                    const parsed = AnnotationSchema.parse(op.value);
                    const id = parsed.id;
                    next.annotations[id] = { ...parsed, id };
                    break;
                }
                case "OperatorRun": {
                    const parsed = OperatorRunSchema.parse(op.value);
                    const id = parsed.id;
                    const run = {
                        id,
                        kind: "OperatorRun",
                        operator: parsed.operator,
                        status: parsed.status,
                        createdAt: parsed.createdAt,
                        inputs: parsed.inputs,
                        outputs: parsed.outputs,
                        params: parsed.params,
                    };
                    if (parsed.finishedAt !== undefined) {
                        run.finishedAt = parsed.finishedAt;
                    }
                    next.operatorRuns[id] = run;
                    break;
                }
                default: {
                    const _exhaustive = op.objectKind;
                    throw new Error(`Unhandled kind ${String(_exhaustive)}`);
                }
            }
        }
        else {
            switch (op.objectKind) {
                case "Space":
                    delete next.spaces[op.id];
                    break;
                case "Edge":
                    delete next.edges[op.id];
                    break;
                case "Payload":
                    delete next.payloads[op.id];
                    break;
                case "Annotation":
                    delete next.annotations[op.id];
                    break;
                case "OperatorRun":
                    delete next.operatorRuns[op.id];
                    break;
                default: {
                    const _exhaustive = op.objectKind;
                    throw new Error(`Unhandled kind ${String(_exhaustive)}`);
                }
            }
        }
    }
    for (const e of Object.values(next.edges)) {
        if (!next.spaces[e.from] || !next.spaces[e.to]) {
            throw new Error(`Edge ${e.id} references missing Space(s): ${e.from} -> ${e.to}`);
        }
    }
    return next;
}
