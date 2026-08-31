/**
 * View-state store.
 *
 * Module-level zustand store that owns the *cross-mode* view selection:
 * which score/parts are shown and which page-layout view mode is active.
 * These were previously component-local `useState` slots inside Write's
 * `useAppLocalState` and Engrave's `usePreviewControls`, which meant the
 * selected score, selected parts, and view mode were lost every time the
 * user switched between Write and Engrave (each mode mounted its own tree).
 *
 * Hoisting them here lets Write and Engrave share one source of truth so
 * switching modes only swaps the chrome, never the score context.
 *
 * The viewport (scroll + zoom) intentionally does NOT live here — it stays
 * inside the single persistent `ScoreCanvas` instance, which is never
 * unmounted across the Write/Engrave switch, so scroll + zoom persist for
 * free.
 */

import { create } from "zustand";
import type { WriteViewMode as ViewMode } from "@viritura/ui";

/** A React-style setter that accepts either a value or an updater function. */
type SetAction<T> = T | ((prev: T) => T);

function applySetAction<T>(prev: T, action: SetAction<T>): T {
  return typeof action === "function" ? (action as (p: T) => T)(prev) : action;
}

interface ViewStateStore {
  /** Currently selected score/layout index (0 = full score). */
  selectedScoreIndex: number;
  /** Part IDs selected in the panel — when 2+, renders only those parts. */
  selectedPartIds: string[];
  /** Page-layout view mode (page / spread / spread-h / horizon). */
  viewMode: ViewMode;

  setSelectedScoreIndex: (action: SetAction<number>) => void;
  setSelectedPartIds: (action: SetAction<string[]>) => void;
  setViewMode: (action: SetAction<ViewMode>) => void;
}

export const useViewStateStore = create<ViewStateStore>((set) => ({
  selectedScoreIndex: 0,
  selectedPartIds: [],
  viewMode: "horizon",

  setSelectedScoreIndex: (action) => set((s) => ({ selectedScoreIndex: applySetAction(s.selectedScoreIndex, action) })),
  setSelectedPartIds: (action) => set((s) => ({ selectedPartIds: applySetAction(s.selectedPartIds, action) })),
  setViewMode: (action) => set((s) => ({ viewMode: applySetAction(s.viewMode, action) })),
}));
