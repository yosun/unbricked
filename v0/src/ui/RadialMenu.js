import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useRef, useState } from "react";
const RADIUS = 70;
export default function RadialMenu(props) {
    const { items, x, y, selectedLayerIndex, onClose } = props;
    const [hovered, setHovered] = useState(null);
    const [visible, setVisible] = useState(false);
    const menuRef = useRef(null);
    // Animate in
    useEffect(() => {
        requestAnimationFrame(() => { setVisible(true); });
    }, []);
    // Close on outside click
    useEffect(() => {
        const handler = (e) => {
            if (menuRef.current && !menuRef.current.contains(e.target)) {
                onClose();
            }
        };
        window.addEventListener("pointerdown", handler);
        return () => { window.removeEventListener("pointerdown", handler); };
    }, [onClose]);
    // Close on Escape
    useEffect(() => {
        const handler = (e) => {
            if (e.key === "Escape")
                onClose();
        };
        window.addEventListener("keydown", handler);
        return () => { window.removeEventListener("keydown", handler); };
    }, [onClose]);
    const handleItemClick = useCallback((idx) => {
        items[idx]?.action();
        onClose();
    }, [items, onClose]);
    const count = items.length;
    return (_jsxs("div", { ref: menuRef, style: {
            position: "fixed",
            left: x,
            top: y,
            zIndex: 100,
            pointerEvents: "auto",
            transform: "translate(-50%, -50%)",
        }, children: [_jsx("div", { style: {
                    position: "absolute",
                    left: "50%",
                    top: "50%",
                    transform: "translate(-50%, -50%)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: selectedLayerIndex !== null && selectedLayerIndex !== undefined ? 36 : 8,
                    height: selectedLayerIndex !== null && selectedLayerIndex !== undefined ? 36 : 8,
                    borderRadius: "50%",
                    background: selectedLayerIndex !== null && selectedLayerIndex !== undefined
                        ? "var(--hud-bg)" : "var(--scrubber-active)",
                    border: selectedLayerIndex !== null && selectedLayerIndex !== undefined
                        ? "2px solid var(--scrubber-active)" : "none",
                    opacity: visible ? 1 : 0,
                    transition: "opacity 0.15s",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--scrubber-active)",
                    pointerEvents: "none",
                    userSelect: "none",
                }, children: selectedLayerIndex !== null && selectedLayerIndex !== undefined && `L${String(selectedLayerIndex)}` }), items.map((item, i) => {
                const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
                const ix = Math.cos(angle) * RADIUS;
                const iy = Math.sin(angle) * RADIUS;
                const isHovered = hovered === i;
                return (_jsxs("button", { type: "button", onPointerEnter: () => { setHovered(i); }, onPointerLeave: () => { setHovered(null); }, onClick: () => { handleItemClick(i); }, style: {
                        position: "absolute",
                        left: `calc(50% + ${String(ix)}px)`,
                        top: `calc(50% + ${String(iy)}px)`,
                        transform: `translate(-50%, -50%) scale(${String(visible ? 1 : 0.3)})`,
                        opacity: visible ? 1 : 0,
                        transition: `all 0.2s ease-out ${String(i * 0.03)}s`,
                        width: 44,
                        height: 44,
                        borderRadius: "50%",
                        background: isHovered ? "var(--hud-active)" : "var(--hud-bg)",
                        border: `1px solid ${isHovered ? "var(--scrubber-active)" : "var(--hud-border)"}`,
                        color: isHovered ? "var(--scrubber-active)" : "var(--hud-text)",
                        cursor: "pointer",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 16,
                        lineHeight: 1,
                        padding: 0,
                    }, title: item.label, children: [_jsx("span", { children: item.icon }), _jsx("span", { style: { fontSize: 7, marginTop: 2, opacity: 0.7 }, children: item.label })] }, i));
            })] }));
}
