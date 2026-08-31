/**
 * Layout Debug — toggle store for the vertical-spacing debug overlay.
 *
 * Persisted to localStorage so toggle state survives reloads. The actual
 * Rust-side flag (`setEmitLayoutDebug`) is driven by `enabled`; rendering
 * categories are filtered client-side by the painter.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { setEmitLayoutDebug } from "@viritura/renderer";

export interface LayoutDebugCategories {
  systemBboxes: boolean;
  staffLines: boolean;
  aboveBelowExtras: boolean;
  measureExtremes: boolean;
  interSystemGaps: boolean;
  staffPairGaps: boolean;
  pageFill: boolean;
  noteSpacing: boolean;
  placementBoxes: boolean;
  labels: boolean;
}

export interface LayoutDebugState {
  enabled: boolean;
  categories: LayoutDebugCategories;
  setEnabled: (enabled: boolean) => void;
  toggleCategory: (key: keyof LayoutDebugCategories) => void;
  setAllCategories: (value: boolean) => void;
}

const DEFAULT_CATEGORIES: LayoutDebugCategories = {
  systemBboxes: true,
  staffLines: true,
  aboveBelowExtras: true,
  measureExtremes: false,
  interSystemGaps: true,
  staffPairGaps: true,
  pageFill: true,
  noteSpacing: true,
  placementBoxes: false,
  labels: true,
};

export const useLayoutDebugStore = create<LayoutDebugState>()(
  persist(
    (set, get) => ({
      enabled: false,
      categories: DEFAULT_CATEGORIES,
      setEnabled: (enabled) => {
        setEmitLayoutDebug(enabled);
        set({ enabled });
      },
      toggleCategory: (key) => set({ categories: { ...get().categories, [key]: !get().categories[key] } }),
      setAllCategories: (value) =>
        set({
          categories: Object.keys(get().categories).reduce(
            (acc, k) => ({ ...acc, [k]: value }),
            {} as LayoutDebugCategories,
          ),
        }),
    }),
    {
      name: "viritura.layoutDebug",
      // Replay the Rust flag on hydrate
      onRehydrateStorage: () => (state) => {
        if (state?.enabled) setEmitLayoutDebug(true);
      },
    },
  ),
);
