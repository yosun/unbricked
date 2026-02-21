import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Bottom-right overlay listing portal edges from the current space.
 * Each portal shows an "↳ Enter" button that navigates into the target space.
 */
export default function PortalOverlay(props) {
    const { portalEdges, spaces, onEnter } = props;
    if (portalEdges.length === 0)
        return null;
    return (_jsxs("div", { style: {
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
        }, children: [_jsx("div", { style: {
                    fontSize: 10,
                    color: "var(--hud-muted)",
                    letterSpacing: 1,
                    textTransform: "uppercase",
                    paddingBottom: 2,
                }, children: "Portals" }), portalEdges.map((edge) => {
                const target = spaces[edge.to];
                const name = target?.name ?? edge.to;
                return (_jsxs("div", { style: {
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
                    }, children: [_jsx("span", { style: { fontSize: 12, color: "var(--hud-text)", flex: 1 }, children: name }), _jsx("button", { type: "button", onClick: () => { onEnter(edge.to); }, style: {
                                background: "var(--hud-active)",
                                border: "1px solid var(--hud-border-btn)",
                                color: "var(--scrubber-active)",
                                padding: "3px 10px",
                                borderRadius: 4,
                                cursor: "pointer",
                                fontSize: 11,
                                whiteSpace: "nowrap",
                            }, children: "\u21B3 Enter" })] }, edge.id));
            })] }));
}
