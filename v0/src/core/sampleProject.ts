import { makeId } from "./ids";
import type { ProjectState, Space } from "./types";

const rootSpace: Space = {
  id: makeId("space"),
  kind: "Space",
  name: "Root Space",
  createdAt: new Date().toISOString(),
  layerCount: 7,
  meta: {
    uiHint: "layerspace",
  },
};

export const sampleProject: { state: ProjectState; rootSpace: Space } = {
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
