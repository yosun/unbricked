import React, { useCallback, useRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { DoubleSide, Plane, Raycaster, Vector3 } from "three";
import type { ThreeEvent } from "@react-three/fiber";
import LayerScrubber from "./LayerScrubber";
import LayerControlsHUD from "./LayerControlsHUD";
import CameraRig from "./CameraRig";
import type { AnimPhase } from "./CameraRig";

/* ── Shared prism dimensions ──────────────────────── */
const PRISM_W = 4;
const PRISM_H = 2.5;
const PRISM_D = 3;

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

interface SpacePrismProps {
  layerCount: number;
  selectedLayerIndex: number | null;
  layerVisibility: LayerVis[];
  onSelectLayer: (index: number) => void;
}

function SpacePrism(props: SpacePrismProps): React.JSX.Element {
  const { layerCount, selectedLayerIndex, layerVisibility, onSelectLayer } = props;

  const layers = Array.from({ length: layerCount }, (_, i) => i);
  return (
    <group>
      <mesh>
        <boxGeometry args={[PRISM_W, PRISM_H, PRISM_D]} />
        <meshBasicMaterial wireframe transparent opacity={0.4} color="#8888aa" />
      </mesh>

      {layers.map((i) => {
        const vis = layerVisibility[i];
        if (vis && !vis.visible) return null;

        const y = layerY(i, layerCount);
        const selected = i === selectedLayerIndex;
        const scale: [number, number, number] = selected
          ? [1.02, 1.02, 1.02]
          : [1, 1, 1];
        const opacity = vis ? vis.opacity : (selected ? 0.30 : 0.10);
        return (
          <mesh
            key={i}
            position={[0, y, 0]}
            rotation={[Math.PI / 2, 0, 0]}
            scale={scale}
            onClick={(e) => {
              e.stopPropagation();
              onSelectLayer(i);
            }}
          >
            <planeGeometry args={[PRISM_W * 0.96, PRISM_D * 0.96]} />
            <meshBasicMaterial
              transparent
              opacity={opacity}
              color={selected ? "#7ec8e3" : "#ccccdd"}
              depthWrite={false}
              side={DoubleSide}
            />
          </mesh>
        );
      })}
    </group>
  );
}

/* ── Scrubber Plane (draggable in-scene) ──────────── */

interface ScrubberPlaneProps {
  layerCount: number;
  selectedLayerIndex: number | null;
  onPreviewLayer: (index: number | null) => void;
  onCommitLayer: (index: number) => void;
}

const _dragPlane = new Plane(new Vector3(0, 0, 1), 0);
const _intersection = new Vector3();
const _raycaster = new Raycaster();

function ScrubberPlane(props: ScrubberPlaneProps): React.JSX.Element | null {
  const { layerCount, selectedLayerIndex, onPreviewLayer, onCommitLayer } = props;
  const { camera } = useThree();
  const dragging = useRef(false);
  const startY = useRef(0);
  const startLayerY = useRef(0);

  const currentIndex = selectedLayerIndex ?? 0;
  const y = layerY(currentIndex, layerCount);

  const handlePointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      const target = e.eventObject as unknown as { setPointerCapture: (id: number) => void };
      target.setPointerCapture(e.pointerId);
      dragging.current = true;

      // Set up a drag plane perpendicular to camera forward through the mesh position
      const camDir = new Vector3();
      camera.getWorldDirection(camDir);
      // Use a horizontal drag plane (normal = camera direction projected to XZ, then use Y drag)
      // Simpler: use a plane facing the camera at the mesh's Z position
      _dragPlane.setFromNormalAndCoplanarPoint(camDir, e.point);
      startY.current = e.point.y;
      startLayerY.current = layerY(currentIndex, layerCount);
    },
    [camera, currentIndex, layerCount],
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
        const snapped = clampLayerIndex(continuous, layerCount);
        onPreviewLayer(snapped);
      }
    },
    [camera, layerCount, onPreviewLayer],
  );

  const handlePointerUp = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!dragging.current) return;
      e.stopPropagation();
      dragging.current = false;

      // Final snap
      _raycaster.setFromCamera(e.pointer, camera);
      let finalIndex = currentIndex;
      if (_raycaster.ray.intersectPlane(_dragPlane, _intersection)) {
        const deltaY = _intersection.y - startY.current;
        const newY = startLayerY.current + deltaY;
        const continuous = yToLayerContinuous(newY, layerCount);
        finalIndex = clampLayerIndex(continuous, layerCount);
      }

      onPreviewLayer(null);
      onCommitLayer(finalIndex);
    },
    [camera, layerCount, currentIndex, onPreviewLayer, onCommitLayer],
  );

  return (
    <mesh
      position={[0, y, 0]}
      rotation={[Math.PI / 2, 0, 0]}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <planeGeometry args={[PRISM_W * 0.5, PRISM_D * 0.5]} />
      <meshBasicMaterial
        transparent
        opacity={0.18}
        color="#7ec8e3"
        depthWrite={false}
        side={DoubleSide}
      />
    </mesh>
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
  animPhase: AnimPhase;
  onAnimDone: () => void;
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
    animPhase,
    onAnimDone,
  } = props;
  const animating = animPhase !== "idle";

  const selectedVis = selectedLayerIndex !== null ? layerVisibility[selectedLayerIndex] : null;
  const selectedIsHidden = selectedVis ? !selectedVis.visible : false;
  const selectedIsSolo = selectedLayerIndex !== null && soloIndex === selectedLayerIndex;

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <Canvas camera={{ position: [0, 10, 0.01], fov: 50 }} style={{ background: "#1a1a2e" }}>
        <ambientLight intensity={0.8} />
        <directionalLight position={[10, 10, 5]} intensity={0.6} />
        <SpacePrism
          layerCount={layerCount}
          selectedLayerIndex={selectedLayerIndex}
          layerVisibility={layerVisibility}
          onSelectLayer={onSelectLayer}
        />
        <ScrubberPlane
          layerCount={layerCount}
          selectedLayerIndex={selectedLayerIndex}
          onPreviewLayer={onPreviewLayer}
          onCommitLayer={onSelectLayer}
        />
        <CameraRig animPhase={animPhase} onAnimDone={onAnimDone} />
        <OrbitControls
          makeDefault
          enabled={!animating}
          target={[0, 0, 0]}
          enableDamping
          dampingFactor={0.12}
          minPolarAngle={0.05}
          maxPolarAngle={Math.PI * 0.48}
          minDistance={5}
          maxDistance={20}
        />
      </Canvas>
      <LayerScrubber
        layerCount={layerCount}
        selectedIndex={selectedLayerIndex}
        onPreview={onPreviewLayer}
        onCommit={onSelectLayer}
      />
      {selectedLayerIndex !== null && (
        <LayerControlsHUD
          layerIndex={selectedLayerIndex}
          isHidden={selectedIsHidden}
          isSolo={selectedIsSolo}
          opacity={persistedOpacity}
          onToggleHidden={onToggleHidden}
          onToggleSolo={onToggleSolo}
          onPreviewOpacity={onPreviewOpacity}
          onCommitOpacity={onCommitOpacity}
        />
      )}
    </div>
  );
}
