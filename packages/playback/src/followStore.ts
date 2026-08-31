/**
 * followStore — persisted user preference for "follow the playhead".
 *
 * This is a tiny zustand store (separate from the transport state machine in
 * usePlayback) holding the single master on/off toggle for auto-scrolling the
 * viewport to keep the playhead in view during playback. It lives in
 * `@viritura/playback` so the TransportBar toggle and the editor's follow
 * controller can share one source of truth (editor → playback is a one-way
 * dependency, so the editor can read this but not vice-versa).
 *
 * Only the boolean preference lives here. The runtime engagement state
 * (following vs. detached after the user scrolls away) is editor-side and
 * ephemeral — see `useFollowPlayhead`.
 */

import { create } from "zustand";

const STORAGE_KEY = "viritura.followPlayhead";

function loadEnabled(): boolean {
  if (typeof localStorage === "undefined") return true;
  // Default ON; only an explicit "0" disables.
  return localStorage.getItem(STORAGE_KEY) !== "0";
}

function persistEnabled(enabled: boolean): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
}

interface FollowStore {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  toggle: () => void;
}

const useFollowStore = create<FollowStore>()((set) => ({
  enabled: loadEnabled(),
  setEnabled: (enabled) => {
    persistEnabled(enabled);
    set({ enabled });
  },
  toggle: () =>
    set((s) => {
      const enabled = !s.enabled;
      persistEnabled(enabled);
      return { enabled };
    }),
}));

/** Read the current follow-playhead master preference. */
export function useFollowEnabled(): boolean {
  return useFollowStore((s) => s.enabled);
}

/** Actions to change the follow-playhead preference. */
export function useFollowActions(): { setEnabled: (enabled: boolean) => void; toggle: () => void } {
  // Select each action individually — their references are stable, so this
  // avoids constructing a new object every render (which zustand v5 flags as
  // an unstable snapshot, causing an infinite re-render loop).
  const setEnabled = useFollowStore((s) => s.setEnabled);
  const toggle = useFollowStore((s) => s.toggle);
  return { setEnabled, toggle };
}
