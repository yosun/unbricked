// ═══════════════════════════════════════════════════════
// Subway-Map AI History — Data Model
// ═══════════════════════════════════════════════════════

export type HistoryNodeType = "source" | "root" | "op";

export type OpKind = "img2img" | "inpaint" | "segment" | "3dgen" | "other";

export type HistoryNodeId = string;

export interface HistoryNode {
  id: HistoryNodeId;
  type: HistoryNodeType;

  parentIds: HistoryNodeId[];
  childIds: HistoryNodeId[];

  label?: string;        // e.g. "img2img"
  subtitle?: string;     // e.g. "flux1-img2img"
  createdAt?: number;

  op?: {
    kind: OpKind;
    model?: string;
    prompt?: string;
    seed?: number;
    maskId?: string;
  };

  artifactId?: string;   // points to snapshot/thumbnail
  has3D?: boolean;       // true if this node has an associated GLB model
}

export interface HistoryGraph {
  rootId: HistoryNodeId;
  activeNodeId: HistoryNodeId;
  nodes: Record<HistoryNodeId, HistoryNode>;
}
