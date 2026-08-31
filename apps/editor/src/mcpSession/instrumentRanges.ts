/**
 * Read-only per-part instrument identity + range queries backing the
 * `score.get_instruments` MCP tool.
 *
 * Beyond echoing the resolved instrument identity (from `_x.viritura` and the
 * editor's instrument catalog), this performs the range check that previously
 * lived in an ad-hoc script: it compares each part's actual sounding pitches
 * against the catalog's playable range and flags parts that stray outside it.
 */

import type { Part, Pitch, Score } from "@viritura/core";
import { pitchToMidi } from "@viritura/core";
import { getCatalogInstrument, type CatalogInstrument } from "../score/InstrumentCatalog";

interface PitchWalkNode {
  readonly type?: string;
  readonly notes?: readonly { readonly pitch?: Pitch }[];
  readonly content?: readonly PitchWalkNode[];
}

interface InstrumentReport {
  partId: string | null;
  index: number;
  name: string;
  instrumentId: string | null;
  midiProgram: number | null;
  family: string | null;
  transpositionHalfSteps: number;
  /** Catalog sounding-MIDI range, when the instrument is known. */
  catalogRange: { low: number; high: number } | null;
  clefs: { sign: string; staffPosition: number }[];
  /** Sounding-MIDI extremes of the part's actual notes, or null when empty. */
  soundingRange: { low: number; high: number } | null;
  noteCount: number;
  /** Notes below/above the catalog range (0 when in range or unknown). */
  belowRange: number;
  aboveRange: number;
  outOfRange: boolean;
}

export function getScoreInstruments(score: Score): Record<string, unknown> {
  const instruments = score.parts.map((part, index) => describePart(part, index));
  return {
    instruments,
    outOfRangeCount: instruments.filter((i) => i.outOfRange).length,
  };
}

function describePart(part: Part, index: number): InstrumentReport {
  const instrumentId = part._x?.viritura?.instrumentId ?? null;
  const catalog = instrumentId ? (getCatalogInstrument(instrumentId) ?? null) : null;
  const transpositionHalfSteps = part.transposition?.interval.halfSteps ?? 0;

  const soundingMidis = collectPartSoundingMidis(part, transpositionHalfSteps);
  const soundingRange =
    soundingMidis.length > 0 ? { low: Math.min(...soundingMidis), high: Math.max(...soundingMidis) } : null;
  const catalogRange = catalog ? { low: catalog.rangeLow, high: catalog.rangeHigh } : null;
  const { belowRange, aboveRange } = countOutOfRange(soundingMidis, catalogRange);

  return {
    partId: part.id ?? null,
    index,
    name: part.name,
    instrumentId,
    midiProgram: part._x?.viritura?.midiProgram ?? catalog?.midiProgram ?? null,
    family: part._x?.viritura?.family ?? catalog?.family ?? null,
    transpositionHalfSteps,
    catalogRange,
    clefs: catalogClefs(catalog),
    soundingRange,
    noteCount: soundingMidis.length,
    belowRange,
    aboveRange,
    outOfRange: belowRange > 0 || aboveRange > 0,
  };
}

function collectPartSoundingMidis(part: Part, transpositionHalfSteps: number): number[] {
  const soundingMidis: number[] = [];
  for (const measure of part.measures) {
    for (const seq of measure.sequences) {
      collectSoundingMidis(seq.content, transpositionHalfSteps, soundingMidis);
    }
  }
  return soundingMidis;
}

function countOutOfRange(
  soundingMidis: readonly number[],
  catalogRange: { low: number; high: number } | null,
): { belowRange: number; aboveRange: number } {
  if (!catalogRange) return { belowRange: 0, aboveRange: 0 };
  let belowRange = 0;
  let aboveRange = 0;
  for (const midi of soundingMidis) {
    if (midi < catalogRange.low) belowRange++;
    else if (midi > catalogRange.high) aboveRange++;
  }
  return { belowRange, aboveRange };
}

function catalogClefs(catalog: CatalogInstrument | null): { sign: string; staffPosition: number }[] {
  if (!catalog) return [];
  return Object.values(catalog.clefs).map((clef) => ({ sign: clef.sign, staffPosition: clef.staffPosition }));
}

/** Recursively collect sounding MIDI numbers (written pitch minus transposition). */
function collectSoundingMidis(content: readonly PitchWalkNode[], transpositionHalfSteps: number, out: number[]): void {
  for (const node of content) {
    if (node.notes) {
      for (const note of node.notes) {
        if (note.pitch) out.push(pitchToMidi(note.pitch) - transpositionHalfSteps);
      }
    }
    if (node.content) collectSoundingMidis(node.content, transpositionHalfSteps, out);
  }
}
