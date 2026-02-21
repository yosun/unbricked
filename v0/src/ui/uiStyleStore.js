import { create } from "zustand";
import { WayOfCodeTemplate } from "./styleTemplates";
/** Push every template color into CSS custom properties on :root so that
 *  plain CSS (styles.css) and inline styles using var(--xxx) stay in sync. */
function applyCSSVariables(t) {
    const s = document.documentElement.style;
    s.setProperty("--hud-bg", t.colors.hudBg);
    s.setProperty("--hud-border", t.colors.hudBorder);
    s.setProperty("--hud-border-btn", t.colors.hudBorderBtn);
    s.setProperty("--hud-text", t.colors.hudText);
    s.setProperty("--hud-muted", t.colors.hudMuted);
    s.setProperty("--hud-active", t.colors.hudActive);
    s.setProperty("--scrubber-active", t.colors.scrubberActive);
    s.setProperty("--btn-primary-text", t.colors.btnPrimaryText);
    s.setProperty("--control-bg", t.colors.controlBg);
    s.setProperty("--overlay-scrim", t.colors.overlayScrim);
    s.setProperty("--overlay-bg", t.colors.overlayBg);
    s.setProperty("--color-dimmed", t.colors.dimmed);
    s.setProperty("--color-success", t.colors.success);
    s.setProperty("--color-warning", t.colors.warning);
    s.setProperty("--color-error", t.colors.error);
    s.setProperty("--glow-ai", t.colors.glowAi);
    s.setProperty("--processing-glow", t.colors.processingGlow);
    s.setProperty("--chrome-toggle-hover", t.colors.chromeToggleHover);
    s.setProperty("--shadow-light", t.colors.shadowLight);
    s.setProperty("--shadow-medium", t.colors.shadowMedium);
    // body-level colours
    s.setProperty("--body-bg", t.colors.background);
    s.setProperty("--body-fg", t.colors.foreground);
}
// Apply defaults immediately so CSS vars are available before first render.
if (typeof document !== "undefined")
    applyCSSVariables(WayOfCodeTemplate);
export const useUIStyle = create((set) => ({
    template: WayOfCodeTemplate,
    setTemplate: (template) => {
        applyCSSVariables(template);
        set({ template });
    },
    chromeVisible: false,
    setChromeVisible: (visible) => set((s) => s.chromeVisible === visible ? s : { chromeVisible: visible }),
}));
