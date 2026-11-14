import type { GlobalMeasure, Swing, Tempo } from "../measure";
import { measureTempoInstructions } from "../measure";
import type { TextContent } from "../text";

export interface ResolvedTempoSwing {
  swing: Swing;
  source?: { measureIndex: number; tempoIndex: number };
}

export function resolveTempoSwing(
  measures: readonly GlobalMeasure[],
  measureIndex: number,
  tempoIndex: number,
): ResolvedTempoSwing {
  const selected = measures[measureIndex] && measureTempoInstructions(measures[measureIndex]!)[tempoIndex];
  if (!selected) throw new Error("Cannot resolve swing for a missing tempo marking.");
  const position = (tempo: Tempo) => {
    const [numerator, denominator] = tempo.location?.fraction ?? [0, 1];
    return numerator / denominator;
  };
  let result: ResolvedTempoSwing = { swing: { mode: "straight" } };
  for (let index = 0; index <= measureIndex; index++) {
    const ordered = measureTempoInstructions(measures[index]!)
      .map((tempo, tempoIndex) => ({ tempo, tempoIndex }))
      .sort((a, b) => position(a.tempo) - position(b.tempo) || a.tempoIndex - b.tempoIndex);
    for (const entry of ordered) {
      if (
        index === measureIndex &&
        (position(entry.tempo) > position(selected) ||
          (position(entry.tempo) === position(selected) && entry.tempoIndex > tempoIndex))
      )
        continue;
      if (entry.tempo.swing) {
        result = { swing: entry.tempo.swing, source: { measureIndex: index, tempoIndex: entry.tempoIndex } };
      }
    }
  }
  return result;
}

export function withTempoSwing(tempo: Tempo, swing: Swing | undefined): Tempo | null {
  if (swing?.mode === "swing" && !swing.ratio.every((value) => Number.isSafeInteger(value) && value > 0)) {
    throw new Error("Swing ratios must be positive safe integers.");
  }
  if (tempo.bpm !== undefined) return { ...tempo, swing };
  if (swing !== undefined) return { ...tempo, swing };
  if (tempo.text?.length) return { ...tempo, swing: undefined, text: tempo.text };
  return null;
}

export function withTempoText(tempo: Tempo, text: TextContent): Tempo | null {
  if (tempo.bpm !== undefined || tempo.swing !== undefined) return { ...tempo, text: text.length ? text : undefined };
  return text.length ? { ...tempo, text } : null;
}
