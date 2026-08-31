/**
 * usePlayback — zustand-backed store + consumer hooks for the playback
 * state machine.
 *
 * The PlaybackProvider (in PlaybackContext.tsx) owns the audio engine
 * refs and the per-render set of action closures. It writes both `state`
 * (via dispatchPlayback) and `actions` (via setPlaybackActions) into the
 * module-level zustand store. Consumers (TransportBar, MixerPanel, ...)
 * read via the hooks below.
 */

import { create } from "zustand";
import {
  initialPlaybackState,
  playbackReducer,
  type PlaybackAction,
  type PlaybackActions,
  type PlaybackState,
} from "./playbackReducer";

// ═══════════════════════════════════════════
// Fallback actions (no-provider environments like Storybook)
// ═══════════════════════════════════════════

const noop = () => {};
const noopAsync = async () => {};

const FALLBACK_ACTIONS: PlaybackActions = {
  play: noopAsync,
  pause: noop,
  stop: noop,
  seek: noop,
  setTempo: noop,
  setVolume: noop,
  toggleMetronome: noop,
  toggleCountIn: noop,
  setLoop: noop,
  clearLoop: noop,
  applyMix: noop,
  setVstMutedParts: noop,
  applySpatialPosition: noop,
  applySpatialListener: noop,
  setReverbPreset: noopAsync,
  setReverbWet: noop,
  previewNote: noop,
  previewPercussion: noopAsync,
  measureBeatToSeconds: () => null,
  setEnsembleLayer: noop,
  setAirEQGain: noop,
  setLimiterThreshold: noop,
  setLimiterRatio: noop,
  applyLayerPan: noop,
};

// ═══════════════════════════════════════════
// Zustand store
// ═══════════════════════════════════════════

interface PlaybackStore {
  state: PlaybackState;
  actions: PlaybackActions;
  _dispatch: (action: PlaybackAction) => void;
  _setActions: (actions: PlaybackActions) => void;
}

const usePlaybackStore = create<PlaybackStore>()((set) => ({
  state: initialPlaybackState(),
  actions: FALLBACK_ACTIONS,
  _dispatch: (action: PlaybackAction) =>
    set((s: PlaybackStore) => {
      const next = playbackReducer(s.state, action);
      return next === s.state ? s : { ...s, state: next };
    }),
  _setActions: (actions: PlaybackActions) => set((s: PlaybackStore) => (s.actions === actions ? s : { ...s, actions })),
}));

/** Dispatch a playback action — called from the provider and tests. */
export function dispatchPlayback(action: PlaybackAction): void {
  usePlaybackStore.getState()._dispatch(action);
}

/** Install the live action object from the provider (replaces fallbacks). */
export function setPlaybackActions(actions: PlaybackActions): void {
  usePlaybackStore.getState()._setActions(actions);
}

// ═══════════════════════════════════════════
// Hooks
// ═══════════════════════════════════════════

/** Read-only access to the current playback state. */
export function usePlaybackState(): PlaybackState {
  return usePlaybackStore((s: PlaybackStore) => s.state);
}

/** Access playback control actions. */
export function usePlaybackActions(): PlaybackActions {
  return usePlaybackStore((s: PlaybackStore) => s.actions);
}

/**
 * Non-reactive read of playback state and actions.
 *
 * For consumers that need the transport's current position on their own clock
 * (the video synchronizer samples it every animation frame) rather than through
 * a React subscription. Subscribing would re-render the consumer at the
 * playhead's 60 Hz update rate purely to read a number.
 */
export function getPlaybackSnapshot(): { state: PlaybackState; actions: PlaybackActions } {
  const store = usePlaybackStore.getState();
  return { state: store.state, actions: store.actions };
}
