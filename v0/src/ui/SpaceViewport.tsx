import React from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { DoubleSide } from "three";
import LayerScrubber from "./LayerScrubber";
import LayerControlsHUD from "./LayerControlsHUD";
import CameraRig from "./CameraRig";
import type { AnimPhase } from "./CameraRig";

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

  const w = 4;
  const h = 2.5;
  const d = 3;

  const layers = Array.from({ length: layerCount }, (_, i) => i);
  return (
    <group>
      <mesh>
        <boxGeometry args={[w, h, d]} />
        <meshBasicMaterial wireframe transparent opacity={0.4} color="#8888aa" />
      </mesh>

      {layers.map((i) => {
        const vis = layerVisibility[i];
        if (vis && !vis.visible) return null;

        const t = layerCount <= 1 ? 0.5 : i / (layerCount - 1);
        const y = -h / 2 + t * h;
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
            <planeGeometry args={[w * 0.96, d * 0.96]} />
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
