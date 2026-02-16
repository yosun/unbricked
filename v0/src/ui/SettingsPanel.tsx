import React from "react";
import { OPERATIONS } from "../core/operations";
import type { ProjectPreferences } from "../core/preferences";

interface SettingsPanelProps {
  preferences: ProjectPreferences;
  onChangePreference: (key: keyof ProjectPreferences, value: string) => void;
  onClose: () => void;
}

export default function SettingsPanel({
  preferences,
  onChangePreference,
  onClose,
}: SettingsPanelProps): React.JSX.Element {
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        width: 320,
        background: "var(--hud-bg)",
        borderLeft: "1px solid var(--hud-border)",
        color: "var(--hud-text)",
        display: "flex",
        flexDirection: "column",
        zIndex: 50,
        backdropFilter: "blur(12px)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          borderBottom: "1px solid var(--hud-border)",
        }}
      >
        <strong style={{ fontSize: 14 }}>Settings</strong>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "var(--hud-text)",
            cursor: "pointer",
            fontSize: 16,
            padding: "2px 6px",
          }}
        >
          ✕
        </button>
      </div>
      <div style={{ padding: 16, flex: 1, overflowY: "auto" }}>
        <label
          style={{ display: "block", fontSize: 12, color: "var(--hud-muted)", marginBottom: 6 }}
        >
          Default operation for new images
        </label>
        <select
          value={preferences.defaultImageOperationId}
          onChange={(e) => { onChangePreference("defaultImageOperationId", e.target.value); }}
          style={{
            width: "100%",
            padding: "6px 8px",
            background: "#1a1a2e",
            border: "1px solid var(--hud-border-btn)",
            borderRadius: 4,
            color: "var(--hud-text)",
            fontSize: 13,
          }}
        >
          {OPERATIONS.map((op) => (
            <option key={op.id} value={op.id}>
              {op.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
