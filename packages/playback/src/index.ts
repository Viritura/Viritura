/**
 * @viritura/playback — score playback runtime.
 *
 * Owns transport state (play/pause/stop/seek/loop), MIDI scheduling,
 * SoundFont sample playback, the metronome, and the playhead overlay
 * painter. Designed to take an MNX score and visible-part list as input
 * and produce both audible playback and a synchronized visual playhead.
 *
 * Internal-use today; intended to be promoted to a public package once
 * @viritura/score-engine ships and we can swap the `score` prop for a
 * `timeline` prop derived from `engine.timeline()`.
 */

export { PlaybackProvider } from "./PlaybackContext";
export { getPlaybackSnapshot, usePlaybackActions, usePlaybackState } from "./usePlayback";
export {
  PAN_RANGE,
  DEFAULT_TEMPO,
  DEFAULT_VOLUME,
  MIN_TEMPO,
  MAX_TEMPO,
  SCORE_CHANGE_DEBOUNCE_MS,
  initialPlaybackState,
  playbackReducer,
  type PlayheadPosition,
  type LoopRegion,
  type PartPatchInfo,
  type PlaybackState,
  type PlaybackActions,
  type PlaybackAction,
} from "./playbackReducer";

export { TransportBar } from "./TransportBar";

export { PlayheadOverlay } from "./PlayheadOverlay";
export type { PlayheadRect } from "./PlayheadOverlay";

export { useFollowEnabled, useFollowActions } from "./followStore";

export type { ViewMode } from "./types";

export {
  resolveSoundProfilePickerView,
  type SoundProfilePickerOption,
  type SoundProfilePickerPack,
  type SoundProfilePickerSection,
  type SoundProfilePickerView,
} from "./soundProfileRuntime";

export type { VstTransport, VstPartAssignment, Sf2PartAssignment, VstPreparePlan } from "./vstTransport";
