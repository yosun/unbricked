import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
const MODES = [
    { mode: "universal", label: "Universal", key: "1", icon: "◈" },
    { mode: "layers", label: "Layers", key: "2", icon: "☰" },
    { mode: "minimalist", label: "Minimal", key: "3", icon: "◯" },
];
export default function ViewModeSwitcher(props) {
    const { current, onChange } = props;
    return (_jsx("div", { style: {
            display: "flex",
            gap: 2,
            background: "var(--control-bg)",
            borderRadius: 6,
            padding: 2,
        }, children: MODES.map(({ mode, label, key, icon }) => {
            const active = current === mode;
            return (_jsxs("button", { type: "button", onClick: () => { onChange(mode); }, title: `${label} (${key})`, style: {
                    background: active ? "var(--hud-active)" : "transparent",
                    border: active
                        ? "1px solid var(--hud-border-btn)"
                        : "1px solid transparent",
                    color: active ? "var(--scrubber-active)" : "var(--color-dimmed)",
                    padding: "3px 8px",
                    borderRadius: 4,
                    cursor: "pointer",
                    fontSize: 13,
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    transition: "all 0.15s",
                }, children: [_jsx("span", { style: { fontSize: 14 }, children: icon }), _jsx("span", { style: { fontSize: 11 }, children: label })] }, mode));
        }) }));
}
