import React, { useCallback, useEffect, useRef, useState } from "react";
import type { SpaceId, Space } from "../core";

interface SpaceAddressHUDProps {
  currentSpaceId: SpaceId;
  space: Space | undefined;
  origin: SpaceId | null;
  canGoBack: boolean;
  canGoForward: boolean;
  onSetOrigin: (spaceId: SpaceId) => void;
  onReturnToOrigin: () => void;
  onGoBack: () => void;
  onGoForward: () => void;
}

export default function SpaceAddressHUD(props: SpaceAddressHUDProps): React.JSX.Element {
  const {
    currentSpaceId,
    space,
    origin,
    canGoBack,
    canGoForward,
    onSetOrigin,
    onReturnToOrigin,
    onGoBack,
    onGoForward,
  } = props;

  const [expanded, setExpanded] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [copied, setCopied] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!expanded) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    document.addEventListener("pointerdown", handler);
    return () => { document.removeEventListener("pointerdown", handler); };
  }, [expanded]);

  const handleCopyLink = useCallback(() => {
    const url = `${window.location.origin}${window.location.pathname}#${currentSpaceId}`;
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => { setCopied(false); }, 1500);
    });
  }, [currentSpaceId]);

  const handleSetOrigin = useCallback(() => {
    onSetOrigin(currentSpaceId);
    setExpanded(false);
  }, [currentSpaceId, onSetOrigin]);

  const handleReturnToOrigin = useCallback(() => {
    onReturnToOrigin();
    setExpanded(false);
  }, [onReturnToOrigin]);

  const spaceName = space?.name ?? "Space";
  const isOrigin = origin === currentSpaceId;

  return (
    <div
      ref={dropdownRef}
      style={{
        position: "absolute",
        top: 8,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 20,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      {/* Collapsed pill */}
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        {/* Back / Forward buttons */}
        <button
          type="button"
          onClick={onGoBack}
          disabled={!canGoBack}
          title="Return (browser back)"
          style={{
            ...navBtnStyle,
            color: canGoBack ? "var(--scrubber-active)" : "var(--hud-muted)",
            cursor: canGoBack ? "pointer" : "default",
          }}
        >
          ←
        </button>

        <button
          type="button"
          onClick={() => { setExpanded((v) => !v); }}
          style={{
            background: "var(--hud-bg)",
            border: "1px solid var(--hud-border)",
            color: "var(--hud-text)",
            padding: "4px 14px",
            borderRadius: 20,
            cursor: "pointer",
            fontSize: 12,
            display: "flex",
            alignItems: "center",
            gap: 6,
            letterSpacing: 0.5,
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
          }}
        >
          <span style={{ fontSize: 14, color: "var(--scrubber-active)" }}>◈</span>
          <span>{spaceName}</span>
          {isOrigin && (
            <span
              title="Origin"
              style={{ fontSize: 10, color: "var(--scrubber-active)", marginLeft: 2 }}
            >
              ⌂
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={onGoForward}
          disabled={!canGoForward}
          title="Re-enter (browser forward)"
          style={{
            ...navBtnStyle,
            color: canGoForward ? "var(--scrubber-active)" : "var(--hud-muted)",
            cursor: canGoForward ? "pointer" : "default",
          }}
        >
          →
        </button>
      </div>

      {/* Expanded dropdown */}
      {expanded && (
        <div
          style={{
            marginTop: 6,
            background: "var(--hud-bg)",
            border: "1px solid var(--hud-border)",
            borderRadius: 8,
            padding: "8px 0",
            minWidth: 220,
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
          }}
        >
          {/* Current space info */}
          <div style={{ padding: "4px 14px 8px", borderBottom: "1px solid var(--hud-border)" }}>
            <div style={{ fontSize: 11, color: "var(--hud-muted)", marginBottom: 2 }}>
              Current Space
            </div>
            <div style={{ fontSize: 13, color: "#eee" }}>{spaceName}</div>
            {advanced && (
              <div style={{ fontSize: 10, color: "var(--hud-muted)", marginTop: 4, wordBreak: "break-all" }}>
                {currentSpaceId}
              </div>
            )}
          </div>

          {/* Actions */}
          <DropdownItem
            label={copied ? "Copied!" : "Copy link"}
            icon="🔗"
            onClick={handleCopyLink}
          />
          <DropdownItem
            label="Set as origin"
            icon="⌂"
            onClick={handleSetOrigin}
            disabled={isOrigin}
          />
          <DropdownItem
            label="Return to origin"
            icon="↩"
            onClick={handleReturnToOrigin}
            disabled={!origin || isOrigin}
          />

          <div style={{ borderTop: "1px solid var(--hud-border)", margin: "4px 0" }} />

          <DropdownItem
            label={advanced ? "Hide advanced" : "Show advanced"}
            icon="⚙"
            onClick={() => { setAdvanced((v) => !v); }}
          />

          {advanced && (
            <div style={{ padding: "6px 14px" }}>
              <div style={{ fontSize: 10, color: "var(--hud-muted)", marginBottom: 2 }}>
                URL
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: "#aaa",
                  wordBreak: "break-all",
                  background: "rgba(0,0,0,0.3)",
                  padding: "4px 6px",
                  borderRadius: 4,
                  userSelect: "all",
                }}
              >
                {window.location.href}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Internal components ──────────────────────────── */

const navBtnStyle: React.CSSProperties = {
  background: "var(--hud-bg)",
  border: "1px solid var(--hud-border)",
  padding: "4px 8px",
  borderRadius: 12,
  fontSize: 13,
  backdropFilter: "blur(10px)",
  WebkitBackdropFilter: "blur(10px)",
};

function DropdownItem(props: {
  label: string;
  icon: string;
  onClick: () => void;
  disabled?: boolean;
}): React.JSX.Element {
  const { label, icon, onClick, disabled } = props;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        padding: "6px 14px",
        background: "transparent",
        border: "none",
        color: disabled ? "var(--hud-muted)" : "var(--hud-text)",
        cursor: disabled ? "default" : "pointer",
        fontSize: 12,
        textAlign: "left",
      }}
      onMouseEnter={(e) => {
        if (!disabled) (e.currentTarget.style.background = "rgba(255,255,255,0.06)");
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <span style={{ fontSize: 13, width: 18, textAlign: "center" }}>{icon}</span>
      {label}
    </button>
  );
}
