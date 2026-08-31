/**
 * Dialog/popover open-state store.
 *
 * Centralizes the open/closed boolean for every modal dialog and floating
 * popover surfaced from the App shell. Each surface gets a stable string id
 * (`DialogId`) and a single source of truth. The store exposes:
 *   - `open(id)` / `close(id)` / `toggle(id)` for imperative control,
 *   - `useIsDialogOpen(id)` for per-dialog subscription that re-renders only
 *     when *that* dialog's state changes.
 *
 * Lifted out of `App.tsx`'s local `useState`s so the closures shrink and the
 * dialog wiring can be reached from anywhere (keyboard shortcuts, command
 * palettes, sub-components) without prop-drilling setters.
 */

import { create } from "zustand";

export type DialogId =
  | "pageSetup"
  | "calibration"
  | "identity"
  | "signIn"
  | "projectGitHubSetup"
  | "transpose"
  | "orchestralStaffSplit"
  | "drumKit"
  | "condensingPopover"
  | "source"
  | "help";

export interface DialogStoreState {
  open: Record<DialogId, boolean>;
  openDialog: (id: DialogId) => void;
  closeDialog: (id: DialogId) => void;
  toggleDialog: (id: DialogId) => void;
}

const allClosed: Record<DialogId, boolean> = {
  pageSetup: false,
  calibration: false,
  identity: false,
  signIn: false,
  projectGitHubSetup: false,
  transpose: false,
  orchestralStaffSplit: false,
  drumKit: false,
  condensingPopover: false,
  source: false,
  help: false,
};

export const useDialogStore = create<DialogStoreState>((set) => ({
  open: allClosed,
  openDialog: (id) => set((s) => (s.open[id] ? s : { open: { ...s.open, [id]: true } })),
  closeDialog: (id) => set((s) => (s.open[id] ? { open: { ...s.open, [id]: false } } : s)),
  toggleDialog: (id) => set((s) => ({ open: { ...s.open, [id]: !s.open[id] } })),
}));

/**
 * Module-level action helpers. These are stable references that proxy into
 * the store's actions; safe to call from event handlers, effects, and
 * non-React code (keyboard shortcut wiring) without going through hooks.
 * Because they're defined at module scope, they don't need to appear in
 * React Hook dependency arrays.
 */
export const openDialog = (id: DialogId): void => useDialogStore.getState().openDialog(id);
export const closeDialog = (id: DialogId): void => useDialogStore.getState().closeDialog(id);
export const toggleDialog = (id: DialogId): void => useDialogStore.getState().toggleDialog(id);
