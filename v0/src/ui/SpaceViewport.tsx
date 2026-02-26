import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree, useFrame, invalidate } from "@react-three/fiber";
import { Line, OrbitControls, TransformControls, useGLTF } from "@react-three/drei";
import { Box3, BoxGeometry, CanvasTexture, Color, DoubleSide, EdgesGeometry, Euler, GridHelper as ThreeGridHelper, Group, MathUtils, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Plane, Quaternion, Raycaster, SRGBColorSpace, Vector3, TextureLoader, BufferGeometry, Float32BufferAttribute, LineBasicMaterial } from "three";
import type { Camera, Material, Mesh, Texture } from "three";
import type { ThreeEvent } from "@react-three/fiber";

export type SegmentDisplayMode = "masked" | "colored";
import type { CropInfo } from "../services/falProxy";
import { AI_EDIT_MODELS, getAiEditModel } from "../services/falProxy";
import LayerScrubber from "./LayerScrubber";
import LayerControlsHUD from "./LayerControlsHUD";
import LayersPanel from "./LayersPanel";
import AIHistoryPanel from "./AIHistoryPanel";
import type { AnchorPoint } from "../history/HistoryHudPanel";
import HistoryGraph3D from "../history/HistoryGraph3D";
import RadialMenu from "./RadialMenu";
import CameraRig from "./CameraRig";
import type { AnimPhase } from "./CameraRig";
import type { ViewMode } from "./ViewMode";
import { useUIStyle } from "./uiStyleStore";
import type { SliceHistoryGraph } from "../core/history/aiHistorySchema";
import type { PayloadId } from "../core/types";

/* ── Shared prism dimensions ──────────────────────── */
const PRISM_H = 2.5;
const DEFAULT_PRISM_W = 4;
const DEFAULT_PRISM_D = 3;

/** Compute prism W and D from an image aspect ratio (width/height). */
function prismDims(imageAspect: number | null): { prismW: number; prismD: number } {
  if (!imageAspect || imageAspect <= 0) return { prismW: DEFAULT_PRISM_W, prismD: DEFAULT_PRISM_D };
  // Keep roughly the same visual area (~12 sq units) while matching the aspect ratio.
  const area = DEFAULT_PRISM_W * DEFAULT_PRISM_D;
  const prismW = Math.sqrt(area * imageAspect);
  const prismD = area / prismW;
  return { prismW, prismD };
}

/** Distinct hue per logical layer index (evenly spaced around the wheel). */
function layerHue(layerIdx: number, layerCount: number): string {
  const hue = Math.round((layerIdx / Math.max(layerCount, 1)) * 360);
  return `hsl(${String(hue)}, 55%, 65%)`;
}

function layerY(index: number, layerCount: number, spread: number = 1): number {
  const h = PRISM_H * spread;
  const t = layerCount <= 1 ? 0.5 : index / (layerCount - 1);
  return -h / 2 + t * h;
}

function yToLayerContinuous(y: number, layerCount: number, spread: number = 1): number {
  const h = PRISM_H * spread;
  const t = (y + h / 2) / h;
  return t * (layerCount - 1);
}

function clampLayerIndex(raw: number, layerCount: number): number {
  return Math.max(0, Math.min(layerCount - 1, Math.round(raw)));
}

interface LayerVis {
  visible: boolean;
  opacity: number;
  /** User-facing opacity multiplier (0–1) applied to the texture image. */
  textureOpacity: number;
}

/** Override for a layer being dragged: its logical index and continuous Y in brick space. */
interface DragOverride {
  layerIdx: number;
  y: number;
}

interface SpacePrismProps {
  layerCount: number;
  selectedLayerIndex: number | null;
  layerVisibility: LayerVis[];
  layerOrder: number[];
  onSelectLayer: (index: number) => void;
  dragOverride?: DragOverride | null;
  suppressClicks?: boolean;
  layerTextures: Record<number, string>;
  layerCropInfo: Record<number, CropInfo>;
  imageAspect: number | null;
  /** Spread multiplier for layer spacing. */
  layerSpread?: number;
  /** Set of layer indices whose source image is hidden (show 3D instead). */
  threeDSourceHidden?: Set<number>;
  /** When true, all layers start stacked at center and spread to final positions. */
  revealActive: boolean;
  onRevealDone?: () => void;
  /** Set of layer indices currently being AI-edited (for pulse animation). */
  aiEditingLayers?: Set<number> | undefined;
  /** GLB blob URLs keyed by layer index. */
  layerGlbUrls?: Record<number, string>;
  /** Layer index currently generating 3D. */
  generating3DLayer?: number | null;
  /** Transform pivot face for 3D models. */
  transformPivot?: PivotFace;
  /** Transform gizmo mode. */
  transformMode?: "translate" | "rotate" | "scale";
  /** Snap values (null = no snap). */
  snapTranslation?: number | undefined;
  snapRotation?: number | undefined;
  snapScale?: number | undefined;
  /** Whether snapping is currently enabled (for visual helpers). */
  snapEnabled?: boolean | undefined;
  /** Callback when user clicks a bbox face to change pivot. */
  onSetTransformPivot?: ((face: PivotFace) => void) | undefined;
  /** Callback when model transform changes. */
  onTransformChange?: ((t: Object3DTransform) => void) | undefined;
  /** Externally-set transform to apply to the model. */
  appliedTransform?: Object3DTransform | undefined;
  /** Current model transform state (for grid alignment). */
  modelTransform?: Object3DTransform | undefined;
  /** Per-layer XZ image translation offsets (from user drag). */
  layerImageOffsets?: Record<number, [number, number]> | undefined;
  /** Called when user drags a layer image with the new absolute [x, z] offset. */
  onLayerImageOffsetChange?: ((layerIdx: number, x: number, z: number) => void) | undefined;
  /** Set of layer indices in the multi-selection (shift+click). */
  multiSelectedLayers?: Set<number> | undefined;
  /** Called when user shift+clicks a layer (for multi-select). */
  onMultiSelect?: ((layerIdx: number) => void) | undefined;
}

/** Shared TextureLoader — one instance for the whole module. */
const sharedTextureLoader = new TextureLoader();

/**
 * Alpha-sampling cache: maps texture uuid → 2D canvas context so we can read
 * per-pixel alpha without creating a new canvas on every pointer event.
 */
const _alphaSampleCtx = new Map<string, CanvasRenderingContext2D | null>();

/**
 * Returns the alpha (0–1) of a texture at the given UV coordinate.
 * Returns 1 (fully opaque) if the texture image isn't readable (CORS, not loaded, etc.).
 * Coordinates: uv.x in [0,1] left→right, uv.y in [0,1] bottom→top (Three.js convention).
 */
function sampleTextureAlpha(tex: Texture, uv: { x: number; y: number }): number {
  if (!tex) return 1;
  let ctx = _alphaSampleCtx.get(tex.uuid);
  if (ctx === undefined) {
    // First access — build the sample canvas from the texture's source image
    const src = tex.source?.data as (HTMLImageElement | HTMLCanvasElement | ImageBitmap) | null;
    if (!src) { _alphaSampleCtx.set(tex.uuid, null); return 1; }
    const w = (src as HTMLImageElement).naturalWidth ?? (src as HTMLCanvasElement).width ?? 256;
    const h = (src as HTMLImageElement).naturalHeight ?? (src as HTMLCanvasElement).height ?? 256;
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(w, 512); // cap at 512 for performance
    canvas.height = Math.min(h, 512);
    const c = canvas.getContext("2d", { willReadFrequently: true });
    if (!c) { _alphaSampleCtx.set(tex.uuid, null); return 1; }
    c.drawImage(src as CanvasImageSource, 0, 0, canvas.width, canvas.height);
    _alphaSampleCtx.set(tex.uuid, c);
    ctx = c;
  }
  if (!ctx) return 1;
  const px = Math.round(Math.max(0, Math.min(1, uv.x)) * (ctx.canvas.width - 1));
  // Three.js UV: y=0 is bottom of image, y=1 is top → flip for canvas
  const py = Math.round(Math.max(0, Math.min(1, 1 - uv.y)) * (ctx.canvas.height - 1));
  try {
    const d = ctx.getImageData(px, py, 1, 1).data;
    return (d[3] ?? 255) / 255;
  } catch {
    return 1; // CORS / security error — treat as opaque
  }
}

/** Cache of canvas-based number textures for layer labels. */
const labelTextureCache = new Map<string, CanvasTexture>();
function getLabelTexture(text: string, color: string): CanvasTexture {
  const key = `${text}:${color}`;
  const cached = labelTextureCache.get(key);
  if (cached) return cached;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = color;
  ctx.font = `bold ${String(size * 0.6)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, size / 2, size / 2);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  labelTextureCache.set(key, tex);
  return tex;
}

/** A lightweight label sprite — replaces the expensive drei <Text> (troika SDF). */
function LayerLabel({ text, color, opacity, renderOrder, position }: { text: string; color: string; opacity: number; renderOrder: number; position?: [number, number, number] }) {
  const tex = useMemo(() => getLabelTexture(text, color), [text, color]);
  return (
    <sprite position={position ?? [0, 0.01, 0]} scale={[0.35, 0.35, 0.35]} renderOrder={renderOrder}>
      <spriteMaterial map={tex} transparent opacity={opacity} depthWrite={false} sizeAttenuation />
    </sprite>
  );
}

/** Lerp speed for position animations (higher = faster). */
const LERP_SPEED = 4.0;
const LERP_THRESHOLD = 0.005;

/**
 * Animated wrapper for a layer group — smoothly lerps x and y toward targets.
 */
function AnimatedLayerGroup({
  targetX,
  targetY,
  children,
}: {
  targetX: number;
  targetY: number;
  children: React.ReactNode;
}): React.JSX.Element {
  const groupRef = useRef<import("three").Group>(null);
  // Initialise at target so first frame doesn't jitter
  const currentX = useRef(targetX);
  const currentY = useRef(targetY);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    // Skip if already at target (within threshold)
    const dx = Math.abs(currentX.current - targetX);
    const dy = Math.abs(currentY.current - targetY);
    if (dx < LERP_THRESHOLD && dy < LERP_THRESHOLD) {
      if (currentX.current !== targetX || currentY.current !== targetY) {
        currentX.current = targetX;
        currentY.current = targetY;
        groupRef.current.position.x = targetX;
        groupRef.current.position.y = targetY;
        // In demand-render mode, this final snap can otherwise leave dependents
        // (e.g. TransformControls) one frame behind and then never catch up.
        groupRef.current.updateMatrixWorld(true);
        invalidate();
      }
      return;
    }
    const dt = Math.min(delta, 0.05); // clamp large dt
    const factor = 1 - Math.exp(-LERP_SPEED * dt);
    currentX.current = MathUtils.lerp(currentX.current, targetX, factor);
    currentY.current = MathUtils.lerp(currentY.current, targetY, factor);
    groupRef.current.position.x = currentX.current;
    groupRef.current.position.y = currentY.current;
    groupRef.current.updateMatrixWorld(true);
    invalidate();
  });

  return (
    <group ref={groupRef} position={[currentX.current, currentY.current, 0]}>
      {children}
    </group>
  );
}

/** Load a texture from a URL (data: or http) and cache by URI. */
function useLayerTexture(uri: string | undefined): Texture | null {
  const [texture, setTexture] = useState<Texture | null>(null);

  useEffect(() => {
    if (!uri) {
      setTexture(null);
      return;
    }
    let cancelled = false;
    sharedTextureLoader.load(
      uri,
      (tex) => {
        if (!cancelled) { setTexture(tex); invalidate(); }
      },
      undefined,
      (err) => {
        console.error("[useLayerTexture] FAILED", err);
        if (!cancelled) setTexture(null);
      },
    );
    return () => { cancelled = true; };
  }, [uri]);

  return texture;
}

/** A single textured layer plane. Handles crop offset, AI pulse glow, fade-in, and drag-translate. */
function TexturedLayerPlane({
  uri,
  width,
  depth,
  layerIdx,
  opacity,
  crop,
  aiEditing,
  generating3D,
  positionIndex,
  selected,
  multiSelected,
  onSelect,
  onSelectShift,
  imageOffset,
  onImageOffsetChange,
}: {
  uri: string | undefined;
  width: number;
  depth: number;
  layerIdx: number;
  opacity: number;
  crop?: CropInfo | undefined;
  aiEditing?: boolean | undefined;
  generating3D?: boolean | undefined;
  /** Visual stack position (0 = bottom) for correct render ordering. */
  positionIndex?: number | undefined;
  selected?: boolean | undefined;
  /** Part of a multi-selection (shift+click). */
  multiSelected?: boolean | undefined;
  onSelect?: ((shiftKey: boolean) => void) | undefined;
  /** Called when shift+clicking to add/remove from multi-selection. */
  onSelectShift?: (() => void) | undefined;
  /** Additional XZ offset applied on top of crop (for user-driven image translation). */
  imageOffset?: [number, number] | undefined;
  /** Called during drag with cumulative delta [dx, dz] in world space. */
  onImageOffsetChange?: ((dx: number, dz: number) => void) | undefined;
}): React.JSX.Element | null {
  const texture = useLayerTexture(uri);
  const matRef = useRef<import("three").MeshBasicMaterial>(null);
  const glowRef = useRef<import("three").MeshBasicMaterial>(null);
  const selectionRingRef = useRef<import("three").MeshBasicMaterial>(null);
  // Track URI changes for fade-in
  const prevUri = useRef(uri);
  const fadeProgress = useRef(1); // 1 = fully visible
  // Track AI editing state to trigger fade-in when it stops
  const wasEditing = useRef(false);
  const glowColor = useUIStyle((s) => s.template.colors.glowAi);
  const selectionColor = useUIStyle((s) => s.template.colors.selectionWireframe);
  const accentColor = useUIStyle((s) => s.template.colors.accent);

  // ── Drag-translate state ──────────────────────────────────────────────
  const { camera, controls } = useThree();
  const dragging = useRef(false);
  const hasMoved = useRef(false);
  const dragHPlane = useRef(new Plane(new Vector3(0, 1, 0), 0));
  const dragHitStart = useRef(new Vector3());
  const dragOffsetStart = useRef<[number, number]>([0, 0]);
  const _tmpVec = useRef(new Vector3());
  const _translateRay = useRef(new Raycaster());
  const meshRef = useRef<import("three").Mesh>(null);

  useEffect(() => {
    if (uri !== prevUri.current) {
      if (wasEditing.current) {
        fadeProgress.current = 0;
      }
      prevUri.current = uri;
    }
  }, [uri]);

  useEffect(() => {
    wasEditing.current = aiEditing ?? false;
  }, [aiEditing]);

  useFrame((_, delta) => {
    let needsInvalidate = false;
    // Fade-in animation
    if (fadeProgress.current < 1 && matRef.current) {
      fadeProgress.current = Math.min(1, fadeProgress.current + delta * 2.0);
      matRef.current.opacity = opacity * fadeProgress.current;
      needsInvalidate = true;
    }
    // Selection ring pulse for multi-selected
    if (selectionRingRef.current) {
      const target = multiSelected ? 0.55 : selected ? 0.35 : 0;
      if (Math.abs(selectionRingRef.current.opacity - target) > 0.01) {
        selectionRingRef.current.opacity = selectionRingRef.current.opacity + (target - selectionRingRef.current.opacity) * 0.15;
        needsInvalidate = true;
      }
    }
    // Organic glow while AI is editing or generating 3D
    if (glowRef.current) {
      if (aiEditing || generating3D) {
        const t = performance.now() / 1000;
        const breath = 0.5 + 0.5 * Math.sin(t * 1.8) * Math.sin(t * 0.7 + 0.3);
        glowRef.current.opacity = 0.15 + 0.35 * breath;
        if (generating3D && !aiEditing) {
          const hue = 190 + 30 * Math.sin(t * 0.5);
          glowRef.current.color.setHSL(hue / 360, 0.85, 0.55);
        } else {
          const hue = 200 + 15 * Math.sin(t * 0.4);
          glowRef.current.color.setHSL(hue / 360, 0.7, 0.6);
        }
        needsInvalidate = true;
      } else if (glowRef.current.opacity !== 0) {
        glowRef.current.opacity = 0;
        needsInvalidate = true;
      }
    }
    if (needsInvalidate) invalidate();
  });

  if (!texture) return null;

  const fullW = width * 0.96;
  const fullD = depth * 0.96;

  let planeW = fullW;
  let planeD = fullD;
  let offX = 0;
  let offZ = 0;

  if (crop) {
    planeW = fullW * (crop.cropW / crop.origW);
    planeD = fullD * (crop.cropH / crop.origH);
    offX = ((crop.cropX + crop.cropW / 2) / crop.origW - 0.5) * fullW;
    offZ = ((crop.cropY + crop.cropH / 2) / crop.origH - 0.5) * fullD;
  }

  // Add user-driven translation offset on top of crop offset
  const finalOffX = offX + (imageOffset?.[0] ?? 0);
  const finalOffZ = offZ + (imageOffset?.[1] ?? 0);

  // Use position in stack for render ordering so upper layers draw on top
  const baseOrder = (positionIndex ?? 0) * 10;

  // ── Pointer handlers for alpha-aware selection and drag-translate ──
  const handlePointerDown = useCallback((e: ThreeEvent<PointerEvent>) => {
    // Alpha-aware: skip transparent pixels so click passes through to layers below
    if (e.uv && texture) {
      const alpha = sampleTextureAlpha(texture, e.uv);
      if (alpha < 0.05) return; // transparent — don't stop, let event propagate
    }
    e.stopPropagation();

    dragging.current = false;
    hasMoved.current = false;

    // Start potential drag (only if this layer is already selected)
    if (selected && onImageOffsetChange) {
      const target = e.eventObject as unknown as { setPointerCapture: (id: number) => void };
      target.setPointerCapture(e.pointerId);
      dragging.current = true;
      // Set up horizontal drag plane at hit point
      dragHPlane.current.set(new Vector3(0, 1, 0), -e.point.y);
      dragHitStart.current.copy(e.point);
      dragOffsetStart.current = [...(imageOffset ?? [0, 0])] as [number, number];
      if (controls) (controls as unknown as { enabled: boolean }).enabled = false;
    }
  }, [selected, texture, imageOffset, onImageOffsetChange, controls]);

  const handlePointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (!dragging.current || !onImageOffsetChange) return;
    e.stopPropagation();
    // Raycast against the horizontal drag plane using the cached raycaster
    _translateRay.current.setFromCamera(e.pointer, camera);
    if (_translateRay.current.ray.intersectPlane(dragHPlane.current, _tmpVec.current)) {
      const dx = _tmpVec.current.x - dragHitStart.current.x;
      const dz = _tmpVec.current.z - dragHitStart.current.z;
      if (Math.abs(dx) > 0.005 || Math.abs(dz) > 0.005) {
        hasMoved.current = true;
      }
      onImageOffsetChange(
        dragOffsetStart.current[0] + dx,
        dragOffsetStart.current[1] + dz,
      );
      invalidate();
    }
  }, [camera, onImageOffsetChange]);

  const handlePointerUp = useCallback((e: ThreeEvent<PointerEvent>) => {
    const wasDragging = dragging.current && hasMoved.current;
    dragging.current = false;
    hasMoved.current = false;
    if (controls) (controls as unknown as { enabled: boolean }).enabled = true;

    if (!wasDragging) {
      // It was a click — handle selection
      if (e.uv && texture) {
        const alpha = sampleTextureAlpha(texture, e.uv);
        if (alpha < 0.05) return; // transparent area — skip
      }
      e.stopPropagation();
      if (e.shiftKey) {
        onSelectShift?.();
      } else {
        onSelect?.(false);
      }
    }
  }, [controls, texture, onSelect, onSelectShift]);

  const handlePointerOver = useCallback(() => {
    if (selected) document.body.style.cursor = "move";
  }, [selected]);

  const handlePointerOut = useCallback(() => {
    document.body.style.cursor = "";
  }, []);

  return (
    <group>
      <mesh
        ref={meshRef}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[finalOffX, 0.04, finalOffZ]}
        renderOrder={baseOrder + 2}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
      >
        <planeGeometry args={[planeW, planeD]} />
        <meshBasicMaterial
          ref={matRef}
          map={texture}
          transparent
          opacity={opacity * fadeProgress.current}
          depthWrite={false}
          side={DoubleSide}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-1}
        />
      </mesh>
      {/* Selection / multi-selection ring overlay */}
      {(selected || multiSelected) && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[finalOffX, 0.05, finalOffZ]} renderOrder={baseOrder + 5}>
          <planeGeometry args={[planeW + 0.04, planeD + 0.04]} />
          <meshBasicMaterial
            ref={selectionRingRef}
            transparent
            opacity={0}
            color={multiSelected ? accentColor : selectionColor}
            depthWrite={false}
            side={DoubleSide}
            wireframe
          />
        </mesh>
      )}
      {/* Glow overlay for AI editing pulse */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[finalOffX, 0.06, finalOffZ]} renderOrder={baseOrder + 3}>
        <planeGeometry args={[planeW, planeD]} />
        <meshBasicMaterial
          ref={glowRef}
          transparent
          opacity={0}
          color={glowColor}
          depthWrite={false}
          side={DoubleSide}
          polygonOffset
          polygonOffsetFactor={-2}
          polygonOffsetUnits={-2}
        />
      </mesh>
      {/* Drag handle indicator — small cross shown when selected and translatable */}
      {selected && onImageOffsetChange && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[finalOffX, 0.07, finalOffZ]} renderOrder={baseOrder + 6}>
          <planeGeometry args={[0.12, 0.12]} />
          <meshBasicMaterial
            transparent
            opacity={0.7}
            color={selectionColor}
            depthWrite={false}
            wireframe
          />
        </mesh>
      )}
    </group>
  );
}



/**
 * Compute how many brick-space Y-units correspond to one screen pixel,
 * by projecting the top and bottom of the prism onto the screen.
 */
function screenToBrickY(camera: Camera, canvasH: number): number {
  const top = new Vector3(0, PRISM_H / 2, 0).project(camera);
  const bot = new Vector3(0, -PRISM_H / 2, 0).project(camera);
  // NDC Y range [-1,1] → pixel range [0, canvasH]
  const topPx = (1 - top.y) * 0.5 * canvasH;
  const botPx = (1 - bot.y) * 0.5 * canvasH;
  const pixelSpan = Math.abs(botPx - topPx);
  if (pixelSpan < 1) return PRISM_H / canvasH; // fallback
  return PRISM_H / pixelSpan;
}

/** Exposes the R3F camera to an external ref. */
function CameraRef({ cameraRef }: { cameraRef: React.MutableRefObject<Camera | null> }): null {
  const { camera } = useThree();
  cameraRef.current = camera;
  return null;
}

/**
 * Projects a selected slice's 3D position → screen coords each frame.
 * Writes to the provided callback only when the position changes by >1px
 * to avoid unnecessary re-renders in demand-render mode.
 */
function SliceAnchorTracker({
  layerIndex,
  layerCount,
  layerOrder,
  onUpdate,
}: {
  layerIndex: number | null;
  layerCount: number;
  layerOrder: number[];
  onUpdate: (anchor: AnchorPoint) => void;
}): null {
  const { camera, size } = useThree();
  const lastRef = useRef<{ x: number; y: number; visible: boolean }>({ x: 0, y: 0, visible: false });
  const _v = useMemo(() => new Vector3(), []);

  useFrame(() => {
    if (layerIndex === null) return;
    const visualPos = layerOrder.indexOf(layerIndex);
    if (visualPos < 0) return;
    const y = layerY(visualPos, layerCount);
    // Slice center in world: x=0, y=layer height, z=0
    _v.set(0, y, 0);
    _v.project(camera);
    // NDC → screen px
    const sx = ((_v.x + 1) / 2) * size.width;
    const sy = ((1 - _v.y) / 2) * size.height;
    const visible = _v.z >= 0 && _v.z <= 1
      && sx >= -100 && sx <= size.width + 100
      && sy >= -100 && sy <= size.height + 100;
    const prev = lastRef.current;
    if (Math.abs(prev.x - sx) > 1 || Math.abs(prev.y - sy) > 1 || prev.visible !== visible) {
      lastRef.current = { x: sx, y: sy, visible };
      onUpdate({ x: sx, y: sy, visible });
    }
  });

  return null;
}

/** Organic breathing glow shown while 3D generation is in progress. */
function Generating3DPlaceholder({
  width,
  depth,
  crop,
}: {
  width: number;
  depth: number;
  crop?: CropInfo;
}): React.JSX.Element {
  const glowColor = useUIStyle((s) => s.template.colors.glowAi);
  const fullW = width * 0.96;
  const fullD = depth * 0.96;
  let offX = 0;
  let offZ = 0;
  if (crop) {
    offX = ((crop.cropX + crop.cropW / 2) / crop.origW - 0.5) * fullW;
    offZ = ((crop.cropY + crop.cropH / 2) / crop.origH - 0.5) * fullD;
  }
  const planeW = crop ? fullW * (crop.cropW / crop.origW) : fullW * 0.5;
  const planeD = crop ? fullD * (crop.cropH / crop.origH) : fullD * 0.5;

  const innerRef = useRef<import("three").MeshBasicMaterial>(null);
  const outerRef = useRef<import("three").MeshBasicMaterial>(null);
  const outerMeshRef = useRef<import("three").Mesh>(null);

  useFrame(() => {
    const t = performance.now() / 1000;
    // Organic multi-frequency breathing
    const breath = 0.5 + 0.5 * Math.sin(t * 1.8) * Math.sin(t * 0.7 + 0.3);
    // Color shifts between warm cyan and soft violet
    const hue = 190 + 30 * Math.sin(t * 0.5);
    const color = `hsl(${String(Math.round(hue))}, 85%, 55%)`;

    if (innerRef.current) {
      innerRef.current.opacity = 0.15 + 0.35 * breath;
      innerRef.current.color.set(color);
    }
    if (outerRef.current) {
      outerRef.current.opacity = 0.08 + 0.18 * breath;
      outerRef.current.color.set(color);
    }
    // Soft scale pulse on the outer ring
    if (outerMeshRef.current) {
      const s = 1.0 + 0.06 * breath;
      outerMeshRef.current.scale.set(s, s, 1);
    }
    invalidate();
  });

  return (
    <group>
      {/* Inner glow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[offX, 0.04, offZ]}>
        <planeGeometry args={[planeW, planeD]} />
        <meshBasicMaterial
          ref={innerRef}
          transparent
          opacity={0.15}
          color={glowColor}
          depthWrite={false}
          side={DoubleSide}
        />
      </mesh>
      {/* Outer breathing halo */}
      <mesh ref={outerMeshRef} rotation={[-Math.PI / 2, 0, 0]} position={[offX, 0.035, offZ]}>
        <planeGeometry args={[planeW * 1.12, planeD * 1.12]} />
        <meshBasicMaterial
          ref={outerRef}
          transparent
          opacity={0.06}
          color={glowColor}
          depthWrite={false}
          side={DoubleSide}
        />
      </mesh>
    </group>
  );
}

/** Standardized 3D object transform state. */
export interface Object3DTransform {
  position: [number, number, number];
  rotation: [number, number, number]; // degrees
  scale: [number, number, number];
}

/**
 * Which face of the bounding rectangular prism the gizmo pivot sits on.
 * "center" = volumetric center.  The six faces are axis-aligned in Y-up space
 * (standard glTF / Three.js convention, no rotation applied):
 *   +Y = top (head), −Y = bottom (feet/base), ±X = left/right, ±Z = front/back.
 */
export type PivotFace = "center" | "-y" | "+y" | "-x" | "+x" | "-z" | "+z";
export const PIVOT_FACES: PivotFace[] = ["center", "+y", "-y", "-x", "+x", "+z", "-z"];
export const PIVOT_FACE_LABELS: Record<PivotFace, string> = {
  "center": "Center",
  "+y": "Top",
  "-y": "Bottom",
  "-x": "Left",
  "+x": "Right",
  "+z": "Front",
  "-z": "Back",
};

const DEFAULT_TRANSFORM: Object3DTransform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
};

/** Renders a GLB model on a layer, auto-fitted to the segment's footprint on the prism. */
function GLBLayerModel({
  url,
  width,
  depth,
  crop,
  selected,
  transformPivot,
  transformMode,
  snapTranslation,
  snapRotation,
  snapScale,
  snapEnabled,
  onTransformChange,
  appliedTransform,
  onSetTransformPivot,
}: {
  url: string;
  width: number;
  depth: number;
  crop?: CropInfo | undefined;
  selected?: boolean | undefined;
  transformPivot?: PivotFace | undefined;
  transformMode?: "translate" | "rotate" | "scale" | undefined;
  snapTranslation?: number | undefined;
  snapRotation?: number | undefined;
  snapScale?: number | undefined;
  snapEnabled?: boolean | undefined;
  onTransformChange?: ((t: Object3DTransform) => void) | undefined;
  appliedTransform?: Object3DTransform | undefined;
  onSetTransformPivot?: ((face: PivotFace) => void) | undefined;
}): React.JSX.Element | null {
  const { scene } = useGLTF(url);
  const selectionWireframe = useUIStyle((s) => s.template.colors.selectionWireframe);
  const pivotColor = useUIStyle((s) => s.template.colors.pivotColor);
  // Base offset positions the model over the selected prism segment (crop offset etc).
  // `pivotCompRef` is an INTERNAL compensation group used to keep the model stationary
  // when the pivot face changes, without modifying the persisted user transform.
  const pivotCompRef = useRef<import("three").Group>(null);
  const tcTargetRef = useRef<import("three").Group>(null);
  const contentRef = useRef<import("three").Group>(null);
  const scaleGroupRef = useRef<import("three").Group>(null);
  const [tcReady, setTcReady] = useState(false);

  const cloned = useMemo(() => {
    const c = scene.clone(true);
    c.traverse((node) => {
      const mesh = node as Mesh;
      if (!mesh.isMesh) return;
      if (!mesh.geometry.attributes["normal"]) {
        mesh.geometry.computeVertexNormals();
      }
      const hasVertexColors = !!(mesh.geometry.attributes["color"]);
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const fixed = mats.map((mat: Material) => {
        const m = mat.clone();
        if (m instanceof MeshStandardMaterial) {
          if (hasVertexColors) m.vertexColors = true;
          if (m.map) { m.map = m.map.clone(); m.map.colorSpace = SRGBColorSpace; m.map.needsUpdate = true; }
          if (!m.map && !hasVertexColors) m.color = new Color(0xcccccc);
          m.metalness = 0;
          m.roughness = Math.max(m.roughness, 0.6);
          m.needsUpdate = true;
        } else if (m instanceof MeshBasicMaterial) {
          if (hasVertexColors) m.vertexColors = true;
          if (m.map) { m.map = m.map.clone(); m.map.colorSpace = SRGBColorSpace; m.map.needsUpdate = true; }
          if (!m.map && !hasVertexColors) m.color = new Color(0xcccccc);
          m.needsUpdate = true;
        }
        return m;
      });
      mesh.material = Array.isArray(mesh.material) ? fixed : fixed[0]!;
    });
    return c;
  }, [scene]);

  // ── Target footprint on the prism ──
  const fullW = width * 0.96;
  const fullD = depth * 0.96;
  let offX = 0;
  let offZ = 0;
  let targetW = fullW;
  let targetD = fullD;

  if (crop) {
    offX = ((crop.cropX + crop.cropW / 2) / crop.origW - 0.5) * fullW;
    offZ = ((crop.cropY + crop.cropH / 2) / crop.origH - 0.5) * fullD;
    targetW = fullW * (crop.cropW / crop.origW);
    targetD = fullD * (crop.cropH / crop.origH);
  }

  // ── Compute bbox metrics WITHOUT mutating the rendered clone.
  // Build a probe with the EXACT same transform chain as the render tree:
  //   scaleGroup(fitScale) → orientGroup(q) → model
  // so that bbox center is directly in tcTarget-equivalent space.
  // Auto-yaw: if rotating 90° around Y makes the XZ footprint aspect better
  // match the target image aspect, apply it.
  const { orientationQuat, scaledMetrics } = useMemo(() => {
    // Base rotation: SAM-3 outputs Z-up models; Three.js is Y-up → −90° X
    const baseQ = new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, 0));

    // 1. Determine if yaw correction is needed (using base-rotated probe)
    const rawProbe = cloned.clone(true);
    const rawGroup = new Group();
    rawGroup.quaternion.copy(baseQ);
    rawGroup.add(rawProbe);
    rawGroup.updateMatrixWorld(true);
    const rawBox = new Box3().setFromObject(rawGroup);
    const rawSize = new Vector3();
    rawBox.getSize(rawSize);

    // Count meshes and check geometry readiness for debug
    let meshCount = 0;
    let allGeometryReady = true;
    cloned.traverse((node) => {
      const mesh = node as Mesh;
      if (!mesh.isMesh) return;
      meshCount++;
      if (!mesh.geometry.attributes["position"] || mesh.geometry.attributes["position"].count === 0) {
        allGeometryReady = false;
      }
    });

    const imageAspect = targetW / Math.max(targetD, 0.001);
    const modelAspect = rawSize.x / Math.max(rawSize.z, 0.001);
    const modelAspect90 = rawSize.z / Math.max(rawSize.x, 0.001);
    const needsYaw90 =
      Math.abs(modelAspect - imageAspect) > Math.abs(modelAspect90 - imageAspect) &&
      Math.abs(modelAspect - imageAspect) > 0.3;

    const q = baseQ.clone();
    if (needsYaw90) {
      q.premultiply(new Quaternion().setFromEuler(new Euler(0, Math.PI / 2, 0)));
    }

    // 2. Compute fitScale from oriented (but unscaled) bbox
    const orientProbe = cloned.clone(true);
    const orientGroup = new Group();
    orientGroup.quaternion.copy(q);
    orientGroup.add(orientProbe);
    orientGroup.updateMatrixWorld(true);
    const orientBox = new Box3().setFromObject(orientGroup);
    const orientSize = new Vector3();
    orientBox.getSize(orientSize);

    const sX = targetW / Math.max(orientSize.x, 0.001);
    const sZ = targetD / Math.max(orientSize.z, 0.001);
    const fs = Math.min(sX, sZ);

    // 3. Build full probe matching render hierarchy: scale → orient → model
    //    This gives us bbox center directly in tcTarget-equivalent space.
    const fullProbe = cloned.clone(true);
    const innerOrient = new Group();
    innerOrient.quaternion.copy(q);
    innerOrient.add(fullProbe);
    const scaleWrap = new Group();
    scaleWrap.scale.set(fs, fs, fs);
    scaleWrap.add(innerOrient);
    const outerGroup = new Group();
    outerGroup.add(scaleWrap);
    outerGroup.updateMatrixWorld(true);

    const box = new Box3().setFromObject(outerGroup);
    const size = new Vector3();
    box.getSize(size);
    const center = new Vector3();
    box.getCenter(center);

    // Guard: NaN / Infinity / degenerate
    if (!isFinite(center.x) || !isFinite(center.y) || !isFinite(center.z) || size.length() < 0.0001) {
      console.warn('[GLBLayerModel] probe: degenerate bbox, using fallback', { meshCount, allGeometryReady });
      return {
        orientationQuat: q,
        scaledMetrics: {
          fitScale: fs,
          center: new Vector3(),
          size: new Vector3(0.1, 0.1, 0.1),
          min: new Vector3(-0.05, -0.05, -0.05),
          max: new Vector3(0.05, 0.05, 0.05),
        },
      };
    }

    console.log('[GLBLayerModel] bbox computed', {
      meshCount,
      allGeometryReady,
      'center (XYZ)': `(${center.x.toFixed(4)}, ${center.y.toFixed(4)}, ${center.z.toFixed(4)})`,
      'size (XYZ)': `(${size.x.toFixed(4)}, ${size.y.toFixed(4)}, ${size.z.toFixed(4)})`,
      'min (XYZ)': `(${box.min.x.toFixed(4)}, ${box.min.y.toFixed(4)}, ${box.min.z.toFixed(4)})`,
      'max (XYZ)': `(${box.max.x.toFixed(4)}, ${box.max.y.toFixed(4)}, ${box.max.z.toFixed(4)})`,
      fitScale: fs.toFixed(4),
      needsYaw90,
    });

    return {
      orientationQuat: q,
      scaledMetrics: { fitScale: fs, center, size, min: box.min.clone(), max: box.max.clone() },
    };
  }, [cloned, targetW, targetD]);

  const fitScale = scaledMetrics.fitScale;

  // ── Content offset: position content so the desired pivot point
  //    (center or face) lands at tcTarget origin [0,0,0].
  //    scaledMetrics values are in tcTarget-equivalent space (post-orient, post-scale).
  const pivotFace: PivotFace = transformPivot ?? "center";
  const contentOffset = useMemo<[number, number, number]>(() => {
    const { center, min, max } = scaledMetrics;
    // Base offset puts bbox center at origin
    const cx = -center.x;
    const cy = -center.y;
    const cz = -center.z;
    if (pivotFace === "center") return [cx, cy, cz];
    // For face modes: shift so the face center is at origin instead of bbox center.
    // On the pivot axis, use the face coordinate; on other axes, use center.
    switch (pivotFace) {
      case "-y": return [cx, -min.y, cz];
      case "+y": return [cx, -max.y, cz];
      case "-x": return [-min.x, cy, cz];
      case "+x": return [-max.x, cy, cz];
      case "-z": return [cx, cy, -min.z];
      case "+z": return [cx, cy, -max.z];
    }
  }, [scaledMetrics, pivotFace]);

  // ── Bounding box size for wireframe (already scaled) ──
  const bboxSize = useMemo<[number, number, number]>(() => {
    const { size } = scaledMetrics;
    return [size.x, size.y, size.z];
  }, [scaledMetrics]);

  // Edge-only geometry for bounding box (no triangle diagonals)
  const bboxEdgesGeo = useMemo(() => new EdgesGeometry(new BoxGeometry(...bboxSize)), [bboxSize]);

  // ── Bounding box center offset from pivot point (for wireframe positioning) ──
  const bboxCenterOffset = useMemo<[number, number, number]>(() => {
    const { center, min, max } = scaledMetrics;
    if (pivotFace === "center") return [0, 0, 0];
    switch (pivotFace) {
      case "-y": return [0, center.y - min.y, 0];
      case "+y": return [0, center.y - max.y, 0];
      case "-x": return [center.x - min.x, 0, 0];
      case "+x": return [center.x - max.x, 0, 0];
      case "-z": return [0, 0, center.z - min.z];
      case "+z": return [0, 0, center.z - max.z];
    }
  }, [scaledMetrics, pivotFace]);

  // ── Debug: verify actual bbox matches probe on first rendered frame (read-only) ──
  const debugVerifiedRef = useRef(false);
  useEffect(() => { debugVerifiedRef.current = false; }, [cloned]);
  useFrame(() => {
    if (debugVerifiedRef.current) return;
    if (!scaleGroupRef.current || !tcTargetRef.current || !contentRef.current) return;
    debugVerifiedRef.current = true;
    tcTargetRef.current.updateMatrixWorld(true);
    const actualBox = new Box3().setFromObject(scaleGroupRef.current);
    if (actualBox.isEmpty()) { console.warn('[GLBLayerModel] DEBUG: actual bbox empty'); return; }
    const actualCenter = new Vector3();
    actualBox.getCenter(actualCenter);
    // Convert to tcTarget local space
    const tcInv = tcTargetRef.current.matrixWorld.clone().invert();
    const localCenter = actualCenter.applyMatrix4(tcInv);
    console.log('[GLBLayerModel] DEBUG first-frame bbox', {
      'actual center in tcTarget local': `(${localCenter.x.toFixed(4)}, ${localCenter.y.toFixed(4)}, ${localCenter.z.toFixed(4)})`,
      'expected (should be ~0,0,0 for center pivot)': pivotFace === 'center' ? 'yes' : `offset for ${pivotFace}`,
      'contentOffset applied': `(${contentOffset[0].toFixed(4)}, ${contentOffset[1].toFixed(4)}, ${contentOffset[2].toFixed(4)})`,
      'tcTarget.position': `(${tcTargetRef.current.position.x.toFixed(4)}, ${tcTargetRef.current.position.y.toFixed(4)}, ${tcTargetRef.current.position.z.toFixed(4)})`,
    });
  });

  // Mark tcTarget ready after first render
  useEffect(() => {
    if (tcTargetRef.current && !tcReady) setTcReady(true);
  });

  useEffect(() => { invalidate(); }, [cloned]);

  const orbitControls = useThree((s) => s.controls) as { enabled: boolean } | null;

  const reportTransform = useCallback(() => {
    if (!tcTargetRef.current || !onTransformChange) return;
    const g = tcTargetRef.current;
    const euler = new Euler().setFromQuaternion(g.quaternion, "XYZ");
    onTransformChange({
      position: [
        parseFloat(g.position.x.toFixed(3)),
        parseFloat(g.position.y.toFixed(3)),
        parseFloat(g.position.z.toFixed(3)),
      ],
      rotation: [
        parseFloat(MathUtils.radToDeg(euler.x).toFixed(1)),
        parseFloat(MathUtils.radToDeg(euler.y).toFixed(1)),
        parseFloat(MathUtils.radToDeg(euler.z).toFixed(1)),
      ],
      scale: [
        parseFloat(g.scale.x.toFixed(3)),
        parseFloat(g.scale.y.toFixed(3)),
        parseFloat(g.scale.z.toFixed(3)),
      ],
    });
  }, [onTransformChange]);

  useEffect(() => { reportTransform(); }, [reportTransform]);

  // ── When pivotFace changes, adjust tcTarget.position to compensate
  //    for the contentOffset change, so the model stays in place visually.
  //    INVARIANT: pivot toggle NEVER modifies model position/rotation/scale.
  //    It only changes which point is at tcTarget origin.
  const prevPivotRef = useRef<PivotFace>(pivotFace);
  const prevOffsetRef = useRef<[number, number, number]>(contentOffset);
  useEffect(() => {
    if (!tcTargetRef.current || !pivotCompRef.current) return;
    const prev = prevOffsetRef.current;
    const next = contentOffset;
    prevOffsetRef.current = next;
    // Only compensate if the pivot actually changed (not on metrics/model change)
    if (prevPivotRef.current === pivotFace) return;
    prevPivotRef.current = pivotFace;
    if (prev[0] === next[0] && prev[1] === next[1] && prev[2] === next[2]) return;
    // `contentOffset` is in tcTarget-local space. Because child translations are affected by
    // tcTarget's rotation and scale, the compensation must be applied in the parent space.
    // To keep the MODEL stationary in world while pivot changes, we translate `pivotCompRef`
    // by -(R * (S * deltaLocal)). This keeps persisted tcTarget transforms unchanged.
    const deltaLocal = new Vector3(next[0] - prev[0], next[1] - prev[1], next[2] - prev[2]);
    const g = tcTargetRef.current;
    const deltaParent = deltaLocal.clone().multiply(g.scale).applyQuaternion(g.quaternion);
    pivotCompRef.current.position.sub(deltaParent);
    console.log('[GLBLayerModel] pivot changed → compensating pivotComp (tcTarget unchanged, model stays put)', {
      pivotFace,
      deltaLocal: `(${deltaLocal.x.toFixed(4)}, ${deltaLocal.y.toFixed(4)}, ${deltaLocal.z.toFixed(4)})`,
      deltaParent: `(${deltaParent.x.toFixed(4)}, ${deltaParent.y.toFixed(4)}, ${deltaParent.z.toFixed(4)})`,
      tcTargetPosition: `(${g.position.x.toFixed(4)}, ${g.position.y.toFixed(4)}, ${g.position.z.toFixed(4)})`,
      pivotCompPosition: `(${pivotCompRef.current.position.x.toFixed(4)}, ${pivotCompRef.current.position.y.toFixed(4)}, ${pivotCompRef.current.position.z.toFixed(4)})`,
    });
    invalidate();
    reportTransform();
  }, [contentOffset, pivotFace, reportTransform]);

  // Apply externally-set transform (from editable panel inputs)
  const lastAppliedRef = useRef<Object3DTransform | null>(null);
  useEffect(() => {
    if (!appliedTransform || !tcTargetRef.current) return;
    if (lastAppliedRef.current === appliedTransform) return;
    lastAppliedRef.current = appliedTransform;
    const g = tcTargetRef.current;
    g.position.set(...appliedTransform.position);
    g.rotation.set(
      MathUtils.degToRad(appliedTransform.rotation[0]),
      MathUtils.degToRad(appliedTransform.rotation[1]),
      MathUtils.degToRad(appliedTransform.rotation[2]),
    );
    g.scale.set(...appliedTransform.scale);
    invalidate();
  }, [appliedTransform]);

  const effectiveMode = transformMode ?? "rotate";

  return (
    <>
      <group position={[offX, 0.05, offZ]}>
        <group ref={pivotCompRef}>
          <group ref={tcTargetRef}>
            {/* Content offset: positions model so desired pivot point is at tcTarget origin */}
            <group ref={contentRef} position={contentOffset}>
              <group ref={scaleGroupRef} scale={[fitScale, fitScale, fitScale]}>
                <group quaternion={orientationQuat}>
                  <primitive object={cloned} />
                </group>
              </group>
            </group>
            {/* Bounding box wireframe — centered on bbox, offset from pivot point */}
            {selected && (
              <lineSegments geometry={bboxEdgesGeo} position={bboxCenterOffset}>
                <lineBasicMaterial transparent opacity={0.25} color={selectionWireframe} depthWrite={false} />
              </lineSegments>
            )}
            {/* Pivot indicator at gizmo origin (tcTarget space) */}
            {selected && (
              <mesh rotation={[0, Math.PI / 4, 0]} position={[0, 0, 0]}>
                <boxGeometry args={[0.06, 0.06, 0.06]} />
                <meshBasicMaterial color={pivotColor} depthTest={false} transparent opacity={0.9} />
              </mesh>
            )}
            {/* Clickable bbox face proxies for pivot selection */}
            {selected && onSetTransformPivot && (
              <BBoxFaceProxies
                size={bboxSize}
                centerOffset={bboxCenterOffset}
                currentFace={pivotFace}
                onSelectFace={onSetTransformPivot}
              />
            )}
            {/* Snap helpers — parented to gizmo target so they follow position */}
            {selected && snapEnabled && (
              <GizmoChildSnapHelpers
                mode={effectiveMode}
                snapTranslation={snapTranslation}
                snapRotation={snapRotation}
                snapScale={snapScale}
                radius={Math.max(width, depth) * 0.6}
              />
            )}
          </group>
        </group>
      </group>
      {selected && tcReady && tcTargetRef.current && (
        <TransformControls
          object={tcTargetRef.current}
          mode={effectiveMode}
          size={0.6}
          space={pivotFace !== "center" ? "local" : "world"}
          translationSnap={snapTranslation ?? null}
          rotationSnap={snapRotation != null ? MathUtils.degToRad(snapRotation) : null}
          scaleSnap={snapScale ?? null}
          onChange={() => { invalidate(); reportTransform(); }}
          onMouseDown={() => { if (orbitControls) orbitControls.enabled = false; }}
          onMouseUp={() => { if (orbitControls) orbitControls.enabled = true; invalidate(); reportTransform(); }}
        />
      )}
    </>
  );
}

/** Visual snap helpers: shows mode-specific guides centered at the transform tool position.
 *  - translate: XZ grid with spacing matching snapTranslation
 *  - rotate: Radial angle lines matching snapRotation degrees
 *  - scale: Axis ticks along X, Y, Z at snap scale intervals
 */
function SnapHelpers({
  mode,
  snapTranslation,
  snapRotation,
  snapScale,
  radius,
}: {
  mode: "translate" | "rotate" | "scale";
  snapTranslation?: number | undefined;
  snapRotation?: number | undefined;
  snapScale?: number | undefined;
  radius: number;
}): React.JSX.Element {
  const colors = useUIStyle((s) => s.template.colors);

  // Translation grid: XZ plane grid with snap-aligned spacing
  const translationGrid = useMemo(() => {
    if (mode !== "translate") return null;
    const step = snapTranslation ?? 0.25;
    const divisions = Math.max(2, Math.round((radius * 2) / step));
    const size = divisions * step;
    const c = new Color(colors.gridColor);
    const grid = new ThreeGridHelper(size, divisions, c, c);
    grid.material = new LineBasicMaterial({ color: c, transparent: true, opacity: 0.35, depthWrite: false });
    return grid;
  }, [mode, snapTranslation, radius, colors.gridColor]);

  // Rotation angle lines: radial lines from center at snap intervals
  const rotationLines = useMemo(() => {
    if (mode !== "rotate") return null;
    const step = snapRotation ?? 15;
    const count = Math.round(360 / step);
    const r = radius;
    const positions: number[] = [];
    for (let i = 0; i < count; i++) {
      const angle = MathUtils.degToRad(i * step);
      positions.push(0, 0, 0, Math.cos(angle) * r, 0, Math.sin(angle) * r);
    }
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
    return geo;
  }, [mode, snapRotation, radius]);

  // Scale ticks: tick marks along X, Y, Z axes at snap intervals
  const scaleTicks = useMemo(() => {
    if (mode !== "scale") return null;
    const step = snapScale ?? 0.1;
    const positions: number[] = [];
    const tickLength = 0.03; // perpendicular tick size
    const axisLength = radius;
    const tickCount = Math.ceil(axisLength / step);

    // Draw ticks along positive and negative X, Y, Z axes
    const axes: [number, number, number][] = [
      [1, 0, 0], [-1, 0, 0], // X axis
      [0, 1, 0], [0, -1, 0], // Y axis
      [0, 0, 1], [0, 0, -1], // Z axis
    ];

    for (const [ax, ay, az] of axes) {
      // Main axis line
      positions.push(0, 0, 0, ax * axisLength, ay * axisLength, az * axisLength);
      // Tick marks at snap intervals
      for (let i = 1; i <= tickCount; i++) {
        const d = i * step;
        const px = ax * d, py = ay * d, pz = az * d;
        // Perpendicular tick: choose a perpendicular direction
        let tx = 0, ty = 0, tz = 0;
        if (ax !== 0) { ty = tickLength; } // X-axis: tick in Y
        else if (ay !== 0) { tx = tickLength; } // Y-axis: tick in X
        else { tx = tickLength; } // Z-axis: tick in X
        positions.push(px - tx, py - ty, pz - tz, px + tx, py + ty, pz + tz);
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
    return geo;
  }, [mode, snapScale, radius]);

  return (
    <group>
      {/* Translation grid */}
      {translationGrid && <primitive object={translationGrid} />}
      {/* Rotation angle lines */}
      {rotationLines && (
        <lineSegments geometry={rotationLines}>
          <lineBasicMaterial color={colors.snapLineColor} transparent opacity={0.3} depthWrite={false} />
        </lineSegments>
      )}
      {/* Scale axis ticks */}
      {scaleTicks && (
        <lineSegments geometry={scaleTicks}>
          <lineBasicMaterial color={colors.gridColor} transparent opacity={0.4} depthWrite={false} />
        </lineSegments>
      )}
    </group>
  );
}

/** Clickable invisible planes at each bbox face for quick pivot selection. */
function BBoxFaceProxies({
  size,
  centerOffset,
  currentFace,
  onSelectFace,
}: {
  size: [number, number, number];
  centerOffset: [number, number, number];
  currentFace: PivotFace;
  onSelectFace: (face: PivotFace) => void;
}): React.JSX.Element {
  const hoverColor = useUIStyle((s) => s.template.colors.accent);
  const [hovered, setHovered] = useState<PivotFace | null>(null);
  const [sx, sy, sz] = size;
  const [cx, cy, cz] = centerOffset;
  const faces: { face: PivotFace; pos: [number, number, number]; rot: [number, number, number]; w: number; h: number }[] = useMemo(() => [
    { face: "+x", pos: [cx + sx / 2, cy, cz], rot: [0, Math.PI / 2, 0], w: sz, h: sy },
    { face: "-x", pos: [cx - sx / 2, cy, cz], rot: [0, -Math.PI / 2, 0], w: sz, h: sy },
    { face: "+y", pos: [cx, cy + sy / 2, cz], rot: [-Math.PI / 2, 0, 0], w: sx, h: sz },
    { face: "-y", pos: [cx, cy - sy / 2, cz], rot: [Math.PI / 2, 0, 0], w: sx, h: sz },
    { face: "+z", pos: [cx, cy, cz + sz / 2], rot: [0, 0, 0], w: sx, h: sy },
    { face: "-z", pos: [cx, cy, cz - sz / 2], rot: [0, Math.PI, 0], w: sx, h: sy },
  ], [sx, sy, sz, cx, cy, cz]);

  return (
    <group>
      {faces.map(({ face, pos, rot, w, h }) => (
        <mesh
          key={face}
          position={pos}
          rotation={rot}
          onClick={(e) => { e.stopPropagation(); onSelectFace(face); }}
          onPointerOver={() => { setHovered(face); invalidate(); }}
          onPointerOut={() => { setHovered(null); invalidate(); }}
        >
          <planeGeometry args={[w * 0.9, h * 0.9]} />
          <meshBasicMaterial
            transparent
            opacity={hovered === face ? 0.15 : currentFace === face ? 0.08 : 0}
            color={hoverColor}
            depthWrite={false}
            side={DoubleSide}
          />
        </mesh>
      ))}
    </group>
  );
}

/** Snap helpers rendered as child of gizmo target — counter-rotates for translate mode. */
function GizmoChildSnapHelpers({
  mode,
  snapTranslation,
  snapRotation,
  snapScale,
  radius,
}: {
  mode: "translate" | "rotate" | "scale";
  snapTranslation?: number | undefined;
  snapRotation?: number | undefined;
  snapScale?: number | undefined;
  radius: number;
}): React.JSX.Element {
  const counterRef = useRef<Group>(null);
  const _q = useMemo(() => new Quaternion(), []);

  useFrame(() => {
    if (!counterRef.current) return;
    if (mode === "translate") {
      // Counter-rotate so translate grid stays world-axis-aligned
      const parent = counterRef.current.parent;
      if (parent) {
        parent.getWorldQuaternion(_q);
        counterRef.current.quaternion.copy(_q.invert());
      }
    } else {
      // For rotate/scale, snap helpers follow object rotation
      counterRef.current.quaternion.identity();
    }
  });

  return (
    <group ref={counterRef}>
      <SnapHelpers
        mode={mode}
        snapTranslation={snapTranslation}
        snapRotation={snapRotation}
        snapScale={snapScale}
        radius={radius}
      />
    </group>
  );
}

function SpacePrism(props: SpacePrismProps): React.JSX.Element {
  const { layerCount, selectedLayerIndex, layerVisibility, layerOrder, onSelectLayer, dragOverride, suppressClicks, layerTextures, layerCropInfo, imageAspect, layerSpread: spreadProp, threeDSourceHidden, revealActive, onRevealDone, aiEditingLayers, layerGlbUrls, generating3DLayer, transformPivot, transformMode, snapTranslation, snapRotation, snapScale, snapEnabled, onSetTransformPivot, onTransformChange, appliedTransform, modelTransform, layerImageOffsets, onLayerImageOffsetChange, multiSelectedLayers, onMultiSelect } = props;
  const spread = spreadProp ?? 1;
  const { prismW, prismD } = prismDims(imageAspect);
  const hiddenSlideX = -(prismW + 0.5);
  const template = useUIStyle((s) => s.template);

  // Track reveal animation progress
  const revealProgress = useRef(revealActive ? 0 : 1);
  const revealDoneFired = useRef(!revealActive);

  // Use template animation speed to control reveal pacing (lower = calmer)
  const revealSpeed = 1.8 * template.ui.animationSpeed;

  useFrame((_, delta) => {
    if (revealProgress.current >= 1) return;
    revealProgress.current = Math.min(1, revealProgress.current + delta * revealSpeed);
    invalidate();
    if (revealProgress.current >= 1 && !revealDoneFired.current) {
      revealDoneFired.current = true;
      onRevealDone?.();
    }
  });

  // Reset reveal on new trigger
  useEffect(() => {
    if (revealActive) {
      revealProgress.current = 0;
      revealDoneFired.current = false;
    }
  }, [revealActive]);

  // When a layer is being dragged, compute adjusted Y positions for non-dragged layers
  // so they "make room" without relying on parent re-renders (which cause ghost duplicates).
  const dragIdx = dragOverride?.layerIdx ?? -1;
  const dragActive = dragOverride !== null && dragOverride !== undefined;

  // Build the visual position for each layer (memoized for the non-drag case)
  const staticPositions = useMemo(() => {
    const result: { layerIdx: number; y: number; isDragged: boolean }[] = [];
    for (let posIdx = 0; posIdx < layerOrder.length; posIdx++) {
      result.push({ layerIdx: layerOrder[posIdx] ?? posIdx, y: layerY(posIdx, layerCount, spread), isDragged: false });
    }
    return result;
  }, [layerOrder, layerCount, spread]);

  let positions: { layerIdx: number; y: number; isDragged: boolean }[];
  if (dragActive) {
    // Figure out which slot the dragged layer would snap to
    const continuous = yToLayerContinuous(dragOverride.y, layerCount, spread);
    const targetSlot = clampLayerIndex(continuous, layerCount);

    // Build a temporary order with the dragged layer removed, then inserted at target
    const tempOrder = layerOrder.filter(li => li !== dragIdx);
    tempOrder.splice(targetSlot, 0, dragIdx);

    positions = [];
    for (let posIdx = 0; posIdx < tempOrder.length; posIdx++) {
      const li = tempOrder[posIdx] ?? posIdx;
      if (li === dragIdx) {
        positions.push({ layerIdx: li, y: dragOverride.y, isDragged: true });
      } else {
        positions.push({ layerIdx: li, y: layerY(posIdx, layerCount, spread), isDragged: false });
      }
    }
  } else {
    positions = staticPositions;
  }

  // Shared geometry for all brick planes — avoids N allocations per frame
  const brickGeo = useMemo(() => new PlaneGeometry(prismW * 0.96, prismD * 0.96), [prismW, prismD]);

  // Rectangle corner points for slice border (closed loop)
  const sliceEdgePoints = useMemo((): [number, number, number][] => {
    const hw = (prismW * 0.96) / 2;
    const hd = (prismD * 0.96) / 2;
    return [[-hw, -hd, 0], [hw, -hd, 0], [hw, hd, 0], [-hw, hd, 0], [-hw, -hd, 0]];
  }, [prismW, prismD]);

  // Edge-only geometry for the prism wireframe (no triangle diagonals)
  const prismH = PRISM_H * spread;
  const prismEdgesGeo = useMemo(() => new EdgesGeometry(new BoxGeometry(prismW, prismH, prismD)), [prismW, prismD, prismH]);

  return (
    <group>
      <lineSegments geometry={prismEdgesGeo}>
        <lineBasicMaterial transparent opacity={0.15} color={template.colors.foreground} />
      </lineSegments>

      {/* Subtle ground shadow beneath the prism */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -prismH / 2 - 0.01, 0]} renderOrder={-1}>
        <planeGeometry args={[prismW * 1.3, prismD * 1.3]} />
        <meshBasicMaterial transparent opacity={0.06} color="#000000" depthWrite={false} />
      </mesh>

      {positions.map(({ layerIdx, y, isDragged }, positionIndex) => {
        const vis = layerVisibility[layerIdx];
        const hidden = vis ? !vis.visible : false;
        // Hidden / solo-aside layers slide to the right with smooth animation
        const targetX = hidden ? hiddenSlideX : 0;
        // During reveal, lerp Y from center (0) toward final position
        const t = revealProgress.current;
        const eased = t < 1 ? t * t * (3 - 2 * t) : 1; // smoothstep
        const targetY = isDragged ? y : eased * y;
        const selected = layerIdx === selectedLayerIndex;
        const scaleVal = selected ? 1.01 : 1.0;
        const scale: [number, number, number] = [scaleVal, scaleVal, scaleVal];
        const baseOpacity = vis ? vis.opacity : (selected ? 0.30 : 0.10);
        const opacity = hidden ? Math.max(baseOpacity * 0.35, 0.06) : baseOpacity;
        const color = selected ? template.colors.accent : template.brick.color;
        // Use position in stack for render ordering so upper layers draw on top
        const baseOrder = positionIndex * 10;
        return (
          <AnimatedLayerGroup key={layerIdx} targetX={targetX} targetY={targetY}>
            <mesh
              geometry={brickGeo}
              rotation={[Math.PI / 2, 0, 0]}
              scale={scale}
              renderOrder={baseOrder}
  {...(suppressClicks ? {} : {
              onClick: (e: ThreeEvent<MouseEvent>) => {
                e.stopPropagation();
                if (e.shiftKey) { onMultiSelect?.(layerIdx); }
                else { onSelectLayer(layerIdx); }
              }
            })}
            >
              <meshBasicMaterial
                transparent
                opacity={isDragged ? Math.max(opacity, 0.5) : opacity}
                color={color}
                depthWrite={false}
                side={DoubleSide}
                polygonOffset
                polygonOffsetFactor={0}
                polygonOffsetUnits={1}
              />

            </mesh>
            {/* Slice border outline — subtle when idle, vivid when selected or multi-selected */}
            <Line
              points={sliceEdgePoints}
              color={(multiSelectedLayers?.has(layerIdx) || selected) ? template.colors.selectionWireframe : template.colors.foreground}
              lineWidth={(multiSelectedLayers?.has(layerIdx) || selected) ? 2.5 : 1}
              rotation={[Math.PI / 2, 0, 0]}
              scale={scale}
              position={[0, 0.08, 0]}
              renderOrder={baseOrder + 4}
              depthWrite={false}
              transparent
              opacity={(multiSelectedLayers?.has(layerIdx) || selected) ? 1 : 0.25}
            />
            {/* Texture overlay if this layer has an image — hidden when 3D source toggle is on */}
            {layerTextures[layerIdx] && !threeDSourceHidden?.has(layerIdx) && (
              <TexturedLayerPlane
                uri={layerTextures[layerIdx]}
                width={prismW}
                depth={prismD}
                layerIdx={layerIdx}
                opacity={vis ? vis.textureOpacity : 1}
                crop={layerCropInfo[layerIdx]}
                aiEditing={aiEditingLayers?.has(layerIdx) ?? false}
                generating3D={generating3DLayer === layerIdx}
                positionIndex={positionIndex}
                selected={selected}
                multiSelected={multiSelectedLayers?.has(layerIdx) ?? false}
                onSelect={suppressClicks ? undefined : (shiftKey) => {
                  if (shiftKey) { onMultiSelect?.(layerIdx); }
                  else { onSelectLayer(layerIdx); }
                }}
                onSelectShift={suppressClicks ? undefined : () => onMultiSelect?.(layerIdx)}
                imageOffset={layerImageOffsets?.[layerIdx]}
                onImageOffsetChange={selected && onLayerImageOffsetChange
                  ? (x, z) => onLayerImageOffsetChange(layerIdx, x, z)
                  : undefined}
              />
            )}
            {/* GLB 3D model — only shown when source image is toggled hidden */}
            {generating3DLayer === layerIdx && !layerGlbUrls?.[layerIdx] && (
              <Generating3DPlaceholder
                width={prismW}
                depth={prismD}
                {...(layerCropInfo[layerIdx] ? { crop: layerCropInfo[layerIdx] } : {})}
              />
            )}
            {layerGlbUrls?.[layerIdx] && threeDSourceHidden?.has(layerIdx) && (
              <GLBLayerModel
                url={layerGlbUrls[layerIdx]}
                width={prismW}
                depth={prismD}
                selected={selected}
                transformPivot={transformPivot}
                transformMode={transformMode}
                snapTranslation={snapTranslation}
                snapRotation={snapRotation}
                snapScale={snapScale}
                snapEnabled={snapEnabled}
                onTransformChange={selected ? onTransformChange : undefined}
                appliedTransform={selected ? appliedTransform : undefined}
                onSetTransformPivot={selected ? onSetTransformPivot : undefined}
                {...(layerCropInfo[layerIdx] ? { crop: layerCropInfo[layerIdx] } : {})}
              />
            )}
            <LayerLabel
              text={String(layerIdx)}
              color={template.colors.foreground}
              opacity={hidden ? 0.2 : Math.min(0.5, opacity * 2)}
              renderOrder={baseOrder + 1}
              position={[-(prismW * 0.96) / 2 + 0.15, 0.09, -(prismD * 0.96) / 2 + 0.15]}
            />
          </AnimatedLayerGroup>
        );
      })}
    </group>
  );
}

/* ── Scrubber Plane (draggable in-scene) ──────────── */

interface ScrubberPlaneProps {
  layerCount: number;
  selectedLayerIndex: number | null;
  layerOrder: number[];
  onPreviewLayer: (index: number | null) => void;
  onCommitLayer: (index: number) => void;
  imageAspect: number | null;
  layerSpread?: number;
}

const _dragPlane = new Plane(new Vector3(0, 0, 1), 0);
const _intersection = new Vector3();
const _raycaster = new Raycaster();

function ScrubberPlane(props: ScrubberPlaneProps): React.JSX.Element | null {
  const { layerCount, selectedLayerIndex, layerOrder, onPreviewLayer, onCommitLayer, imageAspect, layerSpread: spreadProp } = props;
  const spread = spreadProp ?? 1;
  const { prismW, prismD } = prismDims(imageAspect);
  const { camera, controls } = useThree();
  const scrubber3d = useUIStyle((s) => s.template.colors.scrubber3d);
  const dragging = useRef(false);
  const startY = useRef(0);
  const startLayerY = useRef(0);

  // Find the visual position of the selected logical layer
  const currentLogical = selectedLayerIndex ?? 0;
  const visualPos = layerOrder.indexOf(currentLogical);
  const currentVisual = visualPos >= 0 ? visualPos : 0;
  const y = layerY(currentVisual, layerCount, spread);

  const handlePointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      const target = e.eventObject as unknown as { setPointerCapture: (id: number) => void };
      target.setPointerCapture(e.pointerId);
      dragging.current = true;

      // Disable OrbitControls while dragging
      if (controls) (controls as unknown as { enabled: boolean }).enabled = false;

      // Set up a drag plane perpendicular to camera forward through the mesh position
      const camDir = new Vector3();
      camera.getWorldDirection(camDir);
      _dragPlane.setFromNormalAndCoplanarPoint(camDir, e.point);
      startY.current = e.point.y;
      startLayerY.current = layerY(currentVisual, layerCount, spread);
    },
    [camera, controls, currentVisual, layerCount, spread],
  );

  const handlePointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!dragging.current) return;
      e.stopPropagation();

      // Raycast against the drag plane
      _raycaster.setFromCamera(e.pointer, camera);
      if (_raycaster.ray.intersectPlane(_dragPlane, _intersection)) {
        const deltaY = _intersection.y - startY.current;
        const newY = startLayerY.current + deltaY;
        const continuous = yToLayerContinuous(newY, layerCount, spread);
        const snappedVisual = clampLayerIndex(continuous, layerCount);
        // Map visual position back to logical layer index
        const logicalIdx = layerOrder[snappedVisual] ?? snappedVisual;
        onPreviewLayer(logicalIdx);
      }
    },
    [camera, layerCount, layerOrder, onPreviewLayer],
  );

  const handlePointerUp = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!dragging.current) return;
      e.stopPropagation();
      dragging.current = false;

      // Re-enable OrbitControls
      if (controls) (controls as unknown as { enabled: boolean }).enabled = true;

      // Final snap
      _raycaster.setFromCamera(e.pointer, camera);
      let finalLogical = currentLogical;
      if (_raycaster.ray.intersectPlane(_dragPlane, _intersection)) {
        const deltaY = _intersection.y - startY.current;
        const newY = startLayerY.current + deltaY;
        const continuous = yToLayerContinuous(newY, layerCount, spread);
        const snappedVisual = clampLayerIndex(continuous, layerCount);
        finalLogical = layerOrder[snappedVisual] ?? snappedVisual;
      }

      // Commit selection BEFORE clearing preview so effectiveSelectedIndex
      // never drops to null (which would unmount the LayerControlsHUD).
      onCommitLayer(finalLogical);
      onPreviewLayer(null);
    },
    [camera, controls, layerCount, layerOrder, currentLogical, onPreviewLayer, onCommitLayer],
  );

  // With a single layer there is nothing to scrub — skip rendering so
  // the invisible grab mesh does not block clicks on the layer plane.
  if (layerCount <= 1) return null;

  return (
    <group position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
      {/* Visible scrubber indicator — thin line across the prism */}
      <mesh>
        <planeGeometry args={[prismW * 0.98, prismD * 0.02]} />
        <meshBasicMaterial
          transparent
          opacity={0.4}
          color={scrubber3d}
          depthWrite={false}
          side={DoubleSide}
        />
      </mesh>
      {/* Invisible wide grab area for easy dragging */}
      <mesh
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <planeGeometry args={[prismW * 0.5, prismD * 0.5]} />
        <meshBasicMaterial
          transparent
          opacity={0}
          depthWrite={false}
          side={DoubleSide}
        />
      </mesh>
    </group>
  );
}

interface SpaceViewportProps {
  layerCount: number;
  selectedLayerIndex: number | null;
  onSelectLayer: (index: number) => void;
  onPreviewLayer: (index: number | null) => void;
  layerVisibility: LayerVis[];
  soloIndex: number | null;
  onToggleHidden: (index: number) => void;
  onToggleSolo: (index: number) => void;
  onToggleMask: (index: number) => void;
  maskActive: boolean;
  onPreviewOpacity: (value: number | null) => void;
  onCommitOpacity: (index: number, value: number) => void;
  persistedOpacity: number;
  persistedOpacityFn: (index: number) => number;
  isHiddenFn: (index: number) => boolean;
  layerOrder: number[];
  onPreviewOrder: (order: number[] | null) => void;
  onCommitOrder: (order: number[]) => void;
  animPhase: AnimPhase;
  onAnimDone: () => void;
  viewMode: ViewMode;
  peekLayers: boolean;
  peekRail: boolean;
  onClearSelection: () => void;
  layerTextures: Record<number, string>;
  layerThumbnails: Record<number, string>;
  layerNames: Record<number, string>;
  onRenameLayer: (index: number, name: string) => void;
  colorLayerTextures: Record<number, string>;
  layerCropInfo: Record<number, CropInfo>;
  segmentDisplayMode: SegmentDisplayMode;
  onToggleSegmentDisplay: () => void;
  revealActive: boolean;
  onRevealDone: () => void;
  imageAspect: number | null;
  onImportImage: () => void;
  onAiEdit: (prompt: string, strength?: number) => void;
  onAiEditForLayer: (layerIndex: number, prompt: string, strength?: number) => void;
  aiEditingLayers: Set<number>;
  aiErrors: Record<number, string>;
  onPromptVisibilityChange?: (visible: boolean) => void;
  onAddSlice: () => void;
  onDeleteSlice: (index: number) => void;
  isMaskActiveFn: (index: number) => boolean;
  isMaskInvertedFn: (index: number) => boolean;
  onInvertMask: (index: number) => void;
  aiEditModelId: string;
  onChangeAiEditModel: (id: string) => void;
  onGenerate3D: (index: number) => void;
  generating3DLayer: number | null;
  layerGlbUrls: Record<number, string>;
  threeDSourceHidden: Set<number>;
  onToggle3DSourceImage: (index: number) => void;
  // AI History
  getSliceHistory?: (layerIndex: number) => SliceHistoryGraph | null;
  onSetDisplayCursor?: (layerIndex: number, stateId: string) => void;
  onSetOperationCursor?: (layerIndex: number, stateId: string) => void;
  payloads?: Record<string, { uri: string; meta: Record<string, string> }>;
  /** Keyframe preview: all layer thumbnails composited top-down */
  keyframePreviewUrl?: string | null;
  /** Document-level source image for AI history anchor. */
  documentSourceImageId?: PayloadId | undefined;
  /** Trigger AI composite on the keyframe preview image. */
  onCompositeKeyframe?: () => void;
  /** Result URL from the AI composite operation. */
  compositeResultUrl?: string | null;
  /** Whether the AI composite is currently processing. */
  compositeBusy?: boolean;
}

export default function SpaceViewport(props: SpaceViewportProps): React.JSX.Element {
  const {
    layerCount,
    selectedLayerIndex,
    onSelectLayer,
    onPreviewLayer,
    layerVisibility,
    soloIndex,
    onToggleHidden,
    onToggleSolo,
    onToggleMask,
    maskActive,
    onPreviewOpacity,
    onCommitOpacity,
    persistedOpacity,
    persistedOpacityFn,
    isHiddenFn,
    layerOrder,
    onPreviewOrder,
    onCommitOrder,
    animPhase,
    onAnimDone,
    viewMode,
    peekLayers,
    peekRail,
    layerTextures,
    layerThumbnails,
    layerNames,
    onRenameLayer,
    colorLayerTextures,
    layerCropInfo,
    segmentDisplayMode,
    onToggleSegmentDisplay,
    revealActive,
    onRevealDone,
    imageAspect,
    onImportImage,
    onAiEdit,
    onAiEditForLayer,
    aiEditingLayers,
    aiErrors,
    onPromptVisibilityChange,
    onAddSlice,
    onDeleteSlice,
    isMaskActiveFn,
    isMaskInvertedFn,
    onInvertMask,
    aiEditModelId,
    onChangeAiEditModel,
    onGenerate3D,
    generating3DLayer,
    layerGlbUrls,
    threeDSourceHidden,
    onToggle3DSourceImage,
    onClearSelection,
    getSliceHistory,
    onSetDisplayCursor,
    onSetOperationCursor,
    payloads,
    keyframePreviewUrl,
    documentSourceImageId,
    onCompositeKeyframe,
    compositeResultUrl,
    compositeBusy,
  } = props;
  const animating = animPhase !== "idle";

  // Transform pivot face for 3D models: which bbox face the gizmo anchors to
  const [transformPivot, setTransformPivot] = useState<PivotFace>("center");

  // Keyframe expanded preview + composite state
  const [keyframeExpanded, setKeyframeExpanded] = useState(false);
  const [compositeFade, setCompositeFade] = useState(0.5);

  // AI panel pinned to a specific layer (persists across selection changes)
  const [aiPanelLayer, setAiPanelLayer] = useState<number | null>(null);
  const [aiPanelPrompt, setAiPanelPrompt] = useState("");
  const [aiPanelStrength, setAiPanelStrength] = useState(0.75);

  // Universal AI History panel: which layer index is open, or null
  const [historyPanelLayer, setHistoryPanelLayer] = useState<number | null>(null);
  // Screen-space anchor for the 3D-attached history HUD
  const [sliceAnchor, setSliceAnchor] = useState<AnchorPoint>({ x: 0, y: 0, visible: false });
  const stableSetSliceAnchor = useCallback((a: AnchorPoint) => { setSliceAnchor(a); }, []);
  // Screen-space anchor for the AI edit button on the selected node
  const [selectedSliceAnchor, setSelectedSliceAnchor] = useState<AnchorPoint>({ x: 0, y: 0, visible: false });
  const stableSetSelectedSliceAnchor = useCallback((a: AnchorPoint) => { setSelectedSliceAnchor(a); }, []);
  // Screen-space anchor for the pinned AI panel layer
  const [aiPanelAnchor, setAiPanelAnchor] = useState<AnchorPoint>({ x: 0, y: 0, visible: false });
  const stableSetAiPanelAnchor = useCallback((a: AnchorPoint) => { setAiPanelAnchor(a); }, []);
  // Layer spread multiplier (1 = default, 0.2 = compressed, 3.0 = expanded)
  const [layerSpread, setLayerSpread] = useState(1);
  // Transform gizmo mode
  const [transformMode, setTransformMode] = useState<"translate" | "rotate" | "scale">("rotate");
  // Snap settings
  const [snapEnabled, setSnapEnabled] = useState(false);
  const snapTranslation = snapEnabled ? 0.25 : undefined;
  const snapRotation = snapEnabled ? 15 : undefined;
  const snapScale = snapEnabled ? 0.1 : undefined;
  // Current 3D model transform values for display
  const [modelTransform, setModelTransform] = useState<Object3DTransform>(DEFAULT_TRANSFORM);
  // Externally-applied transform (from editable panel) — uses object identity to trigger effect
  const [appliedTransform, setAppliedTransform] = useState<Object3DTransform | undefined>(undefined);
  const handleApplyTransform = useCallback((t: Object3DTransform) => {
    // Create a new object so React state change triggers the effect even if values are same
    setAppliedTransform({ ...t });
    setModelTransform(t);
  }, []);

  // ── Per-layer 2D image translation offsets (XZ world-space) ──
  const [layerImageOffsets, setLayerImageOffsets] = useState<Record<number, [number, number]>>({});
  const handleLayerImageOffsetChange = useCallback((layerIdx: number, x: number, z: number) => {
    setLayerImageOffsets((prev) => ({ ...prev, [layerIdx]: [x, z] }));
  }, []);

  // ── Multi-selection (shift+click adds/removes layers) ──
  const [multiSelectedLayers, setMultiSelectedLayers] = useState<Set<number>>(new Set());
  const handleMultiSelect = useCallback((layerIdx: number) => {
    setMultiSelectedLayers((prev) => {
      const next = new Set(prev);
      if (next.has(layerIdx)) { next.delete(layerIdx); }
      else { next.add(layerIdx); }
      return next;
    });
    invalidate();
  }, []);

  // Clear multi-select when primary selection changes (non-shift click)
  const handleSelectLayer = useCallback((idx: number) => {
    setMultiSelectedLayers(new Set());
    onSelectLayer(idx);
  }, [onSelectLayer]);

  // Also clear image offset cache when layer count changes to avoid stale offsets
  useEffect(() => {
    setLayerImageOffsets({});
  }, [layerCount]);

  // Keyboard shortcuts for transform modes (T/R/S) when a 3D model layer is selected,
  // and Escape to clear multi-selection or deselect.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      // Skip when typing in text fields
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.target as HTMLElement)?.isContentEditable) return;

      // Escape: clear multi-selection first; if already empty, deselect primary
      if (e.key === "Escape") {
        if (multiSelectedLayers.size > 0) {
          e.preventDefault();
          setMultiSelectedLayers(new Set());
          invalidate();
        } else {
          e.preventDefault();
          onClearSelection();
        }
        return;
      }

      // Only T/R/S active when a 3D model layer is selected
      if (selectedLayerIndex === null || !(selectedLayerIndex in layerGlbUrls)) return;

      switch (e.key.toLowerCase()) {
        case "t":
          e.preventDefault();
          setTransformMode("translate");
          break;
        case "r":
          e.preventDefault();
          setTransformMode("rotate");
          break;
        case "s":
          e.preventDefault();
          setTransformMode("scale");
          break;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => { window.removeEventListener("keydown", handleKeyDown); };
  }, [selectedLayerIndex, layerGlbUrls, multiSelectedLayers, onClearSelection]);

  /* ── Way-of-Code style template ─────────────── */
  const template = useUIStyle((s) => s.template);
  const chromeVisible = useUIStyle((s) => s.chromeVisible);
  const setChromeVisible = useUIStyle((s) => s.setChromeVisible);

  // Track whether an interactive panel (AI prompt) is open — pins chrome visible
  const [promptOpen, setPromptOpen] = useState(false);
  const wrappedPromptVisibility = useCallback((visible: boolean) => {
    setPromptOpen(visible);
    if (visible) setChromeVisible(true);
    onPromptVisibilityChange?.(visible);
  }, [onPromptVisibilityChange, setChromeVisible]);

  const toggleChrome = useCallback(() => {
    setChromeVisible(!chromeVisible);
  }, [chromeVisible, setChromeVisible]);

  // Whether chrome should render: always if showChrome, toggled on, or pinned by interactive panel
  const shouldShowChrome = template.ui.showChrome || chromeVisible || promptOpen;

  const selectedVis = selectedLayerIndex !== null ? layerVisibility[selectedLayerIndex] : null;
  const selectedIsHidden = selectedVis ? !selectedVis.visible : false;
  const selectedIsSolo = selectedLayerIndex !== null && soloIndex === selectedLayerIndex;

  /* ── Radial menu + drag-reorder for minimalist view ─── */
  const [radialMenu, setRadialMenu] = useState<{ x: number; y: number } | null>(null);
  const [longPressSelected, setLongPressSelected] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  // Drag-reorder state for minimalist view
  const [dragReorder, setDragReorder] = useState(false);
  const [dragOverride, setDragOverride] = useState<DragOverride | null>(null);
  const dragStartY = useRef(0);
  const dragOriginalPosIdx = useRef(0);
  const activePointerId = useRef<number | null>(null);
  const lastDragY = useRef(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<Camera | null>(null);

  // Reset minimalist-view transient state when switching away
  useEffect(() => {
    if (viewMode !== "minimalist") {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
      setRadialMenu(null);
      setLongPressSelected(false);
      setDragReorder(false);
      setDragOverride(null);
    }
  }, [viewMode]);

  const handleCanvasPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (viewMode !== "minimalist") return;
      activePointerId.current = e.pointerId;
      longPressPos.current = { x: e.clientX, y: e.clientY };
      dragStartY.current = e.clientY;
      // After 300ms → selection badge + drag enabled.
      // Radial menu opens on pointer-up (if no drag occurred).
      longPressTimer.current = setTimeout(() => {
        setLongPressSelected(true);
        if (selectedLayerIndex !== null) {
          dragOriginalPosIdx.current = layerOrder.indexOf(selectedLayerIndex);
        }
      }, 300);
    },
    [viewMode, selectedLayerIndex, layerOrder],
  );

  const handleCanvasPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const pid = activePointerId.current ?? e.pointerId;
    activePointerId.current = null;
    if (containerRef.current) {
      try { containerRef.current.releasePointerCapture(pid); } catch { /* already released */ }
    }
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    // Commit drag-reorder if active
    if (dragReorder) {
      // Compute the final order from the last drag Y position
      let finalOrder: number[] | null = null;
      if (selectedLayerIndex !== null) {
        const viewportH = containerRef.current?.clientHeight ?? window.innerHeight;
        const stb = cameraRef.current ? screenToBrickY(cameraRef.current, viewportH) : PRISM_H / viewportH;
        const screenDeltaY = dragStartY.current - lastDragY.current;
        const brickDeltaY = screenDeltaY * stb;
        const posIdx = dragOriginalPosIdx.current;
        const origY = layerY(posIdx, layerCount, layerSpread);
        const spreadH = PRISM_H * layerSpread;
        const continuousY = Math.max(-spreadH / 2, Math.min(spreadH / 2, origY + brickDeltaY));
        const continuous = yToLayerContinuous(continuousY, layerCount, layerSpread);
        const newPos = clampLayerIndex(continuous, layerCount);
        if (newPos !== posIdx) {
          finalOrder = [...layerOrder];
          finalOrder.splice(posIdx, 1);
          finalOrder.splice(newPos, 0, selectedLayerIndex);
        }
      }
      setDragReorder(false);
      setDragOverride(null);
      setLongPressSelected(false);
      if (finalOrder) {
        onCommitOrder(finalOrder);
      }
      return;
    }
    // If long-press was active but user didn't drag → open radial menu
    if (longPressSelected && !radialMenu) {
      setRadialMenu({ x: longPressPos.current.x, y: longPressPos.current.y });
      return;
    }
    // Otherwise clear selection indicator
    if (!radialMenu) {
      setLongPressSelected(false);
    }
  }, [radialMenu, longPressSelected, dragReorder, selectedLayerIndex, layerCount, layerOrder, onCommitOrder]);

  const handleCanvasPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      lastDragY.current = e.clientY;

      // If we're actively drag-reordering, update the 3D layer position continuously
      if (dragReorder && selectedLayerIndex !== null) {
        const viewportH = containerRef.current?.clientHeight ?? window.innerHeight;
        // Map screen-space pixel delta to brick-space Y delta
        // Moving cursor up (negative screen delta) = moving layer up in brick
        const stb = cameraRef.current ? screenToBrickY(cameraRef.current, viewportH) : PRISM_H / viewportH;
        const screenDeltaY = dragStartY.current - e.clientY;
        const brickDeltaY = screenDeltaY * stb;

        const posIdx = dragOriginalPosIdx.current;
        const origY = layerY(posIdx, layerCount, layerSpread);
        // Continuous Y, clamped to brick bounds
        const spreadH = PRISM_H * layerSpread;
        const continuousY = Math.max(-spreadH / 2, Math.min(spreadH / 2, origY + brickDeltaY));

        // Update the visual override so the 3D plane follows the mouse.
        // We do NOT call onPreviewOrder here — SpacePrism computes visual
        // positions locally from dragOverride to avoid parent re-render ghosts.
        setDragOverride({ layerIdx: selectedLayerIndex, y: continuousY });
        return;
      }

      // Before long-press activates, cancel if moved too far
      if (longPressTimer.current && !longPressSelected) {
        const dx = e.clientX - longPressPos.current.x;
        const dy = e.clientY - longPressPos.current.y;
        if (dx * dx + dy * dy > 100) {
          clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
        }
        return;
      }

      // After long-press selected but before radial menu: if dragging vertically, enter drag-reorder
      if (longPressSelected && !radialMenu && !dragReorder && selectedLayerIndex !== null) {
        const dy = e.clientY - longPressPos.current.y;
        if (Math.abs(dy) > 8) {
          // Cancel radial menu timer and enter drag mode
          if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
          }
          // Capture pointer now so drag events aren't lost to canvas
          if (activePointerId.current !== null && containerRef.current) {
            containerRef.current.setPointerCapture(activePointerId.current);
          }
          dragStartY.current = longPressPos.current.y;
          setDragReorder(true);
        }
      }
    },
    [dragReorder, longPressSelected, radialMenu, selectedLayerIndex, layerCount, layerOrder],
  );

  const radialItems = [
    { label: "Prev", icon: "↑", action: () => {
      const idx = selectedLayerIndex ?? 0;
      if (idx < layerCount - 1) onSelectLayer(idx + 1);
    }},
    { label: "Next", icon: "↓", action: () => {
      const idx = selectedLayerIndex ?? 0;
      if (idx > 0) onSelectLayer(idx - 1);
    }},
    { label: "Hide", icon: "👁", action: () => {
      if (selectedLayerIndex !== null) onToggleHidden(selectedLayerIndex);
    }},
    { label: "Solo", icon: "S", action: () => {
      if (selectedLayerIndex !== null) onToggleSolo(selectedLayerIndex);
    }},
    { label: "Import", icon: "📥", action: () => {
      onImportImage();
    }},
    { label: "+Slice", icon: "＋", action: () => {
      onAddSlice();
    }},
  ];

  /* ── Determine what to show ──────────────────── */
  const showScrubber = viewMode === "universal" || peekRail;
  const showControlsHUD = viewMode === "universal";
  const showLayersPanel = viewMode === "layers" || peekLayers;

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        touchAction: viewMode === "minimalist" ? "none" : "auto",
        userSelect: "none",
        cursor: dragReorder ? "grabbing" : "auto",
      }}
      onPointerDown={handleCanvasPointerDown}
      onPointerUp={handleCanvasPointerUp}
      onPointerMove={handleCanvasPointerMove}
    >
      <Canvas
        frameloop="demand"
        camera={{ position: [0, 10, 0.01], fov: 50 }}
        style={{ background: template.colors.background }}
        onPointerMissed={() => {
          // Click on empty 3D space → clear multi-selection or deselect primary
          if (multiSelectedLayers.size > 0) {
            setMultiSelectedLayers(new Set());
            invalidate();
          } else {
            onClearSelection();
          }
        }}
      >
        <ambientLight intensity={1.0} />
        <directionalLight position={[10, 10, 5]} intensity={0.8} castShadow={false} />
        <directionalLight position={[-5, -3, -5]} intensity={0.3} />
        <SpacePrism
          layerCount={layerCount}
          selectedLayerIndex={selectedLayerIndex}
          layerVisibility={layerVisibility}
          layerOrder={layerOrder}
          onSelectLayer={handleSelectLayer}
          dragOverride={dragOverride}
          suppressClicks={longPressSelected || dragReorder}
          layerTextures={segmentDisplayMode === "colored" ? colorLayerTextures : layerTextures}
          layerCropInfo={layerCropInfo}
          imageAspect={imageAspect}
          layerSpread={layerSpread}
          threeDSourceHidden={threeDSourceHidden}
          revealActive={revealActive}
          onRevealDone={onRevealDone}
          aiEditingLayers={aiEditingLayers}
          layerGlbUrls={layerGlbUrls}
          generating3DLayer={generating3DLayer}
          transformPivot={transformPivot}
          transformMode={transformMode}
          snapTranslation={snapTranslation}
          snapRotation={snapRotation}
          snapScale={snapScale}
          snapEnabled={snapEnabled}
          onSetTransformPivot={setTransformPivot}
          onTransformChange={setModelTransform}
          appliedTransform={appliedTransform}
          modelTransform={modelTransform}
          layerImageOffsets={layerImageOffsets}
          onLayerImageOffsetChange={handleLayerImageOffsetChange}
          multiSelectedLayers={multiSelectedLayers}
          onMultiSelect={handleMultiSelect}
        />
        <ScrubberPlane
          layerCount={layerCount}
          selectedLayerIndex={selectedLayerIndex}
          layerOrder={layerOrder}
          onPreviewLayer={onPreviewLayer}
          onCommitLayer={onSelectLayer}
          imageAspect={imageAspect}
          layerSpread={layerSpread}
        />
        <CameraRef cameraRef={cameraRef} />
        {/* ── 3D AI History (Universal) — shown automatically when a slice is selected ── */}
        {viewMode === "universal" && selectedLayerIndex !== null && getSliceHistory && onSetDisplayCursor && payloads && (() => {
          const sliceGraph = getSliceHistory(selectedLayerIndex);
          if (!sliceGraph) return null;
          const { prismW: pw } = prismDims(imageAspect);
          const visualIdx = layerOrder.indexOf(selectedLayerIndex);
          const yPos = layerY(visualIdx < 0 ? selectedLayerIndex : visualIdx, layerCount, layerSpread);
          return (
            <HistoryGraph3D
              graph={sliceGraph}
              payloads={payloads}
              sliceY={yPos}
              prismW={pw}
              onSelectNode={(id) => { onSetDisplayCursor(selectedLayerIndex, id); }}
              onSetOperationCursor={(id) => { onSetOperationCursor?.(selectedLayerIndex, id); }}
              {...(documentSourceImageId ? { documentSourceImageId } : {})}
              onToggleAiPanel={() => { setAiPanelLayer((prev) => prev === selectedLayerIndex ? null : selectedLayerIndex); }}
              aiEditing={aiEditingLayers.has(selectedLayerIndex)}
              aiPanelOpen={aiPanelLayer === selectedLayerIndex}
            />
          );
        })()}
        <SliceAnchorTracker
          layerIndex={historyPanelLayer}
          layerCount={layerCount}
          layerOrder={layerOrder}
          onUpdate={stableSetSliceAnchor}
        />
        <SliceAnchorTracker
          layerIndex={selectedLayerIndex}
          layerCount={layerCount}
          layerOrder={layerOrder}
          onUpdate={stableSetSelectedSliceAnchor}
        />
        <SliceAnchorTracker
          layerIndex={aiPanelLayer}
          layerCount={layerCount}
          layerOrder={layerOrder}
          onUpdate={stableSetAiPanelAnchor}
        />
        <CameraRig animPhase={animPhase} onAnimDone={onAnimDone} />
        <OrbitControls
          makeDefault
          onChange={() => { invalidate(); }}
          enabled={!animating && !longPressSelected && !dragReorder}
          target={[0, 0, 0]}
          enableDamping
          dampingFactor={0.12}
          minPolarAngle={0.05}
          maxPolarAngle={Math.PI * 0.48}
          minDistance={5}
          maxDistance={20}
        />
      </Canvas>

      {/* Pinned AI prompt panel — floats near the pinned layer's node (universal view only) */}
      {viewMode === "universal" && aiPanelLayer !== null && aiPanelAnchor.visible && (
        <div
          style={{
            position: "absolute",
            left: Math.min(aiPanelAnchor.x + 60, (typeof window !== "undefined" ? window.innerWidth : 800) - 260),
            top: Math.max(aiPanelAnchor.y - 100, 10),
            display: "flex",
            flexDirection: "column",
            gap: 6,
            padding: "8px 10px",
            borderRadius: 6,
            background: "var(--hud-bg)",
            border: "1px solid var(--hud-border)",
            color: "var(--hud-text)",
            fontSize: 12,
            minWidth: 220,
            maxWidth: 280,
            zIndex: 25,
            pointerEvents: "auto",
            backdropFilter: "blur(12px)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 600, opacity: 0.7, flex: 1 }}>
              AI Edit — {layerNames[aiPanelLayer] ?? `Layer ${String(aiPanelLayer)}`}
            </span>
            {aiEditingLayers.has(aiPanelLayer) && (
              <span style={{ fontSize: 10, color: "var(--scrubber-active)" }}>⏳ Running</span>
            )}
            <button
              type="button"
              onClick={() => { setAiPanelLayer(null); }}
              style={{ background: "none", border: "none", color: "var(--hud-muted)", cursor: "pointer", fontSize: 12, padding: "0 2px" }}
            >✕</button>
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ opacity: 0.6 }}>Model</span>
            <select
              value={aiEditModelId}
              onChange={(e) => { onChangeAiEditModel(e.target.value); }}
              style={{
                background: "var(--hud-active)",
                border: "1px solid var(--hud-border-btn)",
                borderRadius: 4,
                padding: "4px 6px",
                color: "var(--hud-text)",
                fontSize: 12,
                outline: "none",
              }}
            >
              {AI_EDIT_MODELS.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ opacity: 0.6 }}>Prompt</span>
            <input
              type="text"
              value={aiPanelPrompt}
              onChange={(e) => { setAiPanelPrompt(e.target.value); }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter" && aiPanelPrompt.trim() && !aiEditingLayers.has(aiPanelLayer)) {
                  onAiEditForLayer(aiPanelLayer, aiPanelPrompt.trim(), aiPanelStrength);
                }
              }}
              placeholder="Describe the edit..."
              style={{
                background: "var(--hud-active)",
                border: "1px solid var(--hud-border-btn)",
                borderRadius: 4,
                padding: "4px 6px",
                color: "var(--hud-text)",
                fontSize: 12,
                outline: "none",
              }}
            />
          </label>
          {getAiEditModel(aiEditModelId).hasStrength && (
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ opacity: 0.6, minWidth: 52 }}>Strength</span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(aiPanelStrength * 100)}
                onChange={(e) => { setAiPanelStrength(Number(e.target.value) / 100); }}
                onKeyDown={(e) => { e.stopPropagation(); }}
                style={{ flex: 1, accentColor: "var(--scrubber-active)", cursor: "pointer" }}
              />
              <span style={{ opacity: 0.5, minWidth: 30, textAlign: "right" }}>
                {Math.round(aiPanelStrength * 100)}%
              </span>
            </label>
          )}
          <button
            type="button"
            disabled={!aiPanelPrompt.trim() || aiEditingLayers.has(aiPanelLayer)}
            onClick={() => {
              if (aiPanelPrompt.trim()) onAiEditForLayer(aiPanelLayer, aiPanelPrompt.trim(), aiPanelStrength);
            }}
            style={{
              background: aiEditingLayers.has(aiPanelLayer) ? "var(--hud-muted)" : "var(--scrubber-active)",
              border: "none",
              borderRadius: 4,
              padding: "5px 10px",
              color: "var(--btn-primary-text)",
              cursor: aiEditingLayers.has(aiPanelLayer) ? "wait" : "pointer",
              fontWeight: 600,
              fontSize: 12,
            }}
          >
            {aiEditingLayers.has(aiPanelLayer) ? "Running…" : "Run AI Edit"}
          </button>
          {aiErrors[aiPanelLayer] && (
            <div style={{ color: "var(--color-error)", fontSize: 11, wordBreak: "break-word", maxHeight: 60, overflowY: "auto" }}>
              {aiErrors[aiPanelLayer]}
            </div>
          )}
        </div>
      )}

      {/* Chrome toggle button — always visible in top-left corner */}
      <button
        type="button"
        onClick={toggleChrome}
        title={shouldShowChrome ? "Hide toolbar" : "Show toolbar"}
        className={`chrome-toggle-btn${shouldShowChrome ? " chrome-toggle-open" : ""}`}
      >
        {shouldShowChrome ? "✕" : "☰"}
      </button>

      {/* Vertical slice distance slider — left edge, all views */}
      {layerCount > 1 && (
        <div
          style={{
            position: "absolute",
            left: 12,
            top: "50%",
            transform: "translateY(-50%)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 4,
            padding: "8px 4px",
            borderRadius: 6,
            background: "var(--hud-bg)",
            border: "1px solid var(--hud-border)",
            zIndex: 11,
            pointerEvents: "auto",
          }}
        >
          <span style={{ fontSize: 8, color: "var(--hud-muted)", writingMode: "vertical-rl", textOrientation: "mixed" }}>Spread</span>
          <input
            type="range"
            min={20}
            max={300}
            step={5}
            value={Math.round(layerSpread * 100)}
            onChange={(e) => { setLayerSpread(Number(e.target.value) / 100); }}
            title={`Slice spread: ${Math.round(layerSpread * 100)}%`}
            style={{
              writingMode: "vertical-lr",
              direction: "rtl",
              height: 100,
              width: 18,
              accentColor: "var(--scrubber-active)",
              cursor: "pointer",
            }}
          />
          <span style={{ fontSize: 8, color: "var(--hud-muted)" }}>{Math.round(layerSpread * 100)}%</span>
        </div>
      )}

      {/* Keyframe preview — persistent top-down composite */}
      {keyframePreviewUrl && !keyframeExpanded && (
        <div
          title="Keyframe preview (top-down composite) — click to expand"
          onClick={() => { setKeyframeExpanded(true); }}
          style={{
            position: "absolute",
            // Layers mode: top-left so the bottom history drawer never covers it.
            // Other modes: bottom-left, above the LayerControlsHUD (bottom: 12).
            ...(viewMode === "layers" ? { top: 50, left: 12 } : { bottom: 60, left: 12 }),
            width: 72,
            height: 72,
            borderRadius: 8,
            overflow: "hidden",
            border: "1px solid var(--hud-border)",
            background: "var(--hud-bg)",
            zIndex: 11,
            cursor: "pointer",
          }}
        >
          <img
            src={keyframePreviewUrl}
            alt="Keyframe"
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
            }}
          />
          {/* Expand icon */}
          <span style={{
            position: "absolute",
            top: 3,
            right: 3,
            fontSize: 10,
            color: "var(--hud-muted)",
            opacity: 0.7,
          }}>⤢</span>
          <span style={{
            position: "absolute",
            bottom: 2,
            left: 0,
            right: 0,
            textAlign: "center",
            fontSize: 7,
            color: "var(--hud-muted)",
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}>Keyframe</span>
        </div>
      )}

      {/* Keyframe expanded modal with AI composite */}
      {keyframePreviewUrl && keyframeExpanded && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.7)",
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setKeyframeExpanded(false); }}
        >
          <div
            style={{
              position: "relative",
              background: "var(--hud-bg, #1a1a2e)",
              border: "1px solid var(--hud-border, #333)",
              borderRadius: 12,
              padding: 16,
              maxWidth: "80vw",
              maxHeight: "80vh",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12,
            }}
          >
            {/* Close button */}
            <button
              type="button"
              onClick={() => { setKeyframeExpanded(false); }}
              style={{
                position: "absolute",
                top: 8,
                right: 8,
                background: "none",
                border: "none",
                color: "var(--hud-text, #ccc)",
                fontSize: 18,
                cursor: "pointer",
                lineHeight: 1,
              }}
            >✕</button>

            <span style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--hud-text, #ccc)",
              textTransform: "uppercase",
              letterSpacing: 1,
            }}>Keyframe Preview</span>

            {/* Image container with before/after */}
            <div style={{
              position: "relative",
              width: "min(60vw, 480px)",
              aspectRatio: "1",
              borderRadius: 8,
              overflow: "hidden",
              background: "#000",
            }}>
              {/* Raw keyframe (always visible as base) */}
              <img
                src={keyframePreviewUrl}
                alt="Keyframe raw"
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                }}
              />
              {/* Composited result fading over the raw */}
              {compositeResultUrl && (
                <img
                  src={compositeResultUrl}
                  alt="Composited"
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                    opacity: compositeFade,
                    transition: "opacity 0.15s ease",
                  }}
                />
              )}
              {/* Loading spinner overlay */}
              {compositeBusy && (
                <div style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "rgba(0,0,0,0.4)",
                }}>
                  <span style={{
                    fontSize: 14,
                    color: "#fff",
                    animation: "pulse 1.2s ease-in-out infinite",
                  }}>Compositing…</span>
                </div>
              )}
            </div>

            {/* Fade slider — only when composite result exists */}
            {compositeResultUrl && (
              <div style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "min(60vw, 480px)",
              }}>
                <span style={{ fontSize: 9, color: "var(--hud-muted, #888)", whiteSpace: "nowrap" }}>Raw</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={compositeFade}
                  onChange={(e) => { setCompositeFade(Number(e.target.value)); }}
                  style={{
                    flex: 1,
                    accentColor: "var(--scrubber-active, #5af)",
                    cursor: "pointer",
                  }}
                />
                <span style={{ fontSize: 9, color: "var(--hud-muted, #888)", whiteSpace: "nowrap" }}>Composite</span>
              </div>
            )}

            {/* AI Composite button */}
            <button
              type="button"
              disabled={compositeBusy}
              onClick={() => { onCompositeKeyframe?.(); }}
              style={{
                padding: "8px 20px",
                borderRadius: 6,
                border: "1px solid var(--hud-border, #444)",
                background: compositeBusy ? "#333" : "linear-gradient(135deg, #4a5af0, #7b2ff7)",
                color: "#fff",
                fontSize: 12,
                fontWeight: 600,
                cursor: compositeBusy ? "not-allowed" : "pointer",
                opacity: compositeBusy ? 0.6 : 1,
              }}
            >{compositeBusy ? "Compositing…" : compositeResultUrl ? "Re-composite" : "AI Composite"}</button>
          </div>
        </div>
      )}

      {/* AI History toggle button — only for Layers/Minimalist; Universal auto-shows in 3D */}
      {viewMode !== "universal" && selectedLayerIndex !== null && getSliceHistory && (() => {
        const graph = getSliceHistory(selectedLayerIndex);
        if (!graph) return null;
        // In layers view: bottom-anchored drawer-handle tab; hide when drawer is open.
        // In minimalist: top-right corner toggle.
        if (viewMode === "layers") {
          if (historyPanelLayer !== null) return null; // drawer open — its own ✕ handles close
          return (
            <button
              type="button"
              onClick={() => { setHistoryPanelLayer(selectedLayerIndex); }}
              title="Open AI History drawer"
              style={{
                position: "absolute",
                bottom: 0,
                left: 12,
                padding: "6px 14px",
                borderRadius: "8px 8px 0 0",
                background: "var(--hud-bg)",
                border: "1px solid var(--hud-border)",
                borderBottom: "none",
                color: "var(--hud-text)",
                fontSize: 10,
                fontWeight: 600,
                cursor: "pointer",
                zIndex: 13,
                backdropFilter: "blur(12px)",
                letterSpacing: 0.4,
              }}
            >
              ↑ AI History
            </button>
          );
        }
        return (
          <button
            type="button"
            onClick={() => { setHistoryPanelLayer(historyPanelLayer === selectedLayerIndex ? null : selectedLayerIndex); }}
            title="Open AI History panel"
            style={{
              position: "absolute",
              top: 12,
              right: 12,
              padding: "5px 10px",
              borderRadius: 6,
              background: historyPanelLayer !== null ? "var(--hud-active)" : "var(--hud-bg)",
              border: historyPanelLayer !== null ? "1px solid var(--scrubber-active)" : "1px solid var(--hud-border)",
              color: historyPanelLayer !== null ? "var(--scrubber-active)" : "var(--hud-text)",
              fontSize: 10,
              fontWeight: 600,
              cursor: "pointer",
              zIndex: 11,
            }}
          >
            🕰 History
          </button>
        );
      })()}

      {/* Universal AI History is now rendered inside <Canvas> as HistoryGraph3D */}

      {/* Layers-view AI History — seed-path panel (only in Layers mode) */}
      {viewMode === "layers" && historyPanelLayer !== null && getSliceHistory && onSetDisplayCursor && onSetOperationCursor && (() => {
        const sliceGraph = getSliceHistory(historyPanelLayer);
        if (!sliceGraph) return null;
        return (
          <AIHistoryPanel
            layerIndex={historyPanelLayer}
            layerName={layerNames[historyPanelLayer]}
            graph={sliceGraph}
            payloads={payloads}
            onSetDisplayCursor={onSetDisplayCursor}
            onSetOperationCursor={onSetOperationCursor}
            onClose={() => { setHistoryPanelLayer(null); }}
            documentSourceImageId={documentSourceImageId}
            style={{ right: 260, bottom: 0, borderRadius: "10px 10px 0 0" }}
          />
        );
      })()}

      {/* Segment display mode toggle (masked original vs colored segments) */}
      {layerCount > 1 && (
        <button
          type="button"
          onClick={onToggleSegmentDisplay}
          title={segmentDisplayMode === "masked" ? "Switch to colored segments" : "Switch to masked original"}
          style={{
            position: "absolute",
            top: 12,
            left: 50,
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 12px",
            borderRadius: 6,
            background: "var(--hud-bg)",
            border: "1px solid var(--hud-border)",
            color: "var(--hud-text)",
            fontSize: 11,
            cursor: "pointer",
            zIndex: 10,
            transition: "background 0.15s, border-color 0.15s",
          }}
        >
          <span style={{ fontSize: 14, lineHeight: 1 }}>{segmentDisplayMode === "masked" ? "🖼" : "🎨"}</span>
          {segmentDisplayMode === "masked" ? "Masked" : "Colored"}
        </button>
      )}

      {/* Universal: Depth Rail (scrubber with drag-reorder ticks) */}
      {showScrubber && (
        <LayerScrubber
          layerCount={layerCount}
          selectedIndex={selectedLayerIndex}
          layerOrder={layerOrder}
          onPreview={onPreviewLayer}
          onCommit={onSelectLayer}
          onPreviewOrder={onPreviewOrder}
          onCommitOrder={onCommitOrder}
          layerThumbnails={layerThumbnails}
          layerGlbUrls={layerGlbUrls}
          layerNames={layerNames}
          onRenameLayer={onRenameLayer}
          getSliceHistory={getSliceHistory}
        />
      )}

      {/* Universal: Context HUD on selection (bottom center) */}
      {showControlsHUD && selectedLayerIndex !== null && (
        <LayerControlsHUD
          layerIndex={selectedLayerIndex}
          layerName={layerNames[selectedLayerIndex]}
          isHidden={selectedIsHidden}
          isSolo={selectedIsSolo}
          maskActive={maskActive}
          opacity={persistedOpacity}
          onToggleHidden={onToggleHidden}
          onToggleSolo={onToggleSolo}
          onToggleMask={onToggleMask}
          onInvertMask={onInvertMask}
          onPreviewOpacity={onPreviewOpacity}
          onCommitOpacity={onCommitOpacity}
          hasImage={selectedLayerIndex in layerTextures}
          onImportImage={onImportImage}
          onAiEdit={onAiEdit}
          aiRunning={aiEditingLayers.has(selectedLayerIndex)}
          aiError={aiErrors[selectedLayerIndex] ?? null}
          onAddSlice={onAddSlice}
          aiEditModelId={aiEditModelId}
          onChangeAiEditModel={onChangeAiEditModel}
          onPromptVisibilityChange={wrappedPromptVisibility}
          onGenerate3D={onGenerate3D}
          generating3D={generating3DLayer === selectedLayerIndex}
          has3DModel={selectedLayerIndex in layerGlbUrls}
          sourceImageHidden={threeDSourceHidden.has(selectedLayerIndex)}
          onToggle3DSourceImage={onToggle3DSourceImage}
          transformPivot={transformPivot}
          onSetTransformPivot={setTransformPivot}
          transformMode={transformMode}
          onSetTransformMode={setTransformMode}
          snapEnabled={snapEnabled}
          onToggleSnap={() => { setSnapEnabled((s) => !s); }}
          modelTransform={selectedLayerIndex in layerGlbUrls ? modelTransform : undefined}
          onApplyTransform={handleApplyTransform}
          onDeleteSlice={onDeleteSlice}
          layerCount={layerCount}
          onRenameLayer={onRenameLayer}
        />
      )}

      {/* Layers view: full Photoshop-inspired panel */}
      {showLayersPanel && (
        <LayersPanel
          layerCount={layerCount}
          order={layerOrder}
          selectedLayerIndex={selectedLayerIndex}
          soloIndex={soloIndex}
          layerVisibility={layerVisibility}
          isHidden={isHiddenFn}
          isMaskActive={isMaskActiveFn}
          isMaskInverted={isMaskInvertedFn}
          persistedOpacity={persistedOpacityFn}
          onSelectLayer={onSelectLayer}
          onToggleHidden={onToggleHidden}
          onToggleSolo={onToggleSolo}
          onToggleMask={onToggleMask}
          onInvertMask={onInvertMask}
          onPreviewOpacity={onPreviewOpacity}
          onCommitOpacity={onCommitOpacity}
          onPreviewOrder={onPreviewOrder}
          onCommitOrder={onCommitOrder}
          onImportImage={onImportImage}
          onAiEdit={onAiEdit}
          aiEditingLayers={aiEditingLayers}
          aiErrors={aiErrors}
          onAddSlice={onAddSlice}
          onDeleteSlice={onDeleteSlice}
          layerTextures={layerTextures}
          layerThumbnails={layerThumbnails}
          layerNames={layerNames}
          onRenameLayer={onRenameLayer}
          aiEditModelId={aiEditModelId}
          onChangeAiEditModel={onChangeAiEditModel}
          onGenerate3D={onGenerate3D}
          generating3DLayer={generating3DLayer}
          layerGlbUrls={layerGlbUrls}
          threeDSourceHidden={threeDSourceHidden}
          onToggle3DSourceImage={onToggle3DSourceImage}
          transformPivot={transformPivot}
          onSetTransformPivot={setTransformPivot}
          transformMode={transformMode}
          onSetTransformMode={setTransformMode}
          snapEnabled={snapEnabled}
          onToggleSnap={() => { setSnapEnabled((s) => !s); }}
          modelTransform={selectedLayerIndex !== null && selectedLayerIndex in layerGlbUrls ? modelTransform : undefined}
          onApplyTransform={handleApplyTransform}
          getSliceHistory={getSliceHistory}
          onSetDisplayCursor={onSetDisplayCursor}
          onSetOperationCursor={onSetOperationCursor}
          payloads={payloads}
        />
      )}

      {/* Minimalist: selected layer badge (shown during long-press before menu opens) */}
      {viewMode === "minimalist" && (longPressSelected || selectedLayerIndex !== null) && !radialMenu && (
        <div
          style={{
            position: "absolute",
            bottom: 16,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "4px 14px",
            borderRadius: 6,
            background: "var(--hud-bg)",
            border: dragReorder ? "1px solid var(--scrubber-active)" : "1px solid var(--hud-border)",
            color: "var(--scrubber-active)",
            fontSize: 12,
            pointerEvents: "none",
            userSelect: "none",
            opacity: selectedLayerIndex !== null ? 0.85 : 0.5,
            transition: "opacity 0.15s",
          }}
        >
          {dragReorder && selectedLayerIndex !== null
            ? <><span style={{ fontSize: 14 }}>⇕</span> Dragging {layerNames[selectedLayerIndex] ?? `Layer ${String(selectedLayerIndex)}`}</>
            : selectedLayerIndex !== null
              ? <><span style={{ fontSize: 14 }}>◈</span> {layerNames[selectedLayerIndex] ?? `Layer ${String(selectedLayerIndex)}`} — hold for menu</>
              : <span style={{ color: "var(--hud-muted)" }}>long-press for menu</span>}
        </div>
      )}

      {/* Minimalist: radial menu */}
      {viewMode === "minimalist" && radialMenu && (
        <RadialMenu
          items={radialItems}
          x={radialMenu.x}
          y={radialMenu.y}
          selectedLayerIndex={selectedLayerIndex}
          onClose={() => { setRadialMenu(null); setLongPressSelected(false); }}
        />
      )}

      {/* Peek overlay indicators */}
      {(peekLayers || peekRail) && (
        <div
          style={{
            position: "absolute",
            top: 8,
            left: "50%",
            transform: "translateX(-50%)",
            fontSize: 10,
            color: "var(--scrubber-active)",
            opacity: 0.7,
            letterSpacing: 1,
            textTransform: "uppercase",
            pointerEvents: "none",
            userSelect: "none",
            background: "var(--hud-bg)",
            padding: "3px 10px",
            borderRadius: 4,
            border: "1px solid var(--hud-border)",
          }}
        >
          {peekLayers ? "Peek: Layers (Tab)" : "Peek: Rail (Shift)"}
        </div>
      )}
    </div>
  );
}
