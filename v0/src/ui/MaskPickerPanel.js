import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useState } from "react";
export default function MaskPickerPanel(props) {
    const { candidates, onCombine, onClose, combining } = props;
    // Initialize selection from auto-selected masks
    const [selected, setSelected] = useState(() => {
        const s = new Set();
        for (const c of candidates) {
            if (c.autoSelected)
                s.add(c.index);
        }
        return s;
    });
    const toggle = useCallback((idx) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(idx))
                next.delete(idx);
            else
                next.add(idx);
            return next;
        });
    }, []);
    const selectAll = useCallback(() => {
        setSelected(new Set(candidates.filter((c) => !c.isBackground).map((c) => c.index)));
    }, [candidates]);
    const selectNone = useCallback(() => {
        setSelected(new Set());
    }, []);
    const handleCombine = useCallback(() => {
        const urls = candidates
            .filter((c) => selected.has(c.index))
            .map((c) => c.maskUrl);
        if (urls.length > 0)
            onCombine(urls);
    }, [candidates, selected, onCombine]);
    return (_jsxs("div", { style: {
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            width: "min(520px, 90vw)",
            maxHeight: "80vh",
            display: "flex",
            flexDirection: "column",
            borderRadius: 12,
            background: "var(--hud-bg)",
            border: "1px solid var(--hud-border)",
            zIndex: 100,
            backdropFilter: "blur(12px)",
            overflow: "hidden",
        }, children: [_jsxs("div", { style: {
                    padding: "12px 16px 10px",
                    borderBottom: "1px solid var(--hud-border)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    flexShrink: 0,
                }, children: [_jsx("span", { style: { color: "var(--hud-text)", fontSize: 13, fontWeight: 600 }, children: "Select Masks to Combine" }), _jsx("button", { type: "button", onClick: onClose, style: {
                            background: "none",
                            border: "none",
                            color: "var(--hud-muted)",
                            cursor: "pointer",
                            fontSize: 16,
                            padding: "0 4px",
                        }, children: "\u2715" })] }), _jsxs("div", { style: {
                    padding: "8px 16px",
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    borderBottom: "1px solid var(--hud-border)",
                    flexShrink: 0,
                }, children: [_jsx("button", { type: "button", onClick: selectAll, style: quickBtnStyle, children: "Select all" }), _jsx("button", { type: "button", onClick: selectNone, style: quickBtnStyle, children: "Clear" }), _jsx("span", { style: { flex: 1 } }), _jsxs("span", { style: { fontSize: 11, color: "var(--hud-muted)" }, children: [selected.size, " of ", candidates.length, " selected"] })] }), _jsx("div", { style: {
                    flex: 1,
                    overflowY: "auto",
                    padding: 12,
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))",
                    gap: 8,
                }, children: candidates.map((c) => {
                    const isSelected = selected.has(c.index);
                    return (_jsxs("button", { type: "button", onClick: () => { toggle(c.index); }, style: {
                            position: "relative",
                            background: isSelected
                                ? "var(--hud-active)"
                                : "var(--control-bg)",
                            border: isSelected
                                ? "2px solid var(--scrubber-active)"
                                : "2px solid transparent",
                            borderRadius: 8,
                            padding: 4,
                            cursor: "pointer",
                            transition: "border-color 0.12s, background 0.12s",
                        }, children: [_jsx("img", { src: c.coloredUrl, alt: `Mask ${String(c.index)}`, style: {
                                    width: "100%",
                                    aspectRatio: "1",
                                    objectFit: "contain",
                                    borderRadius: 4,
                                    opacity: isSelected ? 1 : 0.5,
                                } }), _jsxs("div", { style: {
                                    fontSize: 10,
                                    color: c.isBackground ? "var(--color-warning)" : "var(--hud-muted)",
                                    marginTop: 2,
                                    textAlign: "center",
                                }, children: [(c.areaFraction * 100).toFixed(1), "%", c.isBackground ? " BG" : "", c.autoSelected ? " ★" : ""] })] }, c.index));
                }) }), _jsxs("div", { style: {
                    padding: "10px 16px",
                    borderTop: "1px solid var(--hud-border)",
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    justifyContent: "flex-end",
                    flexShrink: 0,
                }, children: [_jsx("button", { type: "button", onClick: onClose, style: {
                            background: "none",
                            border: "1px solid var(--hud-border)",
                            borderRadius: 6,
                            padding: "6px 14px",
                            color: "var(--hud-text)",
                            cursor: "pointer",
                            fontSize: 12,
                        }, children: "Cancel" }), _jsx("button", { type: "button", disabled: selected.size === 0 || combining, onClick: handleCombine, style: {
                            background: selected.size === 0 || combining
                                ? "var(--hud-muted)"
                                : "var(--scrubber-active)",
                            border: "none",
                            borderRadius: 6,
                            padding: "6px 16px",
                            color: "var(--btn-primary-text)",
                            cursor: selected.size === 0 || combining ? "default" : "pointer",
                            fontWeight: 600,
                            fontSize: 12,
                        }, children: combining ? "Combining…" : `Combine ${selected.size} mask${selected.size === 1 ? "" : "s"} → New Layer` })] })] }));
}
const quickBtnStyle = {
    background: "none",
    border: "1px solid var(--hud-border)",
    borderRadius: 4,
    padding: "3px 10px",
    color: "var(--hud-text)",
    cursor: "pointer",
    fontSize: 11,
};
