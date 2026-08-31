/**
 * @viritura/midi — MIDI event timeline types.
 *
 * These types represent the output of the MIDI timeline generator:
 * a time-ordered sequence of MIDI noteOn/noteOff events with absolute
 * timestamps in seconds.
 */

import type { TempoModel } from "./tempoModel";

/** A single MIDI event (noteOn, noteOff, programChange, or controlChange). */
export interface MidiEvent {
  /** Event type */
  type: "noteOn" | "noteOff" | "programChange" | "controlChange";
  /** Absolute time in seconds from the start of the score */
  time: number;
  /** MIDI note number (0–127) */
  midiNote: number;
  /** Velocity (0–127). noteOff events use 0. */
  velocity: number;
  /** Index into score.parts[] identifying which instrument plays this event */
  partIndex: number;
  /** Independently controlled semantic playback stream. */
  playbackLaneId?: string;
  /** MIDI channel (0–15) */
  channel: number;
  /** GM program number — only present for `type: "programChange"`. */
  program?: number;
  /** GS drum-kit program (bank 128) this note should play on, overriding the
   *  part's default kit. Only set for kit-note events whose component borrows a
   *  sound from another kit (e.g. a Tam-tam from the Ethnic kit). The audio
   *  engine routes such hits to a dedicated drum channel loaded with this kit. */
  drumKitProgram?: number;
  /** MIDI controller number (0–127) — only present for `type: "controlChange"`. */
  cc?: number;
  /** Controller value (0–127) — only present for `type: "controlChange"`. */
  value?: number;
}

/** An entry in the tempo map for playhead positioning. */
export interface TempoMapEntry {
  /** Global measure index (0-based) */
  measureIndex: number;
  /** Beat offset within the measure (in quarter-note beats) */
  beatInMeasure: number;
  /** Absolute time in seconds when this tempo takes effect */
  timeSeconds: number;
  /** Tempo in beats per minute (quarter-note = 1 beat) */
  bpm: number;
}

/** The complete MIDI timeline generated from a Score. */
export interface MidiTimeline {
  /** Time-ordered MIDI events (noteOn and noteOff interleaved) */
  events: MidiEvent[];
  /** Total duration of the score in seconds */
  duration: number;
  /** Tempo map entries for playhead and UI synchronization */
  tempoMap: TempoMapEntry[];
  /** Absolute start time (seconds) of each measure, indexed by measure index */
  measureStartTimes: number[];
  /** Continuous tempo model — the sub-bar-resolved beat↔time map used to
   *  generate this timeline. Enables an exact playhead inverse and click-track
   *  scheduling through tempo changes / rit. / fermata holds. In-process only
   *  (a class instance; not part of the serialized export payload). */
  model: TempoModel;
  /** Global quarter-note beat at each expanded measure's start (the model's
   *  beat axis). `model.timeAtBeat(measureStartBeats[i])` === `measureStartTimes[i]`.
   *  Lets a global beat from `model.beatAtTime` be split into measure + beat. */
  measureStartBeats: number[];
  /** Original score measure index for each expanded timeline measure. This is
   *  parallel to `measureStartBeats` and preserves renderer coordinates when
   *  repeats or jumps cause timeline measures to revisit score measures. */
  expandedMeasureToOriginal: number[];
  /** Active time signature at each expanded measure (parallel to
   *  `measureStartBeats`). Lets a consumer derive the metronome click grid per
   *  measure (which beats click, where the accent falls) without re-resolving
   *  the score's meter changes. */
  measureTimeSignatures: { count: number; unit: number }[];
  /** Explicit degradation notices for physical MIDI 1 channel allocation. */
  diagnostics?: TimelineDiagnostic[];
}

export interface TimelineDiagnostic {
  code: "midi-channel-capacity" | "percussion-lane-collapse";
  message: string;
  playbackLaneIds: string[];
}
