import React, { useCallback, useEffect, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, Text } from "@react-three/drei";
import { DoubleSide, Plane, Raycaster, Vector3, TextureLoader } from "three";
import type { Camera, Texture } from "three";
import type { ThreeEvent } from "@react-three/fiber";
import LayerScrubber from "./LayerScrubber";
import LayerControlsHUD from "./LayerControlsHUD";
import LayersPanel from "./LayersPanel";
import RadialMenu from "./RadialMenu";
import CameraRig from "./CameraRig";
import type { AnimPhase } from "./CameraRig";
import type { ViewMode } from "./ViewMode";

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
  imageAspect: number | null;
}

/** Load a texture from a URL (data: or http) and cache by URI. */
function useLayerTexture(uri: string | undefined): Texture | null {
  const [texture, setTexture] = useState<Texture | null>(null);
  const loaderRef = useRef(new TextureLoader());

  useEffect(() => {
    if (!uri) {
      setTexture(null);
      return;
    }
    let cancelled = false;
    loaderRef.current.load(
      uri,
      (tex) => { if (!cancelled) setTexture(tex); },
      undefined,
      () => { if (!cancelled) setTexture(null); },
    );
    return () => { cancelled = true; };
  }, [uri]);

  return texture;
}

/** A single textured layer plane. */
function TexturedLayerPlane({
  uri,
  width,
  depth,
}: {
  uri: string | undefined;
  width: number;
  depth: number;
}): React.JSX.Element | null {
  const texture = useLayerTexture(uri);
  if (!texture) return null;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
      <planeGeometry args={[width * 0.96, depth * 0.96]} />
      <meshBasicMaterial
        map={texture}
        transparent
        opacity={0.9}
        depthWrite={false}
        side={DoubleSide}
      />
    </mesh>
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

function SpacePrism(props: SpacePrismProps): React.JSX.Element {
  const { layerCount, selectedLayerIndex, layerVisibility, layerOrder, onSelectLayer, dragOverride, suppressClicks, layerTextures, imageAspect } = props;
  const { prismW, prismD } = prismDims(imageAspect);
  const hiddenSlideX = prismW + 0.5;

  // When a layer is being dragged, compute adjusted Y positions for non-dragged layers
  // so they "make room" without relying on parent re-renders (which cause ghost duplicates).
  const dragIdx = dragOverride?.layerIdx ?? -1;
  const dragActive = dragOverride !== null && dragOverride !== undefined;

  // Build the visual position for each layer
  const positions: { layerIdx: number; y: number; isDragged: boolean }[] = [];
  if (dragActive) {
    // Figure out which slot the dragged layer would snap to
    const continuous = yToLayerContinuous(dragOverride.y, layerCount);
    const targetSlot = clampLayerIndex(continuous, layerCount);

    // Build a temporary order with the dragged layer removed, then inserted at target
    const tempOrder = layerOrder.filter(li => li !== dragIdx);
    tempOrder.splice(targetSlot, 0, dragIdx);

    for (let posIdx = 0; posIdx < tempOrder.length; posIdx++) {
      const li = tempOrder[posIdx] ?? posIdx;
      if (li === dragIdx) {
        // Dragged layer renders at the continuous override Y
        positions.push({ layerIdx: li, y: dragOverride.y, isDragged: true });
      } else {
        positions.push({ layerIdx: li, y: layerY(posIdx, layerCount), isDragged: false });
      }
    }
  } else {
    for (let posIdx = 0; posIdx < layerOrder.length; posIdx++) {
      positions.push({ layerIdx: layerOrder[posIdx] ?? posIdx, y: layerY(posIdx, layerCount), isDragged: false });
    }
  }

  return (
    <group>
      <mesh>
        <boxGeometry args={[prismW, PRISM_H, prismD]} />
        <meshBasicMaterial wireframe transparent opacity={0.4} color="#8888aa" />
      </mesh>

      {positions.map(({ layerIdx, y, isDragged }) => {
        const vis = layerVisibility[layerIdx];
        const hidden = vis ? !vis.visible : false;
        // Hidden layers slide to the right — same size, like slides pushed aside
        const x = hidden ? hiddenSlideX : 0;
        const selected = layerIdx === selectedLayerIndex;
        const scale: [number, number, number] = selected
          ? [1.02, 1.02, 1.02]
          : [1, 1, 1];
        const baseOpacity = vis ? vis.opacity : (selected ? 0.30 : 0.10);
        const opacity = hidden ? Math.max(baseOpacity * 0.35, 0.06) : baseOpacity;
        const color = selected ? "#7ec8e3" : layerHue(layerIdx, layerCount);
        return (
          <group key={layerIdx} position={[x, y, 0]}>
            <mesh
              rotation={[Math.PI / 2, 0, 0]}
              scale={scale}
              onClick={(e) => {
                e.stopPropagation();
                if (!suppressClicks) onSelectLayer(layerIdx);
              }}
            >
              <planeGeometry args={[prismW * 0.96, prismD * 0.96]} />
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
              />
            )}
            <Text
              position={[0, 0.01, 0]}
              rotation={[-Math.PI / 2, 0, 0]}
              fontSize={0.5}
              color={color}
              anchorX="center"
              anchorY="middle"
              fillOpacity={hidden ? 0.4 : Math.min(1, opacity * 3)}
            >
              {String(layerIdx)}
            </Text>
          </group>
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
          opacity={0.6}
          color="#7ec8e3"
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
  imageAspect: number | null;
  onImportImage: () => void;
  onAiEdit: (prompt: string, strength?: number) => void;
  aiRunning: boolean;
  aiError: string | null;
  onAddSlice: () => void;
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
    imageAspect,
    onImportImage,
    onAiEdit,
    aiRunning,
    aiError,
    onAddSlice,
  } = props;
  const animating = animPhase !== "idle";

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
      <Canvas camera={{ position: [0, 10, 0.01], fov: 50 }} style={{ background: "#1a1a2e" }}>
        <ambientLight intensity={0.8} />
        <directionalLight position={[10, 10, 5]} intensity={0.6} />
        <SpacePrism
          layerCount={layerCount}
          selectedLayerIndex={selectedLayerIndex}
          layerVisibility={layerVisibility}
          layerOrder={layerOrder}
          onSelectLayer={onSelectLayer}
          dragOverride={dragOverride}
          suppressClicks={longPressSelected || dragReorder}
          layerTextures={layerTextures}
          imageAspect={imageAspect}
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
        />
      )}

      {/* Universal: Context HUD on selection (bottom center) */}
      {showControlsHUD && selectedLayerIndex !== null && (
        <LayerControlsHUD
          layerIndex={selectedLayerIndex}
          isHidden={selectedIsHidden}
          isSolo={selectedIsSolo}
          opacity={persistedOpacity}
          onToggleHidden={onToggleHidden}
          onToggleSolo={onToggleSolo}
          onPreviewOpacity={onPreviewOpacity}
          onCommitOpacity={onCommitOpacity}
          hasImage={selectedLayerIndex in layerTextures}
          onImportImage={onImportImage}
          onAiEdit={onAiEdit}
          aiRunning={aiRunning}
          aiError={aiError}
          onAddSlice={onAddSlice}
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
          persistedOpacity={persistedOpacityFn}
          onSelectLayer={onSelectLayer}
          onToggleHidden={onToggleHidden}
          onToggleSolo={onToggleSolo}
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
