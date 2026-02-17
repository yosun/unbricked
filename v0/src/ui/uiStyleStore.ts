import { create } from "zustand";
import { WayOfCodeTemplate } from "./styleTemplates";
import type { UIStyleTemplate } from "./styleTemplates";

interface UIStyleState {
  template: UIStyleTemplate;
  setTemplate: (template: UIStyleTemplate) => void;
  /** Whether chrome HUDs are currently visible (for auto-hide behavior). */
  chromeVisible: boolean;
  setChromeVisible: (visible: boolean) => void;
}

export const useUIStyle = create<UIStyleState>((set) => ({
  template: WayOfCodeTemplate,
  setTemplate: (template) => set({ template }),
  chromeVisible: false,
  setChromeVisible: (visible) => set((s) => s.chromeVisible === visible ? s : { chromeVisible: visible }),
}));
