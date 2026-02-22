// ═══════════════════════════════════════════════════════
// Adapter: SliceHistoryGraph (core) → HistoryGraph (subway map)
// ═══════════════════════════════════════════════════════
/** Map core OpType strings to subway-map OpKind. */
function toOpKind(opType) {
    switch (opType) {
        case "img2img": return "img2img";
        case "inpaint": return "inpaint";
        case "segment": return "segment";
        case "imageTo3D": return "3dgen";
        default: return "other";
    }
}
/**
 * Convert the existing per-slice `SliceHistoryGraph` into the
 * subway-map `HistoryGraph` format used by `HistoryMapPanel`.
 *
 * Optionally prepends a "source" pseudo-node for the document-level
 * source image (if `documentSourceImageId` is provided).
 */
export function sliceHistoryToSubwayGraph(sg, documentSourceImageId) {
    const nodes = {};
    // Pre-compute child lookup: stateId → child stateIds
    const childMap = new Map();
    for (const state of Object.values(sg.states)) {
        if (state.parentStateId) {
            const siblings = childMap.get(state.parentStateId) ?? [];
            siblings.push(state.stateId);
            childMap.set(state.parentStateId, siblings);
        }
    }
    // Find the op edge that produced a given state
    const opForState = new Map();
    for (const op of Object.values(sg.ops)) {
        for (const outId of op.outputStateIds) {
            opForState.set(outId, op);
        }
    }
    // Determine effective root: if we have a source image, root's parent is the source node
    const sourceNodeId = documentSourceImageId ? `__source__${sg.sliceId}` : undefined;
    // Convert each StateNode → HistoryNode
    for (const state of Object.values(sg.states)) {
        const isRoot = state.stateId === sg.rootStateId;
        const parentOp = opForState.get(state.stateId);
        const childIds = childMap.get(state.stateId) ?? [];
        // Sort children by creation time for stable ordering
        childIds.sort((a, b) => {
            const na = sg.states[a];
            const nb = sg.states[b];
            if (!na || !nb)
                return 0;
            return na.meta.createdAt.localeCompare(nb.meta.createdAt);
        });
        const parentIds = [];
        if (isRoot && sourceNodeId) {
            parentIds.push(sourceNodeId);
        }
        else if (state.parentStateId) {
            parentIds.push(state.parentStateId);
        }
        const hNode = {
            id: state.stateId,
            type: isRoot ? "root" : "op",
            parentIds,
            childIds,
            label: isRoot
                ? "Slice Root"
                : parentOp
                    ? [parentOp.opType, parentOp.summary?.model].filter(Boolean).join(" · ")
                    : (state.meta.label ?? "Op"),
            ...(!isRoot && parentOp?.summary?.model ? { subtitle: parentOp.summary.model } : {}),
            createdAt: new Date(state.meta.createdAt).getTime(),
            ...(state.assetRefs.thumb ? { artifactId: state.assetRefs.thumb } : state.assetRefs.image ? { artifactId: state.assetRefs.image } : {}),
            ...(state.assetRefs.glb ? { has3D: true } : {}),
        };
        if (!isRoot && parentOp) {
            hNode.op = {
                kind: toOpKind(parentOp.opType),
                ...(parentOp.summary?.model ? { model: parentOp.summary.model } : {}),
                ...(parentOp.summary?.prompt ? { prompt: parentOp.summary.prompt } : {}),
            };
        }
        nodes[state.stateId] = hNode;
    }
    // Optionally prepend source image pseudo-node
    let rootId = sg.rootStateId;
    if (sourceNodeId) {
        nodes[sourceNodeId] = {
            id: sourceNodeId,
            type: "source",
            parentIds: [],
            childIds: [sg.rootStateId],
            label: "Source Image",
            ...(documentSourceImageId ? { artifactId: documentSourceImageId } : {}),
        };
        rootId = sourceNodeId;
    }
    return {
        rootId,
        activeNodeId: sg.displayStateId,
        nodes,
    };
}
