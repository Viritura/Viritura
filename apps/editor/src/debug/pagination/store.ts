import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { LayoutDebugInfo } from "@viritura/renderer";

export type PaginationDiagnostics = NonNullable<LayoutDebugInfo["pagination"]>;

export interface PaginationCategories {
  restWindows: boolean;
  pageCapacity: boolean;
  systemDensity: boolean;
  alternatives: boolean;
  reasons: boolean;
}

interface PaginationDebugState {
  enabled: boolean;
  categories: PaginationCategories;
  diagnostics: PaginationDiagnostics | null;
  selectedSystem: number | null;
  setEnabled: (enabled: boolean) => void;
  toggleCategory: (key: keyof PaginationCategories) => void;
  setDiagnostics: (diagnostics: PaginationDiagnostics | null) => void;
  selectSystem: (system: number | null) => void;
}

export const usePaginationDebugStore = create<PaginationDebugState>()(
  persist(
    (set) => ({
      enabled: false,
      categories: {
        restWindows: true,
        pageCapacity: true,
        systemDensity: true,
        alternatives: false,
        reasons: true,
      },
      diagnostics: null,
      selectedSystem: null,
      setEnabled: (enabled) => set({ enabled }),
      toggleCategory: (key) => set((state) => ({ categories: { ...state.categories, [key]: !state.categories[key] } })),
      setDiagnostics: (diagnostics) => set({ diagnostics, selectedSystem: null }),
      selectSystem: (selectedSystem) => set({ selectedSystem }),
    }),
    {
      name: "viritura.paginationDebug",
      partialize: ({ enabled, categories }) => ({ enabled, categories }),
    },
  ),
);
