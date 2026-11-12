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
import { pitchToMidi, walkSequenceEvents } from "@viritura/core";
import { getCatalogInstrument, INSTRUMENT_CATALOG, type CatalogInstrument } from "../score/InstrumentCatalog";
import { measureReference, type MeasureReference } from "./measureReferences";
import { pagination, selectParts } from "./queryFilters";

interface RangeViolation extends MeasureReference {
  voice: number;
  eventId: string | null;
  eventPath: number[];
  noteId: string | null;
  pitch: Pitch;
  soundingMidi: number;
  direction: "below" | "above";
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
  violations: RangeViolation[];
  violationsTruncated: boolean;
  violationOffset: number;
  nextViolationOffset: number | null;
}

export function getScoreInstruments(score: Score, args: unknown) {
  const input = isObject(args) ? args : {};
  const { offset, limit } = pagination(input.violationOffset, input.violationLimit, 100);
  const instruments = selectParts(score, input.partIds).map((part) =>
    describePart(score, part, score.parts.indexOf(part), offset, limit),
  );
  return {
    instruments,
    outOfRangeCount: instruments.filter((i) => i.outOfRange).length,
  };
}

export function searchInstrumentCatalog(args: unknown): Record<string, unknown> {
  const input = isObject(args) ? args : {};
  if (input.query !== undefined && typeof input.query !== "string") throw new Error("query must be a string.");
  const query = typeof input.query === "string" ? input.query.toLowerCase() : "";
  const { offset, limit } = pagination(input.offset, input.limit, 100);
  const matches = INSTRUMENT_CATALOG.filter((item) =>
    `${item.id} ${item.name} ${item.family}`.toLowerCase().includes(query),
  );
  return {
    offset,
    total: matches.length,
    nextOffset: offset + limit < matches.length ? offset + limit : null,
    instruments: matches.slice(offset, offset + limit).map((item) => ({
      id: item.id,
      name: item.name,
      family: item.family,
      staves: item.staves,
      transpositionHalfSteps: item.transposition?.halfSteps ?? 0,
      catalogRange: { low: item.rangeLow, high: item.rangeHigh },
    })),
  };
}

function describePart(score: Score, part: Part, index: number, offset: number, limit: number): InstrumentReport {
  const instrumentId = part._x?.viritura?.instrumentId ?? null;
  const catalog = instrumentId ? (getCatalogInstrument(instrumentId) ?? null) : null;
  const transpositionHalfSteps = part.transposition?.interval.halfSteps ?? 0;

  const catalogRange = catalog ? { low: catalog.rangeLow, high: catalog.rangeHigh } : null;
  const notes = collectPartNotes(score, part, catalogRange, offset, limit);
  const total = notes.belowRange + notes.aboveRange;

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
    ...notes,
    outOfRange: notes.belowRange > 0 || notes.aboveRange > 0,
    violationOffset: offset,
    violationsTruncated: offset > 0 || total > offset + notes.violations.length,
    nextViolationOffset: total > offset + notes.violations.length ? offset + notes.violations.length : null,
  };
}

function collectPartNotes(
  score: Score,
  part: Part,
  catalogRange: { low: number; high: number } | null,
  offset: number,
  limit: number,
): Pick<InstrumentReport, "soundingRange" | "noteCount" | "belowRange" | "aboveRange" | "violations"> {
  const result: Pick<InstrumentReport, "soundingRange" | "noteCount" | "belowRange" | "aboveRange" | "violations"> = {
    soundingRange: null,
    noteCount: 0,
    belowRange: 0,
    aboveRange: 0,
    violations: [],
  };
  for (const [measureIndex, measure] of part.measures.entries()) {
    for (const [voice, sequence] of measure.sequences.entries()) {
      for (const { event, path } of walkSequenceEvents(sequence.content)) {
        for (const note of event.notes ?? []) {
          const soundingMidi = pitchToMidi(note.pitch);
          result.noteCount++;
          if (result.soundingRange) {
            result.soundingRange.low = Math.min(result.soundingRange.low, soundingMidi);
            result.soundingRange.high = Math.max(result.soundingRange.high, soundingMidi);
          } else {
            result.soundingRange = { low: soundingMidi, high: soundingMidi };
          }
          const direction = catalogRange
            ? soundingMidi < catalogRange.low
              ? "below"
              : soundingMidi > catalogRange.high
                ? "above"
                : null
            : null;
          if (!direction) continue;
          if (direction === "below") result.belowRange++;
          else result.aboveRange++;
          const violationIndex = result.belowRange + result.aboveRange - 1;
          if (violationIndex >= offset && result.violations.length < limit) {
            result.violations.push({
              ...measureReference(score, measureIndex),
              voice,
              eventId: event.id ?? null,
              eventPath: path,
              noteId: note.id ?? null,
              pitch: note.pitch,
              soundingMidi,
              direction,
            });
          }
        }
      }
    }
  }
  return result;
}

function catalogClefs(catalog: CatalogInstrument | null): { sign: string; staffPosition: number }[] {
  if (!catalog) return [];
  return Object.values(catalog.clefs).map((clef) => ({ sign: clef.sign, staffPosition: clef.staffPosition }));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
