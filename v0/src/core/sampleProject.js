import { makeId } from "./ids";
export function createSampleProject() {
    const rootSpace = {
        id: makeId("space"),
        kind: "Space",
        name: "Root Space",
        createdAt: new Date().toISOString(),
        layerCount: 7,
        meta: {
            uiHint: "layerspace",
        },
    };
    return {
        rootSpace,
        state: {
            manifest: {
                kind: "Manifest",
                version: 0,
                rootSpaceId: rootSpace.id,
                objectHashes: {},
            },
            spaces: { [rootSpace.id]: rootSpace },
            edges: {},
            payloads: {},
            annotations: {},
            operatorRuns: {},
            revision: 0,
        },
    };
}
/** Default instance for initial load and tests. */
export const sampleProject = createSampleProject();
