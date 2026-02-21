import { useEffect, useRef } from "react";
import { useThree, useFrame, invalidate } from "@react-three/fiber";
import { Vector3 } from "three";
/* ── Presets ─────────────────────────────────────── */
/** Top-down (2D-ish): camera directly above origin — perfectly flat. */
const TOP_DOWN = new Vector3(0, 10, 0);
/** Isometric-ish orbit position. */
const ISO = new Vector3(6, 5, 6);
/** Default up vector (Y-up). */
const DEFAULT_UP = new Vector3(0, 1, 0);
/** Up vector for the top-down singularity (camera on Y axis, so "up" = +Z). */
const TOP_DOWN_UP = new Vector3(0, 0, -1);
const EASE_FACTOR = 2.5; // higher = faster convergence
const DONE_THRESHOLD = 0.02; // distance at which animation is "done"
/**
 * CameraRig — lives inside the R3F Canvas.
 *
 * - "intro": eases camera from TOP_DOWN → ISO on mount.
 * - "reset": eases camera from current position → TOP_DOWN, then → ISO.
 * - "idle": no animation; OrbitControls has full authority.
 *
 * Any pointer-down or wheel event on the canvas cancels the animation
 * immediately and hands control back to OrbitControls.
 */
export default function CameraRig(props) {
    const { animPhase, onAnimDone } = props;
    const { camera, gl } = useThree();
    const targetPos = useRef(new Vector3());
    const targetUp = useRef(new Vector3());
    const resetMidReached = useRef(false);
    // Resolve the target position whenever animPhase changes.
    useEffect(() => {
        resetMidReached.current = false;
        if (animPhase === "intro") {
            // Snap camera to perfectly flat top-down, then animate toward iso.
            camera.position.copy(TOP_DOWN);
            camera.up.copy(TOP_DOWN_UP);
            camera.lookAt(0, 0, 0);
            targetPos.current.copy(ISO);
            targetUp.current.copy(DEFAULT_UP);
        }
        else if (animPhase === "reset") {
            // First animate toward top-down, then back to iso.
            targetPos.current.copy(TOP_DOWN);
            targetUp.current.copy(TOP_DOWN_UP);
        }
        else if (animPhase === "toTopDown") {
            targetPos.current.copy(TOP_DOWN);
            targetUp.current.copy(TOP_DOWN_UP);
        }
        else if (animPhase === "toIso") {
            targetPos.current.copy(ISO);
            targetUp.current.copy(DEFAULT_UP);
        }
        else if (animPhase === "spaceTransition") {
            // Dolly in toward origin, then reset to ISO (like "reset" but faster)
            targetPos.current.set(0, 3, 0);
            targetUp.current.copy(TOP_DOWN_UP);
        }
    }, [animPhase, camera]);
    // Cancel animation on any user interaction (pointer or wheel).
    useEffect(() => {
        if (animPhase === "idle")
            return;
        const cancel = () => {
            // Restore default up so OrbitControls isn't confused.
            camera.up.copy(DEFAULT_UP);
            onAnimDone();
        };
        const dom = gl.domElement;
        dom.addEventListener("pointerdown", cancel);
        dom.addEventListener("wheel", cancel);
        return () => {
            dom.removeEventListener("pointerdown", cancel);
            dom.removeEventListener("wheel", cancel);
        };
    }, [animPhase, gl, onAnimDone]);
    // Per-frame easing.
    useFrame((_, delta) => {
        if (animPhase === "idle")
            return;
        const alpha = 1 - Math.exp(-EASE_FACTOR * delta);
        camera.position.lerp(targetPos.current, alpha);
        camera.up.lerp(targetUp.current, alpha).normalize();
        camera.lookAt(0, 0, 0);
        invalidate();
        const dist = camera.position.distanceTo(targetPos.current);
        if (animPhase === "intro" || animPhase === "toIso") {
            if (dist < DONE_THRESHOLD) {
                camera.position.copy(ISO);
                camera.up.copy(DEFAULT_UP);
                camera.lookAt(0, 0, 0);
                onAnimDone();
            }
        }
        else if (animPhase === "toTopDown") {
            if (dist < DONE_THRESHOLD) {
                camera.position.copy(TOP_DOWN);
                camera.up.copy(TOP_DOWN_UP);
                camera.lookAt(0, 0, 0);
                onAnimDone();
            }
        }
        else if (animPhase === "spaceTransition") {
            // Two-phase: dolly in → reset to iso
            if (!resetMidReached.current) {
                if (dist < DONE_THRESHOLD) {
                    resetMidReached.current = true;
                    targetPos.current.copy(ISO);
                    targetUp.current.copy(DEFAULT_UP);
                }
            }
            else {
                if (dist < DONE_THRESHOLD) {
                    camera.position.copy(ISO);
                    camera.up.copy(DEFAULT_UP);
                    camera.lookAt(0, 0, 0);
                    onAnimDone();
                }
            }
        }
        else {
            // animPhase === "reset"
            if (!resetMidReached.current) {
                // Phase 1: fly to top-down
                if (dist < DONE_THRESHOLD) {
                    camera.position.copy(TOP_DOWN);
                    camera.up.copy(TOP_DOWN_UP);
                    camera.lookAt(0, 0, 0);
                    resetMidReached.current = true;
                    targetPos.current.copy(ISO);
                    targetUp.current.copy(DEFAULT_UP);
                }
            }
            else {
                // Phase 2: fly back to iso
                if (dist < DONE_THRESHOLD) {
                    camera.position.copy(ISO);
                    camera.up.copy(DEFAULT_UP);
                    camera.lookAt(0, 0, 0);
                    onAnimDone();
                }
            }
        }
    });
    return null;
}
