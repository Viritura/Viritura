import { mergeGlobalChordSymbols, ptr, type ChordSymbolSource, type DiagnosticCollector } from "@viritura/core";
import type { MnxGlobalMeasure } from "../types";

export interface ImportedHarmonySource extends ChordSymbolSource {
  measureIndex: number;
  staff: number;
}

/** Source staff is import provenance only, never persistent chord or layout state. */
export function consolidateImportedHarmony(
  sources: readonly ImportedHarmonySource[],
  globalMeasures: MnxGlobalMeasure[],
  diagnostics?: DiagnosticCollector,
): void {
  const ordered = [...sources].sort((a, b) => a.partIndex - b.partIndex || a.staff - b.staff);
  for (const [measureIndex, wireMeasure] of globalMeasures.entries()) {
    const incoming = ordered.filter((source) => source.measureIndex === measureIndex);
    if (incoming.length === 0) continue;
    const { measure, warnings } = mergeGlobalChordSymbols(
      { chordSymbols: wireMeasure._x?.viritura.chordSymbols },
      incoming,
    );
    globalMeasures[measureIndex] = {
      ...wireMeasure,
      _x: { ...wireMeasure._x, viritura: { ...wireMeasure._x?.viritura, chordSymbols: measure.chordSymbols } },
    };
    for (const warning of warnings) {
      diagnostics?.warn(
        ptr("parts", warning.discardedPartIndex, "measures", measureIndex, "harmony"),
        `Conflicting chord symbols at ${warning.position.fraction.join("/")}: kept the topmost source staff in part ${warning.keptPartIndex + 1}.`,
        "musicxml-harmony-conflict",
      );
    }
  }
}
