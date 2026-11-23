import { parseMnx } from "@viritura/format";
import { resolveMeter } from "@viritura/core";
import { compilePlaybackTiming, type PlaybackTiming } from "@viritura/midi/timing";

export interface ClickDocument {
  readonly filename: string;
  readonly timing: PlaybackTiming;
  readonly barNumbers: readonly number[];
}

export function readClickDocument(filename: string, text: string): ClickDocument {
  const score = parseMnx(JSON.parse(text));
  const timing = compilePlaybackTiming(score);
  for (const meter of timing.measureTimeSignatures) resolveMeter(meter);
  return {
    filename,
    timing,
    barNumbers: score.global.measures.map((measure, index) => measure.number ?? index + 1),
  };
}
