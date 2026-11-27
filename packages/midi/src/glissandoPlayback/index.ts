import {
  FLAT_ORDER,
  SHARP_ORDER,
  collectHarpPedalNotes,
  harpPedalFractionFromNumber,
  harpPedalSpellingMidi,
  isHarpInstrumentAt,
  resolveHarpPedalState,
  walkSequenceEvents,
  type Glissando,
  type GlissandoPlaybackType,
  type HarpPedalNote,
  type HarpPedalTuning,
  type Score,
} from "@viritura/core";
import type { MidiEvent, MidiTimeline, TimelineDiagnostic } from "../types";
import { playedSpansContinue } from "../navigation";

interface Line {
  source: string;
  glissando: Glissando;
}

export function partHasGlissando(score: Score, partIndex: number): boolean {
  return linesForPart(score, partIndex).length > 0;
}

function linesForPart(score: Score, partIndex: number): Line[] {
  const lines: Line[] = [];
  for (const measure of score.parts[partIndex]?.measures ?? []) {
    for (const sequence of measure.sequences) {
      for (const { event } of walkSequenceEvents(sequence.content)) {
        if (!event.glissandos?.length) continue;
        if (!event.id) throw new Error("Glissando source event requires an ID.");
        for (const glissando of event.glissandos) lines.push({ source: event.id, glissando });
      }
    }
  }
  return lines;
}

function noteKey(event: MidiEvent): string {
  return JSON.stringify([event.partIndex, event.playbackLaneId, event.playbackInstrumentKey, event.midiNote]);
}

function releasesFor(events: readonly MidiEvent[]): Map<MidiEvent, MidiEvent> {
  const held = new Map<string, MidiEvent[]>();
  const releases = new Map<MidiEvent, MidiEvent>();
  for (const event of events) {
    const key = noteKey(event);
    if (event.type === "noteOn") {
      const queue = held.get(key) ?? [];
      queue.push(event);
      held.set(key, queue);
    } else if (event.type === "noteOff") {
      const onset = held.get(key)?.shift();
      if (onset) releases.set(onset, event);
    }
  }
  return releases;
}

function measureAt(timeline: MidiTimeline, beat: number): number {
  let index = 0;
  while (index + 1 < timeline.measureStartBeats.length && timeline.measureStartBeats[index + 1]! <= beat + 1e-9) {
    index++;
  }
  return index;
}

function continuousTo(timeline: MidiTimeline, start: MidiEvent, end: MidiEvent): boolean {
  const startBeat = start.scoreBeat ?? timeline.model.beatAtTime(start.time);
  const endBeat = end.scoreBeat ?? timeline.model.beatAtTime(end.time);
  for (let index = measureAt(timeline, startBeat); index < measureAt(timeline, endBeat); index++) {
    if (timeline.playedSpans) {
      if (!playedSpansContinue(timeline.playedSpans[index]!, timeline.playedSpans[index + 1])) return false;
    } else if (timeline.expandedMeasureToOriginal[index + 1] !== timeline.expandedMeasureToOriginal[index]! + 1) {
      return false;
    }
  }
  return true;
}

function keyPitches(score: Score, timeline: MidiTimeline, onset: MidiEvent): Set<number> {
  const beat = onset.scoreBeat ?? timeline.model.beatAtTime(onset.time);
  const measureIndex = timeline.expandedMeasureToOriginal[measureAt(timeline, beat)]!;
  let fifths = 0;
  for (let index = 0; index <= measureIndex; index++) {
    fifths = score.global.measures[index]?.key?.fifths ?? fifths;
  }
  const steps = ["C", "D", "E", "F", "G", "A", "B"];
  const pitches = [0, 2, 4, 5, 7, 9, 11];
  const order = fifths >= 0 ? SHARP_ORDER : FLAT_ORDER;
  for (let index = 0; index < Math.abs(fifths); index++) {
    const position = steps.indexOf(order[index % order.length]!);
    pitches[position] = pitches[position]! + Math.sign(fifths);
  }
  return new Set(pitches.map((pitch) => ((pitch % 12) + 12) % 12));
}

function steppedPitches(start: number, end: number, key: Set<number> | undefined): number[] {
  const direction = Math.sign(end - start);
  const pitches = [start];
  for (let pitch = start + direction; direction && direction * (end - pitch) > 0; pitch += direction) {
    if (!key || key.has(pitch % 12)) pitches.push(pitch);
  }
  return pitches;
}

function renderSteps(
  on: MidiEvent,
  off: MidiEvent,
  target: MidiEvent,
  pitches: number[],
  timeline: MidiTimeline,
): MidiEvent[] {
  const events: MidiEvent[] = [];
  const duration = target.time - on.time;
  pitches.forEach((midiNote, index) => {
    const time = on.time + (duration * index) / pitches.length;
    const end = on.time + (duration * (index + 1)) / pitches.length;
    events.push({
      ...on,
      midiNote,
      time,
      scoreBeat: timeline.model.beatAtTime(time),
      scoreDurationBeats: timeline.model.beatAtTime(end) - timeline.model.beatAtTime(time),
    });
    events.push({ ...off, midiNote, time: end });
  });
  return events;
}

type HarpString = Pick<HarpPedalNote["pitch"], "step" | "octave">;

const HARP_STEPS = ["C", "D", "E", "F", "G", "A", "B"] as const;

function harpStringOrdinal(string: HarpString): number {
  return string.octave * 7 + HARP_STEPS.indexOf(string.step);
}

function harpStringSweep(start: HarpString, end: HarpString): HarpString[] | undefined {
  const first = harpStringOrdinal(start);
  const last = harpStringOrdinal(end);
  const direction = Math.sign(last - first);
  if (!direction) return [{ ...start }];
  const strings: HarpString[] = [];
  for (let ordinal = first; direction * (last - ordinal) > 0; ordinal += direction) {
    strings.push({
      step: HARP_STEPS[Math.floor(ordinal % 7)]!,
      octave: Math.floor(ordinal / 7) as HarpPedalNote["pitch"]["octave"],
    });
    if (strings.length >= 128) return undefined;
  }
  return strings;
}

function tuningAtAttack(
  score: Score,
  timeline: MidiTimeline,
  partIndex: number,
  beat: number,
): HarpPedalTuning | undefined {
  const part = score.parts[partIndex];
  if (!part) return undefined;
  const expandedIndex = measureAt(timeline, beat);
  const measureIndex = timeline.expandedMeasureToOriginal[expandedIndex];
  if (measureIndex === undefined) return undefined;
  const span = timeline.playedSpans?.[expandedIndex];
  const measureStartBeat = timeline.measureStartBeats[expandedIndex];
  if (measureStartBeat === undefined) return undefined;
  const measureBeats =
    span?.measureBeats ??
    ((timeline.measureTimeSignatures[expandedIndex]?.count ?? 4) * 4) /
      (timeline.measureTimeSignatures[expandedIndex]?.unit ?? 4);
  const beatInSourceMeasure = (span?.startBeat ?? 0) + beat - measureStartBeat;
  const position = harpPedalFractionFromNumber(beatInSourceMeasure / measureBeats);
  if (!isHarpInstrumentAt(part, measureIndex, position)) return undefined;
  return resolveHarpPedalState(part, measureIndex, position)?.tuning;
}

function renderHarpPedalSweep(
  on: MidiEvent,
  off: MidiEvent,
  target: MidiEvent,
  strings: readonly HarpString[],
  timeline: MidiTimeline,
  score: Score,
  partIndex: number,
): MidiEvent[] | undefined {
  const duration = target.time - on.time;
  const startBeat = on.scoreBeat ?? timeline.model.beatAtTime(on.time);
  const targetBeat = target.scoreBeat ?? timeline.model.beatAtTime(target.time);
  const events: MidiEvent[] = [];
  for (let index = 0; index < strings.length; index++) {
    const string = strings[index]!;
    const time = on.time + (duration * index) / strings.length;
    const end = on.time + (duration * (index + 1)) / strings.length;
    const scoreBeat = startBeat + ((targetBeat - startBeat) * index) / strings.length;
    const endScoreBeat = startBeat + ((targetBeat - startBeat) * (index + 1)) / strings.length;
    let midiNote = on.midiNote;
    if (index > 0) {
      const tuning = tuningAtAttack(score, timeline, partIndex, scoreBeat);
      if (!tuning) return undefined;
      midiNote = harpPedalSpellingMidi({ ...string, alter: tuning[string.step] });
    }
    events.push({
      ...on,
      midiNote,
      time,
      scoreBeat,
      scoreDurationBeats: endScoreBeat - scoreBeat,
    });
    events.push({ ...off, midiNote, time: end });
  }
  return events;
}

function renderBend(on: MidiEvent, off: MidiEvent, target: MidiEvent, lane: string): MidiEvent[] {
  const base = { ...on, playbackLaneId: lane };
  const end = target.time;
  const range = Math.max(2, Math.abs(target.midiNote - on.midiNote));
  const control = (cc: number, value: number): MidiEvent => ({
    ...base,
    type: "controlChange",
    time: on.time,
    cc,
    value,
  });
  const events: MidiEvent[] = [
    control(101, 0),
    control(100, 0),
    control(6, range),
    control(38, 0),
    control(101, 127),
    control(100, 127),
    base,
    { ...off, time: end, playbackLaneId: lane },
  ];
  // 200 Hz bounds the pitch increment even for the widest MIDI-key interval.
  const samples = Math.max(1, Math.ceil((end - on.time) * 200));
  for (let index = 0; index < samples; index++) {
    const fraction = index / samples;
    const delta = (target.midiNote - on.midiNote) * fraction;
    events.push({
      ...base,
      type: "pitchBend",
      time: on.time + (end - on.time) * fraction,
      bendRange: range,
      value: Math.max(0, Math.min(16383, Math.round(8192 + (delta * 8192) / range))),
    });
  }
  // A release tail (or pedal-held voice) must not jump back to the source pitch.
  events.push({ ...base, type: "controlChange", time: end, cc: 120, value: 0 });
  events.push({ ...base, type: "pitchBend", time: end, value: 8192, bendRange: range });
  return events;
}

interface PlaybackContext {
  score: Score;
  timeline: MidiTimeline;
  original: MidiEvent[];
  releases: Map<MidiEvent, MidiEvent>;
  removed: Set<MidiEvent>;
  added: MidiEvent[];
  mirroredLanes: Set<string>;
  diagnostics: TimelineDiagnostic[];
}

function glissandoTargets(onsets: readonly MidiEvent[], targetId: string): MidiEvent[] {
  const exact = onsets.filter((event) => event.scoreEventId === targetId);
  return exact.length > 0 ? exact : onsets.filter((event) => event.scoreEventId?.replaceAll("/", "_") === targetId);
}

function chordOrder(sources: readonly MidiEvent[], onset: MidiEvent): number {
  return sources
    .filter((event) => Math.abs(event.time - onset.time) < 1e-9)
    .sort((left, right) => left.midiNote - right.midiNote)
    .indexOf(onset);
}

function glissandoTarget(
  timeline: MidiTimeline,
  onset: MidiEvent,
  sources: readonly MidiEvent[],
  targets: readonly MidiEvent[],
  type: GlissandoPlaybackType,
): MidiEvent | undefined {
  const viable = targets.filter(
    (candidate) => candidate.time > onset.time + 1e-9 && continuousTo(timeline, onset, candidate),
  );
  if (type === "harp-pedals") return viable.find((candidate) => candidate.scoreNoteIndex === onset.scoreNoteIndex);
  const time = viable[0]?.time;
  if (time === undefined) return undefined;
  const chord = viable
    .filter((candidate) => Math.abs(candidate.time - time) < 1e-9)
    .sort((left, right) => left.midiNote - right.midiNote);
  const sourceOrder = chordOrder(sources, onset);
  return chord[Math.min(sourceOrder, chord.length - 1)];
}

function diagnostic(code: TimelineDiagnostic["code"], message: string, onset: MidiEvent): TimelineDiagnostic {
  return {
    code,
    message,
    playbackLaneIds: onset.playbackLaneId ? [onset.playbackLaneId] : [],
  };
}

function harpPedalSweepEvents(
  context: PlaybackContext,
  partIndex: number,
  source: string,
  targetId: string,
  onset: MidiEvent,
  off: MidiEvent,
  target: MidiEvent,
  sourceWritten: HarpPedalNote | undefined,
  writtenNotes: readonly HarpPedalNote[],
  lane: string,
): MidiEvent[] | TimelineDiagnostic {
  const targetWritten = writtenNotes.find(
    (note) => note.eventId === target.scoreEventId && note.noteIndex === target.scoreNoteIndex,
  );
  if (
    !sourceWritten ||
    !targetWritten ||
    Math.abs(sourceWritten.pitch.alter) > 1 ||
    Math.abs(targetWritten.pitch.alter) > 1 ||
    harpPedalSpellingMidi(sourceWritten.pitch) !== onset.midiNote ||
    harpPedalSpellingMidi(targetWritten.pitch) !== target.midiNote
  ) {
    return diagnostic(
      "harp-pedal-playback-unsupported",
      `Harp glissando endpoints "${source}" and "${targetId}" do not have supported exact string spellings.`,
      onset,
    );
  }
  const strings = harpStringSweep(sourceWritten.pitch, targetWritten.pitch);
  if (!strings) {
    return diagnostic(
      "harp-pedal-playback-unsupported",
      `Harp glissando from "${source}" to "${targetId}" exceeds the supported string span.`,
      onset,
    );
  }
  const events = renderHarpPedalSweep(
    { ...onset, playbackLaneId: lane },
    { ...off, playbackLaneId: lane },
    target,
    strings,
    context.timeline,
    context.score,
    partIndex,
  );
  return (
    events ??
    diagnostic(
      "harp-pedal-state-unknown",
      `Harp glissando from "${source}" to "${targetId}" crosses an unknown or inactive harp-pedal state.`,
      onset,
    )
  );
}

function renderGlissandoEvents(
  context: PlaybackContext,
  {
    partIndex,
    source,
    glissando,
    type,
    onset,
    off,
    target,
    sourceWritten,
    writtenNotes,
    lane,
  }: {
    partIndex: number;
    source: string;
    glissando: Glissando;
    type: GlissandoPlaybackType;
    onset: MidiEvent;
    off: MidiEvent;
    target: MidiEvent;
    sourceWritten: HarpPedalNote | undefined;
    writtenNotes: readonly HarpPedalNote[];
    lane: string;
  },
): MidiEvent[] | TimelineDiagnostic {
  const { score, timeline } = context;
  if (type === "pitch-bend") {
    const events = renderBend(onset, off, target, lane);
    const bendOnset = events.find((event) => event.type === "noteOn")!;
    bendOnset.scoreDurationBeats =
      timeline.model.beatAtTime(target.time) - (onset.scoreBeat ?? timeline.model.beatAtTime(onset.time));
    return events;
  }
  if (type === "harp-pedals") {
    return harpPedalSweepEvents(
      context,
      partIndex,
      source,
      glissando.target,
      onset,
      off,
      target,
      sourceWritten,
      writtenNotes,
      lane,
    );
  }
  const key = type === "diatonic" ? keyPitches(score, timeline, onset) : undefined;
  return renderSteps(
    { ...onset, playbackLaneId: lane },
    { ...off, playbackLaneId: lane },
    target,
    steppedPitches(onset.midiNote, target.midiNote, key),
    timeline,
  );
}

function mirrorLane(context: PlaybackContext, partIndex: number, onset: MidiEvent, lane: string): void {
  if (context.mirroredLanes.has(lane)) return;
  context.mirroredLanes.add(lane);
  for (const event of context.original) {
    if (
      event.partIndex === partIndex &&
      event.playbackLaneId === onset.playbackLaneId &&
      (event.type === "programChange" || event.type === "controlChange")
    ) {
      context.added.push({ ...event, playbackLaneId: lane });
    }
  }
}

function realizeOnset(
  context: PlaybackContext,
  partIndex: number,
  source: string,
  glissando: Glissando,
  sources: readonly MidiEvent[],
  targets: readonly MidiEvent[],
  onset: MidiEvent,
  sourceWritten: HarpPedalNote | undefined,
  writtenNotes: readonly HarpPedalNote[],
): { realized: boolean; harpFailure: boolean } {
  const part = context.score.parts[partIndex]!;
  const activeHarp =
    sourceWritten !== undefined && isHarpInstrumentAt(part, sourceWritten.measureIndex, sourceWritten.fraction);
  const type =
    glissando.playbackType ??
    (glissando.kind === "portamento" ? "pitch-bend" : activeHarp ? "harp-pedals" : "diatonic");
  if (type === "harp-pedals" && !activeHarp) {
    context.diagnostics.push(
      diagnostic(
        "harp-pedal-playback-unsupported",
        `Glissando from "${source}" requests harp pedals outside an active harp segment.`,
        onset,
      ),
    );
    return { realized: false, harpFailure: true };
  }
  const target = glissandoTarget(context.timeline, onset, sources, targets, type);
  if (!target) {
    if (type === "harp-pedals") {
      context.diagnostics.push(
        diagnostic(
          "harp-pedal-playback-unsupported",
          `Harp glissando from "${source}" to "${glissando.target}" has no matching note-index endpoints on a continuous playback route.`,
          onset,
        ),
      );
      return { realized: false, harpFailure: true };
    }
    return { realized: false, harpFailure: false };
  }
  const off = context.releases.get(onset);
  if (!off || onset.channel === 9) return { realized: false, harpFailure: false };
  const sourceOrder = chordOrder(sources, onset);
  const lane = `${onset.playbackLaneId ?? `part:${partIndex}`}:gliss:${source}:${onset.scoreNoteIndex ?? sourceOrder}`;
  const generated = renderGlissandoEvents(context, {
    partIndex,
    source,
    glissando,
    type,
    onset,
    off,
    target,
    sourceWritten,
    writtenNotes,
    lane,
  });
  if (!Array.isArray(generated)) {
    context.diagnostics.push(generated);
    return { realized: false, harpFailure: type === "harp-pedals" };
  }
  context.removed.add(onset);
  context.removed.add(off);
  context.added.push(...generated);
  // Mirror dynamics, pedal, and timbre state into the isolated note lane.
  mirrorLane(context, partIndex, onset, lane);
  return { realized: true, harpFailure: false };
}

function realizeGlissandoLine(
  context: PlaybackContext,
  partIndex: number,
  source: string,
  glissando: Glissando,
  onsets: readonly MidiEvent[],
  writtenNotes: readonly HarpPedalNote[],
): void {
  const sources = onsets.filter((event) => event.scoreEventId === source);
  const targets = glissandoTargets(onsets, glissando.target);
  let realized = false;
  let harpFailure = false;
  for (const onset of sources) {
    if (context.removed.has(onset)) continue;
    const sourceWritten = writtenNotes.find(
      (note) => note.eventId === source && note.noteIndex === onset.scoreNoteIndex,
    );
    const result = realizeOnset(
      context,
      partIndex,
      source,
      glissando,
      sources,
      targets,
      onset,
      sourceWritten,
      writtenNotes,
    );
    realized ||= result.realized;
    harpFailure ||= result.harpFailure;
  }
  if (!realized && !harpFailure) {
    context.diagnostics.push({
      code: "glissando-playback-unsupported",
      message: `Glissando from "${source}" to "${glissando.target}" has no forward pitched endpoints on a continuous playback route.`,
      playbackLaneIds: sources.flatMap((event) => (event.playbackLaneId ? [event.playbackLaneId] : [])),
    });
  }
}

/** Realize after navigation, so a line cannot sweep through an unplayed route. */
export function applyGlissandoPlayback(score: Score, timeline: MidiTimeline): TimelineDiagnostic[] {
  const partLines = score.parts.map((_part, partIndex) => linesForPart(score, partIndex));
  if (partLines.every((lines) => lines.length === 0)) return [];
  const original = [...timeline.events];
  const context: PlaybackContext = {
    score,
    timeline,
    original,
    releases: releasesFor(original),
    removed: new Set(),
    added: [],
    mirroredLanes: new Set(),
    diagnostics: [],
  };
  partLines.forEach((lines, partIndex) => {
    const writtenNotes = collectHarpPedalNotes(score, partIndex);
    const onsets = original.filter((event) => event.partIndex === partIndex && event.type === "noteOn");
    for (const { source, glissando } of lines) {
      realizeGlissandoLine(context, partIndex, source, glissando, onsets, writtenNotes);
    }
  });
  timeline.events = original.filter((event) => !context.removed.has(event)).concat(context.added);
  return context.diagnostics;
}
