import React, { useEffect, useRef, useState } from "react";

interface SlicingOverlayProps {
  imageUrl: string;
  label: string;
}

/** Simulated progress that decelerates as it approaches 90%. */
function useSimulatedProgress(): number {
  const [progress, setProgress] = useState(0);
  const startRef = useRef(Date.now());

  useEffect(() => {
    let raf: number;
    const tick = (): void => {
      const elapsed = (Date.now() - startRef.current) / 1000;
      // Fast start, asymptotic approach to ~92%
      const p = Math.min(0.92, 1 - 1 / (1 + elapsed * 0.35));
      setProgress(p);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return progress;
}

/** Generate N sparkle positions (deterministic per mount). */
function makeSparkles(count: number): { x: number; y: number; delay: number; size: number }[] {
  const out: { x: number; y: number; delay: number; size: number }[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      x: ((i * 37 + 13) % 100),
      y: ((i * 53 + 7) % 100),
      delay: (i * 0.3) % 2.4,
      size: 2 + (i % 3),
    });
  }
  return out;
}

const SPARKLES = makeSparkles(12);

/**
 * Full-viewport overlay shown during the initial slicing operation.
 * Displays the ingested image with magical glow effects, a scanning line,
 * floating sparkles, and a progress bar.
 */
export default function SlicingOverlay({
  imageUrl,
  label,
}: SlicingOverlayProps): React.JSX.Element {
  const progress = useSimulatedProgress();
  const pct = Math.round(progress * 100);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--overlay-bg)",
        zIndex: 70,
        pointerEvents: "none",
        animation: "slicingFadeIn 0.3s ease-out",
      }}
    >
      {/* Glowing image container */}
      <div
        style={{
          position: "relative",
          maxWidth: "60%",
          maxHeight: "60%",
        }}
      >
        {/* Color-shifting glow layer */}
        <div
          style={{
            position: "absolute",
            inset: -24,
            borderRadius: 20,
            opacity: 0.5,
            filter: "blur(40px)",
            animation: "slicingColorShift 4s ease-in-out infinite",
            background: "linear-gradient(135deg, #0077aa, #7c3aed, #06b6d4)",
            backgroundSize: "200% 200%",
          }}
        />

        {/* Secondary orbiting glow */}
        <div
          style={{
            position: "absolute",
            inset: -8,
            borderRadius: 14,
            opacity: 0.3,
            filter: "blur(20px)",
            animation: "slicingColorShift 4s ease-in-out infinite reverse",
            background: "linear-gradient(315deg, #06b6d4, #a855f7, #0077aa)",
            backgroundSize: "200% 200%",
          }}
        />

        {/* Image with subtle breathing scale */}
        <img
          src={imageUrl}
          alt=""
          style={{
            position: "relative",
            display: "block",
            maxWidth: "100%",
            maxHeight: "55vh",
            borderRadius: 8,
            animation: "slicingBreathe 3s ease-in-out infinite",
          }}
        />

        {/* Scanning line */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 8,
            overflow: "hidden",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              height: 2,
              background: "linear-gradient(90deg, transparent, rgba(120,200,255,0.9), rgba(168,85,247,0.7), transparent)",
              boxShadow: "0 0 20px 4px rgba(120,200,255,0.4), 0 0 60px 8px rgba(168,85,247,0.2)",
              animation: "slicingScanLine 2.5s ease-in-out infinite",
            }}
          />
        </div>

        {/* Sparkle particles */}
        {SPARKLES.map((s, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${String(s.x)}%`,
              top: `${String(s.y)}%`,
              width: s.size,
              height: s.size,
              borderRadius: "50%",
              background: "white",
              boxShadow: `0 0 ${String(s.size * 2)}px ${String(s.size)}px rgba(168,85,247,0.6)`,
              animation: `slicingSparkle 2.4s ease-in-out ${String(s.delay)}s infinite`,
              pointerEvents: "none",
            }}
          />
        ))}
      </div>

      {/* Progress bar */}
      <div
        style={{
          marginTop: 28,
          width: "min(320px, 50%)",
          height: 4,
          borderRadius: 2,
          background: "rgba(255,255,255,0.08)",
          overflow: "hidden",
          position: "relative",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${String(pct)}%`,
            borderRadius: 2,
            background: "linear-gradient(90deg, #0077aa, #7c3aed, #06b6d4)",
            backgroundSize: "200% 100%",
            animation: "slicingProgressShimmer 2s linear infinite",
            transition: "width 0.3s ease-out",
            boxShadow: "0 0 8px rgba(124,58,237,0.5), 0 0 20px rgba(6,182,212,0.3)",
          }}
        />
      </div>

      {/* Status label */}
      <div
        style={{
          marginTop: 14,
          display: "flex",
          alignItems: "center",
          gap: 10,
          color: "rgba(255,255,255,0.7)",
          fontSize: 13,
          letterSpacing: 1,
          fontWeight: 500,
          textTransform: "uppercase",
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: 12,
            height: 12,
            border: "2px solid rgba(168,85,247,0.7)",
            borderTopColor: "rgba(6,182,212,0.9)",
            borderRadius: "50%",
            animation: "opSpin 0.8s linear infinite",
          }}
        />
        <span>{label}</span>
      </div>
    </div>
  );
}
