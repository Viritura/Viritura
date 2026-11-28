import { create } from "zustand";
import type { ProfileScope } from "../../../../engraveStyle";

type StylePanelMode = "layout" | "house";
type LayoutTab = "layout" | "selection";

interface StyleEditorState {
  mode: StylePanelMode;
  layoutTab: LayoutTab;
  /** Profile whose page setup is shown while editing the house style. */
  houseProfile: ProfileScope;
  openLayout: () => void;
  openSelection: () => void;
  openHouse: (profile?: ProfileScope) => void;
}

/** Which part of the Engrave style panel is showing. Shared so menus and the toolbar can open it. */
export const useStyleEditorStore = create<StyleEditorState>()((set) => ({
  mode: "layout",
  layoutTab: "layout",
  houseProfile: { kind: "profile", role: "score" },
  openLayout: () => set({ mode: "layout", layoutTab: "layout" }),
  openSelection: () => set({ mode: "layout", layoutTab: "selection" }),
  openHouse: (profile) => set((state) => ({ mode: "house", houseProfile: profile ?? state.houseProfile })),
}));
