import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree, useFrame, invalidate } from "@react-three/fiber";
import { OrbitControls, TransformControls, useGLTF } from "@react-three/drei";
import { Box3, CanvasTexture, Color, DoubleSide, Euler, GridHelper as ThreeGridHelper, Group, MathUtils, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Plane, Raycaster, SRGBColorSpace, Vector3, TextureLoader, BufferGeometry, Float32BufferAttribute, LineBasicMaterial } from "three";
import type { Camera, Material, Mesh, Texture } from "three";
import type { ThreeEvent } from "@react-three/fiber";

export type SegmentDisplayMode = "masked" | "colored";
import type { CropInfo } from "../services/falProxy";
import LayerScrubber from "./LayerScrubber";
import LayerControlsHUD from "./LayerControlsHUD";
import LayersPanel from "./LayersPanel";
import RadialMenu from "./RadialMenu";
import CameraRig from "./CameraRig";
import type { AnimPhase } from "./CameraRig";
import type { ViewMode } from "./ViewMode";
import { useUIStyle } from "./uiStyleStore";

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

function layerY(index: number, layerCount: number): number {
  const t = layerCount <= 1 ? 0.5 : index / (layerCount - 1);
  return -PRISM_H / 2 + t * PRISM_H;
}

function yToLayerContinuous(y: number, layerCount: number): number {
  const t = (y + PRISM_H / 2) / PRISM_H;
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
  /** When true, all layers start stacked at center and spread to final positions. */
  revealActive: boolean;
  onRevealDone?: () => void;
  /** Layer index currently being AI-edited (for pulse animation), or null. */
  aiEditingLayer?: number | null | undefined;
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
  /** Callback when model transform changes. */
  onTransformChange?: ((t: Object3DTransform) => void) | undefined;
  /** Externally-set transform to apply to the model. */
  appliedTransform?: Object3DTransform | undefined;
  /** Current model transform state (for grid alignment). */
  modelTransform?: Object3DTransform | undefined;
}

/** Shared TextureLoader — one instance for the whole module. */
const sharedTextureLoader = new TextureLoader();

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
function LayerLabel({ text, color, opacity, renderOrder }: { text: string; color: string; opacity: number; renderOrder: number }) {
  const tex = useMemo(() => getLabelTexture(text, color), [text, color]);
  return (
    <sprite position={[0, 0.01, 0]} scale={[0.5, 0.5, 0.5]} renderOrder={renderOrder}>
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
      }
      return;
    }
    const dt = Math.min(delta, 0.05); // clamp large dt
    const factor = 1 - Math.exp(-LERP_SPEED * dt);
    currentX.current = MathUtils.lerp(currentX.current, targetX, factor);
    currentY.current = MathUtils.lerp(currentY.current, targetY, factor);
    groupRef.current.position.x = currentX.current;
    groupRef.current.position.y = currentY.current;
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

/** A single textured layer plane. Handles crop offset, AI pulse glow, and fade-in. */
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
}): React.JSX.Element | null {
  const texture = useLayerTexture(uri);
  const matRef = useRef<import("three").MeshBasicMaterial>(null);
  const glowRef = useRef<import("three").MeshBasicMaterial>(null);
  // Track URI changes for fade-in
  const prevUri = useRef(uri);
  const fadeProgress = useRef(1); // 1 = fully visible
  // Track AI editing state to trigger fade-in when it stops
  const wasEditing = useRef(false);
  const glowColor = useUIStyle((s) => s.template.colors.glowAi);

  useEffect(() => {
    if (uri !== prevUri.current) {
      // If the URI changed while (or just after) AI editing, fade in
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
      fadeProgress.current = Math.min(1, fadeProgress.current + delta * 2.0); // ~0.5s
      matRef.current.opacity = opacity * fadeProgress.current;
      needsInvalidate = true;
    }
    // Organic glow while AI is editing or generating 3D
    if (glowRef.current) {
      if (aiEditing || generating3D) {
        const t = performance.now() / 1000;
        // Multi-frequency breathing for organic feel
        const breath = 0.5 + 0.5 * Math.sin(t * 1.8) * Math.sin(t * 0.7 + 0.3);
        glowRef.current.opacity = 0.15 + 0.35 * breath;
        // Shift hue: cyan→violet for 3D, soft blue for AI edit
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

  // Use position in stack for render ordering so upper layers draw on top
  const baseOrder = (positionIndex ?? 0) * 10;

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[offX, 0.02, offZ]} renderOrder={baseOrder + 2}>
        <planeGeometry args={[planeW, planeD]} />
        <meshBasicMaterial
          ref={matRef}
          map={texture}
          transparent
          opacity={opacity * fadeProgress.current}
          depthWrite={false}
          side={DoubleSide}
        />
      </mesh>
      {/* Glow overlay for AI editing pulse */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[offX, 0.03, offZ]} renderOrder={baseOrder + 3}>
        <planeGeometry args={[planeW, planeD]} />
        <meshBasicMaterial
          ref={glowRef}
          transparent
          opacity={0}
          color={glowColor}
          depthWrite={false}
          side={DoubleSide}
        />
      </mesh>
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
 * "center" = volumetric center.  The six faces correspond to the axis-aligned
 * planes of the oriented bounding box *after* the −90° X rotation.
 * Because the rotation maps raw (x,y,z) → (x, z, -y):
 *   +Z = bottom (base/feet), −Z = top (head), ±X = left/right, ±Y = front/back.
 */
export type PivotFace = "center" | "-y" | "+y" | "-x" | "+x" | "-z" | "+z";
export const PIVOT_FACES: PivotFace[] = ["center", "+z", "-z", "-x", "+x", "-y", "+y"];
export const PIVOT_FACE_LABELS: Record<PivotFace, string> = {
  "center": "Center",
  "+z": "Bottom",
  "-z": "Top",
  "-x": "Left",
  "+x": "Right",
  "-y": "Front",
  "+y": "Back",
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
  onTransformChange,
  appliedTransform,
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
  onTransformChange?: ((t: Object3DTransform) => void) | undefined;
  appliedTransform?: Object3DTransform | undefined;
}): React.JSX.Element | null {
  const { scene } = useGLTF(url);
  const selectionWireframe = useUIStyle((s) => s.template.colors.selectionWireframe);
  const pivotColor = useUIStyle((s) => s.template.colors.pivotColor);
  const tcTargetRef = useRef<import("three").Group>(null);
  const contentRef = useRef<import("three").Group>(null);
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

  // ── Compute bbox metrics in the ROTATED space (as the model will actually be displayed).
  // We apply the -90° X rotation to a temporary group, then compute the AABB directly.
  const rotatedMetrics = useMemo(() => {
    const tempGroup = new Group();
    tempGroup.rotation.set(-Math.PI / 2, 0, 0);
    tempGroup.add(cloned);
    tempGroup.updateMatrixWorld(true);

    const box = new Box3().setFromObject(tempGroup);
    const size = new Vector3();
    box.getSize(size);
    const center = new Vector3();
    box.getCenter(center);

    // Remove cloned from temp group so it can be used normally in the scene
    tempGroup.remove(cloned);

    return { center, size, min: box.min.clone(), max: box.max.clone() };
  }, [cloned]);

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

  // ── Fit scale: match XZ footprint (top-down view) to the segment area.
  const fitScale = useMemo(() => {
    const sX = targetW / Math.max(rotatedMetrics.size.x, 0.001);
    const sZ = targetD / Math.max(rotatedMetrics.size.z, 0.001);
    return Math.min(sX, sZ);
  }, [rotatedMetrics, targetW, targetD]);

  // ── Single content offset: positions content so the desired pivot point
  //    (center or face) lands at tcTarget origin [0,0,0].
  //    All values are in POST-scale space (applied after scale group).
  const pivotFace: PivotFace = transformPivot ?? "center";
  const contentOffset = useMemo<[number, number, number]>(() => {
    const { center, min, max } = rotatedMetrics;
    const s = fitScale;
    // Base offset puts bbox center at origin
    const cx = -center.x * s;
    const cy = -center.y * s;
    const cz = -center.z * s;
    if (pivotFace === "center") return [cx, cy, cz];
    // For face modes: shift so the face center is at origin instead of bbox center
    switch (pivotFace) {
      case "-y": return [cx, -min.y * s, cz];
      case "+y": return [cx, -max.y * s, cz];
      case "-x": return [-min.x * s, cy, cz];
      case "+x": return [-max.x * s, cy, cz];
      case "-z": return [cx, cy, -min.z * s];
      case "+z": return [cx, cy, -max.z * s];
    }
  }, [rotatedMetrics, pivotFace, fitScale]);

  // ── Bounding box size (scaled) for wireframe ──
  const bboxSize = useMemo<[number, number, number]>(() => {
    const { size } = rotatedMetrics;
    return [size.x * fitScale, size.y * fitScale, size.z * fitScale];
  }, [rotatedMetrics, fitScale]);

  // ── Bounding box center offset from pivot point (for wireframe positioning) ──
  // This is the vector from the pivot point to the bbox center in tcTarget space.
  const bboxCenterOffset = useMemo<[number, number, number]>(() => {
    const { center, min, max } = rotatedMetrics;
    const s = fitScale;
    if (pivotFace === "center") return [0, 0, 0];
    // Bbox center in tcTarget space = center*s + contentOffset
    // For face modes, the face coordinate is at 0, so the center is offset from that.
    switch (pivotFace) {
      case "-y": return [0, (center.y - min.y) * s, 0];
      case "+y": return [0, (center.y - max.y) * s, 0];
      case "-x": return [(center.x - min.x) * s, 0, 0];
      case "+x": return [(center.x - max.x) * s, 0, 0];
      case "-z": return [0, 0, (center.z - min.z) * s];
      case "+z": return [0, 0, (center.z - max.z) * s];
    }
  }, [rotatedMetrics, pivotFace, fitScale]);

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
  //    for the contentOffset change, so the model stays in place.
  const prevOffsetRef = useRef<[number, number, number]>(contentOffset);
  useEffect(() => {
    if (!tcTargetRef.current) return;
    const prev = prevOffsetRef.current;
    const next = contentOffset;
    if (prev[0] === next[0] && prev[1] === next[1] && prev[2] === next[2]) return;
    prevOffsetRef.current = next;
    tcTargetRef.current.position.x -= (next[0] - prev[0]);
    tcTargetRef.current.position.y -= (next[1] - prev[1]);
    tcTargetRef.current.position.z -= (next[2] - prev[2]);
    invalidate();
    reportTransform();
  }, [contentOffset, reportTransform]);

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
      <group ref={tcTargetRef} position={[offX, 0.05, offZ]}>
        {/* Content offset: positions model so desired pivot point is at tcTarget origin */}
        <group ref={contentRef} position={contentOffset}>
          <group scale={[fitScale, fitScale, fitScale]}>
            <group rotation={[-Math.PI / 2, 0, 0]}>
              <primitive object={cloned} />
            </group>
          </group>
        </group>
        {/* Bounding box wireframe — centered on bbox, offset from pivot point */}
        {selected && (
          <mesh position={bboxCenterOffset}>
            <boxGeometry args={bboxSize} />
            <meshBasicMaterial wireframe transparent opacity={0.25} color={selectionWireframe} depthWrite={false} />
          </mesh>
        )}
        {/* Pivot indicator at gizmo origin (tcTarget space) */}
        {selected && (
          <mesh rotation={[0, Math.PI / 4, 0]} position={[0, 0, 0]}>
            <boxGeometry args={[0.06, 0.06, 0.06]} />
            <meshBasicMaterial color={pivotColor} depthTest={false} transparent opacity={0.9} />
          </mesh>
        )}
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
  position,
  snapTranslation,
  snapRotation,
  snapScale,
  radius,
}: {
  mode: "translate" | "rotate" | "scale";
  position: [number, number, number];
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
    <group position={position}>
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

function SpacePrism(props: SpacePrismProps): React.JSX.Element {
  const { layerCount, selectedLayerIndex, layerVisibility, layerOrder, onSelectLayer, dragOverride, suppressClicks, layerTextures, layerCropInfo, imageAspect, revealActive, onRevealDone, aiEditingLayer, layerGlbUrls, generating3DLayer, transformPivot, transformMode, snapTranslation, snapRotation, snapScale, snapEnabled, onTransformChange, appliedTransform, modelTransform } = props;
  const { prismW, prismD } = prismDims(imageAspect);
  const hiddenSlideX = prismW + 0.5;
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
      result.push({ layerIdx: layerOrder[posIdx] ?? posIdx, y: layerY(posIdx, layerCount), isDragged: false });
    }
    return result;
  }, [layerOrder, layerCount]);

  let positions: { layerIdx: number; y: number; isDragged: boolean }[];
  if (dragActive) {
    // Figure out which slot the dragged layer would snap to
    const continuous = yToLayerContinuous(dragOverride.y, layerCount);
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
        positions.push({ layerIdx: li, y: layerY(posIdx, layerCount), isDragged: false });
      }
    }
  } else {
    positions = staticPositions;
  }

  // Shared geometry for all brick planes — avoids N allocations per frame
  const brickGeo = useMemo(() => new PlaneGeometry(prismW * 0.96, prismD * 0.96), [prismW, prismD]);

  return (
    <group>
      <mesh>
        <boxGeometry args={[prismW, PRISM_H, prismD]} />
        <meshBasicMaterial wireframe transparent opacity={0.15} color={template.colors.foreground} />
      </mesh>

      {/* Snap helpers: mode-specific guides centered at transform tool */}
      {snapEnabled && selectedLayerIndex !== null && layerGlbUrls?.[selectedLayerIndex] && (() => {
        // Use the live modelTransform position (which tracks the gizmo's actual position
        // in AnimatedLayerGroup-local space). Add the layer's Y offset to get root-space position.
        const posIdx = layerOrder.indexOf(selectedLayerIndex);
        const layerYOffset = posIdx >= 0 ? layerY(posIdx, layerCount) : 0;
        const posX = modelTransform?.position[0] ?? 0;
        const posY = layerYOffset + (modelTransform?.position[1] ?? 0.05);
        const posZ = modelTransform?.position[2] ?? 0;
        const mode = transformMode ?? "rotate";
        return (
          <SnapHelpers
            mode={mode}
            position={[posX, posY, posZ]}
            snapTranslation={snapTranslation}
            snapRotation={snapRotation}
            snapScale={snapScale}
            radius={Math.max(prismW, prismD) * 0.6}
          />
        );
      })()}

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
              onClick={(e) => {
                e.stopPropagation();
                if (!suppressClicks) onSelectLayer(layerIdx);
              }}
            >
              <meshBasicMaterial
                transparent
                opacity={isDragged ? Math.max(opacity, 0.5) : opacity}
                color={color}
                depthWrite={false}
                side={DoubleSide}
              />

            </mesh>
            {/* Texture overlay if this layer has an image */}
            {layerTextures[layerIdx] && (
              <TexturedLayerPlane
                uri={layerTextures[layerIdx]}
                width={prismW}
                depth={prismD}
                layerIdx={layerIdx}
                opacity={vis ? vis.textureOpacity : 1}
                crop={layerCropInfo[layerIdx]}
                aiEditing={aiEditingLayer === layerIdx}
                generating3D={generating3DLayer === layerIdx}
                positionIndex={positionIndex}
                selected={selected}
              />
            )}
            {/* GLB 3D model overlay */}
            {generating3DLayer === layerIdx && !layerGlbUrls?.[layerIdx] && (
              <Generating3DPlaceholder
                width={prismW}
                depth={prismD}
                {...(layerCropInfo[layerIdx] ? { crop: layerCropInfo[layerIdx] } : {})}
              />
            )}
            {layerGlbUrls?.[layerIdx] && (
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
                onTransformChange={selected ? onTransformChange : undefined}
                appliedTransform={selected ? appliedTransform : undefined}
                {...(layerCropInfo[layerIdx] ? { crop: layerCropInfo[layerIdx] } : {})}
              />
            )}
            <LayerLabel
              text={String(layerIdx)}
              color={template.colors.foreground}
              opacity={hidden ? 0.2 : Math.min(0.5, opacity * 2)}
              renderOrder={baseOrder + 1}
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
}

const _dragPlane = new Plane(new Vector3(0, 0, 1), 0);
const _intersection = new Vector3();
const _raycaster = new Raycaster();

function ScrubberPlane(props: ScrubberPlaneProps): React.JSX.Element | null {
  const { layerCount, selectedLayerIndex, layerOrder, onPreviewLayer, onCommitLayer, imageAspect } = props;
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
  const y = layerY(currentVisual, layerCount);

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
      startLayerY.current = layerY(currentVisual, layerCount);
    },
    [camera, controls, currentVisual, layerCount],
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
        const continuous = yToLayerContinuous(newY, layerCount);
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
        const continuous = yToLayerContinuous(newY, layerCount);
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
  colorLayerTextures: Record<number, string>;
  layerCropInfo: Record<number, CropInfo>;
  segmentDisplayMode: SegmentDisplayMode;
  onToggleSegmentDisplay: () => void;
  revealActive: boolean;
  onRevealDone: () => void;
  imageAspect: number | null;
  onImportImage: () => void;
  onAiEdit: (prompt: string, strength?: number) => void;
  aiRunning: boolean;
  aiError: string | null;
  onPromptVisibilityChange?: (visible: boolean) => void;
  onAddSlice: () => void;
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
    colorLayerTextures,
    layerCropInfo,
    segmentDisplayMode,
    onToggleSegmentDisplay,
    revealActive,
    onRevealDone,
    imageAspect,
    onImportImage,
    onAiEdit,
    aiRunning,
    aiError,
    onPromptVisibilityChange,
    onAddSlice,
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
  } = props;
  const animating = animPhase !== "idle";

  // Transform pivot face for 3D models: which bbox face the gizmo anchors to
  const [transformPivot, setTransformPivot] = useState<PivotFace>("center");
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

  // Keyboard shortcuts for transform modes (T/R/S) when a 3D model layer is selected
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      // Skip when typing in text fields
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.target as HTMLElement)?.isContentEditable) return;
      // Only active when a 3D model layer is selected
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
  }, [selectedLayerIndex, layerGlbUrls]);

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
        const origY = layerY(posIdx, layerCount);
        const continuousY = Math.max(-PRISM_H / 2, Math.min(PRISM_H / 2, origY + brickDeltaY));
        const continuous = yToLayerContinuous(continuousY, layerCount);
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
        const origY = layerY(posIdx, layerCount);
        // Continuous Y, clamped to brick bounds
        const continuousY = Math.max(-PRISM_H / 2, Math.min(PRISM_H / 2, origY + brickDeltaY));

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
      <Canvas frameloop="demand" camera={{ position: [0, 10, 0.01], fov: 50 }} style={{ background: template.colors.background }}>
        <ambientLight intensity={1.0} />
        <directionalLight position={[10, 10, 5]} intensity={0.8} castShadow={false} />
        <directionalLight position={[-5, -3, -5]} intensity={0.3} />
        <SpacePrism
          layerCount={layerCount}
          selectedLayerIndex={selectedLayerIndex}
          layerVisibility={layerVisibility}
          layerOrder={layerOrder}
          onSelectLayer={onSelectLayer}
          dragOverride={dragOverride}
          suppressClicks={longPressSelected || dragReorder}
          layerTextures={segmentDisplayMode === "colored" ? colorLayerTextures : layerTextures}
          layerCropInfo={layerCropInfo}
          imageAspect={imageAspect}
          revealActive={revealActive}
          onRevealDone={onRevealDone}
          aiEditingLayer={aiRunning ? selectedLayerIndex : null}
          layerGlbUrls={layerGlbUrls}
          generating3DLayer={generating3DLayer}
          transformPivot={transformPivot}
          transformMode={transformMode}
          snapTranslation={snapTranslation}
          snapRotation={snapRotation}
          snapScale={snapScale}
          snapEnabled={snapEnabled}
          onTransformChange={setModelTransform}
          appliedTransform={appliedTransform}
          modelTransform={modelTransform}
        />
        <ScrubberPlane
          layerCount={layerCount}
          selectedLayerIndex={selectedLayerIndex}
          layerOrder={layerOrder}
          onPreviewLayer={onPreviewLayer}
          onCommitLayer={onSelectLayer}
          imageAspect={imageAspect}
        />
        <CameraRef cameraRef={cameraRef} />
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

      {/* Chrome toggle button — always visible in top-left corner */}
      <button
        type="button"
        onClick={toggleChrome}
        title={shouldShowChrome ? "Hide toolbar" : "Show toolbar"}
        className={`chrome-toggle-btn${shouldShowChrome ? " chrome-toggle-open" : ""}`}
      >
        {shouldShowChrome ? "✕" : "☰"}
      </button>

      {/* Segment display mode toggle (masked original vs colored segments) */}
      {shouldShowChrome && layerCount > 1 && (
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
      {shouldShowChrome && showScrubber && (
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
        />
      )}

      {/* Universal: Context HUD on selection (bottom center) */}
      {shouldShowChrome && showControlsHUD && selectedLayerIndex !== null && (
        <LayerControlsHUD
          layerIndex={selectedLayerIndex}
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
          aiRunning={aiRunning}
          aiError={aiError}
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
        />
      )}

      {/* Layers view: full Photoshop-inspired panel */}
      {shouldShowChrome && showLayersPanel && (
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
          aiRunning={aiRunning}
          aiError={aiError}
          onAddSlice={onAddSlice}
          layerTextures={layerTextures}
          layerThumbnails={layerThumbnails}
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
            ? <><span style={{ fontSize: 14 }}>⇕</span> Dragging Layer {selectedLayerIndex}</>
            : selectedLayerIndex !== null
              ? <><span style={{ fontSize: 14 }}>◈</span> Layer {selectedLayerIndex} — hold for menu</>
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
