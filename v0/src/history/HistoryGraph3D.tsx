// ═══════════════════════════════════════════════════════
// HistoryGraph3D — In-scene subway-map attached to a slice brick
//
// Renders a figure-8 hub + branching operation nodes in 3D space,
// positioned to the right of the selected slice in the prism.
//
// Layout (looking down, Y-up):
//   Slice plane is at (0, layerY, 0).
//   A connector line extends rightward along +X.
//   The hub has two nodes stacked vertically:
//     top  = original slice image (root state)
//     bottom = current display image
//   From the hub, operation branches fan out along +X,
//   each op node showing its result thumbnail.
//
// All geometry is in world-space, parented to a group at
// the selected slice's Y position.
// ═══════════════════════════════════════════════════════

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, invalidate } from "@react-three/fiber";
import {
  DoubleSide,
  SRGBColorSpace,
  TextureLoader,
  MeshBasicMaterial,
  BufferGeometry,
  Float32BufferAttribute,
} from "three";
import type { Texture } from "three";
import type { SliceHistoryGraph, StateNode } from "../core/history/aiHistorySchema";
import type { PayloadId } from "../core/types";

// ── Shared texture loader ────────────────────────────
const _texLoader = new TextureLoader();

/** Load a single texture reactively. */
function useNodeTexture(uri: string | undefined): Texture | null {
  const [tex, setTex] = useState<Texture | null>(null);
  useEffect(() => {
    if (!uri) { setTex(null); return; }
    let cancelled = false;
    _texLoader.load(
      uri,
      (t) => { t.colorSpace = SRGBColorSpace; if (!cancelled) { setTex(t); invalidate(); } },
      undefined,
      () => { if (!cancelled) setTex(null); },
    );
    return () => { cancelled = true; };
  }, [uri]);
  return tex;
}

// ── Layout constants ─────────────────────────────────
const HUB_OFFSET_X = 3.0;       // how far right of prism center the hub lives
const HUB_GAP_Y = 0.55;         // vertical spacing between top/bottom hub nodes
const NODE_SIZE = 0.45;          // thumbnail plane size (square)
const HUB_NODE_SIZE = 0.55;     // hub nodes are bigger
const BRANCH_START_X = 1.2;     // how far right of hub the first op node sits
const BRANCH_STEP_X = 0.9;      // step between successive ops on a branch
const BRANCH_STEP_Z = 0.8;      // Z offset between branch lanes
const LINE_Y_OFFSET = 0.01;     // keep lines slightly above planes for visibility
const CURSOR_RING_EXTRA = 0.08; // extra radius for selection ring

// ── Types ────────────────────────────────────────────
interface HistoryGraph3DProps {
  graph: SliceHistoryGraph;
  payloads: Record<string, { uri: string; meta: Record<string, string> }>;
  /** World-Y of the selected slice. */
  sliceY: number;
  /** Width of the prism (so we can position the hub to the right edge). */
  prismW: number;
  /** Called when user clicks a node to set display cursor. */
  onSelectNode: (stateId: string) => void;
  /** Optional: document source image id. */
  documentSourceImageId?: PayloadId;
}

// ── Helpers ──────────────────────────────────────────

/** Resolve a state's thumbnail URI. */
function stateThumbUri(
  state: StateNode | undefined,
  payloads: Record<string, { uri: string; meta: Record<string, string> }>,
): string | undefined {
  if (!state) return undefined;
  const pid = state.assetRefs.thumb ?? state.assetRefs.image;
  if (!pid) return undefined;
  return payloads[pid]?.uri;
}

/** Get direct children of a state. */
function childStates(graph: SliceHistoryGraph, stateId: string): StateNode[] {
  return Object.values(graph.states).filter((s) => s.parentStateId === stateId);
}

/** Walk ancestry from stateId to root, returning the path (root-first). */
function ancestryPath(graph: SliceHistoryGraph, stateId: string): string[] {
  const path: string[] = [];
  let cur: string | null = stateId;
  const visited = new Set<string>();
  while (cur) {
    if (visited.has(cur)) break;
    visited.add(cur);
    path.unshift(cur);
    cur = graph.states[cur]?.parentStateId ?? null;
  }
  return path;
}

/** Get the op edge label for a state (derived from the op that produced it). */
function opLabel(graph: SliceHistoryGraph, state: StateNode): string {
  if (!state.parentOpId) return state.meta.label;
  const op = graph.ops[state.parentOpId];
  if (!op) return state.meta.label;
  return [op.opType, op.summary?.model].filter(Boolean).join(" · ");
}

// ── Sub-components ───────────────────────────────────

/** A single thumbnail node in 3D — textured plane + optional label. */
function ThumbNode({
  uri,
  size,
  position,
  label,
  isSelected,
  isCursor,
  onClick,
}: {
  uri: string | undefined;
  size: number;
  position: [number, number, number];
  label?: string;
  isSelected?: boolean;
  /** Whether this node is the current display cursor (👁). */
  isCursor?: boolean;
  onClick?: () => void;
}): React.JSX.Element {
  const tex = useNodeTexture(uri);
  const halfSize = size / 2;

  return (
    <group position={position}>
      {/* Thumbnail plane — face the camera (billboard) via rotation to look along Y */}
      {tex && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          {...(onClick ? { onClick: (e: import("@react-three/fiber").ThreeEvent<MouseEvent>) => { e.stopPropagation(); onClick(); } } : {})}
        >
          <planeGeometry args={[size, size]} />
          <meshBasicMaterial
            map={tex}
            transparent
            opacity={0.95}
            depthWrite={false}
            side={DoubleSide}
          />
        </mesh>
      )}

      {/* Fallback: colored square if no texture */}
      {!tex && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          {...(onClick ? { onClick: (e: import("@react-three/fiber").ThreeEvent<MouseEvent>) => { e.stopPropagation(); onClick(); } } : {})}
        >
          <planeGeometry args={[size, size]} />
          <meshBasicMaterial
            color={0x666666}
            transparent
            opacity={0.5}
            depthWrite={false}
            side={DoubleSide}
          />
        </mesh>
      )}

      {/* Border ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
        <ringGeometry args={[halfSize - 0.01, halfSize + 0.02, 32]} />
        <meshBasicMaterial
          color={isCursor ? 0x66ccff : isSelected ? 0xffffff : 0x888888}
          transparent
          opacity={isCursor ? 1.0 : isSelected ? 0.8 : 0.4}
          depthWrite={false}
          side={DoubleSide}
        />
      </mesh>

      {/* 👁 cursor indicator */}
      {isCursor && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
          <ringGeometry args={[halfSize + 0.03, halfSize + CURSOR_RING_EXTRA + 0.03, 32]} />
          <meshBasicMaterial
            color={0x00ccff}
            transparent
            opacity={0.7}
            depthWrite={false}
            side={DoubleSide}
          />
        </mesh>
      )}
    </group>
  );
}

/** A 3D line between two points (using BufferGeometry line segments). */
function ConnectorLine({
  from,
  to,
  color,
  opacity,
  lineWidth,
}: {
  from: [number, number, number];
  to: [number, number, number];
  color?: number;
  opacity?: number;
  lineWidth?: number;
}): React.JSX.Element {
  const geo = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute([...from, ...to], 3));
    return g;
  }, [from[0], from[1], from[2], to[0], to[1], to[2]]);

  return (
    <lineSegments geometry={geo}>
      <lineBasicMaterial
        color={color ?? 0xaaaaaa}
        transparent
        opacity={opacity ?? 0.6}
        depthWrite={false}
      />
    </lineSegments>
  );
}

// ── Main component ───────────────────────────────────

export default function HistoryGraph3D({
  graph,
  payloads,
  sliceY,
  prismW,
  onSelectNode,
  documentSourceImageId,
}: HistoryGraph3DProps): React.JSX.Element | null {
  const rootState = graph.states[graph.rootStateId];
  if (!rootState) return null;

  const displayStateId = graph.displayStateId;

  // Resolve URIs
  const rootThumbUri = stateThumbUri(rootState, payloads);
  const displayState = graph.states[displayStateId];
  const displayThumbUri = stateThumbUri(displayState, payloads);

  // Document source image URI
  const sourceUri = documentSourceImageId ? payloads[documentSourceImageId]?.uri : undefined;

  // Get all direct children of root (seed paths / first-generation ops)
  const rootChildren = childStates(graph, graph.rootStateId);
  // Sort by creation time
  rootChildren.sort((a, b) => a.meta.createdAt.localeCompare(b.meta.createdAt));

  // Build all branch chains: for each root child, walk the primary chain
  const branches: Array<{ states: StateNode[]; branchIndex: number }> = [];
  rootChildren.forEach((child, idx) => {
    const chain: StateNode[] = [child];
    let cur = child;
    const visited = new Set<string>([child.stateId]);
    // Follow primary: pick first child, depth-limited
    for (let depth = 0; depth < 20; depth++) {
      const kids = childStates(graph, cur.stateId)
        .sort((a, b) => a.meta.createdAt.localeCompare(b.meta.createdAt));
      if (kids.length === 0) break;
      const next = kids[0]!;
      if (visited.has(next.stateId)) break;
      visited.add(next.stateId);
      chain.push(next);
      cur = next;
    }
    branches.push({ states: chain, branchIndex: idx });
  });

  // Ancestry path of display state (to highlight the active chain)
  const activeAncestry = useMemo(
    () => new Set(ancestryPath(graph, displayStateId)),
    [graph, displayStateId],
  );

  // ── Positions ──
  const hubX = prismW / 2 + HUB_OFFSET_X;
  const hubTopY = HUB_GAP_Y / 2;     // original image (top)
  const hubBotY = -HUB_GAP_Y / 2;    // current display image (bottom)
  const hubCenterY = 0;

  // Connector from slice to hub
  const sliceEdgeX = prismW / 2 * 0.96; // right edge of slice plane

  return (
    <group position={[0, sliceY, 0]}>
      {/* ── Connector line: slice → hub ── */}
      <ConnectorLine
        from={[sliceEdgeX, LINE_Y_OFFSET, 0]}
        to={[hubX - HUB_NODE_SIZE / 2 - 0.1, LINE_Y_OFFSET, 0]}
        color={0x66ccff}
        opacity={0.5}
      />

      {/* ── Hub: figure-8 with two nodes ── */}
      {/* Vertical line between top and bottom hub nodes */}
      <ConnectorLine
        from={[hubX, LINE_Y_OFFSET, -HUB_GAP_Y / 2]}
        to={[hubX, LINE_Y_OFFSET, HUB_GAP_Y / 2]}
        color={0x88aacc}
        opacity={0.5}
      />

      {/* Top hub node: Original Slice Image */}
      <ThumbNode
        uri={sourceUri ?? rootThumbUri}
        size={HUB_NODE_SIZE}
        position={[hubX, LINE_Y_OFFSET, -HUB_GAP_Y / 2]}
        label="Original"
        isSelected={displayStateId === graph.rootStateId}
        isCursor={displayStateId === graph.rootStateId}
        onClick={() => onSelectNode(graph.rootStateId)}
      />

      {/* Bottom hub node: Current Display Image */}
      <ThumbNode
        uri={displayThumbUri}
        size={HUB_NODE_SIZE}
        position={[hubX, LINE_Y_OFFSET, HUB_GAP_Y / 2]}
        label="Current"
        isSelected
        isCursor
      />

      {/* ── Branch lines from hub center → operation nodes ── */}
      {branches.map(({ states: chain, branchIndex }) => {
        // Z offset: spread branches vertically (along Z) from center
        const branchCount = branches.length;
        const zCenter = 0;
        const zOffset = branchCount <= 1
          ? 0
          : (branchIndex - (branchCount - 1) / 2) * BRANCH_STEP_Z;

        return (
          <group key={chain[0]!.stateId}>
            {/* Connector from hub center to first op node */}
            <ConnectorLine
              from={[hubX, LINE_Y_OFFSET, zCenter]}
              to={[hubX + BRANCH_START_X, LINE_Y_OFFSET, zOffset]}
              color={activeAncestry.has(chain[0]!.stateId) ? 0x66ccff : 0x888888}
              opacity={activeAncestry.has(chain[0]!.stateId) ? 0.8 : 0.4}
            />

            {/* Op nodes along the branch */}
            {chain.map((state, stepIdx) => {
              const nodeX = hubX + BRANCH_START_X + stepIdx * BRANCH_STEP_X;
              const nodeZ = zOffset;
              const isOnActive = activeAncestry.has(state.stateId);
              const isCursorNode = state.stateId === displayStateId;
              const thumbUri = stateThumbUri(state, payloads);
              const label = opLabel(graph, state);

              return (
                <React.Fragment key={state.stateId}>
                  {/* Connector to next node (if not last) */}
                  {stepIdx < chain.length - 1 && (
                    <ConnectorLine
                      from={[nodeX + NODE_SIZE / 2, LINE_Y_OFFSET, nodeZ]}
                      to={[nodeX + BRANCH_STEP_X - NODE_SIZE / 2, LINE_Y_OFFSET, nodeZ]}
                      color={isOnActive ? 0x66ccff : 0x888888}
                      opacity={isOnActive ? 0.7 : 0.35}
                    />
                  )}
                  <ThumbNode
                    uri={thumbUri}
                    size={NODE_SIZE}
                    position={[nodeX, LINE_Y_OFFSET, nodeZ]}
                    label={label}
                    isSelected={isOnActive}
                    isCursor={isCursorNode}
                    onClick={() => onSelectNode(state.stateId)}
                  />
                </React.Fragment>
              );
            })}
          </group>
        );
      })}

      {/* If no operations yet, show a subtle placeholder text */}
      {branches.length === 0 && (
        <ConnectorLine
          from={[hubX + HUB_NODE_SIZE / 2 + 0.1, LINE_Y_OFFSET, 0]}
          to={[hubX + HUB_NODE_SIZE / 2 + 0.6, LINE_Y_OFFSET, 0]}
          color={0x555555}
          opacity={0.3}
        />
      )}
    </group>
  );
}
