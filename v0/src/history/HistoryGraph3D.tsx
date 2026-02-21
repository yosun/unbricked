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

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useThree, useFrame, invalidate } from "@react-three/fiber";
import {
  DoubleSide,
  SRGBColorSpace,
  TextureLoader,
  MeshBasicMaterial,
  BufferGeometry,
  Float32BufferAttribute,
  Vector3,
} from "three";
import type { Texture, Group } from "three";
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
const HUB_OFFSET_X = 1.0;       // how far right of prism edge the hub lives
const HUB_GAP_Y = 0.35;         // vertical spacing between top/bottom hub nodes
const NODE_SIZE = 0.25;          // thumbnail plane size (square)
const HUB_NODE_SIZE = 0.32;     // hub nodes are slightly bigger
const BRANCH_START_X = 0.7;     // how far right of hub the first op node sits
const BRANCH_STEP_X = 0.5;      // step between successive ops on a branch
const BRANCH_STEP_Z = 0.5;      // Z offset between branch lanes
const LINE_Y_OFFSET = 0.01;     // keep lines slightly above planes for visibility
const CURSOR_RING_EXTRA = 0.04; // extra radius for selection ring

// ── Responsive scaling ───────────────────────────────
// At the "reference" camera distance the layout uses its base sizes.
// As the camera moves farther, the graph scales down proportionally
// so it doesn't dominate the viewport; as the user zooms in, nodes
// grow to reveal detail.
const REF_CAMERA_DIST = 10;  // OrbitControls default (~10 units from origin)
const MIN_SCALE = 0.35;      // floor so it doesn't vanish when fully zoomed out
const MAX_SCALE = 1.6;       // cap so nodes don't become enormous up-close

/** R3F hook: returns a ref whose .current is the adaptive uniform scale. */
function useAdaptiveScale(groupRef: React.RefObject<Group | null>): void {
  const camera = useThree((s) => s.camera);

  useFrame(() => {
    if (!groupRef.current) return;
    const dist = camera.position.length(); // distance from origin
    const raw = REF_CAMERA_DIST / Math.max(dist, 0.1);
    const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, raw));
    const cur = groupRef.current.scale.x;
    // Only update + invalidate when delta is perceptible
    if (Math.abs(cur - s) > 0.005) {
      groupRef.current.scale.setScalar(s);
      invalidate();
    }
  });
}

// ── Zoom-to-node animation ───────────────────────────
// When a user double-clicks a node we smoothly fly the camera so
// the OrbitControls target lands on that node's world position
// and the camera distance shrinks to give a close-up.
const ZOOM_CLOSE_DIST = 5.5;   // camera distance for close-up
const ZOOM_LERP_SPEED = 3.5;   // lerp factor per second

interface ZoomTarget {
  position: Vector3;   // world-space target
  startCamPos: Vector3;
  startTarget: Vector3;
  t: number;           // 0→1 progress
}

/** Hook that smoothly animates the camera toward a target point. */
function useZoomToNode(): [
  (worldPos: Vector3) => void,
  React.RefObject<ZoomTarget | null>,
] {
  const { camera, controls } = useThree();
  const zoomRef = useRef<ZoomTarget | null>(null);

  const startZoom = useCallback((worldPos: Vector3) => {
    const orbitCtrl = controls as { target?: Vector3 } | null;
    zoomRef.current = {
      position: worldPos.clone(),
      startCamPos: camera.position.clone(),
      startTarget: orbitCtrl?.target?.clone() ?? new Vector3(),
      t: 0,
    };
    invalidate();
  }, [camera, controls]);

  useFrame((_, delta) => {
    const z = zoomRef.current;
    if (!z) return;
    z.t = Math.min(1, z.t + delta * ZOOM_LERP_SPEED);
    const ease = 1 - Math.pow(1 - z.t, 3); // ease-out cubic

    // Interpolate OrbitControls target
    const orbitCtrl = controls as { target?: Vector3; update?: () => void } | null;
    if (orbitCtrl?.target) {
      orbitCtrl.target.lerpVectors(z.startTarget, z.position, ease);
    }

    // Interpolate camera: keep direction, but shrink distance
    const dir = z.startCamPos.clone().sub(z.startTarget).normalize();
    const startDist = z.startCamPos.distanceTo(z.startTarget);
    const dist = startDist + (ZOOM_CLOSE_DIST - startDist) * ease;
    camera.position.copy(z.position).addScaledVector(dir, dist);

    orbitCtrl?.update?.();
    invalidate();

    if (z.t >= 1) zoomRef.current = null;
  });

  return [startZoom, zoomRef];
}

// ── Types ────────────────────────────────────────────
interface HistoryGraph3DProps {
  graph: SliceHistoryGraph;
  payloads: Record<string, { uri: string; meta: Record<string, string> }>;
  /** World-Y of the selected slice. */
  sliceY: number;
  /** Width of the prism (so we can position the hub to the right edge). */
  prismW: number;
  /** Called when user clicks a node — sets display cursor (show this image). */
  onSelectNode: (stateId: string) => void;
  /** Called when user clicks a node — sets operation cursor (next AI input). */
  onSetOperationCursor: (stateId: string) => void;
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
  isOpCursor,
  onClick,
  onDoubleClick,
}: {
  uri: string | undefined;
  size: number;
  position: [number, number, number];
  label?: string;
  isSelected?: boolean;
  /** Whether this node is the current display cursor (👁). */
  isCursor?: boolean;
  /** Whether this node is the current operation cursor (⚙). */
  isOpCursor?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
}): React.JSX.Element {
  const tex = useNodeTexture(uri);
  const halfSize = size / 2;

  // Build event handlers with conditional spread for exactOptionalPropertyTypes
  const clickHandlers = useMemo(() => {
    const h: Record<string, (e: import("@react-three/fiber").ThreeEvent<MouseEvent>) => void> = {};
    if (onClick) h.onClick = (e) => { e.stopPropagation(); onClick(); };
    if (onDoubleClick) h.onDoubleClick = (e) => { e.stopPropagation(); onDoubleClick(); };
    return h;
  }, [onClick, onDoubleClick]);

  return (
    <group position={position}>
      {/* Thumbnail plane */}
      {tex && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          {...clickHandlers}
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
          {...clickHandlers}
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

      {/* ⚙ operation cursor indicator (orange ring) */}
      {isOpCursor && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]}>
          <ringGeometry args={[halfSize + CURSOR_RING_EXTRA + 0.04, halfSize + CURSOR_RING_EXTRA + 0.07, 32]} />
          <meshBasicMaterial
            color={0xff9933}
            transparent
            opacity={0.8}
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
  onSetOperationCursor,
  documentSourceImageId,
}: HistoryGraph3DProps): React.JSX.Element | null {
  const groupRef = useRef<Group>(null);
  useAdaptiveScale(groupRef);
  const [startZoom] = useZoomToNode();

  /** Convert a local node position to world-space and trigger zoom. */
  const zoomToLocal = useCallback((localX: number, localZ: number) => {
    startZoom(new Vector3(localX, sliceY, localZ));
  }, [startZoom, sliceY]);

  /** Select a node: set both display and operation cursors. */
  const handleNodeClick = useCallback((stateId: string) => {
    onSelectNode(stateId);
    onSetOperationCursor(stateId);
  }, [onSelectNode, onSetOperationCursor]);

  const rootState = graph.states[graph.rootStateId];
  if (!rootState) return null;

  const displayStateId = graph.displayStateId;

  // Resolve URIs
  const rootThumbUri = stateThumbUri(rootState, payloads);
  const displayState = graph.states[displayStateId];
  const displayThumbUri = stateThumbUri(displayState, payloads);

  // Document source image URI
  const sourceUri = documentSourceImageId ? payloads[documentSourceImageId]?.uri : undefined;

  // ── Positions ──
  const hubX = prismW / 2 + HUB_OFFSET_X;
  const sliceEdgeX = prismW / 2 * 0.96; // right edge of slice plane

  // Get all direct children of root (seed paths / first-generation ops)
  const rootChildren = childStates(graph, graph.rootStateId);
  rootChildren.sort((a, b) => a.meta.createdAt.localeCompare(b.meta.createdAt));

  // ── Build ALL branch chains (including sub-branches from mid-chain forks) ──
  // BFS: seed from root children, discover sub-branches when nodes have >1 child
  const branchSeeds: Array<{ startState: StateNode; forkX: number; parentBranchIdx: number | null }> =
    rootChildren.map((child) => ({ startState: child, forkX: hubX, parentBranchIdx: null }));
  const allBranches: Array<{
    states: StateNode[];
    startX: number;
    forkX: number;
    parentBranchIdx: number | null;
    zOffset: number;
  }> = [];

  let seedIdx = 0;
  while (seedIdx < branchSeeds.length) {
    const seed = branchSeeds[seedIdx]!;
    const isRootBranch = seed.parentBranchIdx === null;
    const startX = isRootBranch ? hubX + BRANCH_START_X : seed.forkX + BRANCH_STEP_X;

    const chain: StateNode[] = [seed.startState];
    let cur = seed.startState;
    const visited = new Set<string>([cur.stateId]);

    for (let depth = 0; depth < 20; depth++) {
      const kids = childStates(graph, cur.stateId)
        .sort((a, b) => a.meta.createdAt.localeCompare(b.meta.createdAt));
      if (kids.length === 0) break;

      // Queue sub-branches for additional children of cur
      const curX = startX + (chain.length - 1) * BRANCH_STEP_X;
      for (let i = 1; i < kids.length; i++) {
        branchSeeds.push({ startState: kids[i]!, forkX: curX, parentBranchIdx: seedIdx });
      }

      const next = kids[0]!;
      if (visited.has(next.stateId)) break;
      visited.add(next.stateId);
      chain.push(next);
      cur = next;
    }

    allBranches.push({ states: chain, startX, forkX: seed.forkX, parentBranchIdx: seed.parentBranchIdx, zOffset: 0 });
    seedIdx++;
  }

  // Assign Z offsets centered around 0
  const totalBranches = allBranches.length;
  for (let i = 0; i < totalBranches; i++) {
    allBranches[i]!.zOffset = totalBranches <= 1
      ? 0
      : (i - (totalBranches - 1) / 2) * BRANCH_STEP_Z;
  }

  // Ancestry path of display state (to highlight the active chain)
  const activeAncestry = useMemo(
    () => new Set(ancestryPath(graph, displayStateId)),
    [graph, displayStateId],
  );

  return (
    <group ref={groupRef} position={[0, sliceY, 0]}>
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
        isOpCursor={graph.operationStateId === graph.rootStateId}
        onClick={() => handleNodeClick(graph.rootStateId)}
        onDoubleClick={() => zoomToLocal(hubX, -HUB_GAP_Y / 2)}
      />

      {/* Bottom hub node: Current Display Image */}
      <ThumbNode
        uri={displayThumbUri}
        size={HUB_NODE_SIZE}
        position={[hubX, LINE_Y_OFFSET, HUB_GAP_Y / 2]}
        label="Current"
        isSelected
        isCursor
        isOpCursor={graph.operationStateId === displayStateId}
        onDoubleClick={() => zoomToLocal(hubX, HUB_GAP_Y / 2)}
      />

      {/* ── Branch lines from hub/fork → operation nodes ── */}
      {allBranches.map((branch) => {
        const { states: chain, startX, forkX: bForkX, parentBranchIdx, zOffset } = branch;
        const forkZ = parentBranchIdx !== null
          ? allBranches[parentBranchIdx]!.zOffset
          : 0;

        return (
          <group key={chain[0]!.stateId}>
            {/* Connector from fork point to first op node */}
            <ConnectorLine
              from={[bForkX, LINE_Y_OFFSET, forkZ]}
              to={[startX, LINE_Y_OFFSET, zOffset]}
              color={activeAncestry.has(chain[0]!.stateId) ? 0x66ccff : 0x888888}
              opacity={activeAncestry.has(chain[0]!.stateId) ? 0.8 : 0.4}
            />

            {/* Op nodes along the branch */}
            {chain.map((state, stepIdx) => {
              const nodeX = startX + stepIdx * BRANCH_STEP_X;
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
                    isOpCursor={state.stateId === graph.operationStateId}
                    onClick={() => handleNodeClick(state.stateId)}
                    onDoubleClick={() => zoomToLocal(nodeX, nodeZ)}
                  />
                </React.Fragment>
              );
            })}
          </group>
        );
      })}

      {/* If no operations yet, show a subtle placeholder text */}
      {allBranches.length === 0 && (
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
