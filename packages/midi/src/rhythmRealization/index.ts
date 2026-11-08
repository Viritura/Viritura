import {
  DURATION_BEATS,
  type Duration,
  type NoteEvent,
  type Score,
  type Sequence,
  type SequenceContent,
  type Swing,
} from "@viritura/core";
import { playbackGlobalMeasures } from "../cadenzaTiming";
import { resolveActiveTime, resolvePartStaffMeterTable } from "../staffMeterTiming";
import type { PlayedMeasureSpan } from "../navigation";
import type { TimelineDiagnostic } from "../types";
import { buildHoldSchedule } from "../holds";

interface PairTiming {
  start: number;
  end: number;
  pairStart: number;
  pairEnd: number;
}
export type RhythmTimings = ReadonlyMap<NoteEvent, PairTiming>;

export interface RhythmProgram {
  sequences: ReadonlyMap<Sequence, RhythmTimings>;
  diagnostics: TimelineDiagnostic[];
}

interface SwingAnchor {
  beat: number;
  swing: Swing;
}

const EPS = 1e-9;

function duration(d: Duration): number {
  return DURATION_BEATS[d.base] * (d.dots ? 2 - 2 ** -d.dots : 1);
}

function itemBeats(item: SequenceContent): number {
  switch (item.type) {
    case "event":
      return duration(item.duration);
    case "space":
      return (item.duration[0] * 4) / item.duration[1];
    case "tuplet":
    case "tremolo":
      return duration(item.outer.duration) * item.outer.multiple;
    case "grace":
      return 0;
  }
}

function eligible(item: SequenceContent | undefined, sequence: Sequence): item is NoteEvent {
  return (
    item?.type === "event" &&
    !item.duration.dots &&
    (item.staff === undefined || item.staff === (sequence.staff ?? 1)) &&
    item.markings?.tremolo === undefined &&
    item.markings?.trill === undefined
  );
}

function swingAt(anchors: readonly SwingAnchor[], beat: number): Swing {
  let result: Swing = { mode: "straight" };
  for (const anchor of anchors) {
    if (anchor.beat > beat + EPS) break;
    result = anchor.swing;
  }
  return result;
}

function containsGrace(content: readonly SequenceContent[]): boolean {
  return content.some((item) => item.type === "grace" || (item.type === "tuplet" && containsGrace(item.content)));
}

function compileSequence(
  sequence: Sequence,
  anchors: readonly SwingAnchor[],
  metricOffset: number,
  measureBeats: number,
  holdBeats: readonly number[],
): ReadonlyMap<NoteEvent, PairTiming> {
  const timings = new Map<NoteEvent, PairTiming>();
  // Grace timing differs between the current generators. Leave its whole voice
  // literal rather than moving a principal attack into an anticipated grace.
  if (sequence.fullMeasure || containsGrace(sequence.content)) return timings;
  let cursor = 0;
  for (let index = 0; index < sequence.content.length; index++) {
    const first = sequence.content[index]!;
    const second = sequence.content[index + 1];
    const swing = swingAt(anchors, cursor);
    const beats = itemBeats(first);
    const pairEnd = cursor + 2 * beats;
    if (
      swing.mode === "swing" &&
      eligible(first, sequence) &&
      eligible(second, sequence) &&
      first.duration.base === swing.subdivision &&
      second.duration.base === swing.subdivision &&
      Math.abs((cursor + metricOffset) / (2 * beats) - Math.round((cursor + metricOffset) / (2 * beats))) < EPS &&
      pairEnd <= measureBeats + EPS &&
      !holdBeats.some((beat) => beat > cursor + EPS && beat < pairEnd - EPS) &&
      !anchors.some((anchor) => anchor.beat > cursor + EPS && anchor.beat < pairEnd - EPS)
    ) {
      const split = cursor + (2 * beats * swing.ratio[0]) / (swing.ratio[0] + swing.ratio[1]);
      timings.set(first, { start: cursor, end: split, pairStart: cursor, pairEnd });
      timings.set(second, { start: split, end: pairEnd, pairStart: cursor, pairEnd });
    }
    cursor += beats;
  }
  return timings;
}

/** Written-source compilation: neither repeat order nor expanded beat phase is
 * involved. Only equal, complete, metric-grid pairs are realized. */
export function compileRhythmProgram(score: Score): RhythmProgram {
  const indices = score.global.measures.map((_, index) => index);
  const playbackMeasures = playbackGlobalMeasures(score, indices);
  const holds = buildHoldSchedule(score, indices, score.global.measures);
  let inherited: Swing = { mode: "straight" };
  const anchorsByMeasure = score.global.measures.map((measure) => {
    const anchors: SwingAnchor[] = [{ beat: -Infinity, swing: inherited }];
    const ordered = (measure.tempos ?? [])
      .map((tempo, index) => ({
        tempo,
        index,
        beat: ((tempo.location?.fraction[0] ?? 0) * 4) / (tempo.location?.fraction[1] ?? 1),
      }))
      .sort((a, b) => a.beat - b.beat || a.index - b.index);
    for (const { tempo, beat } of ordered) {
      if (!tempo.swing) continue;
      if (
        tempo.swing.mode === "swing" &&
        !tempo.swing.ratio.every((value) => Number.isSafeInteger(value) && value > 0)
      ) {
        throw new Error("Swing ratios must be positive safe integers.");
      }
      inherited = tempo.swing;
      anchors.push({ beat, swing: inherited });
    }
    return anchors;
  });
  const sequences = new Map<Sequence, ReadonlyMap<NoteEvent, PairTiming>>();
  const diagnostics: TimelineDiagnostic[] = [];
  score.parts.forEach((part, partIndex) => {
    const staffMeters = resolvePartStaffMeterTable(part, score.global.measures);
    part.measures.forEach((measure, measureIndex) => {
      const anchors = anchorsByMeasure[measureIndex];
      if (!anchors) return;
      const time = resolveActiveTime(score.global.measures, measureIndex);
      const playbackTime = playbackMeasures[measureIndex]!.time!;
      const measureBeats = (playbackTime.count * 4) / playbackTime.unit;
      const metricOffset =
        measureIndex === 0 && score.global.measures[0]!.number === 0 ? (time.count * 4) / time.unit - measureBeats : 0;
      const diagnosed = new Set<number>();
      const hasSwing = [
        0,
        ...anchors.map((anchor) => anchor.beat).filter((beat) => beat > 0 && beat < measureBeats),
      ].some((beat) => swingAt(anchors, beat).mode === "swing");
      for (const sequence of measure.sequences) {
        const staff = sequence.staff ?? 1;
        if (staffMeters[measureIndex]?.has(staff)) {
          if (!diagnosed.has(staff) && hasSwing) {
            diagnostics.push({
              code: "swing-staff-meter-unsupported",
              source: { partIndex, measureIndex, staff },
              message: `Swing left literal in part ${partIndex}, measure ${measureIndex}, staff ${staff}: local staff meters are not supported.`,
              playbackLaneIds: [],
            });
            diagnosed.add(staff);
          }
          continue;
        }
        if (time.display !== "senzaMisura") {
          sequences.set(
            sequence,
            compileSequence(
              sequence,
              anchors,
              metricOffset,
              measureBeats,
              (holds[measureIndex] ?? []).map((hold) => hold.atBeat),
            ),
          );
        }
      }
    });
  });
  return { sequences, diagnostics };
}

/** Onset and release move together, before tempo integration and articulation.
 * A navigation entry/exit inside the pair makes both members literal. */
export function realizeRhythmEvent(
  timings: ReadonlyMap<NoteEvent, PairTiming> | undefined,
  event: NoteEvent,
  start: number,
  beats: number,
  span?: PlayedMeasureSpan,
): { start: number; beats: number } {
  const timing = timings?.get(event);
  if (!timing || (span && (timing.pairStart < span.startBeat - EPS || timing.pairEnd > span.endBeat + EPS))) {
    return { start, beats };
  }
  return { start: timing.start, beats: timing.end - timing.start };
}
