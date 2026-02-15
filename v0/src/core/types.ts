import type { BrickedId } from "./ids";

export type IsoDateString = string;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export type SpaceId = BrickedId<"space">;
export type EdgeId = BrickedId<"edge">;
export type PayloadId = BrickedId<"payload">;
export type AnnotationId = BrickedId<"annotation">;
export type OperatorRunId = BrickedId<"oprun">;
export type GraphPatchId = BrickedId<"patch">;

export type EdgeKind = "containment" | "projection" | "derivation" | "portal";

export interface Space {
  id: SpaceId;
  kind: "Space";
  name: string;
  createdAt: IsoDateString;

  // MVP: “layers as slices”
  layerCount: number;

  meta: Record<string, string>;
}

export interface Edge {
  id: EdgeId;
  kind: "Edge";
  edgeKind: EdgeKind;
  from: SpaceId;
  to: SpaceId;

  // optional operator provenance for derivation edges
  operatorRunId?: OperatorRunId;

  meta: Record<string, string>;
}

export interface Payload {
  id: PayloadId;
  kind: "Payload";
  mediaType: string; // e.g. image/png, model/gltf+json
  uri: string; // future: S3/CloudFront
  sha256: string;
  bytes: number;
  meta: Record<string, string>;
}

export interface Annotation {
  id: AnnotationId;
  kind: "Annotation";
  target: { kind: "Space" | "Edge" | "Payload" | "OperatorRun"; id: string };
  schema: string; // schema URI / name
  data: Record<string, string>;
  createdAt: IsoDateString;
}

export type OperatorStatus = "queued" | "running" | "succeeded" | "failed";

export interface OperatorRun {
  id: OperatorRunId;
  kind: "OperatorRun";
  operator: string; // e.g. "segment.sam2", "img2mesh"
  status: OperatorStatus;
  createdAt: IsoDateString;
  finishedAt?: IsoDateString;

  inputs: Array<{ kind: "Space" | "Payload"; id: string }>;
  outputs: Array<{ kind: "Space" | "Payload"; id: string }>;
  params: Record<string, string>;
}

export type PatchOpKind = "Space" | "Edge" | "Payload" | "Annotation" | "OperatorRun";

export type GraphPatchOp =
  | { op: "put"; objectKind: PatchOpKind; id: string; value: JsonValue }
  | { op: "del"; objectKind: PatchOpKind; id: string };

export interface GraphPatch {
  id: GraphPatchId;
  kind: "GraphPatch";
  baseRevision: number;
  createdAt: IsoDateString;
  ops: GraphPatchOp[];
}

export interface Manifest {
  kind: "Manifest";
  version: number;
  rootSpaceId: SpaceId;
  objectHashes: Record<string, string>;
}

export interface ProjectState {
  manifest: Manifest;
  spaces: Record<SpaceId, Space>;
  edges: Record<EdgeId, Edge>;
  payloads: Record<PayloadId, Payload>;
  annotations: Record<AnnotationId, Annotation>;
  operatorRuns: Record<OperatorRunId, OperatorRun>;
  revision: number;
}
