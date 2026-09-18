import type {
  GlobalMeasure,
  Grace,
  MultiNoteTremolo,
  Note,
  NoteEvent,
  Part,
  Score,
  Sequence,
  SequenceContent,
  TextExpression,
  Tuplet,
} from "@viritura/core";
import { isRest, pitchToMidi } from "@viritura/core";
import { buildDynamicsEnvelope, cc11Events, samplePlaybackVelocity, sampleDynamics } from "./dynamicsEnvelope";
import { compileDynamicProgram, laneForScope } from "./dynamicPlayback";
import { buildHoldSchedule } from "./holds";
import { classifyTechniqueText, type TechniqueAction } from "./technique";
import { buildTempoMap, buildTempoModel } from "./tempoMap";
import { durationBeats, expandMeasureOrder, fractionToBeats, type TimelineOptions } from "./timeline";
import { detectToCodaMeasureIndex } from "./repeatExpansion";
import type { TempoModel } from "./tempoModel";
import { resolvePartStaffMeterTable, staffMeterRatioAt } from "./staffMeterTiming";

export interface Articulations {
  staccato: boolean;
  staccatissimo: boolean;
  tenuto: boolean;
  accent: boolean;
  marcato: boolean;
  legato: boolean;
  portato: boolean;
}

export interface PlayingState {
  pizzicato: boolean;
  conSordino: boolean;
  sulPonticello: boolean;
  sulTasto: boolean;
  tremolo: boolean;
  trill: boolean;
  harmonic: boolean;
}

export interface PlaybackVelocityEndpoint {
  /** Semantic dynamic scalar (0..1), interpreted by the consumer's attack mapping. */
  dynamics: number;
  playbackVelocity?: number;
}

export interface PlaybackVelocityInterpolation {
  from: PlaybackVelocityEndpoint;
  to: PlaybackVelocityEndpoint;
  progress: number;
}

export interface PerformanceNote {
  id: string;
  startTime: number;
  duration: number;
  pitch: number;
  dynamics: number;
  /** Explicit MIDI attack velocity (1..127), independent of semantic dynamics. */
  playbackVelocity?: number;
  /** Partially calibrated ramp; resolve missing endpoints using the consumer's mapping. */
  playbackVelocityInterpolation?: PlaybackVelocityInterpolation;
  articulations: Articulations;
  state: PlayingState;
}

export type PerformanceEvent =
  | { kind: "reset"; time: number }
  | { kind: "noteOn"; time: number; note: PerformanceNote }
  | { kind: "noteOff"; time: number; note: PerformanceNote }
  | { kind: "dynamics"; time: number; value: number }
  | { kind: "technique"; time: number; state: PlayingState };

interface TimedEvent {
  event: PerformanceEvent;
  order: number;
}

interface TimingContext {
  readonly model: TempoModel;
  readonly measureStartBeat: number;
  readonly staffMeterRatio: number;
}

interface TraversalContext extends TimingContext {
  readonly partIndex: number;
  readonly expandedMeasureIndex: number;
  readonly originalMeasureIndex: number;
  readonly sequenceIndex: number;
  readonly voiceKey: string;
  readonly tieTargets: ReadonlySet<string>;
  readonly pendingTies: Map<string, PerformanceNote>;
  readonly events: TimedEvent[];
  readonly dynamicsEnvelope: ReturnType<typeof buildDynamicsEnvelope>;
  readonly attackCalibrationAt: (event: NoteEvent, startTime: number) => AttackCalibration;
  readonly measureInitialState: PlayingState;
  readonly techniqueMarks: readonly TechniqueMark[];
  order: number;
}

const EPS = 1e-9;

type AttackCalibration = Pick<PerformanceNote, "playbackVelocity" | "playbackVelocityInterpolation">;

function attackCalibrationAt(envelope: ReturnType<typeof buildDynamicsEnvelope>, time: number): AttackCalibration {
  const sample = samplePlaybackVelocity(envelope, time);
  if (sample === undefined) return {};
  if (typeof sample === "number") return { playbackVelocity: sample };
  const { from, to, progress } = sample;
  if (from.playbackVelocity !== undefined && to.playbackVelocity !== undefined) {
    return { playbackVelocity: Math.round(from.playbackVelocity * (1 - progress) + to.playbackVelocity * progress) };
  }
  return {
    playbackVelocityInterpolation: {
      from: {
        dynamics: from.cc11 / 127,
        ...(from.playbackVelocity === undefined ? {} : { playbackVelocity: from.playbackVelocity }),
      },
      to: {
        dynamics: to.cc11 / 127,
        ...(to.playbackVelocity === undefined ? {} : { playbackVelocity: to.playbackVelocity }),
      },
      progress,
    },
  };
}

/** Resolve attack calibration only once the consumer's native mapping is known. */
export function performanceNoteVelocity(note: PerformanceNote, defaultVelocity: (dynamics: number) => number): number {
  if (note.playbackVelocity !== undefined) return note.playbackVelocity;
  const interpolation = note.playbackVelocityInterpolation;
  if (!interpolation) return defaultVelocity(note.dynamics);
  const from = interpolation.from.playbackVelocity ?? defaultVelocity(interpolation.from.dynamics);
  const to = interpolation.to.playbackVelocity ?? defaultVelocity(interpolation.to.dynamics);
  return Math.round(from * (1 - interpolation.progress) + to * interpolation.progress);
}

const DEFAULT_ARTICULATIONS: Articulations = {
  staccato: false,
  staccatissimo: false,
  tenuto: false,
  accent: false,
  marcato: false,
  legato: false,
  portato: false,
};

const DEFAULT_PLAYING_STATE: PlayingState = {
  pizzicato: false,
  conSordino: false,
  sulPonticello: false,
  sulTasto: false,
  tremolo: false,
  trill: false,
  harmonic: false,
};

function cloneState(state: PlayingState): PlayingState {
  return { ...state };
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function pushEvent(ctx: { events: TimedEvent[]; order: number }, event: PerformanceEvent): number {
  ctx.events.push({ event, order: ctx.order });
  return ctx.order + 1;
}

function timeAt(ctx: TimingContext, beatOffset: number): number {
  return ctx.model.timeAtBeat(ctx.measureStartBeat + beatOffset * ctx.staffMeterRatio);
}

function secondsForBeats(ctx: TimingContext, beatOffset: number, beats: number): number {
  return ctx.model.secondsForBeats(
    ctx.measureStartBeat + beatOffset * ctx.staffMeterRatio,
    beats * ctx.staffMeterRatio,
  );
}

function noteDynamics(ctx: TraversalContext, startTime: number): number {
  return clamp01(sampleDynamics(ctx.dynamicsEnvelope, startTime).cc11 / 127);
}

function emptyArticulations(event: NoteEvent): Articulations {
  const markings = event.markings;
  return {
    ...DEFAULT_ARTICULATIONS,
    staccato: markings?.staccato !== undefined,
    staccatissimo: markings?.staccatissimo !== undefined || markings?.staccatissimoWedge !== undefined,
    tenuto: markings?.tenuto !== undefined,
    accent: markings?.accent !== undefined,
    marcato: markings?.strongAccent !== undefined,
    // TODO(phase5): slur-span legato/portato need full event-id span tracking.
    legato: false,
    portato: false,
  };
}

function noteState(persistent: PlayingState, event: NoteEvent): PlayingState {
  return {
    ...persistent,
    tremolo: event.markings?.tremolo !== undefined,
    trill: event.markings?.trill !== undefined,
  };
}

function stableNoteId(
  ctx: TraversalContext,
  event: NoteEvent,
  note: Note,
  noteIndex: number,
  beatOffset: number,
): string {
  if (note.id) return note.id;
  if (event.id && (event.notes?.length ?? 0) <= 1) return event.id;
  if (event.id) return `${event.id}:n${noteIndex}`;
  return [
    "p",
    ctx.partIndex,
    "x",
    ctx.expandedMeasureIndex,
    "m",
    ctx.originalMeasureIndex,
    "s",
    ctx.sequenceIndex,
    "v",
    ctx.voiceKey,
    "b",
    beatOffset.toFixed(6),
    "n",
    noteIndex,
  ].join("");
}

function tieKey(ctx: TraversalContext, pitch: number): string {
  return `${pitch}:${ctx.partIndex}:${ctx.voiceKey}`;
}

function hasTieOut(note: Note): boolean {
  return note.ties?.some((tie) => tie.target !== undefined) ?? false;
}

function isTieTarget(ctx: TraversalContext, note: Note): boolean {
  return note.id !== undefined && ctx.tieTargets.has(note.id);
}

function collectNoteTieTargets(notes: readonly Note[] | undefined, targets: Set<string>): void {
  for (const note of notes ?? []) {
    for (const tie of note.ties ?? []) {
      if (tie.target) targets.add(tie.target);
    }
  }
}

function collectTieTargets(content: readonly SequenceContent[], targets: Set<string>): void {
  for (const item of content) {
    if (item.type === "event") {
      collectNoteTieTargets(item.notes, targets);
    } else if (item.type === "tuplet") {
      collectTieTargets(item.content, targets);
    } else if (item.type === "grace") {
      for (const event of item.content) collectNoteTieTargets(event.notes, targets);
    } else if (item.type === "tremolo") {
      for (const event of item.content) collectNoteTieTargets(event.notes, targets);
    }
  }
}

function collectPartTieTargets(part: Part, measureOrder: readonly number[]): Set<string> {
  const targets = new Set<string>();
  for (const measureIndex of measureOrder) {
    const measure = part.measures[measureIndex];
    if (!measure) continue;
    for (const sequence of measure.sequences) collectTieTargets(sequence.content, targets);
  }
  return targets;
}

interface TechniqueMark {
  beat: number;
  action: TechniqueAction;
}

function measureTechniqueMarks(
  expressions: readonly TextExpression[] | undefined,
  ratioForStaff: (staff: number | undefined) => number,
): TechniqueMark[] {
  return (expressions ?? [])
    .map((expression) => ({
      action: classifyTechniqueText(expression.text),
      beat: fractionToBeats(expression.position.fraction) * ratioForStaff(expression.staff),
    }))
    .filter((mark): mark is TechniqueMark => mark.action !== null)
    .sort((a, b) => a.beat - b.beat);
}

function applyTechniqueAction(state: PlayingState, action: TechniqueAction): PlayingState {
  if (action.kind === "bow") return { ...state, pizzicato: action.pizz };
  return { ...state, conSordino: action.muted };
}

function samePersistentTechnique(a: PlayingState, b: PlayingState): boolean {
  return a.pizzicato === b.pizzicato && a.conSordino === b.conSordino;
}

function emitMeasureTechniques(
  ctx: { events: TimedEvent[]; order: number },
  timing: TimingContext,
  initialState: PlayingState,
  marks: readonly TechniqueMark[],
): { order: number; finalState: PlayingState } {
  let state = cloneState(initialState);
  let order = ctx.order;
  for (const mark of marks) {
    const next = applyTechniqueAction(state, mark.action);
    if (samePersistentTechnique(state, next)) continue;
    state = next;
    order = pushEvent(
      { events: ctx.events, order },
      { kind: "technique", time: timeAt(timing, mark.beat), state: cloneState(state) },
    );
  }
  return { order, finalState: state };
}

function stateAtBeat(initialState: PlayingState, marks: readonly TechniqueMark[], beatOffset: number): PlayingState {
  let state = cloneState(initialState);
  for (const mark of marks) {
    if (mark.beat > beatOffset + EPS) break;
    state = applyTechniqueAction(state, mark.action);
  }
  return state;
}

function stateForEvent(ctx: TraversalContext, beatOffset: number): PlayingState {
  return stateAtBeat(ctx.measureInitialState, ctx.techniqueMarks, beatOffset * ctx.staffMeterRatio);
}

function emitDynamicsEvents(
  events: TimedEvent[],
  order: number,
  envelope: ReturnType<typeof buildDynamicsEnvelope>,
): number {
  let currentOrder = order;
  let previousValue: number | undefined;
  for (const event of cc11Events(envelope)) {
    const value = clamp01(event.value / 127);
    if (previousValue !== undefined && Math.abs(previousValue - value) <= EPS) continue;
    currentOrder = pushEvent({ events, order: currentOrder }, { kind: "dynamics", time: event.time, value });
    previousValue = value;
  }
  return currentOrder;
}

function emitNoteOff(ctx: TraversalContext, note: PerformanceNote): void {
  ctx.order = pushEvent(ctx, { kind: "noteOff", time: note.startTime + note.duration, note });
}

function processNoteEvent(ctx: TraversalContext, event: NoteEvent, beatOffset: number, tupletRatio: number): number {
  const beats = durationBeats(event.duration) * tupletRatio;
  if (isRest(event)) return beats;

  const startTime = timeAt(ctx, beatOffset);
  const segmentSeconds = secondsForBeats(ctx, beatOffset, beats);
  const articulations = emptyArticulations(event);
  const playingState = noteState(stateForEvent(ctx, beatOffset), event);
  const attackCalibration = ctx.attackCalibrationAt(event, startTime);

  for (const [noteIndex, note] of (event.notes ?? []).entries()) {
    const pitch = pitchToMidi(note.pitch);
    if (pitch < 0 || pitch > 127) continue;

    const key = tieKey(ctx, pitch);
    const tiedToPrevious = isTieTarget(ctx, note);
    const tiedOut = hasTieOut(note);
    if (tiedToPrevious) {
      const pending = ctx.pendingTies.get(key);
      if (pending) {
        pending.duration = startTime + segmentSeconds - pending.startTime;
        if (!tiedOut) {
          emitNoteOff(ctx, pending);
          ctx.pendingTies.delete(key);
        }
      }
      continue;
    }

    const performanceNote: PerformanceNote = {
      id: stableNoteId(ctx, event, note, noteIndex, beatOffset),
      startTime,
      duration: segmentSeconds,
      pitch,
      dynamics: noteDynamics(ctx, startTime),
      ...attackCalibration,
      articulations: { ...articulations },
      state: playingState,
    };
    ctx.order = pushEvent(ctx, { kind: "noteOn", time: startTime, note: performanceNote });
    if (tiedOut) ctx.pendingTies.set(key, performanceNote);
    else emitNoteOff(ctx, performanceNote);
  }
  return beats;
}

function processContentItem(
  ctx: TraversalContext,
  item: SequenceContent,
  beatOffset: number,
  tupletRatio: number,
): number {
  switch (item.type) {
    case "event":
      return processNoteEvent(ctx, item, beatOffset, tupletRatio);
    case "tuplet":
      return processTuplet(ctx, item, beatOffset, tupletRatio);
    case "grace":
      return processGrace(ctx, item, beatOffset, tupletRatio);
    case "space":
      return (item.duration[0] / item.duration[1]) * 4 * tupletRatio;
    case "tremolo":
      return processTremolo(ctx, item, beatOffset, tupletRatio);
    default:
      return 0;
  }
}

function processTuplet(ctx: TraversalContext, tuplet: Tuplet, beatOffset: number, parentTupletRatio: number): number {
  const outerBeats = durationBeats(tuplet.outer.duration) * tuplet.outer.multiple;
  const innerBeats = durationBeats(tuplet.inner.duration) * tuplet.inner.multiple;
  const ratio = (outerBeats / innerBeats) * parentTupletRatio;
  let cursor = beatOffset;
  for (const item of tuplet.content) cursor += processContentItem(ctx, item, cursor, ratio);
  return outerBeats * parentTupletRatio;
}

function processGrace(ctx: TraversalContext, grace: Grace, beatOffset: number, tupletRatio: number): number {
  // TODO(phase5): honor grace timing modes; for now, make-time grace advances by its inner durations.
  let cursor = beatOffset;
  for (const event of grace.content) cursor += processNoteEvent(ctx, event, cursor, tupletRatio);
  return cursor - beatOffset;
}

function processTremolo(
  ctx: TraversalContext,
  tremolo: MultiNoteTremolo,
  beatOffset: number,
  tupletRatio: number,
): number {
  // TODO(phase5): expand playback alternation; this preserves container timing for notation events.
  const outerBeats = durationBeats(tremolo.outer.duration) * tremolo.outer.multiple * tupletRatio;
  const perEventRatio =
    outerBeats /
    Math.max(
      1,
      tremolo.content.reduce((sum, event) => sum + durationBeats(event.duration), 0),
    );
  let cursor = beatOffset;
  for (const event of tremolo.content) cursor += processNoteEvent(ctx, event, cursor, perEventRatio);
  return outerBeats;
}

function processSequence(ctx: TraversalContext, sequence: Sequence): void {
  if (sequence.fullMeasure) return;
  let beatCursor = 0;
  for (const item of sequence.content) {
    beatCursor += processContentItem(ctx, item, beatCursor, 1);
  }
}

function sortPerformanceEvents(events: readonly TimedEvent[]): PerformanceEvent[] {
  return [...events]
    .sort((a, b) => {
      if (Math.abs(a.event.time - b.event.time) > EPS) return a.event.time - b.event.time;
      if (a.event.kind === "reset" && b.event.kind !== "reset") return -1;
      if (b.event.kind === "reset" && a.event.kind !== "reset") return 1;
      return a.order - b.order;
    })
    .map(({ event }) => event);
}

export function generatePerformanceEvents(
  score: Score,
  partIndex: number,
  options?: TimelineOptions,
): PerformanceEvent[] {
  const globalMeasures = score.global.measures;
  const part = score.parts[partIndex];
  if (!part || globalMeasures.length === 0) return [{ kind: "reset", time: 0 }];
  if (part.kit && Object.keys(part.kit).length > 0) {
    // Percussion kits are out of scope for VST-routed pitched-instrument mapping.
    return [{ kind: "reset", time: 0 }];
  }

  const toCodaMeasureIndex = detectToCodaMeasureIndex(score);
  const measureOrder = expandMeasureOrder(globalMeasures, { toCodaMeasureIndex });
  if (measureOrder.length === 0) return [{ kind: "reset", time: 0 }];

  const expandedGlobal: GlobalMeasure[] = measureOrder.map((idx) => globalMeasures[idx]!).filter(Boolean);
  const holdSchedule = buildHoldSchedule(score, measureOrder, globalMeasures);
  buildTempoMap(expandedGlobal, holdSchedule);
  const { model, measureStartBeats } = buildTempoModel(expandedGlobal, holdSchedule);
  const staffMeterTable = resolvePartStaffMeterTable(part, globalMeasures);
  const dynamicsEnvelope = buildDynamicsEnvelope(
    part,
    measureOrder,
    measureStartBeats,
    model,
    globalMeasures,
    [],
    staffMeterTable,
  );
  // Keep the legacy part-wide CC11 signal; scope only explicit attack overrides.
  const playbackProgram = part.measures.some((measure) =>
    measure.dynamics?.some((group) => group.playbackVelocity !== undefined),
  )
    ? compileDynamicProgram(
        part,
        partIndex,
        measureOrder,
        measureStartBeats,
        model,
        globalMeasures,
        -1,
        [],
        staffMeterTable,
      )
    : undefined;
  const tieTargets = collectPartTieTargets(part, measureOrder);
  const pendingTies = new Map<string, PerformanceNote>();
  const events: TimedEvent[] = [{ event: { kind: "reset", time: 0 }, order: 0 }];
  let order = emitDynamicsEvents(events, 1, dynamicsEnvelope);
  let persistentState = cloneState(DEFAULT_PLAYING_STATE);

  for (let expandedMeasureIndex = 0; expandedMeasureIndex < measureOrder.length; expandedMeasureIndex++) {
    const originalMeasureIndex = measureOrder[expandedMeasureIndex]!;
    const measure = part.measures[originalMeasureIndex];
    if (!measure) continue;

    const measureStartBeat = measureStartBeats[expandedMeasureIndex]!;
    const ratioForStaff = (staff: number | undefined): number =>
      staffMeterRatioAt(staffMeterTable, originalMeasureIndex, staff);
    const marks = measureTechniqueMarks(measure.expressions, ratioForStaff);
    const timing: TimingContext = { model, measureStartBeat, staffMeterRatio: 1 };
    const techniqueResult = emitMeasureTechniques({ events, order }, timing, persistentState, marks);
    order = techniqueResult.order;

    measure.sequences.forEach((sequence, sequenceIndex) => {
      const voiceKey = sequence.voice ?? `v${sequenceIndex}`;
      const ctx: TraversalContext = {
        model,
        measureStartBeat,
        staffMeterRatio: ratioForStaff(sequence.staff ?? 1),
        partIndex,
        expandedMeasureIndex,
        originalMeasureIndex,
        sequenceIndex,
        voiceKey,
        tieTargets,
        pendingTies,
        events,
        dynamicsEnvelope,
        attackCalibrationAt: (event, startTime) => {
          const envelope = playbackProgram
            ? laneForScope(
                playbackProgram,
                partIndex,
                event.staff ?? sequence.staff ?? 1,
                sequence.voice ?? `sequence:${sequenceIndex}`,
              ).envelope
            : dynamicsEnvelope;
          return attackCalibrationAt(envelope, startTime);
        },
        measureInitialState: persistentState,
        techniqueMarks: marks,
        order,
      };
      processSequence(ctx, sequence);
      order = ctx.order;
    });

    persistentState = techniqueResult.finalState;
  }

  for (const note of pendingTies.values()) {
    events.push({ event: { kind: "noteOff", time: note.startTime + note.duration, note }, order });
    order += 1;
  }

  void options;
  return sortPerformanceEvents(events);
}
