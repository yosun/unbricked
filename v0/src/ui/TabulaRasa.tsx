import React, { useEffect, useState } from "react";

interface TabulaRasaProps {
  onTap: () => void;
}

/**
 * Tabula Rasa — the blank-slate start state.
 * Shows a blinking unbrick-cube cursor and "Tap to begin." hint.
 */
export default function TabulaRasa({ onTap }: TabulaRasaProps): React.JSX.Element {
  const [visible, setVisible] = useState(true);

  // Blink the cursor
  useEffect(() => {
    const id = setInterval(() => { setVisible((v) => !v); }, 600);
    return () => { clearInterval(id); };
  }, []);

  return (
    <div
      onClick={onTap}
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        zIndex: 90,
        userSelect: "none",
      }}
    >
      {/* Unbrick cube cursor */}
      <div
        style={{
          width: 32,
          height: 32,
          border: "2px solid var(--scrubber-active)",
          borderRadius: 4,
          opacity: visible ? 0.9 : 0.15,
          transition: "opacity 0.15s ease",
          marginBottom: 16,
          boxShadow: visible ? "0 0 12px var(--shadow-medium)" : "none",
        }}
      />
      <span
        style={{
          color: "var(--hud-muted)",
          fontSize: 14,
          letterSpacing: 0.5,
        }}
      >
        Tap to begin.
      </span>
    </div>
  );
}
