import React, { useState } from "react";
import type { SliceHistoryGraph, StateNode } from "../core/history/aiHistorySchema";
import type { PayloadId } from "../core/types";
import { getSeedPathIds, getPathHeadStateId, getAncestryPath, getChildStates } from "../core/history/historyGraph";

export interface AIHistoryPanelProps {
  /** Which layer index this panel shows history for */
  layerIndex: number;
  /** User-assigned layer name, if any */
  layerName?: string | undefined;
  graph: SliceHistoryGraph;
  payloads?: Record<string, { uri: string; meta: Record<string, string> }> | undefined;
  onSetDisplayCursor: (layerIndex: number, stateId: string) => void;
  onSetOperationCursor: (layerIndex: number, stateId: string) => void;
  onClose: () => void;
  /** Document-level source image id (project-level, separate from slice root). */
  documentSourceImageId?: PayloadId | undefined;
  /** Override any CSS properties on the panel's root container (e.g. right/bottom offsets). */
  style?: React.CSSProperties;
}

/**
 * Universal AI History panel — shows per-slice DAG for the selected layer.
 * Layout: left anchor (Root + Current), right side (N seed path lanes).
 */
export default function AIHistoryPanel({
  layerIndex,
  layerName,
  graph,
  payloads,
  onSetDisplayCursor,
  onSetOperationCursor,
  onClose,
  documentSourceImageId,
  style: containerStyle,
}: AIHistoryPanelProps): React.JSX.Element {
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  const [thumbSize, setThumbSize] = useState(48);

  const seedPaths = getSeedPathIds(graph);
  const rootNode = graph.states[graph.rootStateId];

  // Thumbnail helper — resolve from node asset refs
  const thumbUrl = (node: StateNode | undefined): string | null => {
    if (!node) return null;
    const pid = node.assetRefs.thumb ?? node.assetRefs.image;
    if (!pid || !payloads) return null;
    return payloads[pid]?.uri ?? null;
  };

  // Resolve document source image URI
  const sourceImageUrl: string | null =
    documentSourceImageId && payloads
      ? (payloads[documentSourceImageId]?.uri ?? null)
      : null;

  // Station label derived from the parent op edge
  const stationLabel = (node: StateNode): string => {
    const op = node.parentOpId ? graph.ops[node.parentOpId] : undefined;
    const opType = op?.opType ?? node.meta.opType;
    const model = op?.summary?.model;
    return [opType, model].filter(Boolean).join(" · ");
  };

  // Cursor badges
  const cursorBadges = (stateId: string): React.ReactNode => (
    <>
      {stateId === graph.displayStateId && (
        <span style={{ position: "absolute", top: 0, right: 1, fontSize: 8 }}>👁</span>
      )}
      {stateId === graph.operationStateId && (
        <span style={{ position: "absolute", bottom: 0, right: 1, fontSize: 8 }}>⚙</span>
      )}
    </>
  );

  // Thumbnail box with optional ⚙ gear overlay
  const ThumbBox = ({
    node,
    size = 48,
    active = false,
    onClick,
    onSetOperationCursor: onGear,
    label,
    children,
    imgUrl,
  }: {
    node?: StateNode | undefined;
    size?: number;
    active?: boolean;
    onClick?: () => void;
    onSetOperationCursor?: () => void;
    label?: string;
    children?: React.ReactNode;
    /** Override image URL (e.g. for document source image). */
    imgUrl?: string | null;
  }): React.JSX.Element => {
    const url = imgUrl !== undefined ? imgUrl : thumbUrl(node);
    const has3D = !!node?.assetRefs.glb;
    return (
      <div style={{ textAlign: "center", flexShrink: 0 }}>
        <div
          onClick={onClick}
          style={{
            width: size,
            height: size,
            borderRadius: "50%",
            overflow: "hidden",
            border: active ? "2px solid var(--scrubber-active)" : "1px solid var(--hud-border-btn)",
            cursor: onClick ? "pointer" : "default",
            position: "relative",
            background: "var(--hud-active)",
          }}
        >
          {url && (
            <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", background: "var(--hud-active)" }} />
          )}
          {node && cursorBadges(node.stateId)}
          {has3D && (
            <span style={{
              position: "absolute",
              top: 1,
              left: 1,
              fontSize: 6,
              fontWeight: 700,
              lineHeight: "10px",
              padding: "0 3px",
              borderRadius: 3,
              background: "#2299ff",
              color: "#fff",
            }}>3D</span>
          )}
          {children}
          {/* ⚙ gear overlay — bottom-left, hover-visible */}
          {onGear && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onGear(); }}
              title="Use as input for next AI op"
              className="ai-history-gear"
              style={{
                position: "absolute",
                bottom: 1,
                left: 1,
                width: 14,
                height: 14,
                borderRadius: 3,
                border: "none",
                background: "rgba(0,0,0,0.55)",
                color: "#fff",
                fontSize: 8,
                lineHeight: "14px",
                textAlign: "center",
                cursor: "pointer",
                padding: 0,
                opacity: 0,
                transition: "opacity 0.12s",
              }}
            >
              ⚙
            </button>
          )}
        </div>
        {label && (
          <div style={{ fontSize: 7, color: "var(--hud-muted)", marginTop: 2, maxWidth: size, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {label}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      style={{
        position: "absolute",
        left: 12,
        right: 12,
        bottom: 12,
        height: 240,
        borderRadius: 10,
        background: "var(--hud-bg)",
        border: "1px solid var(--hud-border)",
        zIndex: 12,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        backdropFilter: "blur(12px)",
        ...containerStyle,
      }}
      /* Show ⚙ gear on hover over any ThumbBox */
      onMouseOver={(e) => {
        const target = (e.target as HTMLElement).closest(".ai-history-gear");
        if (!target) return;
        (target as HTMLElement).style.opacity = "1";
      }}
    >
      {/* Inline style for hover — gear buttons become visible when parent is hovered */}
      <style>{`.ai-history-gear { opacity: 0 !important; } div:hover > .ai-history-gear { opacity: 1 !important; }`}</style>

      {/* Header row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          borderBottom: "1px solid var(--hud-border)",
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 10, fontWeight: 600, color: "var(--hud-text)", textTransform: "uppercase", letterSpacing: 0.8 }}>
          AI History — {layerName ?? `Layer ${String(layerIndex)}`}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 9, color: "var(--hud-muted)" }}>
          {Object.keys(graph.ops).length} op{Object.keys(graph.ops).length !== 1 ? "s" : ""} · {seedPaths.length} path{seedPaths.length !== 1 ? "s" : ""}
        </span>
        <input
          type="range"
          min={28}
          max={96}
          step={4}
          value={thumbSize}
          onChange={(e) => { setThumbSize(Number(e.target.value)); }}
          title={`Thumbnail size: ${String(thumbSize)}px`}
          style={{ width: 50, height: 12, accentColor: "var(--scrubber-active)", cursor: "pointer" }}
        />
        <button
          type="button"
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "var(--hud-muted)",
            cursor: "pointer",
            fontSize: 14,
            padding: "0 4px",
          }}
        >
          ✕
        </button>
      </div>

      {/* Main content: left anchors + right seed lanes */}
      <div style={{ flex: 1, display: "flex", gap: 0, minHeight: 0, overflow: "hidden" }}>
        {/* Left anchor: Source Image + Slice Root */}
        <div
          style={{
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
            padding: "10px 14px",
            borderRight: "1px solid var(--hud-border)",
          }}
        >
          {/* Two anchors side-by-side */}
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            {/* Document Source Image — visually inert */}
            <ThumbBox
              size={thumbSize}
              imgUrl={sourceImageUrl}
              label="Source Image"
            />
            {/* Slice Root — clickable */}
            <ThumbBox
              node={rootNode}
              size={thumbSize}
              active={graph.displayStateId === graph.rootStateId}
              onClick={() => { onSetDisplayCursor(layerIndex, graph.rootStateId); }}
              onSetOperationCursor={() => { onSetOperationCursor(layerIndex, graph.rootStateId); }}
              label="Slice Root"
            />
          </div>
        </div>

        {/* Right: seed path lanes (subway lines) */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 10px" }}>
          {seedPaths.length === 0 ? (
            <div style={{ fontSize: 10, color: "var(--hud-muted)", padding: 12, textAlign: "center" }}>
              No AI operations yet. Run an AI edit to create seed paths.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {seedPaths.map((pathId, pathIdx) => {
                const headId = getPathHeadStateId(graph, pathId);
                const isExpanded = expandedPath === pathId;

                // Get full path for this seed lane
                const pathAncestry = getAncestryPath(graph, headId);
                // Skip root (first element) for display
                const pathNodes = pathAncestry.slice(1);
                // Is the current display state on this path?
                const displayNode = graph.states[graph.displayStateId];
                const pathForDisplay = displayNode?.seedPathId === pathId;

                return (
                  <div key={pathId}>
                    {/* Path header */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        marginBottom: 4,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 8,
                          fontWeight: 700,
                          color: pathForDisplay ? "var(--scrubber-active)" : "var(--hud-muted)",
                          textTransform: "uppercase",
                          letterSpacing: 0.5,
                        }}
                      >
                        Path {pathIdx + 1} ({pathNodes.length} op{pathNodes.length !== 1 ? "s" : ""})
                      </span>
                      {pathForDisplay && (
                        <span style={{ fontSize: 7, color: "var(--scrubber-active)" }}>● active</span>
                      )}
                      <button
                        type="button"
                        onClick={() => { setExpandedPath(isExpanded ? null : pathId); }}
                        style={{
                          background: "none",
                          border: "none",
                          color: "var(--hud-muted)",
                          cursor: "pointer",
                          fontSize: 9,
                          padding: "0 2px",
                        }}
                      >
                        {isExpanded ? "▼" : "▶"}
                      </button>
                    </div>

                    {/* Compact: row of station thumbnails */}
                    {!isExpanded && (
                      <div style={{ display: "flex", gap: 4, overflowX: "auto", paddingBottom: 2 }}>
                        {pathNodes.map((stateId) => {
                          const node = graph.states[stateId];
                          if (!node) return null;
                          const isDisplay = stateId === graph.displayStateId;
                          const lbl = stationLabel(node);
                          return (
                            <ThumbBox
                              key={stateId}
                              node={node}
                              size={Math.round(thumbSize * 0.75)}
                              active={isDisplay}
                              onClick={() => { onSetDisplayCursor(layerIndex, stateId); }}
                              onSetOperationCursor={() => { onSetOperationCursor(layerIndex, stateId); }}
                            >
                              {lbl && (
                                <span style={{
                                  position: "absolute", bottom: 0, left: 0, right: 0,
                                  fontSize: 5, textAlign: "center",
                                  background: "rgba(0,0,0,0.6)", color: "#fff",
                                  lineHeight: "8px",
                                }}>
                                  {lbl}
                                </span>
                              )}
                            </ThumbBox>
                          );
                        })}
                      </div>
                    )}

                    {/* Expanded: detailed station list */}
                    {isExpanded && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 3, paddingLeft: 4 }}>
                        {pathNodes.map((stateId) => {
                          const node = graph.states[stateId];
                          if (!node) return null;
                          const isDisplay = stateId === graph.displayStateId;
                          const lbl = stationLabel(node);
                          // Children count for branching indicator
                          const children = getChildStates(graph, stateId);
                          return (
                            <div
                              key={stateId}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                                padding: "3px 4px",
                                borderRadius: 4,
                                background: isDisplay ? "var(--hud-active)" : "transparent",
                                cursor: "pointer",
                              }}
                              onClick={() => { onSetDisplayCursor(layerIndex, stateId); }}
                            >
                              <ThumbBox
                                node={node}
                                size={Math.round(thumbSize * 0.67)}
                                active={isDisplay}
                                onSetOperationCursor={() => { onSetOperationCursor(layerIndex, stateId); }}
                              />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{
                                  fontSize: 10,
                                  color: isDisplay ? "var(--scrubber-active)" : "var(--hud-text)",
                                  fontWeight: isDisplay ? 600 : 400,
                                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                }}>
                                  {lbl || node.meta.label}
                                </div>
                                <div style={{ fontSize: 8, color: "var(--hud-muted)", display: "flex", gap: 4 }}>
                                  {children.length > 1 && <span>({children.length} branches)</span>}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
