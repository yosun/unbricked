import React, { useState } from "react";
import type { OperationProgress } from "../services/operationRunner";

interface OperationProgressHUDProps {
  progress: OperationProgress;
  operationLabel: string;
  onRetry?: () => void;
  onDismiss?: () => void;
}

export default function OperationProgressHUD({
  progress,
  operationLabel,
  onRetry,
  onDismiss,
}: OperationProgressHUDProps): React.JSX.Element | null {
  const [copied, setCopied] = useState(false);

  const isSucceeded = progress.phase === "succeeded";

  const isRunning = progress.phase === "running" || progress.phase === "queued";
  const isFailed = progress.phase === "failed";
  const isWarning = progress.phase === "succeeded-warning";

  const handleCopyError = (): void => {
    if (progress.phase !== "failed") return;
    void navigator.clipboard.writeText(progress.error).then(() => {
      setCopied(true);
      setTimeout(() => { setCopied(false); }, 1500);
    });
  };

  return (
    <div
      style={{
        position: "absolute",
        bottom: 60,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 16px",
        background: isFailed ? "rgba(255,60,60,0.15)" : isWarning ? "rgba(255,180,40,0.12)" : "var(--hud-bg)",
        border: `1px solid ${isFailed ? "rgba(255,80,80,0.3)" : isWarning ? "rgba(255,180,40,0.35)" : "var(--hud-border)"}`,
        maxWidth: isWarning ? 520 : undefined,
        flexWrap: isWarning ? "wrap" as const : undefined,
        borderRadius: 8,
        color: "var(--hud-text)",
        fontSize: 13,
        zIndex: 80,
        backdropFilter: "blur(8px)",
        animation: "ingestSlideIn 0.2s ease-out",
      }}
    >
      {isRunning && (
        <>
          <span
            style={{
              display: "inline-block",
              width: 12,
              height: 12,
              border: "2px solid var(--scrubber-active)",
              borderTopColor: "transparent",
              borderRadius: "50%",
              animation: "opSpin 0.8s linear infinite",
            }}
          />
          <span>
            {progress.phase === "queued" ? "Queued…" : operationLabel}
          </span>
        </>
      )}
      {isSucceeded && (
        <>
          <span style={{ color: "#6e6", fontSize: 16 }}>✓</span>
          <span style={{ color: "#aaa" }}>
            Segmented into {String(progress.maskCount)} {progress.maskCount === 1 ? "slice" : "slices"}
          </span>
        </>
      )}
      {progress.phase === "succeeded-warning" && (
        <>
          <span style={{ color: "#fb4", fontSize: 18, flexShrink: 0 }}>⚠</span>
          <span style={{ color: "#fb4", lineHeight: 1.4 }}>
            {progress.warning}
          </span>
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                style={{
                  padding: "4px 12px",
                  background: "rgba(255,180,40,0.15)",
                  border: "1px solid rgba(255,180,40,0.4)",
                  borderRadius: 4,
                  color: "#fb4",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                Retry
              </button>
            )}
            {onDismiss && (
              <button
                type="button"
                onClick={onDismiss}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--hud-muted)",
                  cursor: "pointer",
                  fontSize: 16,
                  padding: "0 4px",
                }}
              >
                ✕
              </button>
            )}
          </div>
        </>
      )}
      {isFailed && (
        <>
          <span style={{ color: "#f88", maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            ⚠ {progress.error}
          </span>
          <button
            type="button"
            onClick={handleCopyError}
            title="Copy error"
            style={{
              background: "none",
              border: "none",
              color: copied ? "#8f8" : "var(--hud-muted)",
              cursor: "pointer",
              fontSize: 13,
              padding: "0 4px",
            }}
          >
            {copied ? "✓" : "📋"}
          </button>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              style={{
                padding: "3px 10px",
                background: "transparent",
                border: "1px solid var(--hud-border-btn)",
                borderRadius: 4,
                color: "var(--hud-text)",
                cursor: "pointer",
                fontSize: 11,
              }}
            >
              Retry
            </button>
          )}
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
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
          )}
        </>
      )}
    </div>
  );
}
