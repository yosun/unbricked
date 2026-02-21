// ═══════════════════════════════════════════════════════
// Subway-Map AI History — Graph Helpers
// ═══════════════════════════════════════════════════════
export function getNode(g, id) {
    const n = g.nodes[id];
    if (!n)
        throw new Error(`Missing node ${id}`);
    return n;
}
/** Walk parents (prefers parentIds[0]) to get lineage root → active */
export function getActiveLineage(g) {
    const path = [];
    let cur = g.activeNodeId;
    const seen = new Set();
    while (cur) {
        if (seen.has(cur))
            throw new Error("Cycle detected in history graph");
        seen.add(cur);
        const node = getNode(g, cur);
        path.unshift(node);
        cur = node.parentIds[0]; // primary lineage
    }
    return path;
}
/** Set of node IDs on the active lineage */
export function buildActiveSet(g) {
    const set = new Set();
    for (const n of getActiveLineage(g))
        set.add(n.id);
    return set;
}
/** Primary child: prefer child on active path, else first. */
export function getPrimaryChildId(g, id) {
    const node = getNode(g, id);
    if (!node.childIds.length)
        return undefined;
    const active = buildActiveSet(g);
    return node.childIds.find((c) => active.has(c)) ?? node.childIds[0];
}
/** Children excluding the primary child */
export function getBranchChildIds(g, id) {
    const node = getNode(g, id);
    const primary = getPrimaryChildId(g, id);
    return node.childIds.filter((c) => c !== primary);
}
/** Count primary-chain steps between two nodes (exclusive) */
export function countPrimarySteps(g, fromId, toId) {
    let count = 0;
    let cur = getPrimaryChildId(g, fromId);
    const seen = new Set();
    while (cur && cur !== toId) {
        if (seen.has(cur))
            break;
        seen.add(cur);
        count++;
        cur = getPrimaryChildId(g, cur);
    }
    return count;
}
