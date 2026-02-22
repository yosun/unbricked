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
  CanvasTexture,
  DoubleSide,
  SRGBColorSpace,
  SpriteMaterial,
  TextureLoader,
  MeshBasicMaterial,
  BufferGeometry,
  Float32BufferAttribute,
  Vector3,
  Color,
} from "three";
import type { Texture, Group } from "three";
import type { SliceHistoryGraph, StateNode } from "../core/history/aiHistorySchema";
import type { PayloadId } from "../core/types";
import { useUIStyle } from "../ui/uiStyleStore";

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
      (t) => {
        t.colorSpace = SRGBColorSpace;
        // Center-crop the texture into a square so circle geometry
        // doesn't stretch non-square images.
        const img = t.image as HTMLImageElement | undefined;
        if (img && img.naturalWidth && img.naturalHeight) {
          const aspect = img.naturalWidth / img.naturalHeight;
          if (aspect > 1) {
            // Landscape: crop sides
            t.repeat.set(1 / aspect, 1);
            t.offset.set((1 - 1 / aspect) / 2, 0);
          } else if (aspect < 1) {
            // Portrait: crop top/bottom
            t.repeat.set(1, aspect);
            t.offset.set(0, (1 - aspect) / 2);
          }
        }
        if (!cancelled) { setTex(t); invalidate(); }
      },
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
const GRAPH_RENDER_ORDER = 1000; // draw history graph above all slice layers
const AI_BUTTON_SIZE = 0.22;    // AI sparkle button sprite size

// ── Shared "3D" badge texture (created once, reused) ─
let _badgeTex: CanvasTexture | null = null;
let _badgeMat: SpriteMaterial | null = null;
function get3DBadgeMaterial(): SpriteMaterial {
  if (_badgeMat) return _badgeMat;
  const sz = 64;
  const c = document.createElement("canvas");
  c.width = sz; c.height = sz;
  const ctx = c.getContext("2d")!;
  // Rounded rect background
  const r = 10;
  ctx.fillStyle = "#2299ff";
  ctx.beginPath();
  ctx.moveTo(r, 0); ctx.lineTo(sz - r, 0); ctx.quadraticCurveTo(sz, 0, sz, r);
  ctx.lineTo(sz, sz - r); ctx.quadraticCurveTo(sz, sz, sz - r, sz);
  ctx.lineTo(r, sz); ctx.quadraticCurveTo(0, sz, 0, sz - r);
  ctx.lineTo(0, r); ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.fill();
  // Text
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 36px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("3D", sz / 2, sz / 2);
  _badgeTex = new CanvasTexture(c);
  _badgeMat = new SpriteMaterial({ map: _badgeTex, transparent: true, depthWrite: false, depthTest: false });
  return _badgeMat;
}

// ── Shared AI button textures ("✨" and "⏳") ─
const _aiButtonTexCache = new Map<string, CanvasTexture>();
function getAiButtonTexture(emoji: string): CanvasTexture {
  const cached = _aiButtonTexCache.get(emoji);
  if (cached) return cached;
  const sz = 128;
  const c = document.createElement("canvas");
  c.width = sz; c.height = sz;
  const ctx = c.getContext("2d")!;
  // Transparent bg with subtle circle
  ctx.clearRect(0, 0, sz, sz);
  ctx.beginPath();
  ctx.arc(sz / 2, sz / 2, sz / 2 - 4, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 2;
  ctx.stroke();
  // Emoji
  ctx.font = `${sz * 0.45}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(emoji, sz / 2, sz / 2 + 2);
  const tex = new CanvasTexture(c);
  _aiButtonTexCache.set(emoji, tex);
  return tex;
}

/** Helper: parse a CSS hex color to a Three.js Color integer. */
function cssHexToInt(hex: string): number {
  return new Color(hex).getHex();
}

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
  /** Toggle the AI edit panel for this slice. */
  onToggleAiPanel?: () => void;
  /** Whether an AI edit is running on this slice. */
  aiEditing?: boolean;
  /** Whether the AI prompt panel is currently open for this slice. */
  aiPanelOpen?: boolean;
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
  is3D,
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
  /** Whether this node represents a 3D (imageTo3D) operation result. */
  is3D?: boolean;
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
      {/* Thumbnail plane (circular) */}
      {tex && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          renderOrder={GRAPH_RENDER_ORDER}
          {...clickHandlers}
        >
          <circleGeometry args={[halfSize, 32]} />
          <meshBasicMaterial
            map={tex}
            transparent
            opacity={0.95}
            depthWrite={false}
            depthTest={false}
            side={DoubleSide}
          />
        </mesh>
      )}

      {/* Fallback: colored circle if no texture */}
      {!tex && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          renderOrder={GRAPH_RENDER_ORDER}
          {...clickHandlers}
        >
          <circleGeometry args={[halfSize, 32]} />
          <meshBasicMaterial
            color={0x666666}
            transparent
            opacity={0.5}
            depthWrite={false}
            depthTest={false}
            side={DoubleSide}
          />
        </mesh>
      )}

      {/* Border ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]} renderOrder={GRAPH_RENDER_ORDER + 1}>
        <ringGeometry args={[halfSize - 0.01, halfSize + 0.02, 32]} />
        <meshBasicMaterial
          color={isCursor ? 0x66ccff : isSelected ? 0xffffff : 0x888888}
          transparent
          opacity={isCursor ? 1.0 : isSelected ? 0.8 : 0.4}
          depthWrite={false}
          depthTest={false}
          side={DoubleSide}
        />
      </mesh>

      {/* 👁 cursor indicator */}
      {isCursor && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]} renderOrder={GRAPH_RENDER_ORDER + 2}>
          <ringGeometry args={[halfSize + 0.03, halfSize + CURSOR_RING_EXTRA + 0.03, 32]} />
          <meshBasicMaterial
            color={0x00ccff}
            transparent
            opacity={0.7}
            depthWrite={false}
            depthTest={false}
            side={DoubleSide}
          />
        </mesh>
      )}

      {/* ⚙ operation cursor indicator (orange ring) */}
      {isOpCursor && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]} renderOrder={GRAPH_RENDER_ORDER + 3}>
          <ringGeometry args={[halfSize + CURSOR_RING_EXTRA + 0.04, halfSize + CURSOR_RING_EXTRA + 0.07, 32]} />
          <meshBasicMaterial
            color={0xff9933}
            transparent
            opacity={0.8}
            depthWrite={false}
            depthTest={false}
            side={DoubleSide}
          />
        </mesh>
      )}

      {/* 3D badge (sprite, always faces camera) */}
      {is3D && (
        <sprite
          material={get3DBadgeMaterial()}
          position={[halfSize + 0.04, 0.005, -halfSize - 0.04]}
          scale={[size * 0.45, size * 0.45, 1]}
          renderOrder={GRAPH_RENDER_ORDER + 4}
        />
      )}
    </group>
  );
}

/** A themed connector line with optional glow dots at endpoints. */
function ConnectorLine({
  from,
  to,
  color,
  opacity,
  glowDots,
}: {
  from: [number, number, number];
  to: [number, number, number];
  color?: number;
  opacity?: number;
  /** Show small glowing dots at from/to endpoints. */
  glowDots?: boolean;
}): React.JSX.Element {
  const geo = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute([...from, ...to], 3));
    return g;
  }, [from[0], from[1], from[2], to[0], to[1], to[2]]);

  const c = color ?? 0xaaaaaa;
  const o = opacity ?? 0.6;
  const dotSize = 0.025;

  return (
    <group>
      <lineSegments geometry={geo} renderOrder={GRAPH_RENDER_ORDER}>
        <lineBasicMaterial
          color={c}
          transparent
          opacity={o}
          depthWrite={false}
          depthTest={false}
        />
      </lineSegments>
      {/* Faint glow ribbon behind the line for depth */}
      <lineSegments geometry={geo} renderOrder={GRAPH_RENDER_ORDER - 1}>
        <lineBasicMaterial
          color={c}
          transparent
          opacity={o * 0.2}
          depthWrite={false}
          depthTest={false}
        />
      </lineSegments>
      {glowDots && (
        <>
          <mesh position={from} rotation={[-Math.PI / 2, 0, 0]} renderOrder={GRAPH_RENDER_ORDER + 1}>
            <circleGeometry args={[dotSize, 12]} />
            <meshBasicMaterial color={c} transparent opacity={Math.min(1, o + 0.3)} depthWrite={false} depthTest={false} side={DoubleSide} />
          </mesh>
          <mesh position={to} rotation={[-Math.PI / 2, 0, 0]} renderOrder={GRAPH_RENDER_ORDER + 1}>
            <circleGeometry args={[dotSize, 12]} />
            <meshBasicMaterial color={c} transparent opacity={Math.min(1, o + 0.3)} depthWrite={false} depthTest={false} side={DoubleSide} />
          </mesh>
        </>
      )}
    </group>
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
  onToggleAiPanel,
  aiEditing,
  aiPanelOpen,
}: HistoryGraph3DProps): React.JSX.Element | null {
  const groupRef = useRef<Group>(null);
  useAdaptiveScale(groupRef);
  const [startZoom] = useZoomToNode();

  // Theme colors
  const template = useUIStyle((s) => s.template);
  const accentInt = useMemo(() => cssHexToInt(template.colors.accent), [template]);
  const glowAiInt = useMemo(() => cssHexToInt(template.colors.glowAi), [template]);
  const mutedInt = useMemo(() => cssHexToInt(template.colors.dimmed), [template]);
  const fgInt = useMemo(() => cssHexToInt(template.colors.foreground), [template]);
  // Active line color: accent in dark, glowAi in light (better contrast)
  const isDark = template.id === "dark";
  const lineActiveColor = isDark ? accentInt : glowAiInt;
  const lineInactiveColor = mutedInt;

  // AI button sprite material (memoized per editing state)
  const aiButtonMat = useMemo(() => {
    const emoji = aiEditing ? "⏳" : "✨";
    const tex = getAiButtonTexture(emoji);
    return new SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      opacity: aiEditing ? 0.6 : 1.0,
    });
  }, [aiEditing]);

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
      {/* ── Connector line: slice edge → AI button → hub ── */}
      {/* Segment 1: slice edge → AI button midpoint */}
      <ConnectorLine
        from={[sliceEdgeX, LINE_Y_OFFSET, 0]}
        to={[(sliceEdgeX + hubX - HUB_NODE_SIZE / 2 - 0.1) / 2 - AI_BUTTON_SIZE / 2 - 0.02, LINE_Y_OFFSET, 0]}
        color={lineActiveColor}
        opacity={isDark ? 0.5 : 0.45}
        glowDots
      />
      {/* Segment 2: AI button → hub */}
      <ConnectorLine
        from={[(sliceEdgeX + hubX - HUB_NODE_SIZE / 2 - 0.1) / 2 + AI_BUTTON_SIZE / 2 + 0.02, LINE_Y_OFFSET, 0]}
        to={[hubX - HUB_NODE_SIZE / 2 - 0.1, LINE_Y_OFFSET, 0]}
        color={lineActiveColor}
        opacity={isDark ? 0.5 : 0.45}
      />

      {/* ── AI Edit button (sprite on the connector) ── */}
      {onToggleAiPanel && (
        <sprite
          material={aiButtonMat}
          position={[(sliceEdgeX + hubX - HUB_NODE_SIZE / 2 - 0.1) / 2, LINE_Y_OFFSET + 0.005, 0]}
          scale={[AI_BUTTON_SIZE, AI_BUTTON_SIZE, 1]}
          renderOrder={GRAPH_RENDER_ORDER + 5}
          onClick={(e) => { e.stopPropagation(); onToggleAiPanel(); }}
        />
      )}
      {/* Highlight ring around AI button when panel is open */}
      {aiPanelOpen && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[(sliceEdgeX + hubX - HUB_NODE_SIZE / 2 - 0.1) / 2, LINE_Y_OFFSET + 0.006, 0]}
          renderOrder={GRAPH_RENDER_ORDER + 4}
        >
          <ringGeometry args={[AI_BUTTON_SIZE / 2 + 0.01, AI_BUTTON_SIZE / 2 + 0.035, 24]} />
          <meshBasicMaterial color={lineActiveColor} transparent opacity={0.8} depthWrite={false} depthTest={false} side={DoubleSide} />
        </mesh>
      )}

      {/* ── Hub: figure-8 with two nodes ── */}
      {/* Vertical line between top and bottom hub nodes */}
      <ConnectorLine
        from={[hubX, LINE_Y_OFFSET, -HUB_GAP_Y / 2]}
        to={[hubX, LINE_Y_OFFSET, HUB_GAP_Y / 2]}
        color={isDark ? 0x5588aa : 0x889aaa}
        opacity={isDark ? 0.5 : 0.4}
      />

      {/* Top hub node: Original Slice Image (use the slice's root state, not the full import) */}
      <ThumbNode
        uri={rootThumbUri}
        size={HUB_NODE_SIZE}
        position={[hubX, LINE_Y_OFFSET, -HUB_GAP_Y / 2]}
        label="Original"
        isSelected={displayStateId === graph.rootStateId}
        isCursor={displayStateId === graph.rootStateId}
        isOpCursor={graph.operationStateId === graph.rootStateId}
        is3D={!!rootState.assetRefs.glb}
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
        is3D={!!displayState?.assetRefs.glb}
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
              color={activeAncestry.has(chain[0]!.stateId) ? lineActiveColor : lineInactiveColor}
              opacity={activeAncestry.has(chain[0]!.stateId) ? (isDark ? 0.8 : 0.65) : (isDark ? 0.4 : 0.3)}
              glowDots
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
                      color={isOnActive ? lineActiveColor : lineInactiveColor}
                      opacity={isOnActive ? (isDark ? 0.7 : 0.55) : (isDark ? 0.35 : 0.25)}
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
                    is3D={!!state.assetRefs.glb}
                    onClick={() => handleNodeClick(state.stateId)}
                    onDoubleClick={() => zoomToLocal(nodeX, nodeZ)}
                  />
                </React.Fragment>
              );
            })}
          </group>
        );
      })}

      {/* If no operations yet, show a subtle trailing line from hub */}
      {allBranches.length === 0 && (
        <ConnectorLine
          from={[hubX + HUB_NODE_SIZE / 2 + 0.1, LINE_Y_OFFSET, 0]}
          to={[hubX + HUB_NODE_SIZE / 2 + 0.6, LINE_Y_OFFSET, 0]}
          color={lineInactiveColor}
          opacity={isDark ? 0.3 : 0.2}
        />
      )}
    </group>
  );
}
