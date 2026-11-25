import type { Duration, NoteEvent, GlobalFermata, Score, Sequence, SequenceContent, TimeSignature } from "../model";
import { ratioToNumber, resolveStaffMeterTimeline } from "../model";
import { DURATION_BEATS } from "../constants";

export interface FermataEventSpan {
  partIndex: number;
  sequenceIndex: number;
  staff: number;
  sequence: Sequence;
  /** Undefined for the implicit full-measure rest. */
  event?: NoteEvent;
  /** Nested content indices, including tuplet/tremolo containers. */
  contentPath: number[];
  onset: number;
  duration: number;
  end: number;
}

function beats(duration: Duration): number {
  return DURATION_BEATS[duration.base] * (2 - 2 ** -(duration.dots ?? 0));
}

function collectContent(
  content: readonly SequenceContent[],
  start: number,
  ratio: number,
  parent: number[],
  context: Pick<FermataEventSpan, "partIndex" | "sequenceIndex" | "staff" | "sequence">,
  out: FermataEventSpan[],
): number {
  let cursor = start;
  content.forEach((item, index) => {
    const contentPath = [...parent, index];
    if (item.type === "event") {
      const duration = beats(item.duration) * ratio;
      out.push({ ...context, event: item, contentPath, onset: cursor, duration, end: cursor + duration });
      cursor += duration;
    } else if (item.type === "tuplet") {
      const outer = beats(item.outer.duration) * item.outer.multiple;
      const inner = beats(item.inner.duration) * item.inner.multiple;
      collectContent(item.content, cursor, (ratio * outer) / inner, contentPath, context, out);
      cursor += outer * ratio;
    } else if (item.type === "tremolo") {
      const duration = beats(item.outer.duration) * item.outer.multiple * ratio;
      for (let child = 0; child < item.content.length; child++) {
        const event = item.content[child];
        if (event?.type === "event") {
          out.push({
            ...context,
            event,
            contentPath: [...contentPath, child],
            onset: cursor,
            duration,
            end: cursor + duration,
          });
        }
      }
      cursor += duration;
    } else if (item.type === "space") {
      cursor += (item.duration[0] / item.duration[1]) * 4 * ratio;
    }
  });
  return cursor;
}

/** Notated main-event spans on the shared quarter-note axis, never grace notes. */
export function collectMeasureEventSpans(score: Score, measureIndex: number): FermataEventSpan[] {
  return collectEventSpans(score, measureIndex)[measureIndex] ?? [];
}

/** Batch projection resolves inherited staff meters once for the whole score. */
export function collectScoreEventSpans(score: Score): FermataEventSpan[][] {
  return collectEventSpans(score);
}

function collectEventSpans(score: Score, onlyMeasure?: number): FermataEventSpan[][] {
  let time: TimeSignature = { count: 4, unit: 4 };
  const times = score.global.measures.map((measure) => {
    time = measure.time ?? time;
    return time;
  });
  const rows: FermataEventSpan[][] = times.map(() => []);
  score.parts.forEach((part, partIndex) => {
    const { table, issues } = resolveStaffMeterTimeline(
      part.measures.map((m) => m.staffMeters),
      times,
    );
    if (issues.length) throw issues[0]!.error;
    part.measures.forEach((measure, measureIndex) => {
      if (onlyMeasure !== undefined && onlyMeasure !== measureIndex) return;
      const out = rows[measureIndex];
      const active = times[measureIndex];
      if (!out || !active) return;
      const measureDuration = (active.count * 4) / active.unit;
      measure.sequences.forEach((sequence, sequenceIndex) => {
        const staff = sequence.staff ?? 1;
        const context = { partIndex, sequenceIndex, staff, sequence };
        if (sequence.fullMeasure) {
          out.push({ ...context, contentPath: [], onset: 0, duration: measureDuration, end: measureDuration });
        } else {
          const meter = table[measureIndex]?.get(staff);
          collectContent(sequence.content, 0, meter ? ratioToNumber(meter.ratioToGlobal) : 1, [], context, out);
        }
      });
    });
  });
  return rows;
}

export function projectGlobalFermata(score: Score, measureIndex: number, fermata: GlobalFermata): FermataEventSpan[] {
  const beat = (fermata.position.fraction[0] / fermata.position.fraction[1]) * 4;
  return collectMeasureEventSpans(score, measureIndex).filter(
    (span) => span.onset <= beat + 1e-9 && span.end > beat + 1e-9,
  );
}
