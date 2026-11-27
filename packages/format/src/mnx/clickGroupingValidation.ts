import { compileClickSettings, type ClickInstruction, type ClickMeasure } from "@viritura/core";
import type { Root as RawScore } from "@viritura/core/raw";
import type { MeasureGlobalExtensions, TempoExtensions } from "@viritura/core/raw-viritura";
import type { RawScoreValidationError } from "./validator";

export function validateClickGroupings(score: RawScore): RawScoreValidationError[] {
  const measures: ClickMeasure[] = score.global.measures.map((measure) => {
    const extensions = measure._x?.["viritura"] as MeasureGlobalExtensions | undefined;
    const instructions: ClickInstruction[] = (measure.tempos ?? []).map((tempo) => {
      const extension = tempo._x?.["viritura"] as TempoExtensions | undefined;
      return {
        bpm: tempo.bpm,
        clickSubdivision: extension?.clickSubdivision,
        clickGrouping: extension?.clickGrouping,
        location: tempo.location ? { fraction: [tempo.location.fraction[0]!, tempo.location.fraction[1]!] } : undefined,
      };
    });
    for (const tempo of extensions?.tempos ?? []) {
      instructions.push({
        bpm: tempo.bpm,
        clickSubdivision: tempo.clickSubdivision,
        clickGrouping: tempo.clickGrouping,
        location: tempo.location ? { fraction: [tempo.location.fraction[0]!, tempo.location.fraction[1]!] } : undefined,
      });
    }
    for (const text of extensions?.systemText ?? []) {
      if (text.tempo) {
        instructions.push({
          ...text.tempo,
          location: { fraction: [text.position.fraction[0]!, text.position.fraction[1]!] },
        });
      }
    }
    return {
      time: measure.time ? { count: measure.time.count, unit: measure.time.unit } : undefined,
      instructions,
    };
  });
  try {
    compileClickSettings(measures);
    return [];
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return [{ pointer: "/global/measures", message: error.message, keyword: "clickGrouping" }];
  }
}
