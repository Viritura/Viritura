import { FLAT_ORDER, SHARP_ORDER, walkSequenceEvents, type Glissando, type Score } from "@viritura/core";
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

/** Realize after navigation, so a line cannot sweep through an unplayed route. */
export function applyGlissandoPlayback(score: Score, timeline: MidiTimeline): TimelineDiagnostic[] {
  const partLines = score.parts.map((_part, partIndex) => linesForPart(score, partIndex));
  if (partLines.every((lines) => lines.length === 0)) return [];
  const diagnostics: TimelineDiagnostic[] = [];
  const original = [...timeline.events];
  const releases = releasesFor(original);
  const removed = new Set<MidiEvent>();
  const added: MidiEvent[] = [];
  const mirroredLanes = new Set<string>();
  partLines.forEach((lines, partIndex) => {
    for (const { source, glissando } of lines) {
      const onsets = original.filter((event) => event.partIndex === partIndex && event.type === "noteOn");
      const sources = onsets.filter((event) => event.scoreEventId === source);
      const exactTargets = onsets.filter((event) => event.scoreEventId === glissando.target);
      const targets =
        exactTargets.length > 0
          ? exactTargets
          : onsets.filter((event) => event.scoreEventId?.replaceAll("/", "_") === glissando.target);
      let realized = false;
      for (const onset of sources) {
        if (removed.has(onset)) continue;
        const time = targets.find(
          (target) => target.time > onset.time + 1e-9 && continuousTo(timeline, onset, target),
        )?.time;
        if (time === undefined) continue;
        const sourceChord = sources
          .filter((event) => Math.abs(event.time - onset.time) < 1e-9)
          .sort((a, b) => a.midiNote - b.midiNote);
        const targetChord = targets
          .filter((event) => Math.abs(event.time - time) < 1e-9)
          .sort((a, b) => a.midiNote - b.midiNote);
        const target = targetChord[Math.min(sourceChord.indexOf(onset), targetChord.length - 1)]!;
        const off = releases.get(onset);
        if (!off || onset.channel === 9) continue;
        realized = true;
        const type = glissando.playbackType ?? (glissando.kind === "portamento" ? "pitch-bend" : "diatonic");
        removed.add(onset);
        removed.add(off);
        const lane = `${onset.playbackLaneId ?? `part:${partIndex}`}:gliss:${source}:${sourceChord.indexOf(onset)}`;
        if (type === "pitch-bend") {
          const bendEvents = renderBend(onset, off, target, lane);
          const bendOnset = bendEvents.find((event) => event.type === "noteOn")!;
          bendOnset.scoreDurationBeats =
            timeline.model.beatAtTime(target.time) - (onset.scoreBeat ?? timeline.model.beatAtTime(onset.time));
          added.push(...bendEvents);
        } else {
          const key = type === "diatonic" ? keyPitches(score, timeline, onset) : undefined;
          added.push(
            ...renderSteps(
              { ...onset, playbackLaneId: lane },
              { ...off, playbackLaneId: lane },
              target,
              steppedPitches(onset.midiNote, target.midiNote, key),
              timeline,
            ),
          );
        }
        // Mirror dynamics, pedal, and timbre state into the isolated note lane.
        if (!mirroredLanes.has(lane)) {
          mirroredLanes.add(lane);
          for (const event of original) {
            if (
              event.partIndex === partIndex &&
              event.playbackLaneId === onset.playbackLaneId &&
              (event.type === "programChange" || event.type === "controlChange")
            ) {
              added.push({ ...event, playbackLaneId: lane });
            }
          }
        }
      }
      if (!realized)
        diagnostics.push({
          code: "glissando-playback-unsupported",
          message: `Glissando from "${source}" to "${glissando.target}" has no forward pitched endpoints on a continuous playback route.`,
          playbackLaneIds: sources.flatMap((event) => (event.playbackLaneId ? [event.playbackLaneId] : [])),
        });
    }
  });
  timeline.events = original.filter((event) => !removed.has(event)).concat(added);
  return diagnostics;
}
