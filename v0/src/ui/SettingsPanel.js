import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { OPERATIONS } from "../core/operations";
import { AI_EDIT_MODELS } from "../services/falProxy";
import { useUIStyle } from "./uiStyleStore";
import { ALL_TEMPLATES } from "./styleTemplates";
export default function SettingsPanel({ preferences, onChangePreference, onClose, }) {
    const currentTemplate = useUIStyle((s) => s.template);
    const setTemplate = useUIStyle((s) => s.setTemplate);
    return (_jsxs("div", { style: {
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            width: 320,
            background: "var(--hud-bg)",
            borderLeft: "1px solid var(--hud-border)",
            color: "var(--hud-text)",
            display: "flex",
            flexDirection: "column",
            zIndex: 50,
            backdropFilter: "blur(12px)",
        }, children: [_jsxs("div", { style: {
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "12px 16px",
                    borderBottom: "1px solid var(--hud-border)",
                }, children: [_jsx("strong", { style: { fontSize: 14 }, children: "Settings" }), _jsx("button", { type: "button", onClick: onClose, style: {
                            background: "none",
                            border: "none",
                            color: "var(--hud-text)",
                            cursor: "pointer",
                            fontSize: 16,
                            padding: "2px 6px",
                        }, children: "\u2715" })] }), _jsxs("div", { style: { padding: 16, flex: 1, overflowY: "auto" }, children: [_jsx("label", { style: { display: "block", fontSize: 12, color: "var(--hud-muted)", marginBottom: 6 }, children: "Default operation for new images" }), _jsx("select", { value: preferences.defaultImageOperationId, onChange: (e) => { onChangePreference("defaultImageOperationId", e.target.value); }, style: {
                            width: "100%",
                            padding: "6px 8px",
                            background: "var(--control-bg)",
                            border: "1px solid var(--hud-border-btn)",
                            borderRadius: 4,
                            color: "var(--hud-text)",
                            fontSize: 13,
                        }, children: OPERATIONS.map((op) => (_jsx("option", { value: op.id, children: op.label }, op.id))) }), _jsx("label", { style: { display: "block", fontSize: 12, color: "var(--hud-muted)", marginBottom: 6, marginTop: 16 }, children: "Default AI edit model" }), _jsx("select", { value: preferences.defaultAiEditModelId, onChange: (e) => { onChangePreference("defaultAiEditModelId", e.target.value); }, style: {
                            width: "100%",
                            padding: "6px 8px",
                            background: "var(--control-bg)",
                            border: "1px solid var(--hud-border-btn)",
                            borderRadius: 4,
                            color: "var(--hud-text)",
                            fontSize: 13,
                        }, children: AI_EDIT_MODELS.map((m) => (_jsx("option", { value: m.id, children: m.label }, m.id))) }), _jsx("label", { style: { display: "block", fontSize: 12, color: "var(--hud-muted)", marginBottom: 6, marginTop: 16 }, children: "Theme" }), _jsx("select", { value: currentTemplate.id, onChange: (e) => {
                            const t = ALL_TEMPLATES.find((t) => t.id === e.target.value);
                            if (t)
                                setTemplate(t);
                        }, style: {
                            width: "100%",
                            padding: "6px 8px",
                            background: "var(--control-bg)",
                            border: "1px solid var(--hud-border-btn)",
                            borderRadius: 4,
                            color: "var(--hud-text)",
                            fontSize: 13,
                        }, children: ALL_TEMPLATES.map((t) => (_jsx("option", { value: t.id, children: t.id === "way-of-code" ? "Light (Minimalist)" : "Dark" }, t.id))) })] })] }));
}
