import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree, useFrame, invalidate } from "@react-three/fiber";
import { OrbitControls, TransformControls, useGLTF } from "@react-three/drei";
import { Box3, CanvasTexture, Color, DoubleSide, Euler, GridHelper as ThreeGridHelper, Group, MathUtils, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Plane, Quaternion, Raycaster, SRGBColorSpace, Vector3, TextureLoader, BufferGeometry, Float32BufferAttribute, LineBasicMaterial } from "three";
import LayerScrubber from "./LayerScrubber";
import LayerControlsHUD from "./LayerControlsHUD";
import LayersPanel from "./LayersPanel";
import AIHistoryPanel from "./AIHistoryPanel";
import HistoryGraph3D from "../history/HistoryGraph3D";
import RadialMenu from "./RadialMenu";
import CameraRig from "./CameraRig";
import { useUIStyle } from "./uiStyleStore";
/* ── Shared prism dimensions ──────────────────────── */
const PRISM_H = 2.5;
const DEFAULT_PRISM_W = 4;
const DEFAULT_PRISM_D = 3;
/** Compute prism W and D from an image aspect ratio (width/height). */
function prismDims(imageAspect) {
    if (!imageAspect || imageAspect <= 0)
        return { prismW: DEFAULT_PRISM_W, prismD: DEFAULT_PRISM_D };
    // Keep roughly the same visual area (~12 sq units) while matching the aspect ratio.
    const area = DEFAULT_PRISM_W * DEFAULT_PRISM_D;
    const prismW = Math.sqrt(area * imageAspect);
    const prismD = area / prismW;
    return { prismW, prismD };
}
/** Distinct hue per logical layer index (evenly spaced around the wheel). */
function layerHue(layerIdx, layerCount) {
    const hue = Math.round((layerIdx / Math.max(layerCount, 1)) * 360);
    return `hsl(${String(hue)}, 55%, 65%)`;
}
function layerY(index, layerCount) {
    const t = layerCount <= 1 ? 0.5 : index / (layerCount - 1);
    return -PRISM_H / 2 + t * PRISM_H;
}
function yToLayerContinuous(y, layerCount) {
    const t = (y + PRISM_H / 2) / PRISM_H;
    return t * (layerCount - 1);
}
function clampLayerIndex(raw, layerCount) {
    return Math.max(0, Math.min(layerCount - 1, Math.round(raw)));
}
/** Shared TextureLoader — one instance for the whole module. */
const sharedTextureLoader = new TextureLoader();
/** Cache of canvas-based number textures for layer labels. */
const labelTextureCache = new Map();
function getLabelTexture(text, color) {
    const key = `${text}:${color}`;
    const cached = labelTextureCache.get(key);
    if (cached)
        return cached;
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
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
function LayerLabel({ text, color, opacity, renderOrder }) {
    const tex = useMemo(() => getLabelTexture(text, color), [text, color]);
    return (_jsx("sprite", { position: [0, 0.01, 0], scale: [0.5, 0.5, 0.5], renderOrder: renderOrder, children: _jsx("spriteMaterial", { map: tex, transparent: true, opacity: opacity, depthWrite: false, sizeAttenuation: true }) }));
}
/** Lerp speed for position animations (higher = faster). */
const LERP_SPEED = 4.0;
const LERP_THRESHOLD = 0.005;
/**
 * Animated wrapper for a layer group — smoothly lerps x and y toward targets.
 */
function AnimatedLayerGroup({ targetX, targetY, children, }) {
    const groupRef = useRef(null);
    // Initialise at target so first frame doesn't jitter
    const currentX = useRef(targetX);
    const currentY = useRef(targetY);
    useFrame((_, delta) => {
        if (!groupRef.current)
            return;
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
    return (_jsx("group", { ref: groupRef, position: [currentX.current, currentY.current, 0], children: children }));
}
/** Load a texture from a URL (data: or http) and cache by URI. */
function useLayerTexture(uri) {
    const [texture, setTexture] = useState(null);
    useEffect(() => {
        if (!uri) {
            setTexture(null);
            return;
        }
        let cancelled = false;
        sharedTextureLoader.load(uri, (tex) => {
            if (!cancelled) {
                setTexture(tex);
                invalidate();
            }
        }, undefined, (err) => {
            console.error("[useLayerTexture] FAILED", err);
            if (!cancelled)
                setTexture(null);
        });
        return () => { cancelled = true; };
    }, [uri]);
    return texture;
}
/** A single textured layer plane. Handles crop offset, AI pulse glow, and fade-in. */
function TexturedLayerPlane({ uri, width, depth, layerIdx, opacity, crop, aiEditing, generating3D, positionIndex, selected, }) {
    const texture = useLayerTexture(uri);
    const matRef = useRef(null);
    const glowRef = useRef(null);
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
                }
                else {
                    const hue = 200 + 15 * Math.sin(t * 0.4);
                    glowRef.current.color.setHSL(hue / 360, 0.7, 0.6);
                }
                needsInvalidate = true;
            }
            else if (glowRef.current.opacity !== 0) {
                glowRef.current.opacity = 0;
                needsInvalidate = true;
            }
        }
        if (needsInvalidate)
            invalidate();
    });
    if (!texture)
        return null;
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
    return (_jsxs("group", { children: [_jsxs("mesh", { rotation: [-Math.PI / 2, 0, 0], position: [offX, 0.02, offZ], renderOrder: baseOrder + 2, children: [_jsx("planeGeometry", { args: [planeW, planeD] }), _jsx("meshBasicMaterial", { ref: matRef, map: texture, transparent: true, opacity: opacity * fadeProgress.current, depthWrite: false, side: DoubleSide })] }), _jsxs("mesh", { rotation: [-Math.PI / 2, 0, 0], position: [offX, 0.03, offZ], renderOrder: baseOrder + 3, children: [_jsx("planeGeometry", { args: [planeW, planeD] }), _jsx("meshBasicMaterial", { ref: glowRef, transparent: true, opacity: 0, color: glowColor, depthWrite: false, side: DoubleSide })] })] }));
}
/**
 * Compute how many brick-space Y-units correspond to one screen pixel,
 * by projecting the top and bottom of the prism onto the screen.
 */
function screenToBrickY(camera, canvasH) {
    const top = new Vector3(0, PRISM_H / 2, 0).project(camera);
    const bot = new Vector3(0, -PRISM_H / 2, 0).project(camera);
    // NDC Y range [-1,1] → pixel range [0, canvasH]
    const topPx = (1 - top.y) * 0.5 * canvasH;
    const botPx = (1 - bot.y) * 0.5 * canvasH;
    const pixelSpan = Math.abs(botPx - topPx);
    if (pixelSpan < 1)
        return PRISM_H / canvasH; // fallback
    return PRISM_H / pixelSpan;
}
/** Exposes the R3F camera to an external ref. */
function CameraRef({ cameraRef }) {
    const { camera } = useThree();
    cameraRef.current = camera;
    return null;
}
/**
 * Projects a selected slice's 3D position → screen coords each frame.
 * Writes to the provided callback only when the position changes by >1px
 * to avoid unnecessary re-renders in demand-render mode.
 */
function SliceAnchorTracker({ layerIndex, layerCount, layerOrder, onUpdate, }) {
    const { camera, size } = useThree();
    const lastRef = useRef({ x: 0, y: 0, visible: false });
    const _v = useMemo(() => new Vector3(), []);
    useFrame(() => {
        if (layerIndex === null)
            return;
        const visualPos = layerOrder.indexOf(layerIndex);
        if (visualPos < 0)
            return;
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
function Generating3DPlaceholder({ width, depth, crop, }) {
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
    const innerRef = useRef(null);
    const outerRef = useRef(null);
    const outerMeshRef = useRef(null);
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
    return (_jsxs("group", { children: [_jsxs("mesh", { rotation: [-Math.PI / 2, 0, 0], position: [offX, 0.04, offZ], children: [_jsx("planeGeometry", { args: [planeW, planeD] }), _jsx("meshBasicMaterial", { ref: innerRef, transparent: true, opacity: 0.15, color: glowColor, depthWrite: false, side: DoubleSide })] }), _jsxs("mesh", { ref: outerMeshRef, rotation: [-Math.PI / 2, 0, 0], position: [offX, 0.035, offZ], children: [_jsx("planeGeometry", { args: [planeW * 1.12, planeD * 1.12] }), _jsx("meshBasicMaterial", { ref: outerRef, transparent: true, opacity: 0.06, color: glowColor, depthWrite: false, side: DoubleSide })] })] }));
}
export const PIVOT_FACES = ["center", "+y", "-y", "-x", "+x", "+z", "-z"];
export const PIVOT_FACE_LABELS = {
    "center": "Center",
    "+y": "Top",
    "-y": "Bottom",
    "-x": "Left",
    "+x": "Right",
    "+z": "Front",
    "-z": "Back",
};
const DEFAULT_TRANSFORM = {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
};
/** Renders a GLB model on a layer, auto-fitted to the segment's footprint on the prism. */
function GLBLayerModel({ url, width, depth, crop, selected, transformPivot, transformMode, snapTranslation, snapRotation, snapScale, snapEnabled, onTransformChange, appliedTransform, onSetTransformPivot, }) {
    const { scene } = useGLTF(url);
    const selectionWireframe = useUIStyle((s) => s.template.colors.selectionWireframe);
    const pivotColor = useUIStyle((s) => s.template.colors.pivotColor);
    // Base offset positions the model over the selected prism segment (crop offset etc).
    // `pivotCompRef` is an INTERNAL compensation group used to keep the model stationary
    // when the pivot face changes, without modifying the persisted user transform.
    const pivotCompRef = useRef(null);
    const tcTargetRef = useRef(null);
    const contentRef = useRef(null);
    const scaleGroupRef = useRef(null);
    const [tcReady, setTcReady] = useState(false);
    const cloned = useMemo(() => {
        const c = scene.clone(true);
        c.traverse((node) => {
            const mesh = node;
            if (!mesh.isMesh)
                return;
            if (!mesh.geometry.attributes["normal"]) {
                mesh.geometry.computeVertexNormals();
            }
            const hasVertexColors = !!(mesh.geometry.attributes["color"]);
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            const fixed = mats.map((mat) => {
                const m = mat.clone();
                if (m instanceof MeshStandardMaterial) {
                    if (hasVertexColors)
                        m.vertexColors = true;
                    if (m.map) {
                        m.map = m.map.clone();
                        m.map.colorSpace = SRGBColorSpace;
                        m.map.needsUpdate = true;
                    }
                    if (!m.map && !hasVertexColors)
                        m.color = new Color(0xcccccc);
                    m.metalness = 0;
                    m.roughness = Math.max(m.roughness, 0.6);
                    m.needsUpdate = true;
                }
                else if (m instanceof MeshBasicMaterial) {
                    if (hasVertexColors)
                        m.vertexColors = true;
                    if (m.map) {
                        m.map = m.map.clone();
                        m.map.colorSpace = SRGBColorSpace;
                        m.map.needsUpdate = true;
                    }
                    if (!m.map && !hasVertexColors)
                        m.color = new Color(0xcccccc);
                    m.needsUpdate = true;
                }
                return m;
            });
            mesh.material = Array.isArray(mesh.material) ? fixed : fixed[0];
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
        // 1. Determine if yaw correction is needed (using unscaled probe first)
        const rawProbe = cloned.clone(true);
        const rawGroup = new Group();
        rawGroup.add(rawProbe);
        rawGroup.updateMatrixWorld(true);
        const rawBox = new Box3().setFromObject(rawGroup);
        const rawSize = new Vector3();
        rawBox.getSize(rawSize);
        // Count meshes and check geometry readiness for debug
        let meshCount = 0;
        let allGeometryReady = true;
        cloned.traverse((node) => {
            const mesh = node;
            if (!mesh.isMesh)
                return;
            meshCount++;
            if (!mesh.geometry.attributes["position"] || mesh.geometry.attributes["position"].count === 0) {
                allGeometryReady = false;
            }
        });
        const imageAspect = targetW / Math.max(targetD, 0.001);
        const modelAspect = rawSize.x / Math.max(rawSize.z, 0.001);
        const modelAspect90 = rawSize.z / Math.max(rawSize.x, 0.001);
        const needsYaw90 = Math.abs(modelAspect - imageAspect) > Math.abs(modelAspect90 - imageAspect) &&
            Math.abs(modelAspect - imageAspect) > 0.3;
        const q = new Quaternion();
        if (needsYaw90) {
            q.setFromEuler(new Euler(0, Math.PI / 2, 0));
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
    const pivotFace = transformPivot ?? "center";
    const contentOffset = useMemo(() => {
        const { center, min, max } = scaledMetrics;
        // Base offset puts bbox center at origin
        const cx = -center.x;
        const cy = -center.y;
        const cz = -center.z;
        if (pivotFace === "center")
            return [cx, cy, cz];
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
    const bboxSize = useMemo(() => {
        const { size } = scaledMetrics;
        return [size.x, size.y, size.z];
    }, [scaledMetrics]);
    // ── Bounding box center offset from pivot point (for wireframe positioning) ──
    const bboxCenterOffset = useMemo(() => {
        const { center, min, max } = scaledMetrics;
        if (pivotFace === "center")
            return [0, 0, 0];
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
        if (debugVerifiedRef.current)
            return;
        if (!scaleGroupRef.current || !tcTargetRef.current || !contentRef.current)
            return;
        debugVerifiedRef.current = true;
        tcTargetRef.current.updateMatrixWorld(true);
        const actualBox = new Box3().setFromObject(scaleGroupRef.current);
        if (actualBox.isEmpty()) {
            console.warn('[GLBLayerModel] DEBUG: actual bbox empty');
            return;
        }
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
        if (tcTargetRef.current && !tcReady)
            setTcReady(true);
    });
    useEffect(() => { invalidate(); }, [cloned]);
    const orbitControls = useThree((s) => s.controls);
    const reportTransform = useCallback(() => {
        if (!tcTargetRef.current || !onTransformChange)
            return;
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
    const prevPivotRef = useRef(pivotFace);
    const prevOffsetRef = useRef(contentOffset);
    useEffect(() => {
        if (!tcTargetRef.current || !pivotCompRef.current)
            return;
        const prev = prevOffsetRef.current;
        const next = contentOffset;
        prevOffsetRef.current = next;
        // Only compensate if the pivot actually changed (not on metrics/model change)
        if (prevPivotRef.current === pivotFace)
            return;
        prevPivotRef.current = pivotFace;
        if (prev[0] === next[0] && prev[1] === next[1] && prev[2] === next[2])
            return;
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
    const lastAppliedRef = useRef(null);
    useEffect(() => {
        if (!appliedTransform || !tcTargetRef.current)
            return;
        if (lastAppliedRef.current === appliedTransform)
            return;
        lastAppliedRef.current = appliedTransform;
        const g = tcTargetRef.current;
        g.position.set(...appliedTransform.position);
        g.rotation.set(MathUtils.degToRad(appliedTransform.rotation[0]), MathUtils.degToRad(appliedTransform.rotation[1]), MathUtils.degToRad(appliedTransform.rotation[2]));
        g.scale.set(...appliedTransform.scale);
        invalidate();
    }, [appliedTransform]);
    const effectiveMode = transformMode ?? "rotate";
    return (_jsxs(_Fragment, { children: [_jsx("group", { position: [offX, 0.05, offZ], children: _jsx("group", { ref: pivotCompRef, children: _jsxs("group", { ref: tcTargetRef, children: [_jsx("group", { ref: contentRef, position: contentOffset, children: _jsx("group", { ref: scaleGroupRef, scale: [fitScale, fitScale, fitScale], children: _jsx("group", { quaternion: orientationQuat, children: _jsx("primitive", { object: cloned }) }) }) }), selected && (_jsxs("mesh", { position: bboxCenterOffset, children: [_jsx("boxGeometry", { args: bboxSize }), _jsx("meshBasicMaterial", { wireframe: true, transparent: true, opacity: 0.25, color: selectionWireframe, depthWrite: false })] })), selected && (_jsxs("mesh", { rotation: [0, Math.PI / 4, 0], position: [0, 0, 0], children: [_jsx("boxGeometry", { args: [0.06, 0.06, 0.06] }), _jsx("meshBasicMaterial", { color: pivotColor, depthTest: false, transparent: true, opacity: 0.9 })] })), selected && onSetTransformPivot && (_jsx(BBoxFaceProxies, { size: bboxSize, centerOffset: bboxCenterOffset, currentFace: pivotFace, onSelectFace: onSetTransformPivot })), selected && snapEnabled && (_jsx(GizmoChildSnapHelpers, { mode: effectiveMode, snapTranslation: snapTranslation, snapRotation: snapRotation, snapScale: snapScale, radius: Math.max(width, depth) * 0.6 }))] }) }) }), selected && tcReady && tcTargetRef.current && (_jsx(TransformControls, { object: tcTargetRef.current, mode: effectiveMode, size: 0.6, space: pivotFace !== "center" ? "local" : "world", translationSnap: snapTranslation ?? null, rotationSnap: snapRotation != null ? MathUtils.degToRad(snapRotation) : null, scaleSnap: snapScale ?? null, onChange: () => { invalidate(); reportTransform(); }, onMouseDown: () => { if (orbitControls)
                    orbitControls.enabled = false; }, onMouseUp: () => { if (orbitControls)
                    orbitControls.enabled = true; invalidate(); reportTransform(); } }))] }));
}
/** Visual snap helpers: shows mode-specific guides centered at the transform tool position.
 *  - translate: XZ grid with spacing matching snapTranslation
 *  - rotate: Radial angle lines matching snapRotation degrees
 *  - scale: Axis ticks along X, Y, Z at snap scale intervals
 */
function SnapHelpers({ mode, snapTranslation, snapRotation, snapScale, radius, }) {
    const colors = useUIStyle((s) => s.template.colors);
    // Translation grid: XZ plane grid with snap-aligned spacing
    const translationGrid = useMemo(() => {
        if (mode !== "translate")
            return null;
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
        if (mode !== "rotate")
            return null;
        const step = snapRotation ?? 15;
        const count = Math.round(360 / step);
        const r = radius;
        const positions = [];
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
        if (mode !== "scale")
            return null;
        const step = snapScale ?? 0.1;
        const positions = [];
        const tickLength = 0.03; // perpendicular tick size
        const axisLength = radius;
        const tickCount = Math.ceil(axisLength / step);
        // Draw ticks along positive and negative X, Y, Z axes
        const axes = [
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
                if (ax !== 0) {
                    ty = tickLength;
                } // X-axis: tick in Y
                else if (ay !== 0) {
                    tx = tickLength;
                } // Y-axis: tick in X
                else {
                    tx = tickLength;
                } // Z-axis: tick in X
                positions.push(px - tx, py - ty, pz - tz, px + tx, py + ty, pz + tz);
            }
        }
        const geo = new BufferGeometry();
        geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
        return geo;
    }, [mode, snapScale, radius]);
    return (_jsxs("group", { children: [translationGrid && _jsx("primitive", { object: translationGrid }), rotationLines && (_jsx("lineSegments", { geometry: rotationLines, children: _jsx("lineBasicMaterial", { color: colors.snapLineColor, transparent: true, opacity: 0.3, depthWrite: false }) })), scaleTicks && (_jsx("lineSegments", { geometry: scaleTicks, children: _jsx("lineBasicMaterial", { color: colors.gridColor, transparent: true, opacity: 0.4, depthWrite: false }) }))] }));
}
/** Clickable invisible planes at each bbox face for quick pivot selection. */
function BBoxFaceProxies({ size, centerOffset, currentFace, onSelectFace, }) {
    const hoverColor = useUIStyle((s) => s.template.colors.accent);
    const [hovered, setHovered] = useState(null);
    const [sx, sy, sz] = size;
    const [cx, cy, cz] = centerOffset;
    const faces = useMemo(() => [
        { face: "+x", pos: [cx + sx / 2, cy, cz], rot: [0, Math.PI / 2, 0], w: sz, h: sy },
        { face: "-x", pos: [cx - sx / 2, cy, cz], rot: [0, -Math.PI / 2, 0], w: sz, h: sy },
        { face: "+y", pos: [cx, cy + sy / 2, cz], rot: [-Math.PI / 2, 0, 0], w: sx, h: sz },
        { face: "-y", pos: [cx, cy - sy / 2, cz], rot: [Math.PI / 2, 0, 0], w: sx, h: sz },
        { face: "+z", pos: [cx, cy, cz + sz / 2], rot: [0, 0, 0], w: sx, h: sy },
        { face: "-z", pos: [cx, cy, cz - sz / 2], rot: [0, Math.PI, 0], w: sx, h: sy },
    ], [sx, sy, sz, cx, cy, cz]);
    return (_jsx("group", { children: faces.map(({ face, pos, rot, w, h }) => (_jsxs("mesh", { position: pos, rotation: rot, onClick: (e) => { e.stopPropagation(); onSelectFace(face); }, onPointerOver: () => { setHovered(face); invalidate(); }, onPointerOut: () => { setHovered(null); invalidate(); }, children: [_jsx("planeGeometry", { args: [w * 0.9, h * 0.9] }), _jsx("meshBasicMaterial", { transparent: true, opacity: hovered === face ? 0.15 : currentFace === face ? 0.08 : 0, color: hoverColor, depthWrite: false, side: DoubleSide })] }, face))) }));
}
/** Snap helpers rendered as child of gizmo target — counter-rotates for translate mode. */
function GizmoChildSnapHelpers({ mode, snapTranslation, snapRotation, snapScale, radius, }) {
    const counterRef = useRef(null);
    const _q = useMemo(() => new Quaternion(), []);
    useFrame(() => {
        if (!counterRef.current)
            return;
        if (mode === "translate") {
            // Counter-rotate so translate grid stays world-axis-aligned
            const parent = counterRef.current.parent;
            if (parent) {
                parent.getWorldQuaternion(_q);
                counterRef.current.quaternion.copy(_q.invert());
            }
        }
        else {
            // For rotate/scale, snap helpers follow object rotation
            counterRef.current.quaternion.identity();
        }
    });
    return (_jsx("group", { ref: counterRef, children: _jsx(SnapHelpers, { mode: mode, snapTranslation: snapTranslation, snapRotation: snapRotation, snapScale: snapScale, radius: radius }) }));
}
function SpacePrism(props) {
    const { layerCount, selectedLayerIndex, layerVisibility, layerOrder, onSelectLayer, dragOverride, suppressClicks, layerTextures, layerCropInfo, imageAspect, revealActive, onRevealDone, aiEditingLayer, layerGlbUrls, generating3DLayer, transformPivot, transformMode, snapTranslation, snapRotation, snapScale, snapEnabled, onSetTransformPivot, onTransformChange, appliedTransform, modelTransform } = props;
    const { prismW, prismD } = prismDims(imageAspect);
    const hiddenSlideX = -(prismW + 0.5);
    const template = useUIStyle((s) => s.template);
    // Track reveal animation progress
    const revealProgress = useRef(revealActive ? 0 : 1);
    const revealDoneFired = useRef(!revealActive);
    // Use template animation speed to control reveal pacing (lower = calmer)
    const revealSpeed = 1.8 * template.ui.animationSpeed;
    useFrame((_, delta) => {
        if (revealProgress.current >= 1)
            return;
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
        const result = [];
        for (let posIdx = 0; posIdx < layerOrder.length; posIdx++) {
            result.push({ layerIdx: layerOrder[posIdx] ?? posIdx, y: layerY(posIdx, layerCount), isDragged: false });
        }
        return result;
    }, [layerOrder, layerCount]);
    let positions;
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
            }
            else {
                positions.push({ layerIdx: li, y: layerY(posIdx, layerCount), isDragged: false });
            }
        }
    }
    else {
        positions = staticPositions;
    }
    // Shared geometry for all brick planes — avoids N allocations per frame
    const brickGeo = useMemo(() => new PlaneGeometry(prismW * 0.96, prismD * 0.96), [prismW, prismD]);
    return (_jsxs("group", { children: [_jsxs("mesh", { children: [_jsx("boxGeometry", { args: [prismW, PRISM_H, prismD] }), _jsx("meshBasicMaterial", { wireframe: true, transparent: true, opacity: 0.15, color: template.colors.foreground })] }), positions.map(({ layerIdx, y, isDragged }, positionIndex) => {
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
                const scale = [scaleVal, scaleVal, scaleVal];
                const baseOpacity = vis ? vis.opacity : (selected ? 0.30 : 0.10);
                const opacity = hidden ? Math.max(baseOpacity * 0.35, 0.06) : baseOpacity;
                const color = selected ? template.colors.accent : template.brick.color;
                // Use position in stack for render ordering so upper layers draw on top
                const baseOrder = positionIndex * 10;
                return (_jsxs(AnimatedLayerGroup, { targetX: targetX, targetY: targetY, children: [_jsx("mesh", { geometry: brickGeo, rotation: [Math.PI / 2, 0, 0], scale: scale, renderOrder: baseOrder, onClick: (e) => {
                                e.stopPropagation();
                                if (!suppressClicks)
                                    onSelectLayer(layerIdx);
                            }, children: _jsx("meshBasicMaterial", { transparent: true, opacity: isDragged ? Math.max(opacity, 0.5) : opacity, color: color, depthWrite: false, side: DoubleSide }) }), layerTextures[layerIdx] && (_jsx(TexturedLayerPlane, { uri: layerTextures[layerIdx], width: prismW, depth: prismD, layerIdx: layerIdx, opacity: vis ? vis.textureOpacity : 1, crop: layerCropInfo[layerIdx], aiEditing: aiEditingLayer === layerIdx, generating3D: generating3DLayer === layerIdx, positionIndex: positionIndex, selected: selected })), generating3DLayer === layerIdx && !layerGlbUrls?.[layerIdx] && (_jsx(Generating3DPlaceholder, { width: prismW, depth: prismD, ...(layerCropInfo[layerIdx] ? { crop: layerCropInfo[layerIdx] } : {}) })), layerGlbUrls?.[layerIdx] && (_jsx(GLBLayerModel, { url: layerGlbUrls[layerIdx], width: prismW, depth: prismD, selected: selected, transformPivot: transformPivot, transformMode: transformMode, snapTranslation: snapTranslation, snapRotation: snapRotation, snapScale: snapScale, snapEnabled: snapEnabled, onTransformChange: selected ? onTransformChange : undefined, appliedTransform: selected ? appliedTransform : undefined, onSetTransformPivot: selected ? onSetTransformPivot : undefined, ...(layerCropInfo[layerIdx] ? { crop: layerCropInfo[layerIdx] } : {}) })), _jsx(LayerLabel, { text: String(layerIdx), color: template.colors.foreground, opacity: hidden ? 0.2 : Math.min(0.5, opacity * 2), renderOrder: baseOrder + 1 })] }, layerIdx));
            })] }));
}
const _dragPlane = new Plane(new Vector3(0, 0, 1), 0);
const _intersection = new Vector3();
const _raycaster = new Raycaster();
function ScrubberPlane(props) {
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
    const handlePointerDown = useCallback((e) => {
        e.stopPropagation();
        const target = e.eventObject;
        target.setPointerCapture(e.pointerId);
        dragging.current = true;
        // Disable OrbitControls while dragging
        if (controls)
            controls.enabled = false;
        // Set up a drag plane perpendicular to camera forward through the mesh position
        const camDir = new Vector3();
        camera.getWorldDirection(camDir);
        _dragPlane.setFromNormalAndCoplanarPoint(camDir, e.point);
        startY.current = e.point.y;
        startLayerY.current = layerY(currentVisual, layerCount);
    }, [camera, controls, currentVisual, layerCount]);
    const handlePointerMove = useCallback((e) => {
        if (!dragging.current)
            return;
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
    }, [camera, layerCount, layerOrder, onPreviewLayer]);
    const handlePointerUp = useCallback((e) => {
        if (!dragging.current)
            return;
        e.stopPropagation();
        dragging.current = false;
        // Re-enable OrbitControls
        if (controls)
            controls.enabled = true;
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
    }, [camera, controls, layerCount, layerOrder, currentLogical, onPreviewLayer, onCommitLayer]);
    // With a single layer there is nothing to scrub — skip rendering so
    // the invisible grab mesh does not block clicks on the layer plane.
    if (layerCount <= 1)
        return null;
    return (_jsxs("group", { position: [0, y, 0], rotation: [Math.PI / 2, 0, 0], children: [_jsxs("mesh", { children: [_jsx("planeGeometry", { args: [prismW * 0.98, prismD * 0.02] }), _jsx("meshBasicMaterial", { transparent: true, opacity: 0.4, color: scrubber3d, depthWrite: false, side: DoubleSide })] }), _jsxs("mesh", { onPointerDown: handlePointerDown, onPointerMove: handlePointerMove, onPointerUp: handlePointerUp, children: [_jsx("planeGeometry", { args: [prismW * 0.5, prismD * 0.5] }), _jsx("meshBasicMaterial", { transparent: true, opacity: 0, depthWrite: false, side: DoubleSide })] })] }));
}
export default function SpaceViewport(props) {
    const { layerCount, selectedLayerIndex, onSelectLayer, onPreviewLayer, layerVisibility, soloIndex, onToggleHidden, onToggleSolo, onToggleMask, maskActive, onPreviewOpacity, onCommitOpacity, persistedOpacity, persistedOpacityFn, isHiddenFn, layerOrder, onPreviewOrder, onCommitOrder, animPhase, onAnimDone, viewMode, peekLayers, peekRail, layerTextures, layerThumbnails, colorLayerTextures, layerCropInfo, segmentDisplayMode, onToggleSegmentDisplay, revealActive, onRevealDone, imageAspect, onImportImage, onAiEdit, aiRunning, aiError, onPromptVisibilityChange, onAddSlice, isMaskActiveFn, isMaskInvertedFn, onInvertMask, aiEditModelId, onChangeAiEditModel, onGenerate3D, generating3DLayer, layerGlbUrls, threeDSourceHidden, onToggle3DSourceImage, getSliceHistory, onSetDisplayCursor, onSetOperationCursor, payloads, keyframePreviewUrl, documentSourceImageId, } = props;
    const animating = animPhase !== "idle";
    // Transform pivot face for 3D models: which bbox face the gizmo anchors to
    const [transformPivot, setTransformPivot] = useState("center");
    // Universal AI History panel: which layer index is open, or null
    const [historyPanelLayer, setHistoryPanelLayer] = useState(null);
    // Screen-space anchor for the 3D-attached history HUD
    const [sliceAnchor, setSliceAnchor] = useState({ x: 0, y: 0, visible: false });
    const stableSetSliceAnchor = useCallback((a) => { setSliceAnchor(a); }, []);
    // Transform gizmo mode
    const [transformMode, setTransformMode] = useState("rotate");
    // Snap settings
    const [snapEnabled, setSnapEnabled] = useState(false);
    const snapTranslation = snapEnabled ? 0.25 : undefined;
    const snapRotation = snapEnabled ? 15 : undefined;
    const snapScale = snapEnabled ? 0.1 : undefined;
    // Current 3D model transform values for display
    const [modelTransform, setModelTransform] = useState(DEFAULT_TRANSFORM);
    // Externally-applied transform (from editable panel) — uses object identity to trigger effect
    const [appliedTransform, setAppliedTransform] = useState(undefined);
    const handleApplyTransform = useCallback((t) => {
        // Create a new object so React state change triggers the effect even if values are same
        setAppliedTransform({ ...t });
        setModelTransform(t);
    }, []);
    // Keyboard shortcuts for transform modes (T/R/S) when a 3D model layer is selected
    useEffect(() => {
        const handleKeyDown = (e) => {
            // Skip when typing in text fields
            const tag = e.target?.tagName;
            if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT")
                return;
            if (e.target?.isContentEditable)
                return;
            // Only active when a 3D model layer is selected
            if (selectedLayerIndex === null || !(selectedLayerIndex in layerGlbUrls))
                return;
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
    const wrappedPromptVisibility = useCallback((visible) => {
        setPromptOpen(visible);
        if (visible)
            setChromeVisible(true);
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
    const [radialMenu, setRadialMenu] = useState(null);
    const [longPressSelected, setLongPressSelected] = useState(false);
    const longPressTimer = useRef(null);
    const longPressPos = useRef({ x: 0, y: 0 });
    // Drag-reorder state for minimalist view
    const [dragReorder, setDragReorder] = useState(false);
    const [dragOverride, setDragOverride] = useState(null);
    const dragStartY = useRef(0);
    const dragOriginalPosIdx = useRef(0);
    const activePointerId = useRef(null);
    const lastDragY = useRef(0);
    const containerRef = useRef(null);
    const cameraRef = useRef(null);
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
    const handleCanvasPointerDown = useCallback((e) => {
        if (viewMode !== "minimalist")
            return;
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
    }, [viewMode, selectedLayerIndex, layerOrder]);
    const handleCanvasPointerUp = useCallback((e) => {
        const pid = activePointerId.current ?? e.pointerId;
        activePointerId.current = null;
        if (containerRef.current) {
            try {
                containerRef.current.releasePointerCapture(pid);
            }
            catch { /* already released */ }
        }
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
        // Commit drag-reorder if active
        if (dragReorder) {
            // Compute the final order from the last drag Y position
            let finalOrder = null;
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
    const handleCanvasPointerMove = useCallback((e) => {
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
    }, [dragReorder, longPressSelected, radialMenu, selectedLayerIndex, layerCount, layerOrder]);
    const radialItems = [
        { label: "Prev", icon: "↑", action: () => {
                const idx = selectedLayerIndex ?? 0;
                if (idx < layerCount - 1)
                    onSelectLayer(idx + 1);
            } },
        { label: "Next", icon: "↓", action: () => {
                const idx = selectedLayerIndex ?? 0;
                if (idx > 0)
                    onSelectLayer(idx - 1);
            } },
        { label: "Hide", icon: "👁", action: () => {
                if (selectedLayerIndex !== null)
                    onToggleHidden(selectedLayerIndex);
            } },
        { label: "Solo", icon: "S", action: () => {
                if (selectedLayerIndex !== null)
                    onToggleSolo(selectedLayerIndex);
            } },
        { label: "Import", icon: "📥", action: () => {
                onImportImage();
            } },
        { label: "+Slice", icon: "＋", action: () => {
                onAddSlice();
            } },
    ];
    /* ── Determine what to show ──────────────────── */
    const showScrubber = viewMode === "universal" || peekRail;
    const showControlsHUD = viewMode === "universal";
    const showLayersPanel = viewMode === "layers" || peekLayers;
    return (_jsxs("div", { ref: containerRef, style: {
            position: "relative",
            width: "100%",
            height: "100%",
            touchAction: viewMode === "minimalist" ? "none" : "auto",
            userSelect: "none",
            cursor: dragReorder ? "grabbing" : "auto",
        }, onPointerDown: handleCanvasPointerDown, onPointerUp: handleCanvasPointerUp, onPointerMove: handleCanvasPointerMove, children: [_jsxs(Canvas, { frameloop: "demand", camera: { position: [0, 10, 0.01], fov: 50 }, style: { background: template.colors.background }, children: [_jsx("ambientLight", { intensity: 1.0 }), _jsx("directionalLight", { position: [10, 10, 5], intensity: 0.8, castShadow: false }), _jsx("directionalLight", { position: [-5, -3, -5], intensity: 0.3 }), _jsx(SpacePrism, { layerCount: layerCount, selectedLayerIndex: selectedLayerIndex, layerVisibility: layerVisibility, layerOrder: layerOrder, onSelectLayer: onSelectLayer, dragOverride: dragOverride, suppressClicks: longPressSelected || dragReorder, layerTextures: segmentDisplayMode === "colored" ? colorLayerTextures : layerTextures, layerCropInfo: layerCropInfo, imageAspect: imageAspect, revealActive: revealActive, onRevealDone: onRevealDone, aiEditingLayer: aiRunning ? selectedLayerIndex : null, layerGlbUrls: layerGlbUrls, generating3DLayer: generating3DLayer, transformPivot: transformPivot, transformMode: transformMode, snapTranslation: snapTranslation, snapRotation: snapRotation, snapScale: snapScale, snapEnabled: snapEnabled, onSetTransformPivot: setTransformPivot, onTransformChange: setModelTransform, appliedTransform: appliedTransform, modelTransform: modelTransform }), _jsx(ScrubberPlane, { layerCount: layerCount, selectedLayerIndex: selectedLayerIndex, layerOrder: layerOrder, onPreviewLayer: onPreviewLayer, onCommitLayer: onSelectLayer, imageAspect: imageAspect }), _jsx(CameraRef, { cameraRef: cameraRef }), viewMode === "universal" && selectedLayerIndex !== null && getSliceHistory && onSetDisplayCursor && payloads && (() => {
                        const sliceGraph = getSliceHistory(selectedLayerIndex);
                        if (!sliceGraph)
                            return null;
                        const { prismW: pw } = prismDims(imageAspect);
                        const visualIdx = layerOrder.indexOf(selectedLayerIndex);
                        const yPos = layerY(visualIdx < 0 ? selectedLayerIndex : visualIdx, layerCount);
                        return (_jsx(HistoryGraph3D, { graph: sliceGraph, payloads: payloads, sliceY: yPos, prismW: pw, onSelectNode: (id) => { onSetDisplayCursor(selectedLayerIndex, id); }, onSetOperationCursor: (id) => { onSetOperationCursor?.(selectedLayerIndex, id); }, ...(documentSourceImageId ? { documentSourceImageId } : {}) }));
                    })(), _jsx(SliceAnchorTracker, { layerIndex: historyPanelLayer, layerCount: layerCount, layerOrder: layerOrder, onUpdate: stableSetSliceAnchor }), _jsx(CameraRig, { animPhase: animPhase, onAnimDone: onAnimDone }), _jsx(OrbitControls, { makeDefault: true, onChange: () => { invalidate(); }, enabled: !animating && !longPressSelected && !dragReorder, target: [0, 0, 0], enableDamping: true, dampingFactor: 0.12, minPolarAngle: 0.05, maxPolarAngle: Math.PI * 0.48, minDistance: 5, maxDistance: 20 })] }), _jsx("button", { type: "button", onClick: toggleChrome, title: shouldShowChrome ? "Hide toolbar" : "Show toolbar", className: `chrome-toggle-btn${shouldShowChrome ? " chrome-toggle-open" : ""}`, children: shouldShowChrome ? "✕" : "☰" }), keyframePreviewUrl && (_jsxs("div", { title: "Keyframe preview (top-down composite)", style: {
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
                }, children: [_jsx("img", { src: keyframePreviewUrl, alt: "Keyframe", style: {
                            width: "100%",
                            height: "100%",
                            objectFit: "contain",
                        } }), _jsx("span", { style: {
                            position: "absolute",
                            bottom: 2,
                            left: 0,
                            right: 0,
                            textAlign: "center",
                            fontSize: 7,
                            color: "var(--hud-muted)",
                            textTransform: "uppercase",
                            letterSpacing: 0.5,
                        }, children: "Keyframe" })] })), viewMode !== "universal" && selectedLayerIndex !== null && getSliceHistory && (() => {
                const graph = getSliceHistory(selectedLayerIndex);
                if (!graph)
                    return null;
                // In layers view: bottom-anchored drawer-handle tab; hide when drawer is open.
                // In minimalist: top-right corner toggle.
                if (viewMode === "layers") {
                    if (historyPanelLayer !== null)
                        return null; // drawer open — its own ✕ handles close
                    return (_jsx("button", { type: "button", onClick: () => { setHistoryPanelLayer(selectedLayerIndex); }, title: "Open AI History drawer", style: {
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
                        }, children: "\u2191 AI History" }));
                }
                return (_jsx("button", { type: "button", onClick: () => { setHistoryPanelLayer(historyPanelLayer === selectedLayerIndex ? null : selectedLayerIndex); }, title: "Open AI History panel", style: {
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
                    }, children: "\uD83D\uDD70 History" }));
            })(), viewMode === "layers" && historyPanelLayer !== null && getSliceHistory && onSetDisplayCursor && onSetOperationCursor && (() => {
                const sliceGraph = getSliceHistory(historyPanelLayer);
                if (!sliceGraph)
                    return null;
                return (_jsx(AIHistoryPanel, { layerIndex: historyPanelLayer, graph: sliceGraph, payloads: payloads, onSetDisplayCursor: onSetDisplayCursor, onSetOperationCursor: onSetOperationCursor, onClose: () => { setHistoryPanelLayer(null); }, documentSourceImageId: documentSourceImageId, style: { right: 260, bottom: 0, borderRadius: "10px 10px 0 0" } }));
            })(), layerCount > 1 && (_jsxs("button", { type: "button", onClick: onToggleSegmentDisplay, title: segmentDisplayMode === "masked" ? "Switch to colored segments" : "Switch to masked original", style: {
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
                }, children: [_jsx("span", { style: { fontSize: 14, lineHeight: 1 }, children: segmentDisplayMode === "masked" ? "🖼" : "🎨" }), segmentDisplayMode === "masked" ? "Masked" : "Colored"] })), showScrubber && (_jsx(LayerScrubber, { layerCount: layerCount, selectedIndex: selectedLayerIndex, layerOrder: layerOrder, onPreview: onPreviewLayer, onCommit: onSelectLayer, onPreviewOrder: onPreviewOrder, onCommitOrder: onCommitOrder, layerThumbnails: layerThumbnails, layerGlbUrls: layerGlbUrls })), showControlsHUD && selectedLayerIndex !== null && (_jsx(LayerControlsHUD, { layerIndex: selectedLayerIndex, isHidden: selectedIsHidden, isSolo: selectedIsSolo, maskActive: maskActive, opacity: persistedOpacity, onToggleHidden: onToggleHidden, onToggleSolo: onToggleSolo, onToggleMask: onToggleMask, onInvertMask: onInvertMask, onPreviewOpacity: onPreviewOpacity, onCommitOpacity: onCommitOpacity, hasImage: selectedLayerIndex in layerTextures, onImportImage: onImportImage, onAiEdit: onAiEdit, aiRunning: aiRunning, aiError: aiError, onAddSlice: onAddSlice, aiEditModelId: aiEditModelId, onChangeAiEditModel: onChangeAiEditModel, onPromptVisibilityChange: wrappedPromptVisibility, onGenerate3D: onGenerate3D, generating3D: generating3DLayer === selectedLayerIndex, has3DModel: selectedLayerIndex in layerGlbUrls, sourceImageHidden: threeDSourceHidden.has(selectedLayerIndex), onToggle3DSourceImage: onToggle3DSourceImage, transformPivot: transformPivot, onSetTransformPivot: setTransformPivot, transformMode: transformMode, onSetTransformMode: setTransformMode, snapEnabled: snapEnabled, onToggleSnap: () => { setSnapEnabled((s) => !s); }, modelTransform: selectedLayerIndex in layerGlbUrls ? modelTransform : undefined, onApplyTransform: handleApplyTransform })), showLayersPanel && (_jsx(LayersPanel, { layerCount: layerCount, order: layerOrder, selectedLayerIndex: selectedLayerIndex, soloIndex: soloIndex, layerVisibility: layerVisibility, isHidden: isHiddenFn, isMaskActive: isMaskActiveFn, isMaskInverted: isMaskInvertedFn, persistedOpacity: persistedOpacityFn, onSelectLayer: onSelectLayer, onToggleHidden: onToggleHidden, onToggleSolo: onToggleSolo, onToggleMask: onToggleMask, onInvertMask: onInvertMask, onPreviewOpacity: onPreviewOpacity, onCommitOpacity: onCommitOpacity, onPreviewOrder: onPreviewOrder, onCommitOrder: onCommitOrder, onImportImage: onImportImage, onAiEdit: onAiEdit, aiRunning: aiRunning, aiError: aiError, onAddSlice: onAddSlice, layerTextures: layerTextures, layerThumbnails: layerThumbnails, aiEditModelId: aiEditModelId, onChangeAiEditModel: onChangeAiEditModel, onGenerate3D: onGenerate3D, generating3DLayer: generating3DLayer, layerGlbUrls: layerGlbUrls, threeDSourceHidden: threeDSourceHidden, onToggle3DSourceImage: onToggle3DSourceImage, transformPivot: transformPivot, onSetTransformPivot: setTransformPivot, transformMode: transformMode, onSetTransformMode: setTransformMode, snapEnabled: snapEnabled, onToggleSnap: () => { setSnapEnabled((s) => !s); }, modelTransform: selectedLayerIndex !== null && selectedLayerIndex in layerGlbUrls ? modelTransform : undefined, onApplyTransform: handleApplyTransform, getSliceHistory: getSliceHistory, onSetDisplayCursor: onSetDisplayCursor, onSetOperationCursor: onSetOperationCursor, payloads: payloads })), viewMode === "minimalist" && (longPressSelected || selectedLayerIndex !== null) && !radialMenu && (_jsx("div", { style: {
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
                }, children: dragReorder && selectedLayerIndex !== null
                    ? _jsxs(_Fragment, { children: [_jsx("span", { style: { fontSize: 14 }, children: "\u21D5" }), " Dragging Layer ", selectedLayerIndex] })
                    : selectedLayerIndex !== null
                        ? _jsxs(_Fragment, { children: [_jsx("span", { style: { fontSize: 14 }, children: "\u25C8" }), " Layer ", selectedLayerIndex, " \u2014 hold for menu"] })
                        : _jsx("span", { style: { color: "var(--hud-muted)" }, children: "long-press for menu" }) })), viewMode === "minimalist" && radialMenu && (_jsx(RadialMenu, { items: radialItems, x: radialMenu.x, y: radialMenu.y, selectedLayerIndex: selectedLayerIndex, onClose: () => { setRadialMenu(null); setLongPressSelected(false); } })), (peekLayers || peekRail) && (_jsx("div", { style: {
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
                }, children: peekLayers ? "Peek: Layers (Tab)" : "Peek: Rail (Shift)" }))] }));
}
