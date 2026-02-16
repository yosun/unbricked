import React from "react";
import type { Edge, Space, SpaceId } from "../core";

interface PortalOverlayProps {
  portalEdges: Edge[];
  spaces: Record<SpaceId, Space>;
  onEnter: (spaceId: SpaceId) => void;
}

/**
 * Bottom-right overlay listing portal edges from the current space.
 * Each portal shows an "↳ Enter" button that navigates into the target space.
 */
export default function PortalOverlay(props: PortalOverlayProps): React.JSX.Element | null {
  const { portalEdges, spaces, onEnter } = props;

  if (portalEdges.length === 0) return null;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 16,
        right: 16,
        zIndex: 15,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        maxHeight: "40%",
        overflowY: "auto",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: "var(--hud-muted)",
          letterSpacing: 1,
          textTransform: "uppercase",
          paddingBottom: 2,
        }}
      >
        Portals
      </div>
      {portalEdges.map((edge) => {
        const target = spaces[edge.to];
        const name = target?.name ?? edge.to;
        return (
          <div
            key={edge.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "var(--hud-bg)",
              border: "1px solid var(--hud-border)",
              borderRadius: 6,
              padding: "5px 10px",
              backdropFilter: "blur(10px)",
              WebkitBackdropFilter: "blur(10px)",
              pointerEvents: "auto",
            }}
          >
            <span style={{ fontSize: 12, color: "var(--hud-text)", flex: 1 }}>
              {name}
            </span>
            <button
              type="button"
              onClick={() => { onEnter(edge.to); }}
              style={{
                background: "rgba(126, 200, 227, 0.15)",
                border: "1px solid rgba(126, 200, 227, 0.3)",
                color: "var(--scrubber-active)",
                padding: "3px 10px",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 11,
                whiteSpace: "nowrap",
              }}
            >
              ↳ Enter
            </button>
          </div>
        );
      })}
    </div>
  );
}
