import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
export default function OperationProgressHUD({ progress, operationLabel, onRetry, onDismiss, }) {
    const [copied, setCopied] = useState(false);
    const isSucceeded = progress.phase === "succeeded";
    const isRunning = progress.phase === "running" || progress.phase === "queued";
    const isFailed = progress.phase === "failed";
    const isWarning = progress.phase === "succeeded-warning";
    const handleCopyError = () => {
        if (progress.phase !== "failed")
            return;
        void navigator.clipboard.writeText(progress.error).then(() => {
            setCopied(true);
            setTimeout(() => { setCopied(false); }, 1500);
        });
    };
    return (_jsxs("div", { style: {
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
            flexWrap: isWarning ? "wrap" : undefined,
            borderRadius: 8,
            color: "var(--hud-text)",
            fontSize: 13,
            zIndex: 80,
            backdropFilter: "blur(8px)",
            animation: "ingestSlideIn 0.2s ease-out",
        }, children: [isRunning && (_jsxs(_Fragment, { children: [_jsx("span", { style: {
                            display: "inline-block",
                            width: 12,
                            height: 12,
                            border: "2px solid var(--scrubber-active)",
                            borderTopColor: "transparent",
                            borderRadius: "50%",
                            animation: "opSpin 0.8s linear infinite",
                        } }), _jsx("span", { children: progress.phase === "queued" ? "Queued…" : operationLabel })] })), isSucceeded && (_jsxs(_Fragment, { children: [_jsx("span", { style: { color: "var(--color-success)", fontSize: 16 }, children: "\u2713" }), _jsxs("span", { style: { color: "var(--hud-muted)" }, children: ["Segmented into ", String(progress.maskCount), " ", progress.maskCount === 1 ? "slice" : "slices"] })] })), progress.phase === "succeeded-warning" && (_jsxs(_Fragment, { children: [_jsx("span", { style: { color: "var(--color-warning)", fontSize: 18, flexShrink: 0 }, children: "\u26A0" }), _jsx("span", { style: { color: "var(--color-warning)", lineHeight: 1.4 }, children: progress.warning }), _jsxs("div", { style: { display: "flex", gap: 6, flexShrink: 0 }, children: [onRetry && (_jsx("button", { type: "button", onClick: onRetry, style: {
                                    padding: "4px 12px",
                                    background: "rgba(255,180,40,0.15)",
                                    border: "1px solid rgba(255,180,40,0.4)",
                                    borderRadius: 4,
                                    color: "var(--color-warning)",
                                    cursor: "pointer",
                                    fontSize: 12,
                                    fontWeight: 600,
                                    whiteSpace: "nowrap",
                                }, children: "Retry" })), onDismiss && (_jsx("button", { type: "button", onClick: onDismiss, style: {
                                    background: "none",
                                    border: "none",
                                    color: "var(--hud-muted)",
                                    cursor: "pointer",
                                    fontSize: 16,
                                    padding: "0 4px",
                                }, children: "\u2715" }))] })] })), isFailed && (_jsxs(_Fragment, { children: [_jsxs("span", { style: { color: "var(--color-error)", maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: ["\u26A0 ", progress.error] }), _jsx("button", { type: "button", onClick: handleCopyError, title: "Copy error", style: {
                            background: "none",
                            border: "none",
                            color: copied ? "var(--color-success)" : "var(--hud-muted)",
                            cursor: "pointer",
                            fontSize: 13,
                            padding: "0 4px",
                        }, children: copied ? "✓" : "📋" }), onRetry && (_jsx("button", { type: "button", onClick: onRetry, style: {
                            padding: "3px 10px",
                            background: "transparent",
                            border: "1px solid var(--hud-border-btn)",
                            borderRadius: 4,
                            color: "var(--hud-text)",
                            cursor: "pointer",
                            fontSize: 11,
                        }, children: "Retry" })), onDismiss && (_jsx("button", { type: "button", onClick: onDismiss, style: {
                            background: "none",
                            border: "none",
                            color: "var(--hud-muted)",
                            cursor: "pointer",
                            fontSize: 14,
                            padding: "0 4px",
                        }, children: "\u2715" }))] }))] }));
}
