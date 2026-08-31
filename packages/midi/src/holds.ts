/**
 * Hold schedule — computes the extra time that fermatas and caesuras insert
 * into the timeline.
 *
 * A fermata holds the note it sits on (and pauses the ensemble); a caesura is
 * a grand-pause / breath that inserts silence. Both INSERT time at a beat
 * position, which shifts every later event in every part by the same amount.
 *
 * To keep the ensemble aligned, holds are computed once across ALL parts:
 * - Fermatas are grouped by OVERLAPPING time spans. Each fermata'd note spans
 *   [onset, end); spans whose intervals overlap merge transitively into one
 *   group (a held whole note bridges shorter fermatas under it). Non-overlapping
 *   fermatas in the same bar (e.g. a hold on beat 1 and a separate hold on beat
 *   4) form SEPARATE groups → SEPARATE holds, so each ensemble pause is
 *   preserved instead of being flattened to a single bar-end hold.
 * - Within each group the SHORTEST fermata'd note is the DRIVER: it defines
 *   both the hold AMOUNT ((mult-1) × its duration) AND the insertion POINT
 *   (its END beat). The fermata is held IN PLACE at that note — the extra time
 *   is inserted right where the short note ends, NOT dumped at the bar's end.
 *   Longer fermata notes that overlap merely coexist as a hint: they sustain
 *   through the inserted hold (each extends by the same `extraBeats` from its
 *   own natural end) rather than each doubling their own long duration.
 * - Caesuras are max-merged per beat (a caesura at the same beat in two parts
 *   is one pause).
 *
 * Holds are expressed in quarter-note BEATS (not seconds) so the tempo map can
 * convert them at the tempo in effect where they occur.
 */

import type { GlobalMeasure, Score, SequenceContent, Fermata, Duration, TimeSignature } from "@viritura/core";
import { DURATION_BEATS } from "@viritura/core";

/** What inserted a hold — determines whether carriers sustain (fermata) or the
 *  gap is pure silence (caesura). */
type HoldKind = "fermata" | "caesura";

/** Extra time inserted at one beat position within a measure. */
export interface MeasureHold {
  /** Beat within the measure where the extra time is inserted. For a fermata
   *  this is the DRIVING (shortest) note's END beat, so the hold lands in place
   *  at that note rather than at the bar's end. For a caesura it is the
   *  carrier's end. */
  atBeat: number;
  /** Extra duration to insert, in quarter-note beats. */
  extraBeats: number;
  /** Whether this hold is a fermata (held notes sustain through it) or a
   *  caesura (a pure gap; carriers are not extended). */
  kind: HoldKind;
  /** Fermata only: the group's earliest fermata onset beat. A fermata'd carrier
   *  whose onset falls in [startBeat, spanEndBeat) belongs to this group and
   *  extends by `extraBeats`. */
  startBeat?: number;
  /** Fermata only: the group's latest fermata end beat (the span upper bound
   *  for carrier matching). */
  spanEndBeat?: number;
}

/** Per expanded-measure-index list of holds, sorted by `atBeat`. */
export type HoldSchedule = MeasureHold[][];

/** Default grand-pause / caesura length, in quarter-note beats. */
const CAESURA_BEATS = 1.0;
/** A `short` caesura is a briefer breath. */
const CAESURA_SHORT_BEATS = 0.5;

/**
 * Map a fermata's notated `duration` hint to a hold multiplier (how many times
 * the note's own length it sounds). `normal`/`auto`/unset ≈ doubles the note.
 */
function fermataMultiplier(fermata: Fermata | undefined): number {
  switch (fermata?.duration) {
    case "none":
      return 1.0;
    case "veryShort":
      return 1.25;
    case "short":
      return 1.5;
    case "long":
      return 2.5;
    case "veryLong":
      return 3.0;
    case "normal":
    case "auto":
    default:
      return 2.0;
  }
}

/** Caesura length in beats for a given style. */
function caesuraBeats(style: string | undefined): number {
  return style === "short" ? CAESURA_SHORT_BEATS : CAESURA_BEATS;
}

/** Quarter-note beats for a Duration (base + dots). Local copy to avoid a
 *  circular import with the timeline module. */
function durationBeats(d: Duration): number {
  const base = DURATION_BEATS[d.base] ?? 1;
  if (!d.dots) return base;
  return base * (2 - Math.pow(2, -d.dots));
}

/** Resolve the active time signature at a global measure index. */
function resolveTimeSig(globalMeasures: readonly GlobalMeasure[], measureIdx: number): TimeSignature {
  for (let m = measureIdx; m >= 0; m--) {
    const t = globalMeasures[m]!.time;
    if (t) return t;
  }
  return { count: 4, unit: 4 };
}

/** Quarter-note beats in a measure from its time signature. */
function measureBeats(ts: TimeSignature): number {
  return (ts.count * 4) / ts.unit;
}

/** One fermata'd note's time span within a measure, in quarter-note beats. */
interface FermataSpan {
  /** Onset beat (cursor position where the carrier starts). */
  onset: number;
  /** End beat (onset + real duration). */
  end: number;
  /** Real (tuplet-scaled) duration in beats. */
  duration: number;
  /** Hold multiplier from this note's fermata duration hint. */
  multiplier: number;
}

/**
 * Recursively collect fermata spans and caesuras from a content array,
 * advancing a beat cursor. `ratio` is the cumulative tuplet scaling factor
 * (1 at the top level; for a triplet of 3 eighths in the space of 2 it is 2/3),
 * so a fermata on a note INSIDE a tuplet reports its REAL sounded duration —
 * e.g. a triplet eighth is ~0.33 beats, not 0.5. This is essential: the clarinet
 * solo before reh. 1 carries its fermata on a triplet eighth, and without
 * recursion the scanner only saw the half/whole-note fermatas and over-held the
 * whole bar. Returns the real beats consumed by `content`.
 */
function collectFromContent(
  content: readonly SequenceContent[],
  startBeat: number,
  ratio: number,
  spans: FermataSpan[],
  caesuraByBeat: Map<number, number>,
): number {
  let cursor = startBeat;
  for (const item of content) {
    if (item.type === "event") {
      const dur = durationBeats(item.duration) * ratio;
      const endBeat = cursor + dur;
      if (item.fermata && item.fermata.duration !== "none") {
        const mult = fermataMultiplier(item.fermata);
        if (dur > 0 && mult > 1) {
          spans.push({ onset: cursor, end: endBeat, duration: dur, multiplier: mult });
        }
      }
      if (item.markings?.caesura) {
        mergeMax(caesuraByBeat, endBeat, caesuraBeats(item.markings.caesura.style));
      }
      cursor = endBeat;
    } else if (item.type === "tuplet") {
      const outerBeats = durationBeats(item.outer.duration as Duration) * item.outer.multiple;
      const innerBeats = durationBeats(item.inner.duration as Duration) * item.inner.multiple;
      const childRatio = innerBeats > 0 ? (outerBeats / innerBeats) * ratio : ratio;
      collectFromContent(item.content, cursor, childRatio, spans, caesuraByBeat);
      cursor += outerBeats * ratio;
    } else if (item.type === "tremolo") {
      // Tremolo content carries no meaningful per-note fermata; just advance.
      cursor += durationBeats(item.outer.duration as Duration) * item.outer.multiple * ratio;
    } else if (item.type === "space") {
      cursor += (item.duration[0] / item.duration[1]) * 4 * ratio;
    }
    // grace: consumes no main-cursor time; never carries an ensemble fermata.
  }
  return cursor - startBeat;
}

/**
 * Scan one part's measure, collecting its fermata'd-note spans into `spans`
 * and folding its caesuras into `caesuraByBeat` (max-merged per beat). Recurses
 * into tuplets so nested fermatas report their real (scaled) duration.
 *
 * Spans are grouped by overlap LATER (across all parts) in `groupFermataSpans`,
 * so this just gathers the raw intervals — it does not unify here.
 */
function collectPartMeasureHolds(
  partMeasure: Score["parts"][number]["measures"][number] | undefined,
  spans: FermataSpan[],
  caesuraByBeat: Map<number, number>,
): void {
  if (!partMeasure) return;
  for (const seq of partMeasure.sequences) {
    if (seq.fullMeasure) continue;
    collectFromContent(seq.content, 0, 1, spans, caesuraByBeat);
  }
}

/** Floating-point slop for beat comparisons. */
const BEAT_EPS = 1e-9;

/**
 * Group fermata spans by overlapping intervals and emit one hold per group.
 *
 * Spans are sorted by onset; a span that starts before the running group's end
 * (strictly — touching spans do NOT merge, so back-to-back fermatas stay
 * separate holds) extends the group. Each group's hold amount is
 * `(mult - 1) * minDuration` where `minDuration` is the shortest span in the
 * group (ties broken toward the larger multiplier), inserted at that DRIVING
 * note's END beat so the hold lands in place at the short note. The group's
 * full [startBeat, spanEnd) is recorded so fermata carriers can be matched.
 */
function groupFermataSpans(spans: FermataSpan[]): MeasureHold[] {
  if (spans.length === 0) return [];
  spans.sort((a, b) => a.onset - b.onset || a.end - b.end);

  const holds: MeasureHold[] = [];
  let groupStart = spans[0]!.onset;
  let groupEnd = spans[0]!.end;
  let minDur = spans[0]!.duration;
  let mult = spans[0]!.multiplier;
  let driverEnd = spans[0]!.end; // END of the shortest span = insertion point

  const flush = (): void => {
    const extraBeats = (mult - 1) * minDur;
    if (extraBeats > BEAT_EPS) {
      holds.push({ atBeat: driverEnd, startBeat: groupStart, spanEndBeat: groupEnd, extraBeats, kind: "fermata" });
    }
  };

  for (let i = 1; i < spans.length; i++) {
    const s = spans[i]!;
    if (s.onset < groupEnd - BEAT_EPS) {
      // Overlaps the current group → extend it.
      groupEnd = Math.max(groupEnd, s.end);
      if (s.duration < minDur - BEAT_EPS) {
        minDur = s.duration;
        mult = s.multiplier;
        driverEnd = s.end;
      } else if (Math.abs(s.duration - minDur) < BEAT_EPS && s.multiplier > mult) {
        mult = s.multiplier;
      }
    } else {
      // Disjoint → close the current group and start a new one.
      flush();
      groupStart = s.onset;
      groupEnd = s.end;
      minDur = s.duration;
      mult = s.multiplier;
      driverEnd = s.end;
    }
  }
  flush();
  return holds;
}

/** Insert or max-merge a value at a beat position. */
function mergeMax(byBeat: Map<number, number>, atBeat: number, value: number): void {
  const prev = byBeat.get(atBeat) ?? 0;
  if (value > prev) byBeat.set(atBeat, value);
}

/**
 * Build the per-measure hold schedule for the expanded measure order.
 *
 * @param score          The score (for part measures).
 * @param measureOrder   Expanded measure indices (post repeat/jump expansion).
 * @param globalMeasures Original global measures (for caesura + time sig).
 * @returns One sorted `MeasureHold[]` per expanded measure index.
 */
export function buildHoldSchedule(
  score: Score,
  measureOrder: readonly number[],
  globalMeasures: readonly GlobalMeasure[],
): HoldSchedule {
  const schedule: HoldSchedule = [];

  for (let expandedIdx = 0; expandedIdx < measureOrder.length; expandedIdx++) {
    const origIdx = measureOrder[expandedIdx]!;
    const fermataSpans: FermataSpan[] = [];
    const caesuraByBeat = new Map<number, number>();

    for (const part of score.parts) {
      collectPartMeasureHolds(part.measures[origIdx], fermataSpans, caesuraByBeat);
    }

    // Global caesura on the measure → grand pause at the measure end.
    const globalCaesura = globalMeasures[origIdx]?.caesura;
    if (globalCaesura) {
      const mBeats = measureBeats(resolveTimeSig(globalMeasures, origIdx));
      mergeMax(caesuraByBeat, mBeats, caesuraBeats(globalCaesura.style));
    }

    // Fermatas: group by overlapping spans → one hold per group (see
    // groupFermataSpans). Non-overlapping fermatas yield distinct holds.
    const holds: MeasureHold[] = groupFermataSpans(fermataSpans);
    for (const [atBeat, extraBeats] of caesuraByBeat) {
      holds.push({ atBeat, extraBeats, kind: "caesura" });
    }
    holds.sort((a, b) => a.atBeat - b.atBeat);
    schedule.push(holds);
  }

  return schedule;
}
