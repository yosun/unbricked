// ═══════════════════════════════════════════════════════
// Space AI History (Seed-Path DAG/Tree) — Unbricked Core Integrated
// ═══════════════════════════════════════════════════════
//
// Persisted as a *Space-level* Annotation with schema: "ui.space.aiHistory"
//
// Key decisions locked in:
//   - No parallel asset store: StateNodes reference existing PayloadIds.
//   - No duplicated provenance: OpEdges reference existing OperatorRunIds.
//   - displayStateId (👁) drives what renders in Keyspace/Keyframe/layer stack.
//   - operationStateId (⚙) drives next AI op input.
//   - "N paths" = number of SEED PATHS (children of Slice Root).
//   - Extending within a path does not increment N; path head updates.
//   - v1 supports branching but not merging (each StateNode has exactly one parent).
//   - Distinguish Document Source Image (project-level) from Slice Root (per slice).
//
// Note on slice identity:
//   - Histories are keyed by stable sliceId.
//   - Any index↔id mapping should be resolved via existing annotations (e.g. ui.layers.sliceIds).
//   - Optional sliceIndex on StateNode/OpEdge is allowed only as a *creation-time snapshot*.
//
import type { PayloadId, OperatorRunId } from "../types";

// ──────────────────────────────────────────────────────
// Operation Types (extensible)
// ──────────────────────────────────────────────────────
export type OpType =
  | "img2img"         // AI image-to-image edit (Flux, Nano Banana, etc.)
  | "bgRemove"        // background removal (BiRefNet)
  | "maskRegen"       // mask regeneration after AI edit
  | "inpaint"         // inpainting (future)
  | "style"           // style transfer (future)
  | "maskInvert"      // alpha inversion
  | "maskCombine"     // combining multiple masks
  | "imageTo3D"       // GLB generation (future)
  | "segment"         // initial segmentation (SAM2 etc.)
  | "import"          // manual image import
  | "generate";       // text-to-image generation

// ──────────────────────────────────────────────────────
// State Node (vertex)
// One visual state of a single slice.
//
// IMPORTANT:
// - parentStateId + parentOpId make ancestry deterministic without scanning ops.
// - seedPathId is a derived-but-stored cache:
//     null for root; otherwise equals the first child after root on the ancestry chain.
// ──────────────────────────────────────────────────────
export interface StateNode {
  stateId: string;            // "hstate_<ulid>"
  sliceId: string;            // stable identity for the slice
  sliceIndex?: number;        // optional creation-time snapshot only

  // References into Unbricked Payload store (no duplication)
  assetRefs: {
    image?: PayloadId;        // primary displayed image payload
    mask?: PayloadId;         // segmentation/alpha mask payload
    thumb?: PayloadId;        // thumbnail payload for history UI (optional)
    glb?: PayloadId;          // GLB payload if generated (optional)
  };

  // Ancestry (v1: exactly one parent or null for root)
  parentStateId: string | null; // null iff this node is Slice Root
  parentOpId: string | null;    // null iff this node is Slice Root

  // Seed-path membership cache (required)
  // - null for root
  // - otherwise: stateId of the first child after root on ancestry chain
  seedPathId: string | null;

  meta: {
    label: string;            // prefer "Slice Root", "AI: ...", etc.
    createdAt: string;        // ISO 8601
    opType?: OpType;          // op that produced this state (optional for root/import if desired)
  };
}

// ──────────────────────────────────────────────────────
// Op Edge (directed edge)
// "Operation X transformed input state -> output state(s)."
// Detailed provenance lives in the referenced OperatorRun.
// ──────────────────────────────────────────────────────
export interface OpEdge {
  opId: string;                // "hop_<ulid>"
  sliceId: string;
  sliceIndex?: number;         // optional creation-time snapshot only

  opType: OpType;

  // Link to full provenance (model, params, seeds, etc.)
  // Optional for local ops where you don't create OperatorRuns.
  operatorRunId?: OperatorRunId;

  // Connectivity
  inputStateId: string;
  outputStateIds: string[];    // usually length 1; multi-output allowed

  // Lightweight summary for UI (avoid extra OperatorRun lookup)
  summary?: {
    model?: string;            // "flux-dev", "nano-banana", "birefnet"
    prompt?: string;           // user prompt (if any)
  };

  createdAt: string;           // ISO 8601
}

// ──────────────────────────────────────────────────────
// Slice History Graph (per slice) — single persisted truth
//
// Seed Paths (definition of N):
// - A seed path is created only when an op is applied with inputStateId == rootStateId.
// - pathId is the first child after root (a stateId).
// - N = count(children(rootStateId)).
// - Extending within a seed path does NOT increment N; it updates that path’s head.
//
// Multi-output (v1 rule):
// - If an op from root yields multiple outputs, each output becomes a seed path.
// - Default head update uses outputStateIds[0] unless user chooses otherwise (v2).
//
// DAG note:
// - v1 supports branching but not merging because each StateNode has exactly one parent.
// ──────────────────────────────────────────────────────
export interface SliceHistoryGraph {
  sliceId: string;

  // Slice Root: initial state for this slice (derived from segmentation/import).
  // This is NOT the Document Source Image.
  rootStateId: string;

  // Storage
  states: Record<string, StateNode>;
  ops: Record<string, OpEdge>;

  // Cursors (can diverge)
  displayStateId: string;       // 👁 drives render in Keyspace/Keyframe/layer stack
  operationStateId: string;     // ⚙ input to next AI op

  // Derived caches (optional, recomputable, stored for UI speed)
  // Seed paths are direct children of rootStateId (pathId = that child stateId).
  seedPathIds?: string[];                    // e.g. ["hstate_A", "hstate_B", ...]
  pathHeadStateIds?: Record<string, string>; // pathId -> head stateId (thumbnail state)
}

// ──────────────────────────────────────────────────────
// Space-level AI History Annotation
// Stored as one Annotation per Space with schema: "ui.space.aiHistory"
// ──────────────────────────────────────────────────────
export interface SpaceAIHistory {
  version: 1;

  // Histories keyed by stable sliceId (NOT by index).
  slices: Record<string, SliceHistoryGraph>;

  // Document-level original imported image used to generate initial slices.
  // Explicitly separate from per-slice rootStateId.
  documentSourceImageId?: PayloadId;
}

// ──────────────────────────────────────────────────────
// Annotation schema constant (optional convenience)
// ──────────────────────────────────────────────────────
export const SPACE_AI_HISTORY_SCHEMA = "ui.space.aiHistory" as const;