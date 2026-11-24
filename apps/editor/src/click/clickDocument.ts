import { parseMnx } from "@viritura/format";
import { resolveMeter } from "@viritura/core";
import { compilePlaybackTiming, type PlaybackTiming } from "@viritura/midi/timing";
import { collectClickBars, type ClickBar } from "./barNavigation";
import { clickScoreViews, type ClickScoreView } from "./scoreViews";

export interface ClickDocument {
  readonly filename: string;
  readonly mnx: string;
  readonly scoreViews: readonly ClickScoreView[];
  readonly timing: PlaybackTiming;
  readonly bars: readonly ClickBar[];
}

export function readClickDocument(filename: string, text: string): ClickDocument {
  const score = parseMnx(JSON.parse(text));
  const timing = compilePlaybackTiming(score);
  for (const meter of timing.measureTimeSignatures) resolveMeter(meter);
  const bars = collectClickBars(score, timing);
  if (!bars.some((bar) => bar.startable)) throw new Error("The MNX file has no playable bar boundary");
  return {
    filename,
    mnx: text,
    scoreViews: clickScoreViews(score),
    timing,
    bars,
  };
}
