import React from "react";
import type { ViewMode } from "./ViewMode";

interface ViewModeSwitcherProps {
  current: ViewMode;
  onChange: (mode: ViewMode) => void;
}

const MODES: Array<{ mode: ViewMode; label: string; key: string; icon: string }> = [
  { mode: "universal", label: "Universal", key: "1", icon: "◈" },
  { mode: "layers", label: "Layers", key: "2", icon: "☰" },
  { mode: "minimalist", label: "Minimal", key: "3", icon: "◯" },
];

export default function ViewModeSwitcher(props: ViewModeSwitcherProps): React.JSX.Element {
  const { current, onChange } = props;

  return (
    <div
      style={{
        display: "flex",
        gap: 2,
        background: "rgba(0,0,0,0.35)",
        borderRadius: 6,
        padding: 2,
      }}
    >
      {MODES.map(({ mode, label, key, icon }) => {
        const active = current === mode;
        return (
          <button
            key={mode}
            type="button"
            onClick={() => { onChange(mode); }}
            title={`${label} (${key})`}
            style={{
              background: active ? "var(--hud-active)" : "transparent",
              border: active
                ? "1px solid var(--hud-border-btn)"
                : "1px solid transparent",
              color: active ? "var(--scrubber-active)" : "#888",
              padding: "3px 8px",
              borderRadius: 4,
              cursor: "pointer",
              fontSize: 13,
              display: "flex",
              alignItems: "center",
              gap: 4,
              transition: "all 0.15s",
            }}
          >
            <span style={{ fontSize: 14 }}>{icon}</span>
            <span style={{ fontSize: 11 }}>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
