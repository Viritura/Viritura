import type { SequenceContent, NoteEvent, Pitch, Clef, Score, ChordSymbol } from "@viritura/core";
import type { ClipboardFragment } from "../../clipboard/ClipboardFragment";
import { sequenceContentBeats } from "../../commands/noteCommands";

/** Semitone offset from C for each diatonic step. */
const STEP_SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function pitchToMidi(step: string, octave: number, alter = 0): number {
  return (octave + 1) * 12 + (STEP_SEMITONE[step] ?? 0) + alter;
}

/** Walk all NoteEvents (incl. grace/tuplet containers) and collect their MIDI pitches. */
function collectMidiPitches(items: SequenceContent[]): number[] {
  const out: number[] = [];
  for (const item of items) {
    if (item.type === "event") {
      const ev = item as NoteEvent;
      for (const n of ev.notes ?? []) {
        const p = n.pitch as Pitch | undefined;
        if (p) out.push(pitchToMidi(p.step, p.octave, p.alter ?? 0));
      }
    } else if (item.type === "grace") {
      for (const ev of item.content) {
        for (const n of ev.notes ?? []) {
          const p = n.pitch as Pitch | undefined;
          if (p) out.push(pitchToMidi(p.step, p.octave, p.alter ?? 0));
        }
      }
    } else if (item.type === "tuplet") {
      out.push(...collectMidiPitches(item.content));
    }
  }
  return out;
}

/** Pick the best single clef for the given content (mean MIDI < 60 → bass, else treble). */
function inferClef(items: SequenceContent[]): Clef {
  const midis = collectMidiPitches(items);
  if (midis.length === 0) return { sign: "G", staffPosition: -2 };
  const mean = midis.reduce((a, b) => a + b, 0) / midis.length;
  return mean < 60 ? { sign: "F", staffPosition: 2 } : { sign: "G", staffPosition: -2 };
}

let _restPadCounter = 0;

/** Distribute a flat event array across `measureCount` measures. */
function distributeAcrossMeasures(
  events: SequenceContent[],
  beatsPerMeasure: number,
  measureCount: number,
): SequenceContent[][] {
  const result: SequenceContent[][] = [];
  let evIdx = 0;
  for (let m = 0; m < measureCount; m++) {
    const measureEvents: SequenceContent[] = [];
    let mBeats = 0;
    while (evIdx < events.length && mBeats < beatsPerMeasure - 1e-9) {
      const ev = events[evIdx]!;
      const evBeats = sequenceContentBeats(ev);
      if (mBeats + evBeats <= beatsPerMeasure + 1e-9) {
        measureEvents.push(ev);
        mBeats += evBeats;
        evIdx++;
      } else {
        break;
      }
    }
    if (mBeats < beatsPerMeasure - 1e-9) {
      const gap = beatsPerMeasure - mBeats;
      measureEvents.push({
        type: "event" as const,
        id: `rest-pad-${++_restPadCounter}`,
        duration: { base: gap >= 4 ? "whole" : gap >= 2 ? "half" : gap >= 1 ? "quarter" : "eighth" },
        rest: {},
      });
    }
    result.push(measureEvents);
  }
  return result;
}

type WholeFraction = [number, number];

function compareFractions(left: WholeFraction, right: WholeFraction): number {
  return left[0] * right[1] - right[0] * left[1];
}

function subtractFractions(left: WholeFraction, right: WholeFraction): WholeFraction {
  const numerator = left[0] * right[1] - right[0] * left[1];
  const denominator = left[1] * right[1];
  const divisor = gcd(Math.abs(numerator), denominator);
  return [numerator / divisor, denominator / divisor];
}

function gcd(left: number, right: number): number {
  let a = left;
  let b = right;
  while (b !== 0) [a, b] = [b, a % b];
  return a || 1;
}

function previewChordSymbols(
  fragment: ClipboardFragment,
  time: ClipboardFragment["timeSignature"],
): Map<number, ChordSymbol[]> {
  const byMeasure = new Map<number, ChordSymbol[]>();
  const capacity: WholeFraction = [time.count, time.unit];
  for (const captured of fragment.chordSymbols ?? []) {
    let measureIndex = captured.measureOffset;
    let fraction = captured.chordSymbol.position.fraction;
    if (captured.offset) {
      measureIndex = 0;
      fraction = captured.offset;
      while (compareFractions(fraction, capacity) >= 0) {
        fraction = subtractFractions(fraction, capacity);
        measureIndex += 1;
      }
    }
    if (measureIndex < 0 || compareFractions(fraction, [0, 1]) < 0) continue;
    const chordSymbol = structuredClone(captured.chordSymbol);
    chordSymbol.position = { ...chordSymbol.position, fraction };
    const measure = byMeasure.get(measureIndex);
    if (measure) measure.push(chordSymbol);
    else byMeasure.set(measureIndex, [chordSymbol]);
  }
  return byMeasure;
}

function buildGlobalMeasures(
  fragment: ClipboardFragment,
  time: ClipboardFragment["timeSignature"],
  contentMeasureCount: number,
): Score["global"]["measures"] {
  const chordSymbols = previewChordSymbols(fragment, time);
  const chordMeasureCount = chordSymbols.size > 0 ? Math.max(...chordSymbols.keys()) + 1 : 0;
  const measureCount = Math.max(1, contentMeasureCount, chordMeasureCount);
  return Array.from({ length: measureCount }, (_, measureIndex) => ({
    ...(measureIndex === 0 ? { time } : {}),
    ...(chordSymbols.has(measureIndex) ? { chordSymbols: chordSymbols.get(measureIndex) } : {}),
  }));
}

/**
 * Build a minimal preview Score from a ClipboardFragment.
 *
 * • Single-track: one part, clef taken from fragment.clef or inferred.
 * • Multi-track: one part per partOffset, sequences per voiceIndex.
 */
export function buildPreviewScore(fragment: ClipboardFragment): Score {
  const ts = fragment.timeSignature;
  const beatsPerMeasure = (ts.count / ts.unit) * 4;
  const tracks = fragment.tracks && fragment.tracks.length > 1 ? fragment.tracks : null;

  if (!tracks) {
    return buildSingleTrackPreview(fragment, ts, beatsPerMeasure);
  }
  return buildMultiTrackPreview(fragment, tracks, ts, beatsPerMeasure);
}

function buildSingleTrackPreview(
  fragment: ClipboardFragment,
  ts: ClipboardFragment["timeSignature"],
  beatsPerMeasure: number,
): Score {
  const events = fragment.content.map((ev, i) => {
    const clone = structuredClone(ev);
    if (!("id" in clone) || !clone.id) (clone as { id?: string }).id = `preview-${i}`;
    return clone;
  });
  const totalBeats = events.reduce((s, ev) => s + sequenceContentBeats(ev), 0);
  const contentMeasureCount = Math.max(1, Math.ceil(totalBeats / beatsPerMeasure));
  const globalMeasures = buildGlobalMeasures(fragment, ts, contentMeasureCount);
  const measureCount = globalMeasures.length;
  const perMeasure = distributeAcrossMeasures(events, beatsPerMeasure, measureCount);
  const clef = fragment.clef ?? inferClef(events);
  const transposition = fragment.transposition ? { ...fragment.transposition, prefersWrittenPitches: true } : undefined;

  return {
    mnx: { version: 1 },
    global: {
      measures: globalMeasures,
      ...(fragment.lyrics ? { lyrics: structuredClone(fragment.lyrics) } : {}),
    },
    parts: [
      {
        name: "Preview",
        chordSymbolVisibility: "show",
        ...(transposition ? { transposition } : {}),
        measures: perMeasure.map((seqContent, m) => ({
          ...(m === 0 ? { clefs: [{ clef }] } : {}),
          sequences: [{ content: seqContent }],
        })),
      },
    ],
  };
}

function buildMultiTrackPreview(
  fragment: ClipboardFragment,
  tracks: NonNullable<ClipboardFragment["tracks"]>,
  ts: ClipboardFragment["timeSignature"],
  beatsPerMeasure: number,
): Score {
  // Group by partOffset; within each group, sort by voiceIndex.
  const partMap = new Map<number, typeof tracks>();
  for (const track of tracks) {
    if (!partMap.has(track.partOffset)) partMap.set(track.partOffset, []);
    partMap.get(track.partOffset)!.push(track);
  }
  const sortedOffsets = [...partMap.keys()].sort((a, b) => a - b);

  let maxBeats = 0;
  for (const track of tracks) {
    const beats = track.content.reduce((s, ev) => s + sequenceContentBeats(ev), 0);
    if (beats > maxBeats) maxBeats = beats;
  }
  const contentMeasureCount = Math.max(1, Math.ceil(maxBeats / beatsPerMeasure));
  const globalMeasures = buildGlobalMeasures(fragment, ts, contentMeasureCount);
  const measureCount = globalMeasures.length;

  const parts: Score["parts"] = sortedOffsets.map((offset) =>
    buildPartForOffset(partMap.get(offset)!, offset, measureCount, beatsPerMeasure),
  );

  return {
    mnx: { version: 1 },
    global: {
      measures: globalMeasures,
      ...(fragment.lyrics ? { lyrics: structuredClone(fragment.lyrics) } : {}),
    },
    parts,
  };
}

function buildPartForOffset(
  rawTracks: NonNullable<ClipboardFragment["tracks"]>,
  offset: number,
  measureCount: number,
  beatsPerMeasure: number,
): Score["parts"][number] {
  const partTracks = rawTracks.slice().sort((a, b) => a.voiceIndex - b.voiceIndex);
  const allContent = partTracks.flatMap((t) => t.content);
  const clef = partTracks[0]!.clef ?? inferClef(allContent);
  const srcTransposition = partTracks[0]!.transposition;
  const transposition = srcTransposition ? { ...srcTransposition, prefersWrittenPitches: true } : undefined;

  const sequencesPerMeasure: SequenceContent[][][] = Array.from(
    { length: measureCount },
    () => [] as SequenceContent[][],
  );
  for (const track of partTracks) {
    const events = track.content.map((ev, i) => {
      const clone = structuredClone(ev);
      if (!("id" in clone) || !clone.id) (clone as { id?: string }).id = `preview-${offset}-${track.voiceIndex}-${i}`;
      return clone;
    });
    const perMeasure = distributeAcrossMeasures(events, beatsPerMeasure, measureCount);
    for (let m = 0; m < measureCount; m++) {
      sequencesPerMeasure[m]!.push(perMeasure[m]!);
    }
  }

  return {
    name: `Part ${offset + 1}`,
    chordSymbolVisibility: "show",
    ...(transposition ? { transposition } : {}),
    measures: sequencesPerMeasure.map((seqs, m) => ({
      ...(m === 0 ? { clefs: [{ clef }] } : {}),
      sequences: seqs.map((content) => ({ content })),
    })),
  };
}
