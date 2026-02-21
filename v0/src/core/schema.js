import { z } from "zod";
const isoDate = z.string().min(1);
export const SpaceIdSchema = z.string().startsWith("space_");
export const EdgeIdSchema = z.string().startsWith("edge_");
export const PayloadIdSchema = z.string().startsWith("payload_");
export const AnnotationIdSchema = z.string().startsWith("annotation_");
export const OperatorRunIdSchema = z.string().startsWith("oprun_");
export const GraphPatchIdSchema = z.string().startsWith("patch_");
export const JsonValueSchema = z.lazy(() => z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(JsonValueSchema), z.record(JsonValueSchema)]));
export const SpaceSchema = z.object({
    id: SpaceIdSchema,
    kind: z.literal("Space"),
    name: z.string().min(1),
    createdAt: isoDate,
    layerCount: z.number().int().min(1),
    meta: z.record(z.string()),
});
export const EdgeSchema = z.object({
    id: EdgeIdSchema,
    kind: z.literal("Edge"),
    edgeKind: z.enum(["containment", "projection", "derivation", "portal"]),
    from: SpaceIdSchema,
    to: SpaceIdSchema,
    operatorRunId: OperatorRunIdSchema.optional(),
    meta: z.record(z.string()),
});
export const PayloadSchema = z.object({
    id: PayloadIdSchema,
    kind: z.literal("Payload"),
    mediaType: z.string().min(1),
    uri: z.string().min(1),
    sha256: z.string().min(1),
    bytes: z.number().int().min(0),
    meta: z.record(z.string()),
});
export const AnnotationSchema = z.object({
    id: AnnotationIdSchema,
    kind: z.literal("Annotation"),
    target: z.object({
        kind: z.enum(["Space", "Edge", "Payload", "OperatorRun"]),
        id: z.string().min(1),
    }),
    schema: z.string().min(1),
    data: z.record(z.string()),
    createdAt: isoDate,
});
export const OperatorRunSchema = z.object({
    id: OperatorRunIdSchema,
    kind: z.literal("OperatorRun"),
    operator: z.string().min(1),
    status: z.enum(["queued", "running", "succeeded", "failed"]),
    createdAt: isoDate,
    finishedAt: isoDate.optional(),
    inputs: z.array(z.object({ kind: z.enum(["Space", "Payload"]), id: z.string().min(1) })),
    outputs: z.array(z.object({ kind: z.enum(["Space", "Payload"]), id: z.string().min(1) })),
    params: z.record(z.string()),
});
export const GraphPatchOpSchema = z.union([
    z.object({
        op: z.literal("put"),
        objectKind: z.enum(["Space", "Edge", "Payload", "Annotation", "OperatorRun"]),
        id: z.string().min(1),
        value: JsonValueSchema,
    }),
    z.object({
        op: z.literal("del"),
        objectKind: z.enum(["Space", "Edge", "Payload", "Annotation", "OperatorRun"]),
        id: z.string().min(1),
    }),
]);
export const GraphPatchSchema = z.object({
    id: GraphPatchIdSchema,
    kind: z.literal("GraphPatch"),
    baseRevision: z.number().int().min(0),
    createdAt: isoDate,
    ops: z.array(GraphPatchOpSchema),
});
export const ManifestSchema = z.object({
    kind: z.literal("Manifest"),
    version: z.number().int().min(0),
    rootSpaceId: SpaceIdSchema,
    objectHashes: z.record(z.string()),
});
export const ProjectStateSchema = z.object({
    manifest: ManifestSchema,
    spaces: z.record(SpaceSchema),
    edges: z.record(EdgeSchema),
    payloads: z.record(PayloadSchema),
    annotations: z.record(AnnotationSchema),
    operatorRuns: z.record(OperatorRunSchema),
    revision: z.number().int().min(0),
});
