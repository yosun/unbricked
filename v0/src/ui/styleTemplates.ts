export type UIStyleTemplate = {
  id: string;

  colors: {
    background: string;
    foreground: string;
    accent: string;
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

export const WayOfCodeTemplate: UIStyleTemplate = {
  id: "way-of-code",

  colors: {
    background: "#FAF9F6",
    foreground: "#111111",
    accent: "#000000",
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
