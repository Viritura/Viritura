/**
 * playbackReducer — pure types, constants, reducer, and small math helpers
 * for the audio playback state machine. Split out from PlaybackContext.tsx
 * so React Fast Refresh can keep the .tsx file as components-only.
 */

import type { Score } from "@viritura/core";

// ═══════════════════════════════════════════
// Types
// ═══════════════════════════════════════════

/** Real-time playhead location in the score. */
export interface PlayheadPosition {
  readonly measureIndex: number;
  readonly beat: number;
  readonly timeSeconds: number;
}

/** Loop region defined by start/end beats. */
export interface LoopRegion {
  readonly start: number;
  readonly end: number;
}

/** Info about which sound patch is loaded for a part. */
export interface PartPatchInfo {
  /** Part name from the score. */
  readonly partName: string;
  /** Sound source type. */
  readonly source: "sf2";
  /** GM program number (SF2 only). */
  readonly gmProgram?: number;
  /** GM program name (SF2 only). */
  readonly gmProgramName?: string;
  /** Whether this part has an ensemble layer (SF2 strings only). */
  readonly ensembleLayered?: boolean;
  /** Number of ensemble layers (e.g. 2 for String Ensemble 1 + 2). */
  readonly layerCount?: number;
}

/** Read-only playback state. */
export interface PlaybackState {
  /** Transport status. */
  readonly status: "stopped" | "playing" | "paused" | "loading";
  /** Current playhead position (null when stopped with no position). */
  readonly playheadPosition: PlayheadPosition | null;
  /** Total score duration in seconds. */
  readonly duration: number;
  /** Active BPM — user override or score tempo. */
  readonly currentTempo: number;
  /** Original BPM from the score. */
  readonly scoreTempo: number;
  /** Master volume (0–1). */
  readonly volume: number;
  /** Whether the metronome click track is enabled. */
  readonly metronomeEnabled: boolean;
  /** Whether a one-bar count-in is played before the music when starting from
   *  the beginning. */
  readonly countInEnabled: boolean;
  /** Active loop region, or null if looping is off. */
  readonly loop: LoopRegion | null;
  /** Per-part patch info (what sound source each part is using). */
  readonly partPatches: readonly PartPatchInfo[];
}

/** Actions to control playback. */
export interface PlaybackActions {
  /** Start or resume playback. Optionally start from a specific time in seconds. */
  play(fromSeconds?: number): Promise<void>;
  /** Pause playback (preserves position). */
  pause(): void;
  /** Stop playback (resets position to start). */
  stop(): void;
  /** Seek to an absolute score time in seconds. */
  seek(seconds: number): void;
  /** Override the tempo (BPM). */
  setTempo(bpm: number): void;
  /** Set master volume (0–1, clamped). */
  setVolume(volume: number): void;
  /** Toggle metronome click track on/off. */
  toggleMetronome(): void;
  /** Toggle the count-in (a bar of clicks before playback) on/off. */
  toggleCountIn(): void;
  /** Set a loop region between start and end beats. */
  setLoop(start: number, end: number): void;
  /** Clear the loop region. */
  clearLoop(): void;
  /** Apply mixer settings to a specific part's sampler. */
  applyMix(partIndex: number, volume: number, pan: number, muted: boolean, stageDepthEnabled: boolean): void;
  /** Set which part indices are effectively muted, for the native VST host
   *  (mixer mute/solo). No-op on the web build (no VST transport). */
  setVstMutedParts(mutedParts: ReadonlySet<number>): void;
  /** Update a part's spatial position. */
  applySpatialPosition(partIndex: number, x: number, y: number): void;
  /** Update the listener's spatial position. */
  applySpatialListener(x: number, y: number): void;
  /** Load a reverb preset. */
  setReverbPreset(presetId: string): Promise<void>;
  /** Set reverb wet level (0-1). */
  setReverbWet(level: number): void;
  /** Preview a note using the active sampler (for click-to-hear). Auto-initializes if needed.
   *  `altKitProgram` routes the hit to a borrowed GS drum kit (a kit-component
   *  sound override), matching how the note plays back in the score. */
  previewNote(
    midiNote: number,
    partIndex?: number,
    velocity?: number,
    durationMs?: number,
    altKitProgram?: number,
  ): void;
  /** Preview a GM/GS percussion hit independently of the currently loaded score. */
  previewPercussion(midiNote: number, drumKitProgram?: number, velocity?: number, durationMs?: number): Promise<void>;
  /** Convert a measure index and beat to absolute time in seconds. Returns null if unavailable. */
  /** Convert an authored score measure and beat to its first performed occurrence. */
  measureBeatToSeconds(measureIndex: number, beat: number): number | null;
  /** Enable/disable the ensemble layer on a part's LayeredSampler. */
  setEnsembleLayer(partIndex: number, enabled: boolean): void;
  /** Set air EQ high-shelf gain in dB (e.g. 0 = flat, +2.5 = shimmer boost). */
  setAirEQGain(gainDb: number): void;
  /** Set limiter threshold in dB (e.g. -6). */
  setLimiterThreshold(thresholdDb: number): void;
  /** Set limiter ratio (e.g. 4 = 4:1). */
  setLimiterRatio(ratio: number): void;
  /** Set absolute pan on a layer's sampler (listener-relative, computed from child node position). */
  applyLayerPan(partIndex: number, layerIndex: number, pan: number): void;
}

// ═══════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════

/** Default tempo when no score is loaded (120 BPM is the standard default). */
export const DEFAULT_TEMPO = 120;
/** Default volume (90%). */
export const DEFAULT_VOLUME = 0.9;
/** Debounce interval for MidiTimeline regeneration (ms). */
export const SCORE_CHANGE_DEBOUNCE_MS = 100;
/** Half-width of the stereo field in stage meters. */
export const PAN_RANGE = 2.5;
/** Minimum tempo BPM for UI controls. */
export const MIN_TEMPO = 10;
/** Maximum tempo BPM for UI controls. */
export const MAX_TEMPO = 400;

// ═══════════════════════════════════════════
// Small math helpers
// ═══════════════════════════════════════════

/**
 * Compute a signature of the part list (instruments + percussion kit ids).
 * Used to detect whether samplers must be rebuilt: note edits keep the same
 * signature, but adding/removing parts or kit components changes it.
 */
export function computePartSignature(score: Score): string {
  return score.parts
    .map((p) => {
      const kitIds = p.kit ? Object.keys(p.kit).sort().join("|") : "";
      return `${p.name}::${kitIds}`;
    })
    .join("§");
}

/**
 * Inverse-distance volume with a proximity boost.
 * - At d == refDistance: 1.0 (reference loudness).
 * - At d == refDistance * 0.7: ~1.43 (proximity boost ceiling).
 * - At d >> refDistance: falls off as refDistance / d.
 */
export function proximityVolume(distance: number, refDistance: number): number {
  const r = Math.max(refDistance, 0.001);
  return r / Math.max(distance, r * 0.7);
}

/**
 * Compensate the level loss from equal-power panning.
 * - pan = 0 (center): 1.414 (+3 dB)
 * - pan = ±1 (hard L/R): 1.0 (no change)
 */
export function panCompensation(pan: number): number {
  return 1 / Math.sqrt(0.5 + 0.5 * Math.abs(pan));
}

// ═══════════════════════════════════════════
// Reducer
// ═══════════════════════════════════════════

export type PlaybackAction =
  | { type: "PLAY" }
  | { type: "PAUSE" }
  | { type: "STOP" }
  | { type: "SEEK"; seconds: number }
  | { type: "SET_TEMPO"; bpm: number }
  | { type: "SET_VOLUME"; volume: number }
  | { type: "TOGGLE_METRONOME" }
  | { type: "TOGGLE_COUNT_IN" }
  | { type: "SET_LOOP"; start: number; end: number }
  | { type: "CLEAR_LOOP" }
  | { type: "SET_PLAYHEAD"; position: PlayheadPosition | null }
  | { type: "SET_DURATION"; duration: number }
  | { type: "SET_SCORE_TEMPO"; tempo: number }
  | { type: "SET_STATUS"; status: PlaybackState["status"] }
  | { type: "SET_PART_PATCHES"; patches: PartPatchInfo[] };

/** Initial state factory. */
export function initialPlaybackState(): PlaybackState {
  return {
    status: "stopped",
    playheadPosition: null,
    duration: 0,
    currentTempo: DEFAULT_TEMPO,
    scoreTempo: DEFAULT_TEMPO,
    volume: DEFAULT_VOLUME,
    metronomeEnabled: false,
    countInEnabled: false,
    loop: null,
    partPatches: [],
  };
}

// Per-action handlers. Each handler is responsible for its own no-op
// short-circuit (return the same state ref when nothing changed) so the
// dispatcher stays trivially O(1) and complexity-free.

type ActionHandler<T extends PlaybackAction["type"]> = (
  state: PlaybackState,
  action: Extract<PlaybackAction, { type: T }>,
) => PlaybackState;

const handlePlay: ActionHandler<"PLAY"> = (state) =>
  state.status === "playing" ? state : { ...state, status: "playing" };

const handlePause: ActionHandler<"PAUSE"> = (state) =>
  state.status !== "playing" ? state : { ...state, status: "paused" };

const handleStop: ActionHandler<"STOP"> = (state) =>
  state.status === "stopped" && state.playheadPosition === null
    ? state
    : { ...state, status: "stopped", playheadPosition: null };

const handleSeek: ActionHandler<"SEEK"> = (state, action) => ({
  ...state,
  playheadPosition: {
    // Optimistic position for runtimes where the engine is not ready yet.
    // PlaybackEngine immediately follows with a resolved measure/beat update.
    measureIndex: 0,
    beat: 0,
    timeSeconds: Math.max(0, action.seconds),
  },
});

const handleSetTempo: ActionHandler<"SET_TEMPO"> = (state, action) => {
  const bpm = Math.max(MIN_TEMPO, Math.min(MAX_TEMPO, action.bpm));
  return bpm === state.currentTempo ? state : { ...state, currentTempo: bpm };
};

const handleSetVolume: ActionHandler<"SET_VOLUME"> = (state, action) => {
  const volume = Math.max(0, Math.min(1, action.volume));
  return volume === state.volume ? state : { ...state, volume };
};

const handleToggleMetronome: ActionHandler<"TOGGLE_METRONOME"> = (state) => ({
  ...state,
  metronomeEnabled: !state.metronomeEnabled,
});

const handleToggleCountIn: ActionHandler<"TOGGLE_COUNT_IN"> = (state) => ({
  ...state,
  countInEnabled: !state.countInEnabled,
});

const handleSetLoop: ActionHandler<"SET_LOOP"> = (state, action) => {
  const start = Math.max(0, action.start);
  const end = Math.max(start, action.end);
  if (state.loop && state.loop.start === start && state.loop.end === end) return state;
  return { ...state, loop: { start, end } };
};

const handleClearLoop: ActionHandler<"CLEAR_LOOP"> = (state) =>
  state.loop === null ? state : { ...state, loop: null };

const handleSetPlayhead: ActionHandler<"SET_PLAYHEAD"> = (state, action) => ({
  ...state,
  playheadPosition: action.position,
});

const handleSetDuration: ActionHandler<"SET_DURATION"> = (state, action) =>
  action.duration === state.duration ? state : { ...state, duration: Math.max(0, action.duration) };

const handleSetScoreTempo: ActionHandler<"SET_SCORE_TEMPO"> = (state, action) => {
  const tempo = Math.max(MIN_TEMPO, Math.min(MAX_TEMPO, action.tempo));
  return tempo === state.scoreTempo ? state : { ...state, scoreTempo: tempo };
};

const handleSetStatus: ActionHandler<"SET_STATUS"> = (state, action) =>
  action.status === state.status ? state : { ...state, status: action.status };

const handleSetPartPatches: ActionHandler<"SET_PART_PATCHES"> = (state, action) => ({
  ...state,
  partPatches: action.patches,
});

type HandlerTable = {
  [T in PlaybackAction["type"]]: ActionHandler<T>;
};

const ACTION_HANDLERS: HandlerTable = {
  PLAY: handlePlay,
  PAUSE: handlePause,
  STOP: handleStop,
  SEEK: handleSeek,
  SET_TEMPO: handleSetTempo,
  SET_VOLUME: handleSetVolume,
  TOGGLE_METRONOME: handleToggleMetronome,
  TOGGLE_COUNT_IN: handleToggleCountIn,
  SET_LOOP: handleSetLoop,
  CLEAR_LOOP: handleClearLoop,
  SET_PLAYHEAD: handleSetPlayhead,
  SET_DURATION: handleSetDuration,
  SET_SCORE_TEMPO: handleSetScoreTempo,
  SET_STATUS: handleSetStatus,
  SET_PART_PATCHES: handleSetPartPatches,
};

/** Pure reducer dispatching to per-action handlers from ACTION_HANDLERS. */
export function playbackReducer(state: PlaybackState, action: PlaybackAction): PlaybackState {
  const handler = ACTION_HANDLERS[action.type] as ActionHandler<typeof action.type> | undefined;
  if (!handler) return state;
  // Cast through unknown because TS can't relate the discriminated union to
  // the parameterised handler signature after the runtime indirection.
  return (handler as (s: PlaybackState, a: PlaybackAction) => PlaybackState)(state, action);
}
