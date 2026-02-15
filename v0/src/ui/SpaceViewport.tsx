import React from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { DoubleSide } from "three";
import LayerScrubber from "./LayerScrubber";
import CameraRig from "./CameraRig";
import type { AnimPhase } from "./CameraRig";

interface SpacePrismProps {
  layerCount: number;
  selectedLayerIndex: number | null;
  onSelectLayer: (index: number) => void;
}

function SpacePrism(props: SpacePrismProps): React.JSX.Element {
  const { layerCount, selectedLayerIndex, onSelectLayer } = props;

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
        const t = layerCount <= 1 ? 0.5 : i / (layerCount - 1);
        const y = -h / 2 + t * h;
        const selected = i === selectedLayerIndex;
        const scale: [number, number, number] = selected
          ? [1.02, 1.02, 1.02]
          : [1, 1, 1];
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
              opacity={selected ? 0.35 : 0.12}
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
  animPhase: AnimPhase;
  onAnimDone: () => void;
}

export default function SpaceViewport(props: SpaceViewportProps): React.JSX.Element {
  const {
    layerCount,
    selectedLayerIndex,
    onSelectLayer,
    onPreviewLayer,
    animPhase,
    onAnimDone,
  } = props;
  const animating = animPhase !== "idle";
  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <Canvas camera={{ position: [0, 10, 0.01], fov: 50 }} style={{ background: "#1a1a2e" }}>
        <ambientLight intensity={0.8} />
        <directionalLight position={[10, 10, 5]} intensity={0.6} />
        <SpacePrism
          layerCount={layerCount}
          selectedLayerIndex={selectedLayerIndex}
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
    </div>
  );
}
