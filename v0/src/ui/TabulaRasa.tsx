import React, { useCallback, useEffect, useState } from "react";

interface TabulaRasaProps {
  onTap: () => void;
}

/**
 * Tabula Rasa — the cosmological root state.
 * A minimal, centered opening message before the first node is created.
 */
export default function TabulaRasa({ onTap }: TabulaRasaProps): React.JSX.Element {
  const [phase, setPhase] = useState<"in" | "visible" | "out" | "gone">("in");

  // Fade in on mount
  useEffect(() => {
    const id = requestAnimationFrame(() => { setPhase("visible"); });
    return () => { cancelAnimationFrame(id); };
  }, []);

  const handleClick = useCallback(() => {
    if (phase === "out" || phase === "gone") return;
    setPhase("out");
    setTimeout(() => {
      setPhase("gone");
      onTap();
    }, 150);
  }, [phase, onTap]);

  if (phase === "gone") return <></>;

  return (
    <div
      className="tabula-rasa"
      onClick={handleClick}
      style={{
        opacity: phase === "visible" ? 1 : 0,
      }}
    >
      <div className="tabula-rasa-content">
        <p className="tabula-rasa-line1">Unbricked</p>
        <p className="tabula-rasa-line2">The unexamined brick is not worth editing.</p>
        <p className="tabula-rasa-line3">Tap to begin.</p>
      </div>
    </div>
  );
}
