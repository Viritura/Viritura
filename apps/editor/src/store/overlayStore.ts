/**
 * Floating-overlay state store.
 *
 * Owns the open/closed state of transient overlays that float above the
 * score canvas: the radial command menu, the tempo + staff-text inline
 * popovers, the jump bar, and the lyric-input mode (an editor mode rather
 * than a popover, but its open/state pair has the same shape).
 *
 * Lifted out of `App.tsx` as Phase A3 of the App state-extraction sweep.
 * Keeps the AppInner closure flat and gives shortcut handlers a stable
 * imperative API (`openRadialMenu(...)`) instead of prop-drilled setters.
 */

import { create } from "zustand";

import { type RadialMenuCategory } from "../radialMenu";
import { type LyricInputState } from "../components/LyricInput";
import type { SelectionState } from "./selectionStore";

export interface RadialMenuState {
  category: RadialMenuCategory;
  position: { x: number; y: number };
  /** Selection the command was opened for; focus changes must not retarget it. */
  selection?: SelectionState;
}

export interface TempoPopoverState {
  position: { x: number; y: number };
  initialValue: string;
  measureIndex: number;
  base: import("@viritura/core").NoteValueBase;
  dots: number;
  location?: { fraction: [number, number] };
}

export interface StaffTextPopoverState {
  position: { x: number; y: number };
  partIndex: number;
  measureIndex: number;
  sequenceIndex: number;
  eventIndex: number;
}

interface OverlayState {
  radialMenu: RadialMenuState | null;
  tempoPopover: TempoPopoverState | null;
  staffTextPopover: StaffTextPopoverState | null;
  jumpBarOpen: boolean;
  lyricMode: boolean;
  lyricState: LyricInputState | null;
}

interface OverlayActions {
  setRadialMenu: (next: RadialMenuState | null) => void;
  setTempoPopover: (next: TempoPopoverState | null) => void;
  setStaffTextPopover: (next: StaffTextPopoverState | null) => void;
  setJumpBarOpen: (open: boolean) => void;
  setLyricMode: (active: boolean) => void;
  setLyricState: (next: LyricInputState | null) => void;
}

type OverlayStore = OverlayState & OverlayActions;

export const useOverlayStore = create<OverlayStore>((set) => ({
  radialMenu: null,
  tempoPopover: null,
  staffTextPopover: null,
  jumpBarOpen: false,
  lyricMode: false,
  lyricState: null,

  setRadialMenu: (next) => set({ radialMenu: next }),
  setTempoPopover: (next) => set({ tempoPopover: next }),
  setStaffTextPopover: (next) => set({ staffTextPopover: next }),
  setJumpBarOpen: (open) => set({ jumpBarOpen: open }),
  setLyricMode: (active) => set({ lyricMode: active }),
  setLyricState: (next) => set({ lyricState: next }),
}));

/**
 * Module-level action helpers. Stable references — safe to call from event
 * handlers without listing in React Hook dependency arrays.
 */
export const setRadialMenu = (next: RadialMenuState | null): void => useOverlayStore.getState().setRadialMenu(next);
export const setTempoPopover = (next: TempoPopoverState | null): void =>
  useOverlayStore.getState().setTempoPopover(next);
export const setStaffTextPopover = (next: StaffTextPopoverState | null): void =>
  useOverlayStore.getState().setStaffTextPopover(next);
export const setJumpBarOpen = (open: boolean): void => useOverlayStore.getState().setJumpBarOpen(open);
export const setLyricMode = (active: boolean): void => useOverlayStore.getState().setLyricMode(active);
export const setLyricState = (next: LyricInputState | null): void => useOverlayStore.getState().setLyricState(next);
