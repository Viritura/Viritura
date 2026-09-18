import { measureBeats, type Score } from "@viritura/core";
import type { CapturedChordSymbol } from "./ClipboardFragment";
import { partStaffOffset } from "./clipboardTrackMapping";

function activeMeasureBeats(score: Score, measureIndex: number): number {
  let time = { count: 4, unit: 4 };
  for (let index = 0; index <= measureIndex; index++) {
    if (score.global.measures[index]?.time) time = score.global.measures[index]!.time!;
  }
  return measureBeats(time);
}

function wholeFraction(beats: number): [number, number] {
  return [Math.round(beats * 256), 1024];
}

export function captureChordSymbols(
  score: Score,
  partIndex: number,
  startMeasure: number,
  endMeasure: number,
  firstMeasureStartBeat: number,
  lastMeasureEndBeat: number,
  partOffset = 0,
  anchorStaffOffset = 0,
): CapturedChordSymbol[] {
  const result: CapturedChordSymbol[] = [];
  let beatsBeforeMeasure = 0;
  for (let measureIndex = startMeasure; measureIndex <= endMeasure; measureIndex++) {
    const symbols = score.parts[partIndex]?.measures[measureIndex]?.chordSymbols ?? [];
    for (const chordSymbol of symbols) {
      const [numerator, denominator] = chordSymbol.position.fraction;
      if (denominator === 0) continue;
      const beat = (numerator / denominator) * 4;
      if (measureIndex === startMeasure && beat < firstMeasureStartBeat - 1e-9) continue;
      if (measureIndex === endMeasure && beat > lastMeasureEndBeat + 1e-9) continue;
      const cloned = structuredClone(chordSymbol);
      if (measureIndex === startMeasure) {
        cloned.position = { fraction: wholeFraction(beat - firstMeasureStartBeat) };
      }
      result.push({
        ...(partOffset === 0 ? {} : { partOffset }),
        staffOffset:
          partStaffOffset(score, partIndex - partOffset, partIndex, chordSymbol.displayStaff ?? 1) - anchorStaffOffset,
        measureOffset: measureIndex - startMeasure,
        offset: wholeFraction(beatsBeforeMeasure + beat - firstMeasureStartBeat),
        chordSymbol: cloned,
      });
    }
    beatsBeforeMeasure += activeMeasureBeats(score, measureIndex);
  }
  return result;
}
