/**
 * @viritura/midi — MIDI event timeline and Web MIDI API output.
 *
 * Converts Viritura score models into MIDI event timelines for playback
 * scheduling, and provides Web MIDI API integration for external synths.
 */

// MIDI types
export type { MidiTimeline, MidiEvent, TempoMapEntry, TimelineDiagnostic } from "./types";

// Timeline generator
export { generateTimeline, durationBeats, expandMeasureOrder } from "./timeline";
export { expandMeasureRepeats, expandScoreMeasureRepeats } from "./measureRepeats";
export type { TimelineOptions } from "./timeline";

// Notation-level performance events for VST articulation mapping
export { generatePerformanceEvents } from "./performanceEvents";
export type { PerformanceEvent, PerformanceNote, Articulations, PlayingState } from "./performanceEvents";

// Tempo map
export { buildTempoMap, measureBeatsFromTime, tempoNoteBeats, effectiveQpm, spqAtTime, DEFAULT_BPM } from "./tempoMap";

// Dynamics
export { applyArticulationVelocity, articulationDurationScale, metricAccentOffset, velocityHumanize } from "./dynamics";

// Coupled dynamics envelope (velocity ↔ CC11)
export {
  DYNAMIC_AXES,
  DEFAULT_DYNAMIC,
  dynamicToAxes,
  buildDynamicsEnvelope,
  sampleDynamics,
  noteVelocityAt,
  hasAnyDynamics,
  cc11Events,
} from "./dynamicsEnvelope";
export type { DynamicAxes, DynamicsEnvelope, Cc11Event } from "./dynamicsEnvelope";
export {
  compileDynamicProgram,
  laneForScope,
  laneForSequence,
  playbackLaneId,
  realizeDynamicsEnvelope,
  selectDynamicResponseProfile,
} from "./dynamicPlayback";
export type {
  DynamicPlaybackDiagnostic,
  DynamicProgram,
  DynamicResponseProfile,
  PlaybackLane,
  PlaybackLaneId,
} from "./dynamicPlayback";

// Web MIDI API
export { isWebMidiSupported, listMidiOutputs } from "./webMidi";
export { MidiOutputManager } from "./MidiOutputManager";
export type { MidiOutputPort, MidiOutputManagerEvents } from "./MidiOutputManager";
