import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// src/slice8/SpaceAddressHUD.tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { useSpaceNav } from "./useSpaceNav";
import { shortSpaceLabel } from "./spaceNav";
export default function SpaceAddressHUD(props) {
    const { fallbackSpaceId, spaces } = props;
    const nav = useSpaceNav(fallbackSpaceId);
    const { current, origin, advanced } = nav;
    const [expanded, setExpanded] = useState(false);
    const [toast, setToast] = useState(null);
    const dropdownRef = useRef(null);
    // Close dropdown on outside click
    useEffect(() => {
        if (!expanded)
            return;
        const handler = (e) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
                setExpanded(false);
            }
        };
        document.addEventListener("pointerdown", handler);
        return () => {
            document.removeEventListener("pointerdown", handler);
        };
    }, [expanded]);
    const showToast = useCallback((msg) => {
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
    return (_jsxs("div", { ref: dropdownRef, style: {
            position: "absolute",
            top: 8,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 20,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            pointerEvents: "none",
        }, children: [_jsxs("button", { type: "button", onClick: () => {
                    setExpanded((v) => !v);
                }, style: {
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
                }, children: [_jsx("span", { style: { fontSize: 14, color: "var(--scrubber-active)" }, children: "\u25C8" }), _jsx("span", { children: pillLabel }), isOrigin && (_jsx("span", { title: "Origin", style: { fontSize: 10, color: "var(--scrubber-active)", marginLeft: 2 }, children: "\u2302" })), _jsx("span", { style: { fontSize: 10, color: "var(--hud-muted)", marginLeft: 2 }, children: "\u25BE" })] }), expanded && (_jsxs("div", { style: {
                    marginTop: 6,
                    background: "var(--hud-bg)",
                    border: "1px solid var(--hud-border)",
                    borderRadius: 8,
                    padding: "8px 0",
                    minWidth: 220,
                    backdropFilter: "blur(12px)",
                    WebkitBackdropFilter: "blur(12px)",
                    pointerEvents: "auto",
                }, children: [_jsxs("div", { style: {
                            padding: "4px 14px 8px",
                            borderBottom: "1px solid var(--hud-border)",
                        }, children: [_jsx("div", { style: { fontSize: 11, color: "var(--hud-muted)", marginBottom: 2 }, children: "Current Space" }), _jsx("div", { style: { fontSize: 13, color: "#eee" }, children: spaceName }), isRoot && (_jsx("div", { style: { fontSize: 10, color: "var(--scrubber-active)", marginTop: 2 }, children: "Root Space" })), advanced && (_jsx("div", { style: {
                                    fontSize: 10,
                                    color: "var(--hud-muted)",
                                    marginTop: 4,
                                    wordBreak: "break-all",
                                }, children: current }))] }), _jsx(DropdownItem, { label: "Copy link to this Space", icon: "\uD83D\uDD17", onClick: handleCopyLink }), _jsx(DropdownItem, { label: "Set as origin", icon: "\u2302", onClick: handleSetOrigin, disabled: isOrigin }), _jsx(DropdownItem, { label: "Return to origin", icon: "\u21A9", onClick: handleGoOrigin, disabled: isOrigin }), _jsx("div", { style: { borderTop: "1px solid var(--hud-border)", margin: "4px 0" } }), _jsxs("label", { style: {
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "6px 14px",
                            fontSize: 12,
                            color: "var(--hud-text)",
                            cursor: "pointer",
                        }, children: [_jsx("input", { type: "checkbox", checked: advanced, onChange: (e) => {
                                    nav.toggleAdvanced(e.target.checked);
                                }, style: { margin: 0, accentColor: "var(--scrubber-active)" } }), "Advanced"] }), advanced && (_jsxs("div", { style: { padding: "6px 14px" }, children: [_jsx("div", { style: { fontSize: 10, color: "var(--hud-muted)", marginBottom: 2 }, children: "URL" }), _jsx("div", { style: {
                                    fontSize: 10,
                                    color: "#aaa",
                                    wordBreak: "break-all",
                                    background: "rgba(0,0,0,0.3)",
                                    padding: "4px 6px",
                                    borderRadius: 4,
                                    userSelect: "all",
                                }, children: window.location.href })] }))] })), toast && (_jsx("div", { style: {
                    marginTop: 6,
                    background: "rgba(22,22,42,0.95)",
                    border: "1px solid var(--hud-border)",
                    borderRadius: 6,
                    padding: "4px 12px",
                    fontSize: 11,
                    color: "var(--scrubber-active)",
                }, children: toast }))] }));
}
/* ── Internal component ──────────────────────────── */
function DropdownItem(props) {
    const { label, icon, onClick, disabled } = props;
    return (_jsxs("button", { type: "button", onClick: onClick, disabled: disabled, style: {
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
        }, onMouseEnter: (e) => {
            e.currentTarget.style.background = "rgba(0, 0, 0, 0.06)";
        }, onMouseLeave: (e) => {
            e.currentTarget.style.background = "transparent";
        }, children: [_jsx("span", { style: { fontSize: 13, width: 18, textAlign: "center" }, children: icon }), label] }));
}
