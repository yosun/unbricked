// src/slice8/SpaceAddressHUD.tsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import type { SpaceId, Space } from "../core";
import { useSpaceNav } from "./useSpaceNav";
import { shortSpaceLabel } from "./spaceNav";

interface SpaceAddressHUDProps {
  /** Fallback space ID used when URL hash has no space (typically rootSpaceId). */
  fallbackSpaceId: SpaceId;
  /** Map of all spaces so we can resolve names. */
  spaces: Record<SpaceId, Space>;
}

export default function SpaceAddressHUD(props: SpaceAddressHUDProps): React.JSX.Element {
  const { fallbackSpaceId, spaces } = props;
  const nav = useSpaceNav(fallbackSpaceId);
  const { current, origin, advanced } = nav;

  const [expanded, setExpanded] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
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
    return () => {
      document.removeEventListener("pointerdown", handler);
    };
  }, [expanded]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast(null);
    }, 1500);
  }, []);

  const handleCopyLink = useCallback(() => {
    void nav.copyLink(current).then(() => {
      showToast("Link copied");
    });
  }, [nav, current, showToast]);

  const handleSetOrigin = useCallback(() => {
    nav.setOrigin(current);
    showToast("Origin set");
    setExpanded(false);
  }, [nav, current, showToast]);

  const handleGoOrigin = useCallback(() => {
    void nav.goOrigin();
    setExpanded(false);
  }, [nav]);

  const space = spaces[current];
  const pillLabel = shortSpaceLabel(current);
  const spaceName = space?.name ?? pillLabel;
  const isOrigin = origin === current;
  const isRoot = current === fallbackSpaceId;

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
        pointerEvents: "none",
      }}
    >
      {/* Pill */}
      <button
        type="button"
        onClick={() => {
          setExpanded((v) => !v);
        }}
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
          pointerEvents: "auto",
        }}
      >
        <span style={{ fontSize: 14, color: "var(--scrubber-active)" }}>◈</span>
        <span>{pillLabel}</span>
        {isOrigin && (
          <span
            title="Origin"
            style={{ fontSize: 10, color: "var(--scrubber-active)", marginLeft: 2 }}
          >
            ⌂
          </span>
        )}
        <span style={{ fontSize: 10, color: "var(--hud-muted)", marginLeft: 2 }}>▾</span>
      </button>

      {/* Dropdown */}
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
            pointerEvents: "auto",
          }}
        >
          {/* Current space info */}
          <div
            style={{
              padding: "4px 14px 8px",
              borderBottom: "1px solid var(--hud-border)",
            }}
          >
            <div style={{ fontSize: 11, color: "var(--hud-muted)", marginBottom: 2 }}>
              Current Space
            </div>
            <div style={{ fontSize: 13, color: "#eee" }}>{spaceName}</div>
            {isRoot && (
              <div style={{ fontSize: 10, color: "var(--scrubber-active)", marginTop: 2 }}>
                Root Space
              </div>
            )}
            {advanced && (
              <div
                style={{
                  fontSize: 10,
                  color: "var(--hud-muted)",
                  marginTop: 4,
                  wordBreak: "break-all",
                }}
              >
                {current}
              </div>
            )}
          </div>

          {/* Actions */}
          <DropdownItem label="Copy link to this Space" icon="🔗" onClick={handleCopyLink} />
          <DropdownItem
            label="Set as origin"
            icon="⌂"
            onClick={handleSetOrigin}
            disabled={isOrigin}
          />
          <DropdownItem
            label="Return to origin"
            icon="↩"
            onClick={handleGoOrigin}
            disabled={isOrigin}
          />

          <div style={{ borderTop: "1px solid var(--hud-border)", margin: "4px 0" }} />

          {/* Advanced toggle */}
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 14px",
              fontSize: 12,
              color: "var(--hud-text)",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={advanced}
              onChange={(e) => {
                nav.toggleAdvanced(e.target.checked);
              }}
              style={{ margin: 0, accentColor: "var(--scrubber-active)" }}
            />
            Advanced
          </label>

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

      {/* Toast */}
      {toast && (
        <div
          style={{
            marginTop: 6,
            background: "rgba(22,22,42,0.95)",
            border: "1px solid var(--hud-border)",
            borderRadius: 6,
            padding: "4px 12px",
            fontSize: 11,
            color: "var(--scrubber-active)",
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

/* ── Internal component ──────────────────────────── */

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
        e.currentTarget.style.background = "rgba(0, 0, 0, 0.06)";
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
