/**
 * Onboarding / startup-flow store.
 *
 * Owns the state surrounding the Start Center launch dialog and the
 * "Add to project" banner shown after opening a single file standalone.
 * Both surfaces support a "Don't show me this again" toggle that persists
 * to localStorage under stable keys (kept verbatim from the previous
 * App.tsx-local implementation so existing user preferences survive).
 *
 * Lifted out of `App.tsx`'s local `useState`s so:
 *   - the closure shrinks (Phase A2 of the App state-extraction sweep),
 *   - shortcuts/menus can show the Start Center without prop-drilling, and
 *   - the suppression read/write paths live in one place.
 */

import { create } from "zustand";

import { type RecentScore } from "./recentScores";

/** localStorage keys — must NOT change (existing users rely on them). */
const START_CENTER_SUPPRESS_KEY = "viritura.startCenter.suppress";
const TRACK_BANNER_SUPPRESS_KEY = "viritura.trackBanner.suppress";

export type StartCenterView = "home" | "newProject";

function readSuppressed(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeSuppressed(key: string, value: boolean): void {
  try {
    if (value) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch {
    /* localStorage unavailable (private mode / SSR) — silently skip */
  }
}

interface OnboardingState {
  /** Start Center dialog open/closed. */
  startCenterOpen: boolean;
  /** The view to show the next time Start Center opens. */
  startCenterView: StartCenterView;
  /** Recents list shown in the Start Center. */
  recentScores: RecentScore[];
  /** If true, do not auto-open Start Center on boot. */
  suppressStartCenter: boolean;
  /** When non-null, show "Add to project" banner with this filename. */
  trackBannerFile: string | null;
  /** If true, never show the "Add to project" banner again. */
  suppressTrackBanner: boolean;
}

interface OnboardingActions {
  setStartCenterOpen: (open: boolean) => void;
  setStartCenterView: (view: StartCenterView) => void;
  setRecentScores: (next: RecentScore[] | ((prev: RecentScore[]) => RecentScore[])) => void;
  setSuppressStartCenter: (value: boolean) => void;
  setTrackBannerFile: (file: string | null) => void;
  setSuppressTrackBanner: (value: boolean) => void;
}

type OnboardingStore = OnboardingState & OnboardingActions;

export const useOnboardingStore = create<OnboardingStore>((set) => ({
  startCenterOpen: false,
  startCenterView: "home",
  recentScores: [],
  suppressStartCenter: readSuppressed(START_CENTER_SUPPRESS_KEY),
  trackBannerFile: null,
  suppressTrackBanner: readSuppressed(TRACK_BANNER_SUPPRESS_KEY),

  setStartCenterOpen: (open) =>
    set(open ? { startCenterOpen: true } : { startCenterOpen: false, startCenterView: "home" }),
  setStartCenterView: (view) => set({ startCenterView: view }),
  setRecentScores: (next) =>
    set((s) => ({
      recentScores: typeof next === "function" ? next(s.recentScores) : next,
    })),
  setSuppressStartCenter: (value) => {
    writeSuppressed(START_CENTER_SUPPRESS_KEY, value);
    set({ suppressStartCenter: value });
  },
  setTrackBannerFile: (file) => set({ trackBannerFile: file }),
  setSuppressTrackBanner: (value) => {
    writeSuppressed(TRACK_BANNER_SUPPRESS_KEY, value);
    set({ suppressTrackBanner: value });
  },
}));

/**
 * Module-level action helpers — stable references that don't need to appear
 * in React Hook dependency arrays. Prefer these for new code.
 */
export const setStartCenterOpen = (open: boolean): void => useOnboardingStore.getState().setStartCenterOpen(open);
export const openStartCenter = (view: StartCenterView = "home"): void => {
  useOnboardingStore.setState({ startCenterOpen: true, startCenterView: view });
};
export const setRecentScores = (next: RecentScore[] | ((prev: RecentScore[]) => RecentScore[])): void =>
  useOnboardingStore.getState().setRecentScores(next);
export const setSuppressStartCenter = (value: boolean): void =>
  useOnboardingStore.getState().setSuppressStartCenter(value);
export const setTrackBannerFile = (file: string | null): void => useOnboardingStore.getState().setTrackBannerFile(file);
export const setSuppressTrackBanner = (value: boolean): void =>
  useOnboardingStore.getState().setSuppressTrackBanner(value);
