import { measureBeats, type Score } from "@viritura/core";

export interface CaptureOrigin {
  measureIndex: number;
  beat: number;
}

export function beatsBetweenMeasures(score: Score, startMeasure: number, endMeasure: number): number {
  let activeTime = { count: 4, unit: 4 };
  let beats = 0;
  for (let index = 0; index < Math.max(startMeasure, endMeasure); index++) {
    if (score.global.measures[index]?.time) activeTime = score.global.measures[index]!.time!;
    if (index >= Math.min(startMeasure, endMeasure)) beats += measureBeats(activeTime);
  }
  return Math.sign(endMeasure - startMeasure) * beats;
}
