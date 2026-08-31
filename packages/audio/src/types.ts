// ═══════════════════════════════════════════
// MIDI Timeline types
// ═══════════════════════════════════════════

/** A single MIDI event in the timeline. */
export interface MidiEvent {
  /** Event type */
  readonly type: "noteOn" | "noteOff" | "programChange" | "controlChange";
  /** Absolute time in seconds from the start of the score */
  readonly time: number;
  /** MIDI note number (0–127) */
  readonly midiNote: number;
  /** Velocity (0–127) */
  readonly velocity: number;
  /** Part index in the Score.parts array */
  readonly partIndex: number;
  /** Independently controlled semantic playback stream. */
  readonly playbackLaneId?: string;
  /** MIDI channel (0–15) */
  readonly channel: number;
  /** GM program number — only present for `type: "programChange"`. */
  readonly program?: number;
  /** GS drum-kit program (bank 128) this note plays on, overriding the part's
   *  default kit. Set for kit-note events whose component borrows a sound from
   *  another kit (e.g. a Tam-tam from the Ethnic kit). */
  readonly drumKitProgram?: number;
  /** MIDI controller number (0–127) — only present for `type: "controlChange"`. */
  readonly cc?: number;
  /** Controller value (0–127) — only present for `type: "controlChange"`. */
  readonly value?: number;
}

/** A tempo map entry marking where tempo changes occur. */
export interface TempoMapEntry {
  /** Measure index (0-based) */
  readonly measureIndex: number;
  /** Beat within the measure (0-based, quarter note = 1) */
  readonly beat: number;
  /** Absolute time in seconds */
  readonly time: number;
  /** Tempo in BPM */
  readonly bpm: number;
}

/** The complete time-ordered MIDI representation of a score. */
export interface MidiTimeline {
  /** All MIDI events sorted by time (ascending) */
  readonly events: readonly MidiEvent[];
  /** Total duration in seconds */
  readonly duration: number;
  /** Tempo map — ordered entries where tempo changes */
  readonly tempoMap: readonly TempoMapEntry[];
  /** Absolute start time (seconds) of each measure, indexed by measure index */
  readonly measureStartTimes: readonly number[];
}

// ═══════════════════════════════════════════
// Sampler interface
// ═══════════════════════════════════════════

/**
 * Abstract sampler interface that the PlaybackEngine programs.
 * Concrete implementations (SfzSampler, etc.) must satisfy this contract.
 */
export interface ISampler {
  /** Trigger a note. `time` is audioContext.currentTime-based. `altKitProgram`
   *  optionally routes a percussion hit to a secondary drum channel loaded with
   *  that GS kit program (kit-component sound override). */
  noteOn(midiNote: number, velocity: number, time?: number, altKitProgram?: number): void;
  /** Release a note. `altKitProgram` mirrors {@link noteOn} so the release
   *  targets the same channel. */
  noteOff(midiNote: number, time?: number, altKitProgram?: number): void;
  /** Immediately release all sounding notes. */
  allNotesOff(): void;
  /** Change the GM program (instrument sound). Optional — not all samplers support it. */
  setProgram?(program: number, time?: number): void;
  /** Send a raw MIDI control change (CC) on this part's channel. Optional. */
  sendControl?(cc: number, value: number, time?: number): void;
  /** Restore baseline instrument + neutral technique filter (pizz/arco/mute). Optional. */
  resetTechniqueState?(): void;
}

// ═══════════════════════════════════════════
// Playback state
// ═══════════════════════════════════════════

/** Transport state. */
export type PlaybackState = "stopped" | "playing" | "paused";

/** Current playhead position for UI consumers. */
export interface PlayheadPosition {
  /** Current measure index (0-based) */
  readonly measureIndex: number;
  /** Beat within the measure (0-based, quarter note = 1) */
  readonly beat: number;
  /** Absolute time in seconds from start of score */
  readonly timeSeconds: number;
}

/**
 * Optional time→position inverse injected into the engine. Maps a score time
 * (seconds) to measure index + beat-in-measure. Supplied by the playback layer
 * from the tempo model so the playhead stays exact through sub-bar tempo
 * changes, rit./accel. and fermata holds. Returns `null` to fall back to the
 * engine's built-in per-bar-linear computation. Keeps `@viritura/audio`
 * decoupled from `@viritura/midi` (the model lives upstream).
 */
export type PlayheadResolver = (scoreTime: number) => { readonly measureIndex: number; readonly beat: number } | null;

// ═══════════════════════════════════════════
// Engine events
// ═══════════════════════════════════════════

/** Event detail for "playhead" events. */
interface PlayheadEventDetail {
  readonly position: PlayheadPosition;
}

/** Event detail for "state" events. */
export interface StateEventDetail {
  readonly state: PlaybackState;
  readonly previousState: PlaybackState;
}

/** Event detail for "loaded" events. */
export interface LoadedEventDetail {
  readonly partCount: number;
  readonly duration: number;
}

/** Event detail for "error" events. */
export interface ErrorEventDetail {
  readonly message: string;
  readonly type: "load" | "playback" | "sampler";
}

/** Map of event names to their detail types. */
export interface PlaybackEventMap {
  readonly playhead: PlayheadEventDetail;
  readonly state: StateEventDetail;
  readonly loaded: LoadedEventDetail;
  readonly error: ErrorEventDetail;
}

/** Callback type for playback events. */
export type PlaybackEventCallback<K extends keyof PlaybackEventMap> = (detail: PlaybackEventMap[K]) => void;

// ═══════════════════════════════════════════
// Engine configuration
// ═══════════════════════════════════════════

/** Configuration options for the PlaybackEngine. */
export interface PlaybackEngineOptions {
  /** Schedule-ahead window in seconds (default: 0.5).
   *  Events are pre-scheduled this far into the audio timeline with absolute
   *  timestamps, so they render on the audio thread even if the main thread
   *  is blocked. The window MUST exceed the worst-case main-thread stall
   *  (notably the synchronous Canvas2D full-score repaint on view switches),
   *  otherwise events in the gap become stale: late `noteOn`s are dropped and
   *  `noteOff`s fire crammed to now, producing an audible glitch. 0.5s covers
   *  a ~500ms paint block; the only cost is mid-playback tempo changes taking
   *  up to one window to apply (seek rebuilds the scheduler, so it's exact). */
  readonly scheduleAheadTime?: number;
  /** Look-ahead tick interval in milliseconds (default: 25) */
  readonly tickIntervalMs?: number;
  /** Playhead update interval in milliseconds (default: 1000/60 ≈ 16.67) */
  readonly playheadIntervalMs?: number;
  /** Pre-roll added to the first scheduling tick in seconds (default: 0.12).
   *  Without this, score-time-0 events fire at `audioContext.currentTime`
   *  exactly, which ra5es worklet processing latency and produces a
   *  per-section "flam" on the downbeat. 80–150ms is inaudible as a delay
   *  but reliably gives every section synth the same start quantum. */
  readonly leadInTime?: number;
}

/** Default engine configuration values. */
export const DEFAULT_ENGINE_OPTIONS: Required<PlaybackEngineOptions> = {
  scheduleAheadTime: 0.2,
  tickIntervalMs: 25,
  playheadIntervalMs: 1000 / 60,
  leadInTime: 0.12,
} as const;

// ═══════════════════════════════════════════
// Scheduler types
// ═══════════════════════════════════════════

/** Callback invoked by the Scheduler for each MidiEvent within the schedule window. */
export type ScheduleCallback = (event: MidiEvent, audioTime: number) => void;

/**
 * A single pre-scheduled metronome click, expressed in score time. Built by
 * the playback layer from the tempo model + meter so clicks are sample-accurate
 * through sub-bar tempo changes / rit. / fermata holds (unlike a reactive
 * beat-crossing click, which is jittered by the playhead poll interval).
 */
export interface ClickEvent {
  /** Absolute score time (seconds) of the click. */
  readonly time: number;
  /** Whether this click is the accented (downbeat) click of its measure. */
  readonly accented: boolean;
}

/** Callback invoked by the Scheduler for each click within the schedule window. */
export type ClickCallback = (audioTime: number, accented: boolean) => void;

/** Scheduler configuration. */
export interface SchedulerConfig {
  /** How far ahead (in seconds) to schedule events */
  readonly scheduleAheadTime: number;
  /** How often (in ms) the look-ahead timer fires */
  readonly tickIntervalMs: number;
  /** Pre-roll added to startAudioTime so the first events have time to
   *  cross the postMessage boundary to the worklet. Default 0. */
  readonly leadInTime?: number;
}
