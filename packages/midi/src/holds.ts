import type { GlobalMeasure, Score } from "@viritura/core";
import { canonicalGlobalFermatas, collectScoreEventSpans } from "@viritura/core";

export interface MeasureHold {
  /** Quarter-note beat where the driver ends and the hold begins. */
  atBeat: number;
  extraBeats: number;
  kind: "fermata" | "caesura";
  /** The exact global fermata position, used to match overlapping carriers. */
  startBeat?: number;
  spanEndBeat?: number;
  clickBehavior?: "silent" | "keepClicking";
  fermataId?: string;
}

export type HoldSchedule = MeasureHold[][];

export function fermataResumeBeat(holds: readonly MeasureHold[], onset: number, end: number): number | undefined {
  let resume: number | undefined;
  for (const hold of holds) {
    const position = hold.startBeat ?? hold.atBeat;
    if (hold.kind === "fermata" && onset <= position + 1e-9 && end > position + 1e-9) {
      resume = Math.max(resume ?? hold.atBeat, hold.atBeat);
    }
  }
  return resume;
}

function caesuraBeats(style: string | undefined): number {
  return style === "short" ? 0.5 : 1;
}

/** Global fermatas alone insert ensemble holds; local fermatas are notation. */
export function buildHoldSchedule(
  score: Score,
  measureOrder: readonly number[],
  globalMeasures: readonly GlobalMeasure[],
): HoldSchedule {
  const byMeasure = new Map<number, MeasureHold[]>();
  const rows = collectScoreEventSpans(score);
  return measureOrder.map((measureIndex) => {
    const cached = byMeasure.get(measureIndex);
    if (cached) return cached;
    const spans = rows[measureIndex] ?? [];
    const measure = globalMeasures[measureIndex];
    const holds: MeasureHold[] = [];
    for (const fermata of canonicalGlobalFermatas(measure?.fermatas)) {
      const beat = (fermata.position.fraction[0] / fermata.position.fraction[1]) * 4;
      const sounding = spans.filter((span) => span.onset <= beat + 1e-9 && span.end > beat + 1e-9);
      const driver = sounding.sort((a, b) => b.onset - a.onset || a.duration - b.duration)[0];
      if (!driver) continue;
      const extraBeats = ((fermata.multiplier ?? 2) - 1) * driver.duration;
      if (extraBeats > 0) {
        holds.push({
          atBeat: driver.end,
          extraBeats,
          kind: "fermata",
          startBeat: beat,
          spanEndBeat: Math.max(...sounding.map((span) => span.end)),
          clickBehavior: fermata.clickBehavior ?? "silent",
          fermataId: fermata.id,
        });
      }
    }
    const caesuras = new Map<number, number>();
    for (const span of spans) {
      const caesura = span.event?.markings?.caesura ?? span.sequence.fullMeasure?.caesura;
      if (caesura) caesuras.set(span.end, Math.max(caesuras.get(span.end) ?? 0, caesuraBeats(caesura.style)));
    }
    if (measure?.caesura) {
      let time = { count: 4, unit: 4 };
      for (let index = 0; index <= measureIndex; index++) time = globalMeasures[index]?.time ?? time;
      const beat = (time.count * 4) / time.unit;
      caesuras.set(beat, Math.max(caesuras.get(beat) ?? 0, caesuraBeats(measure.caesura.style)));
    }
    for (const [atBeat, extraBeats] of caesuras) holds.push({ atBeat, extraBeats, kind: "caesura" });
    holds.sort((a, b) => a.atBeat - b.atBeat);
    byMeasure.set(measureIndex, holds);
    return holds;
  });
}
