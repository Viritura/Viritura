/**
 * MIDI timeline generator — converts a Score into a time-ordered sequence
 * of MIDI noteOn/noteOff events with absolute timestamps.
 *
 * The generator is stateless and deterministic: the same Score always
 * produces the same MidiTimeline.
 *
 * Algorithm:
 * 1. Expand repeats and jumps into a linear measure order
 * 2. Build a tempo map from the expanded global measures
 * 3. For each part, walk the expanded measures and emit MIDI events
 * 4. Resolve ties (suppress intermediate noteOn/noteOff pairs)
 * 5. Sort all events by time
 */

/* eslint-disable max-lines -- The ornament-expansion cluster (kit roll,
   single/multi-note tremolo, trill, grace, tuplet) is mutually recursive with
   processNoteEvent/processContentItem and shares a dozen module-private
   helpers (eventTime, eventSeconds, timingHumanize, pitchToMidi, …). Splitting
   it out would require exporting those internals and create circular imports —
   more risk than the ~10-line overage warrants. Revisit if the timing/event
   helpers are first promoted to their own sibling. */

import type {
  Score,
  GlobalMeasure,
  NoteEvent,
  Sequence,
  SequenceContent,
  Duration,
  TimeSignature,
  Grace,
  Note,
  KitNote,
  Pitch,
  Step,
  Octave,
} from "@viritura/core";
import { pitchToMidi, isRest, DURATION_BEATS, SHARP_ORDER, FLAT_ORDER } from "@viritura/core";
import { detectToCodaMeasureIndex, expandMeasureOrder } from "./repeatExpansion";
import { expandScoreMeasureRepeats } from "./measureRepeats";
import { analyzeImpliedSectionDynamics, type ImpliedSectionDynamicAnchor } from "./sectionDynamics";
import { buildHoldSchedule, type HoldSchedule, type MeasureHold } from "./holds";
import { playbackGlobalMeasures, suppressCadenzaFermataHolds } from "./cadenzaTiming";
import { collectPartLegatoOut, flushVoiceLegato, flushAllLegato, pushVoiceLegato, resolveVoiceLegato } from "./legato";
import { ARCO_CAPABLE_PROGRAMS, muteFamilyForProgram, applyMeasureTechniques, type TechniqueState } from "./technique";
export { expandMeasureOrder };

/** GM percussion channel (0-based; channel 10 in 1-based MIDI numbering). */
export const GM_DRUM_CHANNEL = 9;

/**
 * Resolve the effective MIDI note for a pitched note.
 * For pitched notes, returns pitchToMidi(note.pitch).
 */
function noteToMidi(note: Note): number {
  return pitchToMidi(note.pitch);
}

/** Resolve the effective MIDI note for a kit-note via the kitMidiMap. */
function kitNoteToMidi(kn: KitNote, kitMidiMap: ReadonlyMap<string, number>): number {
  return kitMidiMap.get(kn.kitComponent) ?? -1;
}
import type { MidiEvent, MidiTimeline, TempoMapEntry, TimelineDiagnostic } from "./types";
import { buildTempoMap, buildTempoModel, measureBeatsFromTime, DEFAULT_BPM } from "./tempoMap";
import { TempoModel } from "./tempoModel";
import {
  applyArticulationVelocity,
  articulationDurationScale,
  metricAccentOffset,
  velocityHumanize,
  timingHumanize,
} from "./dynamics";
import { noteVelocityAt, emitDynamicsCc11, type DynamicsEnvelope } from "./dynamicsEnvelope";
import { compileDynamicProgram, laneForScope, laneForSequence } from "./dynamicPlayback";
import type { DynamicProgram } from "./dynamicPlayback";

// ═══════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════

/** Duration per grace note in beats (≈ 32nd note). */
const GRACE_NOTE_BEATS = 0.125;

// ═══════════════════════════════════════════
// Duration helpers
// ═══════════════════════════════════════════

/** Compute quarter-note beats for a Duration (base + dots). */
export function durationBeats(d: Duration): number {
  const base = DURATION_BEATS[d.base] ?? 1;
  if (!d.dots) return base;
  return base * (2 - Math.pow(2, -d.dots));
}

/** Convert a measure-relative fraction (of a whole note) to quarter-note beats. */
export function fractionToBeats(frac: readonly [number, number]): number {
  if (!frac || frac[1] === 0) return 0;
  return (frac[0] / frac[1]) * 4;
}

// ═══════════════════════════════════════════
// Main timeline generator
// ═══════════════════════════════════════════

/** Options for timeline generation. */
export interface TimelineOptions {
  /** GM program number per part index (used for tremolo sound selection). */
  partPrograms?: number[];
}

/**
 * Per-part shared context threaded through every process* helper.
 * Pulled out so the process* signatures don't carry 13–15 parameters each.
 *
 * `partIndex`/`channel`/`gmProgram`/`timeSig`/`kitMidiMap`/`tieTargets`/
 * `pendingTieOffs`/`out`/`tempoMap` are invariant for the lifetime of a
 * single part's traversal; per-event state (measureStartTime, beatOffset,
 * baseVelocity, tupletRatio) stays as explicit parameters because it
 * mutates per recursion step.
 */
export interface PartCtx {
  readonly tempoMap: readonly TempoMapEntry[];
  /** Continuous tempo map (single source of timing). Event times are
   *  `model.timeAtBeat(measureStartBeat + beatOffset)`, resolved at sub-bar
   *  granularity so mid-bar tempo changes, rit./accel. and fermata/caesura time
   *  insertions all take effect at any nesting depth (no per-bar quantization). */
  readonly model: TempoModel;
  /** Global quarter-note beat at the current measure's start (the hold-free
   *  beat axis the model integrates over). */
  readonly measureStartBeat: number;
  readonly partIndex: number;
  readonly channel: number;
  readonly tieTargets: ReadonlySet<string>;
  readonly pendingTieOffs: Map<string, MidiEvent>;
  /** Event ids interior to a slur span; their noteOff is deferred and resolved as a legato overlap. */
  readonly legatoOutIds: ReadonlySet<string>;
  /** Deferred legato noteOffs awaiting the next note's onset, bucketed BY VOICE
   *  so a slur in one voice isn't resolved by a note in another. Each off carries
   *  its natural (fallback) time, overwritten on resolution. Threaded across
   *  measures (like `pendingTieOffs`) so slurs cross bar lines. */
  readonly pendingLegato: Map<string, MidiEvent[]>;
  /** Identity of the voice (sequence) currently being processed. Tie and legato
   *  pairing state is keyed by this so a multi-voice part (e.g. piano, two hands
   *  sharing pitches) doesn't cross-contaminate noteOn/noteOff pairing. Mutated
   *  per sequence in processPart. */
  voiceKey: string;
  readonly out: MidiEvent[];
  readonly gmProgram: number;
  readonly timeSig: TimeSignature;
  /** Active key signature (circle-of-fifths) at this measure; drives trill auxiliaries. */
  readonly keyFifths: number;
  readonly kitMidiMap: ReadonlyMap<string, number> | undefined;
  /** kit-component-id → GS drum-kit program override (bank 128). Hits on these
   *  components play on a separate drum channel loaded with the given kit, so a
   *  percussion staff can borrow a sound its main kit lacks (e.g. a Tam-tam from
   *  the Ethnic kit). undefined when no component overrides its kit. */
  readonly kitAltProgramMap: ReadonlyMap<string, number> | undefined;
  /** Coupled velocity/CC11 dynamics over time for this part. Velocity is sampled
   *  per note onset; CC11 is emitted separately (see emitDynamicsCc11). */
  dynamicsEnvelope: DynamicsEnvelope;
  playbackLaneId: string;
  readonly dynamicProgram: DynamicProgram;
  sequenceStaff: number;
  sequenceVoice: string;
  /** Seconds per quarter-note beat at this measure's start (for fermata resume). */
  readonly measureSpq: number;
  /** Fermata groups in this measure (from the hold schedule). The hold's time
   *  insertion is baked into the tempo model at `insertBeat`, so a carrier whose
   *  onset falls in [startBeat, spanEndBeat) rings through the gap automatically
   *  (its model duration already spans the insertion); we only force-extend a
   *  member that ends BEFORE `insertBeat` up to the group's resume time. Beats
   *  are measure-relative. Empty when the measure has no fermata. */
  readonly fermataGroups: readonly { startBeat: number; spanEndBeat: number; insertBeat: number }[];
}

/** An empty timeline (no measures / no playable content). */
function emptyTimeline(): MidiTimeline {
  return {
    events: [],
    duration: 0,
    tempoMap: [],
    measureStartTimes: [],
    model: TempoModel.build([]),
    measureStartBeats: [],
    expandedMeasureToOriginal: [],
    measureTimeSignatures: [],
    diagnostics: [],
  };
}

/**
 * Generate a MIDI timeline from a Score.
 *
 * @param score - The score to convert
 * @param options - Optional generation options
 * @returns A MidiTimeline with time-sorted events, total duration, and tempo map
 */
export function generateTimeline(inputScore: Score, options?: TimelineOptions): MidiTimeline {
  // Simile marks stand in for earlier bars; substitute the real music before
  // anything downstream reads part measures.
  const score = expandScoreMeasureRepeats(inputScore);
  const impliedSectionDynamics = analyzeImpliedSectionDynamics(score);
  const globalMeasures = score.global.measures;
  if (globalMeasures.length === 0) {
    return emptyTimeline();
  }

  // Step 1: Expand repeats/jumps into linear measure order
  const toCodaMeasureIndex = detectToCodaMeasureIndex(score);
  const measureOrder = expandMeasureOrder(globalMeasures, { toCodaMeasureIndex });
  if (measureOrder.length === 0) {
    return emptyTimeline();
  }

  // Step 2: Build the fermata/caesura hold schedule, then the tempo map. The
  // schedule shifts every later measure's start time so holds keep all parts
  // aligned through the pause.
  const expandedGlobal = playbackGlobalMeasures(score, measureOrder);
  const holdSchedule = suppressCadenzaFermataHolds(
    expandedGlobal,
    buildHoldSchedule(score, measureOrder, globalMeasures),
  );
  // Continuous tempo model + global beat axis (single source of event timing).
  // `measureStartTimes` is derived FROM the model so it matches event timing
  // through sub-bar tempo changes / holds. The legacy `tempoMap` entry array is
  // kept for UI, dynamics, and the score-engine consumers.
  const { tempoMap } = buildTempoMap(expandedGlobal, holdSchedule);
  const { model, measureStartTimes, measureStartBeats } = buildTempoModel(expandedGlobal, holdSchedule);
  const timing: TimelineTiming = { tempoMap, measureStartTimes, model, measureStartBeats };

  // Step 3: For each part, generate MIDI events
  const allEvents: MidiEvent[] = [];
  const partChannels = allocatePartChannels(score.parts);

  for (let partIdx = 0; partIdx < score.parts.length; partIdx++) {
    processPart(
      score,
      partIdx,
      options,
      partChannels,
      timing,
      measureOrder,
      globalMeasures,
      holdSchedule,
      impliedSectionDynamics.get(partIdx) ?? [],
      allEvents,
    );
  }

  const diagnostics = assignPhysicalMidiChannels(allEvents, score);

  // Step 4: Sort by time, then noteOff before programChange before noteOn at same time
  const EVENT_TYPE_ORDER: Record<string, number> = { noteOff: 0, programChange: 1, controlChange: 1, noteOn: 2 };
  allEvents.sort((a, b) => {
    if (Math.abs(a.time - b.time) > 1e-9) return a.time - b.time;
    const aOrder = EVENT_TYPE_ORDER[a.type] ?? 1;
    const bOrder = EVENT_TYPE_ORDER[b.type] ?? 1;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.midiNote - b.midiNote;
  });

  // Calculate total duration from last measure
  const lastExpandedIdx = measureOrder.length - 1;
  const lastMeasureBeats = measureBeatsFromTime(expandedGlobal[lastExpandedIdx]!.time ?? { count: 4, unit: 4 });
  const lastTempoQpm = tempoMap.length > 0 ? tempoMap[tempoMap.length - 1]!.bpm : DEFAULT_BPM;
  const duration = measureStartTimes[lastExpandedIdx]! + lastMeasureBeats * (60 / lastTempoQpm);

  // Active time signature per expanded measure (for the metronome click grid).
  const measureTimeSignatures = measureOrder.map((origIdx) => {
    const ts = resolveActiveTime(globalMeasures, origIdx);
    return { count: ts.count, unit: ts.unit };
  });

  return {
    events: allEvents,
    duration,
    tempoMap,
    measureStartTimes,
    model,
    measureStartBeats,
    expandedMeasureToOriginal: measureOrder,
    measureTimeSignatures,
    diagnostics,
  };
}

/** Assign one MIDI 1 channel per independent dynamic lane where possible.
 *  Internal SF2 playback ignores this projection and allocates unbounded synth
 *  instances; this mapping is for Web MIDI and future SMF export. */
function assignPhysicalMidiChannels(events: MidiEvent[], score: Score): TimelineDiagnostic[] {
  const melodicChannels = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];
  const lanesByPart = new Map<number, Set<string>>();
  for (const event of events) {
    const laneId = event.playbackLaneId ?? `part:${event.partIndex}`;
    const lanes = lanesByPart.get(event.partIndex) ?? new Set<string>();
    lanes.add(laneId);
    lanesByPart.set(event.partIndex, lanes);
  }

  const channelByLane = new Map<string, number>();
  const diagnostics: TimelineDiagnostic[] = [];
  let melodicIndex = 0;
  for (const [partIndex, laneSet] of [...lanesByPart].sort(([left], [right]) => left - right)) {
    const laneIds = [...laneSet].sort();
    const percussion = !!score.parts[partIndex]?.kit && Object.keys(score.parts[partIndex]!.kit!).length > 0;
    if (percussion) {
      for (const laneId of laneIds) channelByLane.set(laneId, GM_DRUM_CHANNEL);
      if (laneIds.length > 1) {
        diagnostics.push({
          code: "percussion-lane-collapse",
          message: `Physical MIDI collapses ${laneIds.length} scoped percussion lanes in part ${partIndex} onto channel 10.`,
          playbackLaneIds: laneIds,
        });
      }
      continue;
    }
    for (const laneId of laneIds) {
      if (melodicIndex < melodicChannels.length) {
        channelByLane.set(laneId, melodicChannels[melodicIndex++]!);
      } else {
        channelByLane.set(laneId, melodicChannels[melodicIndex++ % melodicChannels.length]!);
        diagnostics.push({
          code: "midi-channel-capacity",
          message: `Physical MIDI channel capacity exceeded; lane ${laneId} must share a channel.`,
          playbackLaneIds: [laneId],
        });
      }
    }
  }

  for (const event of events) {
    event.channel = channelByLane.get(event.playbackLaneId ?? `part:${event.partIndex}`) ?? event.channel;
  }
  return diagnostics;
}

// ═══════════════════════════════════════════
// Tie target collection
// ═══════════════════════════════════════════

/** Add every tie-target note id from `notes` to `targets`. */
function collectNoteTieTargets(notes: readonly Note[] | undefined, targets: Set<string>): void {
  if (!notes) return;
  for (const note of notes) {
    if (!note.ties) continue;
    for (const tie of note.ties) {
      if (tie.target) targets.add(tie.target);
    }
  }
}

/** Recursively collect all note IDs that are tie targets. */
function collectTieTargets(content: readonly SequenceContent[], targets: Set<string>): void {
  for (const item of content) {
    if (item.type === "event") {
      collectNoteTieTargets(item.notes, targets);
    } else if (item.type === "tuplet") {
      collectTieTargets(item.content, targets);
    } else if (item.type === "grace") {
      // Grace notes may also have ties
      for (const evt of item.content) {
        collectNoteTieTargets(evt.notes, targets);
      }
    }
  }
}

// ═══════════════════════════════════════════
// Sequence processing
// ═══════════════════════════════════════════

/**
 * Allocate a MIDI channel per part, sending percussion parts to
 * `GM_DRUM_CHANNEL` and round-robining the rest across the remaining
 * 15 channels while skipping channel 9 (reserved for GM drums).
 */
function allocatePartChannels(parts: readonly Score["parts"][number][]): number[] {
  const MIDI_CHANNELS = 16;
  const channels: number[] = [];
  let melodicCounter = 0;
  for (const part of parts) {
    const isPerc = !!part.kit && Object.keys(part.kit).length > 0;
    if (isPerc) {
      channels.push(GM_DRUM_CHANNEL);
    } else {
      while (melodicCounter % MIDI_CHANNELS === GM_DRUM_CHANNEL) melodicCounter++;
      channels.push(melodicCounter % MIDI_CHANNELS);
      melodicCounter++;
    }
  }
  return channels;
}

/**
 * Build the `kit-component-id → MIDI note` map for a percussion part.
 * Returns undefined for non-percussion parts.
 */
function buildKitMidiMap(score: Score, part: Score["parts"][number]): ReadonlyMap<string, number> | undefined {
  if (!part.kit || Object.keys(part.kit).length === 0) return undefined;
  const map = new Map<string, number>();
  const sounds = score.global.sounds ?? {};
  for (const [id, comp] of Object.entries(part.kit)) {
    const sound = comp.sound ? sounds[comp.sound] : undefined;
    if (sound && typeof sound.midiNumber === "number") {
      map.set(id, sound.midiNumber);
    }
  }
  return map;
}

/**
 * Build the `kit-component-id → drum-kit program` override map. Only components
 * carrying a `drumKit` vendor field appear; their hits play on a dedicated drum
 * channel loaded with that GS kit program (e.g. a Tam-tam borrowed from the
 * Ethnic kit). Returns undefined when no component overrides its kit.
 */
function buildKitAltProgramMap(part: Score["parts"][number]): ReadonlyMap<string, number> | undefined {
  if (!part.kit) return undefined;
  let map: Map<string, number> | undefined;
  for (const [id, comp] of Object.entries(part.kit)) {
    if (typeof comp.drumKit === "number") {
      (map ??= new Map()).set(id, comp.drumKit);
    }
  }
  return map;
}

/**
 * Pre-scan a part to collect every note id that is the target of a tie.
 * These notes have their noteOn suppressed and instead extend the
 * preceding pending noteOff.
 */
function collectPartTieTargets(part: Score["parts"][number], measureOrder: readonly number[]): Set<string> {
  const tieTargets = new Set<string>();
  for (const expandedIdx of measureOrder) {
    const partMeasure = part.measures[expandedIdx];
    if (!partMeasure) continue;
    for (const seq of partMeasure.sequences) {
      collectTieTargets(seq.content, tieTargets);
    }
  }
  return tieTargets;
}

/** Timing bundle threaded into `processPart` (keeps the param count in check). */
interface TimelineTiming {
  readonly tempoMap: readonly TempoMapEntry[];
  readonly measureStartTimes: readonly number[];
  readonly model: TempoModel;
  readonly measureStartBeats: readonly number[];
}

/**
 * Generate every MIDI event for a single part, appending to `allEvents`.
 * Extracted from generateTimeline so neither function exceeds the
 * complexity / statement budget.
 */
function processPart(
  score: Score,
  partIdx: number,
  options: TimelineOptions | undefined,
  partChannels: readonly number[],
  timing: TimelineTiming,
  measureOrder: readonly number[],
  globalMeasures: readonly GlobalMeasure[],
  holdSchedule: HoldSchedule,
  impliedDynamics: readonly ImpliedSectionDynamicAnchor[],
  allEvents: MidiEvent[],
): void {
  const { tempoMap, measureStartTimes, model, measureStartBeats } = timing;
  const part = score.parts[partIdx]!;
  const channel = partChannels[partIdx]!;
  const gmProgram = options?.partPrograms?.[partIdx] ?? -1;
  const kitMidiMap = buildKitMidiMap(score, part);
  const kitAltProgramMap = buildKitAltProgramMap(part);
  const tieTargets = collectPartTieTargets(part, measureOrder);
  const pendingTieOffs = new Map<string, MidiEvent>();
  const legatoOutIds = collectPartLegatoOut(part);
  const pendingLegato = new Map<string, MidiEvent[]>();

  // Coupled dynamics: a single source of truth for velocity (sampled per note)
  // and CC11 (emitted up front so it spans note boundaries for held-note shaping).
  const dynamicProgram = compileDynamicProgram(
    part,
    partIdx,
    measureOrder,
    measureStartBeats,
    model,
    globalMeasures,
    gmProgram,
    impliedDynamics,
  );
  for (const lane of dynamicProgram.lanes.values()) {
    emitDynamicsCc11(lane.envelope, partIdx, channel, allEvents, lane.id);
  }

  // Persistent pizz/arco + con sord. keyswitch state.
  const bowCapable = ARCO_CAPABLE_PROGRAMS.has(gmProgram);
  const muteFamily = muteFamilyForProgram(gmProgram);
  const techniqueEnabled = bowCapable || muteFamily !== null;
  let techniqueState: TechniqueState = { program: gmProgram, muted: false };

  for (let expandedIdx = 0; expandedIdx < measureOrder.length; expandedIdx++) {
    const origMeasureIdx = measureOrder[expandedIdx]!;
    const partMeasure = part.measures[origMeasureIdx];
    if (!partMeasure) continue;

    const measureStartTime = measureStartTimes[expandedIdx]!;
    const measureStartBeat = measureStartBeats[expandedIdx]!;
    const activeTime = resolveActiveTime(globalMeasures, origMeasureIdx);
    const activeKeyFifths = resolveActiveKeyFifths(globalMeasures, origMeasureIdx);

    // Fermata/caesura holds for this measure shift later events within it.
    const measureHolds = holdSchedule[expandedIdx] ?? [];
    const measureSpq = model.spbAtBeat(measureStartBeat);
    // Each fermata hold is a merged span [startBeat, spanEndBeat) whose time
    // insertion lives in the tempo model at the driver-end beat (`atBeat`). A
    // carrier in the span rings through the gap automatically; the group bounds
    // let resolveFermataDuration force-extend a member that ends early.
    const fermataGroups = measureHolds
      .filter((h) => h.kind === "fermata")
      .map((h) => ({
        startBeat: h.startBeat ?? h.atBeat,
        spanEndBeat: h.spanEndBeat ?? h.atBeat,
        insertBeat: h.atBeat,
      }));

    const ctx: PartCtx = {
      tempoMap,
      model,
      measureStartBeat,
      partIndex: partIdx,
      channel,
      tieTargets,
      pendingTieOffs,
      legatoOutIds,
      pendingLegato,
      voiceKey: "",
      out: allEvents,
      gmProgram,
      timeSig: activeTime,
      keyFifths: activeKeyFifths,
      kitMidiMap,
      kitAltProgramMap,
      dynamicsEnvelope: dynamicProgram.lanes.values().next().value!.envelope,
      playbackLaneId: dynamicProgram.lanes.values().next().value!.id,
      dynamicProgram,
      sequenceStaff: 1,
      sequenceVoice: "sequence:0",
      measureSpq,
      fermataGroups,
    };

    if (techniqueEnabled) {
      techniqueState = applyMeasureTechniques(partMeasure.expressions, ctx, techniqueState, {
        bow: bowCapable,
        mute: muteFamily,
      });
    }

    partMeasure.sequences.forEach((seq, seqIdx) => {
      // Per-voice identity for tie/legato pairing: the MNX voice id when present
      // (stable across measures so ties cross bar lines), else the sequence slot.
      ctx.voiceKey = seq.voice ?? `v${seqIdx}`;
      const lane = laneForSequence(dynamicProgram, partIdx, seq, seqIdx);
      ctx.sequenceStaff = seq.staff ?? 1;
      ctx.sequenceVoice = lane.voice;
      ctx.dynamicsEnvelope = lane.envelope;
      ctx.playbackLaneId = lane.id;
      const firstNewEvent = allEvents.length;
      processSequence(ctx, seq, measureStartTime, measureHolds, measureSpq);
      stampPlaybackLane(allEvents, firstNewEvent, lane.id);
      stampPendingLane(ctx, lane.id);
    });
  }

  // Flush any remaining pending tie noteOffs
  for (const noteOff of pendingTieOffs.values()) {
    allEvents.push(noteOff);
  }

  // Flush deferred legato noteOffs left open at the end of the part, per voice (a
  // slur that runs to the final note with no following onset to overlap).
  flushAllLegato(pendingLegato, allEvents);
}

function stampPlaybackLane(events: MidiEvent[], startIndex: number, laneId: string): void {
  for (let i = startIndex; i < events.length; i++) events[i]!.playbackLaneId ??= laneId;
}

function stampPendingLane(ctx: PartCtx, laneId: string): void {
  for (const event of ctx.pendingTieOffs.values()) event.playbackLaneId ??= laneId;
  for (const events of ctx.pendingLegato.values()) {
    for (const event of events) event.playbackLaneId ??= laneId;
  }
}

/** Absolute time (s) of a measure-relative beat, via the continuous model. */
function eventTime(ctx: PartCtx, beatOffset: number): number {
  return ctx.model.timeAtBeat(ctx.measureStartBeat + beatOffset);
}

/** Seconds spanned by `beats` starting at a measure-relative beat. */
function eventSeconds(ctx: PartCtx, beatOffset: number, beats: number): number {
  return ctx.model.secondsForBeats(ctx.measureStartBeat + beatOffset, beats);
}

/** Sample the part's coupled dynamic velocity (the noteOn level) at a measure beat. */
function dynamicVelocityAt(ctx: PartCtx, measureStartTime: number, beatOffset: number): number {
  void measureStartTime;
  return noteVelocityAt(ctx.dynamicsEnvelope, eventTime(ctx, beatOffset));
}

/** Run one note event against its effective staff/voice dynamics lane and tag
 *  every emitted or deferred MIDI event with that lane identity. */
function processScopedNoteEvent(
  ctx: PartCtx,
  event: NoteEvent,
  measureStartTime: number,
  beatOffset: number,
  tupletRatio: number,
): number {
  const previousEnvelope = ctx.dynamicsEnvelope;
  const previousLaneId = ctx.playbackLaneId;
  const lane = laneForScope(ctx.dynamicProgram, ctx.partIndex, event.staff ?? ctx.sequenceStaff, ctx.sequenceVoice);
  ctx.dynamicsEnvelope = lane.envelope;
  ctx.playbackLaneId = lane.id;
  const firstNewEvent = ctx.out.length;
  const beats = processNoteEvent(
    ctx,
    event,
    measureStartTime,
    beatOffset,
    dynamicVelocityAt(ctx, measureStartTime, beatOffset),
    tupletRatio,
  );
  stampPlaybackLane(ctx.out, firstNewEvent, lane.id);
  stampPendingLane(ctx, lane.id);
  ctx.dynamicsEnvelope = previousEnvelope;
  ctx.playbackLaneId = previousLaneId;
  return beats;
}

/**
 * Process a single sequence (voice), appending events to `ctx.out`.
 *
 * Fermata/caesura time insertions are baked into the continuous tempo model, so
 * every event's absolute time (`eventTime`) already reflects holds at any
 * nesting depth — no per-item offset bookkeeping is needed here.
 */
function processSequence(
  ctx: PartCtx,
  seq: Sequence,
  measureStartTime: number,
  measureHolds: readonly MeasureHold[],
  spq: number,
): void {
  void measureHolds;
  void spq;
  if (seq.fullMeasure) return;

  let beatCursor = 0;
  for (const item of seq.content) {
    beatCursor += processContentItem(ctx, item, measureStartTime, beatCursor, 1.0);
  }
}

/**
 * Process a single content item. Returns the number of beats consumed.
 *
 * The noteOn velocity (dynamic level) is sampled from the coupled dynamics
 * envelope at each event's onset, so it is position-aware within the measure.
 */
function processContentItem(
  ctx: PartCtx,
  item: SequenceContent,
  measureStartTime: number,
  beatOffset: number,
  tupletRatio: number,
): number {
  switch (item.type) {
    case "event":
      return processScopedNoteEvent(ctx, item, measureStartTime, beatOffset, tupletRatio);

    case "tuplet":
      return processTuplet(ctx, item, measureStartTime, beatOffset, tupletRatio);

    case "grace":
      return processGrace(ctx, item, measureStartTime, beatOffset, tupletRatio);

    case "space":
      // Space: advance time without emitting events
      // duration is [numerator, denominator] as a fraction of a whole note
      return (item.duration[0] / item.duration[1]) * 4 * tupletRatio;

    case "tremolo":
      return processTremolo(ctx, item, measureStartTime, beatOffset, tupletRatio);

    default:
      return 0;
  }
}

/**
 * Resolve a note's sounding duration and articulation gap scale.
 *
 * The fermata's time insertion lives in the tempo model at the group's
 * driving-note end, so a held carrier's MODEL duration already spans the gap —
 * it rings through automatically (the followers shifted with it at any nesting
 * depth, so there is no "bleed"). We only force-extend a group member that ends
 * BEFORE the insertion beat up to the group's resume time, so staggered-end
 * fermatas still release together. A bar may have several disjoint groups; the
 * carrier is matched by onset beat. A held note isn't detached → gap scale 1.
 */
function resolveFermataDuration(
  ctx: PartCtx,
  event: NoteEvent,
  naturalDurationSec: number,
  beatOffset: number,
): { durationSec: number; durationScale: number; held: boolean } {
  if (event.fermata && event.fermata.duration !== "none" && ctx.fermataGroups.length > 0) {
    // Match the carrier to the group whose span contains its onset beat.
    const group = ctx.fermataGroups.find((g) => beatOffset >= g.startBeat - 1e-9 && beatOffset < g.spanEndBeat - 1e-9);
    if (group) {
      // Resume time = model time at the (post-insertion) driver-end beat. For
      // the driver and any member ending at/after it, naturalDurationSec already
      // reaches this (the gap is inside its span); a member ending earlier is
      // extended up to it so the group releases together.
      const startTime = eventTime(ctx, beatOffset);
      const resumeTime = ctx.model.timeAtBeat(ctx.measureStartBeat + group.insertBeat);
      return { durationSec: Math.max(naturalDurationSec, resumeTime - startTime), durationScale: 1, held: true };
    }
  }
  return { durationSec: naturalDurationSec, durationScale: articulationDurationScale(event.markings), held: false };
}

/** Whether this event is interior to a slur span (legato-connected to the next note). */
function isInteriorSlurNote(ctx: PartCtx, event: NoteEvent): boolean {
  return event.id !== undefined && ctx.legatoOutIds.has(event.id);
}

/**
 * Dispatch an event to a special playback mode (percussion roll, pitched
 * tremolo, or trill). Returns the consumed beats when one handled the event, or
 * `null` to fall through to the plain note path.
 *
 * Order matters: the percussion-roll branch runs before the pitched-tremolo
 * branch because the latter only subdivides `event.notes` and would silently
 * drop a kit-note roll (kit hits live in `event.kitNotes`).
 */
function tryProcessSpecialEvent(
  ctx: PartCtx,
  event: NoteEvent,
  measureStartTime: number,
  beatOffset: number,
  baseVelocity: number,
  beats: number,
): number | null {
  // Percussion roll: a tremolo on a kit-note sustains a single roll note for
  // the full duration instead of repeated hits (the percussion analog of the
  // 3-slash string tremolo → Tremolo Strings swap).
  if (ctx.kitMidiMap && event.markings?.tremolo && (event.kitNotes?.length ?? 0) > 0) {
    return processKitRoll(ctx, event, measureStartTime, beatOffset, baseVelocity, beats);
  }

  // Single-note pitched tremolo: subdivide into rapid repeated notes.
  const tremoloMarks = event.markings?.tremolo?.marks;
  if (tremoloMarks && tremoloMarks >= 1 && tremoloMarks <= 3) {
    return processSingleNoteTremolo(ctx, event, measureStartTime, beatOffset, baseVelocity, beats, tremoloMarks);
  }

  // Trill: alternate the principal with its diatonic upper auxiliary. Falls
  // through (returns null) if the duration is too short to trill.
  if (event.markings?.trill && tryProcessTrill(ctx, event, measureStartTime, beatOffset, baseVelocity, beats)) {
    return beats;
  }

  return null;
}

/**
 * Process a NoteEvent — emit noteOn/noteOff pairs for each note.
 * Handles ties by deferring noteOff and suppressing noteOn for tied-to notes.
 * Handles single-note tremolos by subdividing into rapid repeated notes.
 */
function processNoteEvent(
  ctx: PartCtx,
  event: NoteEvent,
  measureStartTime: number,
  beatOffset: number,
  baseVelocity: number,
  tupletRatio: number,
): number {
  const { partIndex, channel, tieTargets, out, timeSig, kitMidiMap, kitAltProgramMap } = ctx;
  const beats = durationBeats(event.duration) * tupletRatio;

  if (isRest(event)) {
    // A slur never bridges a rest: release this voice's deferred legato note at
    // its natural time rather than overlapping into the silence.
    flushVoiceLegato(ctx.pendingLegato, ctx.voiceKey, ctx.out);
    return beats;
  }

  // Resolve any deferred legato noteOffs from the previous note against this
  // note's onset (the "next" note from their perspective). Done up front so it
  // also covers the tremolo/trill branches below, which return early.
  resolveVoiceLegato({
    map: ctx.pendingLegato,
    voiceKey: ctx.voiceKey,
    out: ctx.out,
    model: ctx.model,
    measureStartBeat: ctx.measureStartBeat,
    partIndex: ctx.partIndex,
    measureStartTime,
    beatOffset,
    beats,
    notes: event.notes ?? [],
  });

  // Special playback modes (percussion roll / pitched tremolo / trill) handle
  // the event themselves and short-circuit the plain note path below.
  const specialBeats = tryProcessSpecialEvent(ctx, event, measureStartTime, beatOffset, baseVelocity, beats);
  if (specialBeats !== null) return specialBeats;

  const startTime = eventTime(ctx, beatOffset);
  const timingOffset = timingHumanize(measureStartTime, beatOffset, partIndex);
  const naturalDurationSec = eventSeconds(ctx, beatOffset, beats);
  // A fermata holds the note in place (see resolveFermataDuration); otherwise
  // normal articulation scaling applies.
  const {
    durationSec,
    durationScale,
    held: fermataHeld,
  } = resolveFermataDuration(ctx, event, naturalDurationSec, beatOffset);
  const velocity = Math.min(
    127,
    Math.max(
      1,
      applyArticulationVelocity(baseVelocity, event.markings) +
        metricAccentOffset(beatOffset, timeSig) +
        velocityHumanize(measureStartTime, beatOffset),
    ),
  );

  // Interior slur note: defer its release so it overlaps the next note (legato).
  // A fermata-held note is exempt: it must ring through its hold rather than be
  // pinned to the next note's onset by the legato resolver (which would discard
  // the fermata extension and release the note at its natural end).
  const legatoOut = !fermataHeld && isInteriorSlurNote(ctx, event);

  for (const note of event.notes ?? []) {
    // Pitches in the Viritura model are stored as concert (sounding) pitch.
    // The part's transposition is rendering metadata only — no adjustment needed.
    const midiNote = noteToMidi(note);
    if (midiNote < 0 || midiNote > 127) continue;

    const noteId = note.id ?? "";
    const isTiedTo = tieTargets.has(noteId);
    const hasTieOut = note.ties?.some((t) => t.target) ?? false;

    if (isTiedTo) {
      extendOrFinalizeTie(ctx, midiNote, startTime, durationSec, durationScale, hasTieOut);
    } else {
      emitFreshNote(ctx, midiNote, startTime, timingOffset, durationSec, durationScale, velocity, hasTieOut, legatoOut);
    }
  }

  // Kit notes (MNX `kitNotes`): always on the GM drum channel.
  if (kitMidiMap) {
    const jitteredStart = Math.max(0, startTime + timingOffset);
    for (const kn of event.kitNotes ?? []) {
      const midiNote = kitNoteToMidi(kn, kitMidiMap);
      if (midiNote < 0 || midiNote > 127) continue;
      // A component may borrow a sound from another GS kit (e.g. Tam-tam from
      // the Ethnic kit); that routes the hit to a dedicated alt drum channel.
      const drumKitProgram = kitAltProgramMap?.get(kn.kitComponent);
      out.push({ type: "noteOn", time: jitteredStart, midiNote, velocity, partIndex, channel, drumKitProgram });
      out.push({
        type: "noteOff",
        time: jitteredStart + durationSec * durationScale,
        midiNote,
        velocity: 0,
        partIndex,
        channel,
        drumKitProgram,
      });
    }
  }

  return beats;
}

/**
 * Tie-target branch of processNoteEvent: this note continues from a tie, so
 * suppress its noteOn and either extend the pending noteOff (if the chain
 * keeps going) or finalize it with articulation scaling.
 */
function extendOrFinalizeTie(
  ctx: PartCtx,
  midiNote: number,
  startTime: number,
  durationSec: number,
  durationScale: number,
  hasTieOut: boolean,
): void {
  const { partIndex, channel, pendingTieOffs, out } = ctx;
  const tieKey = `${midiNote}:${partIndex}:${ctx.voiceKey}`;
  const pending = pendingTieOffs.get(tieKey);
  if (pending) {
    if (hasTieOut) {
      // Chain continues: extend the pending noteOff further
      pending.time = startTime + durationSec;
    } else {
      // Chain ends: emit the noteOff now with articulation scaling
      pending.time = startTime + durationSec * durationScale;
      out.push(pending);
      pendingTieOffs.delete(tieKey);
    }
  }
  // Register outgoing tie if chain continues
  if (hasTieOut && !pendingTieOffs.has(tieKey)) {
    pendingTieOffs.set(tieKey, {
      type: "noteOff",
      time: startTime + durationSec,
      midiNote,
      velocity: 0,
      partIndex,
      channel,
    });
  }
}

/**
 * Fresh-note branch of processNoteEvent: emit a noteOn with timing jitter
 * for humanization, then either defer the noteOff (if a tie chain starts
 * here) or emit it inline with articulation scaling.
 */
function emitFreshNote(
  ctx: PartCtx,
  midiNote: number,
  startTime: number,
  timingOffset: number,
  durationSec: number,
  durationScale: number,
  velocity: number,
  hasTieOut: boolean,
  legatoOut: boolean,
): void {
  const { partIndex, channel, pendingTieOffs, out } = ctx;
  // Clamp to 0 so early notes don't get negative times.
  const jitteredStart = Math.max(0, startTime + timingOffset);
  out.push({
    type: "noteOn",
    time: jitteredStart,
    midiNote,
    velocity,
    partIndex,
    channel,
  });

  if (hasTieOut) {
    // Start of a tie chain — defer noteOff (no jitter on ties).
    const tieKey = `${midiNote}:${partIndex}:${ctx.voiceKey}`;
    pendingTieOffs.set(tieKey, {
      type: "noteOff",
      time: startTime + durationSec,
      midiNote,
      velocity: 0,
      partIndex,
      channel,
    });
  } else {
    // Standalone or interior-slur note. Build the noteOff at its natural
    // (articulated) release; an interior-slur note is deferred so resolveLegato
    // can later push the release past the next onset (legato overlap).
    const off: MidiEvent = {
      type: "noteOff",
      time: jitteredStart + durationSec * durationScale,
      midiNote,
      velocity: 0,
      partIndex,
      channel,
    };
    if (legatoOut) pushVoiceLegato(ctx.pendingLegato, ctx.voiceKey, off);
    else out.push(off);
  }
}

// ═══════════════════════════════════════════
// Single-note tremolo
// ═══════════════════════════════════════════

/** Beats per subdivision for each tremolo slash count. */
const TREMOLO_SUBDIV_BEATS: Record<number, number> = {
  1: 0.5, // 8th notes
  2: 0.25, // 16th notes
  3: 0.125, // 32nd notes
};

/** GM solo string programs (40–43). */
const STRING_SOLO_RANGE_LO = 40;
const STRING_SOLO_RANGE_HI = 43;
/** GM program 44 — Tremolo Strings. */
const GM_TREMOLO_STRINGS = 44;

/**
 * Sustained "roll" sample for a base drum MIDI note. A tremolo (roll) on a
 * kit-note plays this single sustained note instead of repeated hits — the
 * percussion analog of the 3-slash string tremolo → Tremolo Strings swap.
 * Keyed by the kit-component's resolved GM percussion note. Drums without an
 * entry simply sustain their own sound (e.g. a suspended-cymbal roll).
 *
 * 38 (Acoustic Snare) → 25 (Snare Roll): present in the GS Standard and
 * Orchestra kits this app loads from Shan-SGM-Pro-15.sf2.
 */
const KIT_ROLL_MIDI: Record<number, number> = {
  38: 25, // Acoustic Snare → Snare Roll
};

/**
 * Process a percussion roll — a tremolo marking on a kit-note event. Emits one
 * sustained note per kit-note spanning the full written duration (no
 * subdivision), swapping to a dedicated roll sample when one exists
 * ({@link KIT_ROLL_MIDI}). This keeps a notated roll as a single long note that
 * triggers the roll/sustain sample rather than a machine-gun of repeated hits.
 */
function processKitRoll(
  ctx: PartCtx,
  event: NoteEvent,
  measureStartTime: number,
  beatOffset: number,
  baseVelocity: number,
  beats: number,
): number {
  const { partIndex, channel, out, kitMidiMap, kitAltProgramMap, timeSig } = ctx;
  if (!kitMidiMap) return beats;

  const startTime = eventTime(ctx, beatOffset);
  const timingOffset = timingHumanize(measureStartTime, beatOffset, partIndex);
  const jitteredStart = Math.max(0, startTime + timingOffset);
  const durationSec = eventSeconds(ctx, beatOffset, beats);
  const velocity = Math.min(
    127,
    Math.max(
      1,
      applyArticulationVelocity(baseVelocity, event.markings) +
        metricAccentOffset(beatOffset, timeSig) +
        velocityHumanize(measureStartTime, beatOffset),
    ),
  );

  for (const kn of event.kitNotes ?? []) {
    const baseMidi = kitNoteToMidi(kn, kitMidiMap);
    if (baseMidi < 0 || baseMidi > 127) continue;
    const midiNote = KIT_ROLL_MIDI[baseMidi] ?? baseMidi;
    const drumKitProgram = kitAltProgramMap?.get(kn.kitComponent);
    out.push({ type: "noteOn", time: jitteredStart, midiNote, velocity, partIndex, channel, drumKitProgram });
    out.push({
      type: "noteOff",
      time: jitteredStart + durationSec,
      midiNote,
      velocity: 0,
      partIndex,
      channel,
      drumKitProgram,
    });
  }

  return beats;
}

/**
 * Process a single-note tremolo — subdivide one note into rapid repeated notes.
 *
 * - 1 slash: subdivide into 8th notes
 * - 2 slashes: subdivide into 16th notes
 * - 3 slashes on string instruments (GM 40–43): use GM 45 Tremolo Strings sound
 * - 3 slashes on other instruments: subdivide into 32nd notes
 */
function processSingleNoteTremolo(
  ctx: PartCtx,
  event: NoteEvent,
  measureStartTime: number,
  beatOffset: number,
  baseVelocity: number,
  totalBeats: number,
  marks: number,
): number {
  const { partIndex, channel, out, gmProgram, timeSig } = ctx;
  const velocity = Math.min(
    127,
    Math.max(
      1,
      applyArticulationVelocity(baseVelocity, event.markings) +
        metricAccentOffset(beatOffset, timeSig) +
        velocityHumanize(measureStartTime, beatOffset),
    ),
  );
  const notes = event.notes ?? [];

  // 3-slash tremolo on solo strings: use Tremolo Strings GM patch
  if (marks === 3 && gmProgram >= STRING_SOLO_RANGE_LO && gmProgram <= STRING_SOLO_RANGE_HI) {
    const startTime = eventTime(ctx, beatOffset);
    const tremTimingOffset = timingHumanize(measureStartTime, beatOffset, partIndex);
    const jitteredTremStart = Math.max(0, startTime + tremTimingOffset);
    const durationSec = eventSeconds(ctx, beatOffset, totalBeats);

    // Program change → Tremolo Strings
    out.push({
      type: "programChange",
      time: jitteredTremStart - 0.001, // slightly before the note
      midiNote: 0,
      velocity: 0,
      partIndex,
      channel,
      program: GM_TREMOLO_STRINGS,
    });

    for (const note of notes) {
      const midiNote = noteToMidi(note);
      if (midiNote < 0 || midiNote > 127) continue;
      out.push({ type: "noteOn", time: jitteredTremStart, midiNote, velocity, partIndex, channel });
      out.push({ type: "noteOff", time: jitteredTremStart + durationSec, midiNote, velocity: 0, partIndex, channel });
    }

    // Program change → restore original sound
    out.push({
      type: "programChange",
      time: startTime + durationSec + 0.001,
      midiNote: 0,
      velocity: 0,
      partIndex,
      channel,
      program: gmProgram,
    });

    return totalBeats;
  }

  // Measured tremolo: subdivide into repeated notes
  const subdivBeats = TREMOLO_SUBDIV_BEATS[marks] ?? 0.125;
  const numSubdivisions = Math.max(1, Math.round(totalBeats / subdivBeats));
  const actualSubdivBeats = totalBeats / numSubdivisions;

  for (let s = 0; s < numSubdivisions; s++) {
    const subBeatOffset = beatOffset + s * actualSubdivBeats;
    const subStartTime = eventTime(ctx, subBeatOffset);
    const subTimingOffset = timingHumanize(measureStartTime, subBeatOffset, partIndex);
    const jitteredSubStart = Math.max(0, subStartTime + subTimingOffset);
    const subDurationSec = eventSeconds(ctx, subBeatOffset, actualSubdivBeats);

    for (const note of notes) {
      const midiNote = noteToMidi(note);
      if (midiNote < 0 || midiNote > 127) continue;
      out.push({ type: "noteOn", time: jitteredSubStart, midiNote, velocity, partIndex, channel });
      out.push({
        type: "noteOff",
        time: jitteredSubStart + subDurationSec * 0.9,
        midiNote,
        velocity: 0,
        partIndex,
        channel,
      });
    }
  }

  return totalBeats;
}

// ═══════════════════════════════════════════
// Trill
// ═══════════════════════════════════════════

/** Ideal wall-clock period per trill note (~14 attacks/sec). */
const TRILL_TARGET_PERIOD_SEC = 0.07;
/** A trill note shorter than this reads as a click, not a pitch — don't emit it. */
const TRILL_MIN_NOTE_SEC = 0.05;

/** Diatonic step cycle (C..B) for resolving the upper auxiliary. */
const STEP_CYCLE: readonly Step[] = ["C", "D", "E", "F", "G", "A", "B"];

/** Chromatic alteration a key signature imposes on a given step (+1 sharp, -1 flat, 0 natural). */
function keyAlterForStep(step: Step, fifths: number): number {
  if (fifths > 0) return SHARP_ORDER.slice(0, fifths).includes(step) ? 1 : 0;
  if (fifths < 0) return FLAT_ORDER.slice(0, -fifths).includes(step) ? -1 : 0;
  return 0;
}

/**
 * MIDI number of the trill's upper auxiliary for a principal pitch.
 *
 * The auxiliary is the diatonic step above, altered by the key signature so
 * the trill stays in-scale — unless the trill carries an explicit accidental,
 * which signals a non-diatonic (chromatic) auxiliary.
 */
function trillUpperMidi(pitch: Pitch, keyFifths: number, trillAccidental: number | undefined): number {
  const idx = STEP_CYCLE.indexOf(pitch.step);
  const upStep = STEP_CYCLE[(idx + 1) % 7]!;
  const upOctave = (idx === 6 ? pitch.octave + 1 : pitch.octave) as Octave;
  const alter = trillAccidental ?? keyAlterForStep(upStep, keyFifths);
  return pitchToMidi({ step: upStep, octave: upOctave, alter });
}

/**
 * Expand a trilled note into rapid alternation between the principal note and
 * its diatonic upper auxiliary.
 *
 * Rate is computed in wall-clock time (≈70 ms per note) rather than a fixed
 * note value, so the trill speed stays musical across tempos. The alternation
 * count is then snapped so every note divides the written duration evenly —
 * keeping all notes (including the last) the same length and ending the trill
 * cleanly on the note boundary.
 *
 * Starts on the principal (lower) note. If the note is too short to fit even a
 * single perceptible alternation, returns `false` so the caller plays it plain
 * (i.e. the trill is omitted rather than emitting an imperceptible blur).
 */
function tryProcessTrill(
  ctx: PartCtx,
  event: NoteEvent,
  measureStartTime: number,
  beatOffset: number,
  baseVelocity: number,
  totalBeats: number,
): boolean {
  const { partIndex, channel, out, timeSig, keyFifths } = ctx;
  const notes = event.notes ?? [];
  if (notes.length === 0) return false;

  const durationSec = eventSeconds(ctx, beatOffset, totalBeats);

  // Even division by the wall-clock target, then back off until each note
  // clears the perceptibility floor. Fewer than 2 notes can't read as a trill.
  let n = Math.round(durationSec / TRILL_TARGET_PERIOD_SEC);
  while (n >= 2 && durationSec / n < TRILL_MIN_NOTE_SEC) n--;
  if (n < 2) return false;

  const subBeats = totalBeats / n;
  const velocity = Math.min(
    127,
    Math.max(
      1,
      applyArticulationVelocity(baseVelocity, event.markings) +
        metricAccentOffset(beatOffset, timeSig) +
        velocityHumanize(measureStartTime, beatOffset),
    ),
  );
  const trillAccidental = event.markings?.trill?.accidental;

  // Principal + upper auxiliary MIDI for each note in the (possibly chord) event.
  const pairs = notes
    .map((note) => ({
      lower: pitchToMidi(note.pitch),
      upper: trillUpperMidi(note.pitch, keyFifths, trillAccidental),
    }))
    .filter((p) => p.lower >= 0 && p.lower <= 127 && p.upper >= 0 && p.upper <= 127);
  if (pairs.length === 0) return false;

  for (let s = 0; s < n; s++) {
    // Start on the principal (lower) note: even steps lower, odd steps upper.
    const useUpper = s % 2 === 1;
    const subBeatOffset = beatOffset + s * subBeats;
    const subStartTime = eventTime(ctx, subBeatOffset);
    const subTimingOffset = timingHumanize(measureStartTime, subBeatOffset, partIndex);
    const jitteredStart = Math.max(0, subStartTime + subTimingOffset);
    const subDurationSec = eventSeconds(ctx, subBeatOffset, subBeats);

    for (const pair of pairs) {
      const midiNote = useUpper ? pair.upper : pair.lower;
      out.push({ type: "noteOn", time: jitteredStart, midiNote, velocity, partIndex, channel });
      out.push({
        type: "noteOff",
        time: jitteredStart + subDurationSec * 0.9,
        midiNote,
        velocity: 0,
        partIndex,
        channel,
      });
    }
  }

  return true;
}

/**
 * Process a grace note group.
 *
 * Grace note timing follows industry-standard engravers conventions:
 * - makeTime (default) / stealPrevious: grace notes are played just before
 *   the beat, stealing time from the preceding duration. The main timeline
 *   cursor is NOT advanced.
 * - stealFollowing: grace notes are played at the current beat, pushing the
 *   following note later. The cursor IS advanced by the total grace duration.
 *
 * Each grace note receives a fixed short duration (GRACE_NOTE_BEATS ≈ 32nd
 * note) regardless of its written value.
 */
function processGrace(
  ctx: PartCtx,
  grace: Grace,
  measureStartTime: number,
  beatOffset: number,
  tupletRatio: number,
): number {
  const events = grace.content;
  if (events.length === 0) return 0;

  const graceBeats = GRACE_NOTE_BEATS * tupletRatio;
  const totalGraceBeats = events.length * graceBeats;

  if (grace.graceType === "stealFollowing") {
    // Play at current position — main note is pushed later
    let cursor = beatOffset;
    for (const evt of events) {
      const ratio = graceBeats / durationBeats(evt.duration);
      processScopedNoteEvent(ctx, evt, measureStartTime, cursor, ratio);
      cursor += graceBeats;
    }
    return totalGraceBeats;
  }

  // makeTime (default) / stealPrevious: play before the beat
  let cursor = beatOffset - totalGraceBeats;
  for (const evt of events) {
    const ratio = graceBeats / durationBeats(evt.duration);
    processScopedNoteEvent(ctx, evt, measureStartTime, cursor, ratio);
    cursor += graceBeats;
  }
  return 0;
}

/**
 * Process a tuplet — apply the tuplet ratio and recurse into content.
 */
function processTuplet(
  ctx: PartCtx,
  tuplet: {
    inner: { duration: Duration; multiple: number };
    outer: { duration: Duration; multiple: number };
    content: SequenceContent[];
  },
  measureStartTime: number,
  beatOffset: number,
  parentTupletRatio: number,
): number {
  // Tuplet ratio: outer beats / inner beats
  // e.g., triplet: 3 eighths in the space of 2 → ratio = 2/3
  const outerBeats = durationBeats(tuplet.outer.duration) * tuplet.outer.multiple;
  const innerBeats = durationBeats(tuplet.inner.duration) * tuplet.inner.multiple;
  const ratio = (outerBeats / innerBeats) * parentTupletRatio;

  let cursor = beatOffset;
  for (const item of tuplet.content) {
    cursor += processContentItem(ctx, item, measureStartTime, cursor, ratio);
  }

  return outerBeats * parentTupletRatio;
}

/**
 * Process a multi-note tremolo — alternate between the two notes.
 */
function processTremolo(
  ctx: PartCtx,
  tremolo: {
    content: NoteEvent[];
    marks: number;
    outer: { duration: Duration; multiple: number };
  },
  measureStartTime: number,
  beatOffset: number,
  tupletRatio: number,
): number {
  const outerBeats = durationBeats(tremolo.outer.duration) * tremolo.outer.multiple * tupletRatio;

  if (tremolo.content.length < 2) return outerBeats;

  const subdivisions = Math.pow(2, tremolo.marks);
  const subdivBeats = outerBeats / subdivisions;

  for (let s = 0; s < subdivisions; s++) {
    const noteEvent = tremolo.content[s % 2]!;
    const subBeatOffset = beatOffset + s * subdivBeats;
    const subRatio = subdivBeats / durationBeats(noteEvent.duration);

    processScopedNoteEvent(ctx, noteEvent, measureStartTime, subBeatOffset, subRatio);
  }

  return outerBeats;
}

// ═══════════════════════════════════════════
// Active time signature resolution
// ═══════════════════════════════════════════

/** Resolve the active time signature at a given measure index. */
function resolveActiveTime(globalMeasures: readonly GlobalMeasure[], measureIdx: number): TimeSignature {
  for (let m = measureIdx; m >= 0; m--) {
    if (globalMeasures[m]!.time) {
      return globalMeasures[m]!.time!;
    }
  }
  return { count: 4, unit: 4 };
}

/** Resolve the active key signature (circle-of-fifths) at a given measure index. */
function resolveActiveKeyFifths(globalMeasures: readonly GlobalMeasure[], measureIdx: number): number {
  for (let m = measureIdx; m >= 0; m--) {
    const key = globalMeasures[m]!.key;
    if (key) return key.fifths;
  }
  return 0;
}
