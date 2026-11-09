import type { GlobalMeasure, GradualTempo, TempoRampCurve } from "@viritura/core";
import { TempoModel, type TempoRegion } from "../tempoModel";

export interface TempoRampDeclaration {
  declIdx: number;
  gt: GradualTempo;
  startBeat: number;
}

function shape(curve: TempoRampCurve, u: number): number {
  switch (curve) {
    case "linear":
      return u;
    case "early":
      return 1 - (1 - u) ** 2;
    case "late":
      return u * u;
    case "smooth":
      return u * u * (3 - 2 * u);
  }
}

function positive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be finite and greater than zero.`);
  return value;
}

function rampEnd(
  { declIdx, gt }: TempoRampDeclaration,
  measures: readonly GlobalMeasure[],
  starts: readonly number[],
  totalBeats: number,
): number {
  // Expanded repeats retain source IDs: bind to the endpoint in this occurrence.
  let index = measures.findIndex((measure, i) => i >= declIdx && measure.id === gt.end.measure);
  if (index < 0 && /^\d+$/.test(gt.end.measure)) index = Number(gt.end.measure);
  const start = starts[index];
  if (start === undefined) throw new RangeError(`Tempo ramp endpoint measure not found: ${gt.end.measure}`);
  const [numerator, denominator] = gt.end.position.fraction;
  positive(denominator, "Tempo ramp endpoint denominator");
  const end = start + (numerator / denominator) * 4;
  const measureEnd = starts[index + 1] ?? totalBeats;
  if (end < start || end > measureEnd + 1e-9) {
    throw new RangeError("Tempo ramp endpoint must be within its bar.");
  }
  return end;
}

/** Compile curves to linear BPM segments with a conservative 0.1 ms timing-error budget per ramp. */
function curveRegions(
  start: number,
  end: number,
  stop: number,
  from: number,
  to: number,
  curve: TempoRampCurve,
): TempoRegion[] {
  const regions: TempoRegion[] = [];
  const span = end - start;
  const bpmAt = (beat: number) => from + (to - from) * shape(curve, (beat - start) / span);
  const append = (a: number, b: number, depth: number): void => {
    const startBpm = bpmAt(a);
    const endBpm = bpmAt(b);
    const minBpm = Math.min(startBpm, endBpm);
    const du = (b - a) / span;
    const secondDerivative = curve === "linear" ? 0 : Math.abs(to - from) * (curve === "smooth" ? 6 : 2);
    const bpmError = (secondDerivative * du * du) / 8;
    const timeError = (60 * (b - a) * bpmError) / (minBpm * minBpm);
    if (bpmError > 0.001 || timeError > (0.0001 * (b - a)) / span) {
      if (depth >= 20) throw new RangeError("Tempo ramp exceeds supported curve precision.");
      const mid = (a + b) / 2;
      append(a, mid, depth + 1);
      append(mid, b, depth + 1);
    } else {
      if (regions.length >= 8192) throw new RangeError("Tempo ramp exceeds supported curve precision.");
      regions.push({ startBeat: a, endBeat: b, startBpm, endBpm });
    }
  };
  append(start, stop, 0);
  return regions;
}

export function compileTempoRamps(
  anchors: readonly TempoRegion[],
  declarations: readonly TempoRampDeclaration[],
  measures: readonly GlobalMeasure[],
  starts: readonly number[],
  totalBeats: number,
): TempoRegion[] {
  const regions = [...anchors];
  let previousEnd = -Infinity;
  for (const declaration of [...declarations].sort((a, b) => a.startBeat - b.startBeat)) {
    const { gt, startBeat } = declaration;
    const end = rampEnd(declaration, measures, starts, totalBeats);
    positive(gt.position.fraction[1], "Tempo ramp start denominator");
    const barStart = starts[declaration.declIdx]!;
    const barEnd = starts[declaration.declIdx + 1] ?? totalBeats;
    if (startBeat < barStart || startBeat > barEnd) throw new RangeError("Tempo ramp start must be within its bar.");
    if (!Number.isFinite(startBeat) || startBeat < 0 || !Number.isFinite(end) || end <= startBeat || end > totalBeats) {
      throw new RangeError("Tempo ramp must have a positive span within the score.");
    }
    if (startBeat < previousEnd - 1e-9) throw new RangeError("Tempo ramps must not overlap.");
    previousEnd = end;
    if ((gt.endBpm === undefined) === (gt.endRatio === undefined)) {
      throw new RangeError("Tempo ramp requires exactly one BPM or ratio target.");
    }
    const from = positive(gt.startBpm ?? TempoModel.build(regions).bpmAtBeat(startBeat), "Tempo ramp start BPM");
    const to = positive(gt.endBpm ?? from * positive(gt.endRatio!, "Tempo ramp target ratio"), "Tempo ramp target BPM");
    const interruption = anchors
      .filter((anchor) => anchor.startBeat > startBeat + 1e-9 && anchor.startBeat < end)
      .sort((a, b) => a.startBeat - b.startBeat)[0];
    const stop = interruption?.startBeat ?? end;
    regions.push(...curveRegions(startBeat, end, stop, from, to, gt.curve ?? "linear"));
    if (!anchors.some((anchor) => Math.abs(anchor.startBeat - stop) < 1e-9)) {
      regions.push({ startBeat: stop, endBeat: Infinity, startBpm: to, endBpm: to });
    }
  }
  return regions;
}
