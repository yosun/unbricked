export type UIStyleTemplate = {
  id: string;

  colors: {
    background: string;
    foreground: string;
    accent: string;
    /** HUD panel background (with alpha for backdrop-filter) */
    hudBg: string;
    /** HUD border */
    hudBorder: string;
    /** HUD button border (slightly stronger) */
    hudBorderBtn: string;
    /** Default HUD text */
    hudText: string;
    /** Muted/secondary text */
    hudMuted: string;
    /** Active/hover background tint */
    hudActive: string;
    /** Accent color used on scrubber, active elements */
    scrubberActive: string;
    /** Color for primary action button text on accent bg */
    btnPrimaryText: string;
    /** Select/input control background */
    controlBg: string;
    /** Overlay scrim (modals, ingest panel backdrop) */
    overlayScrim: string;
    /** Slicing/loading overlay background */
    overlayBg: string;
    /** Inactive/dimmed text */
    dimmed: string;
    /** Success indicator */
    success: string;
    /** Warning/caution */
    warning: string;
    /** Error/danger */
    error: string;
    /** Glow color for AI editing effects */
    glowAi: string;
    /** Processing glow (slicing, generating) - needs high contrast */
    processingGlow: string;
    /** 3D grid helper color */
    gridColor: string;
    /** Selection wireframe color */
    selectionWireframe: string;
    /** Pivot/gizmo indicator color */
    pivotColor: string;
    /** Snap angle line color */
    snapLineColor: string;
    /** Scrubber indicator in 3D space */
    scrubber3d: string;
    /** Chrome toggle hover tint */
    chromeToggleHover: string;
    /** Shadow/glow on floating HUDs */
    shadowLight: string;
    shadowMedium: string;
  };

  brick: {
    color: string;
    roughness: number;
    metalness: number;
    outlineColor: string;
    outlineWidth: number;
  };

  ui: {
    showChrome: boolean;
    autoHideChrome: boolean;
    animationSpeed: number;
  };
};

/* ---------- Light theme (Rick-Rubin-minimalist) ---------- */

export const WayOfCodeTemplate: UIStyleTemplate = {
  id: "way-of-code",

  colors: {
    background: "#FAF9F6",
    foreground: "#111111",
    accent: "#000000",
    hudBg: "rgba(245, 244, 240, 0.92)",
    hudBorder: "rgba(0, 0, 0, 0.18)",
    hudBorderBtn: "rgba(0, 0, 0, 0.25)",
    hudText: "#222",
    hudMuted: "#777",
    hudActive: "rgba(0, 0, 0, 0.08)",
    scrubberActive: "#333",
    btnPrimaryText: "#fff",
    controlBg: "rgba(0, 0, 0, 0.06)",
    overlayScrim: "rgba(0, 0, 0, 0.5)",
    overlayBg: "#1a1a2e",
    dimmed: "#666",
    success: "#2a9d2a",
    warning: "#cc7700",
    error: "#cc3333",
    glowAi: "#0088aa",
    processingGlow: "#0077aa",
    gridColor: "#555555",
    selectionWireframe: "#008888",
    pivotColor: "#cc8800",
    snapLineColor: "#996600",
    scrubber3d: "#444444",
    chromeToggleHover: "rgba(0, 0, 0, 0.06)",
    shadowLight: "rgba(0, 0, 0, 0.12)",
    shadowMedium: "rgba(0, 0, 0, 0.25)",
  },

  brick: {
    color: "#E8E8E8",
    roughness: 0.9,
    metalness: 0.0,
    outlineColor: "#000000",
    outlineWidth: 1,
  },

  ui: {
    showChrome: false,
    autoHideChrome: true,
    animationSpeed: 0.6,
  },
};

/* ---------- Dark theme ---------- */

export const DarkTemplate: UIStyleTemplate = {
  id: "dark",

  colors: {
    background: "#121218",
    foreground: "#e0e0e0",
    accent: "#7ec8e3",
    hudBg: "rgba(24, 24, 32, 0.92)",
    hudBorder: "rgba(255, 255, 255, 0.12)",
    hudBorderBtn: "rgba(255, 255, 255, 0.18)",
    hudText: "#ddd",
    hudMuted: "#888",
    hudActive: "rgba(255, 255, 255, 0.08)",
    scrubberActive: "#7ec8e3",
    btnPrimaryText: "#111",
    controlBg: "rgba(255, 255, 255, 0.08)",
    overlayScrim: "rgba(0, 0, 0, 0.65)",
    overlayBg: "#0d0d18",
    dimmed: "#777",
    success: "#66dd66",
    warning: "#ffbb33",
    error: "#ff6666",
    glowAi: "#60d0ff",
    processingGlow: "#60d0ff",
    gridColor: "#666666",
    selectionWireframe: "#00dddd",
    pivotColor: "#ffdd44",
    snapLineColor: "#ffcc00",
    scrubber3d: "#999999",
    chromeToggleHover: "rgba(255, 255, 255, 0.08)",
    shadowLight: "rgba(0, 0, 0, 0.3)",
    shadowMedium: "rgba(0, 0, 0, 0.5)",
  },

  brick: {
    color: "#2a2a2e",
    roughness: 0.85,
    metalness: 0.05,
    outlineColor: "#7ec8e3",
    outlineWidth: 1,
  },

  ui: {
    showChrome: false,
    autoHideChrome: true,
    animationSpeed: 0.6,
  },
};

export const ALL_TEMPLATES: UIStyleTemplate[] = [WayOfCodeTemplate, DarkTemplate];
