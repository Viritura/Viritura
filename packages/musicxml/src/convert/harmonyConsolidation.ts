import type { ChordSymbol } from "@viritura/core";
import type { MnxGlobalMeasure, MnxLayoutContent, MnxPart } from "../types";

interface HarmonyLane {
  partId: string;
  staff: number;
  events: Array<{
    measureIndex: number;
    annotationIndex: number;
    slot: string;
    chord: ChordSymbol;
  }>;
}

export interface HarmonyConsolidation {
  globalTargets: ReadonlySet<string>;
}

function harmonyTargetKey(partId: string, staff: number): string {
  return `${partId}\u0000${staff}`;
}

function semanticChord(chord: ChordSymbol): Omit<ChordSymbol, "displayStaff"> {
  const { displayStaff: _displayStaff, ...semantic } = chord;
  return semantic;
}

function positionKey(chord: ChordSymbol): string {
  const [numerator, denominator] = chord.position.fraction;
  return String(numerator / denominator);
}

function collectHarmonyLanes(parts: MnxPart[]): HarmonyLane[] {
  const lanes = new Map<string, HarmonyLane>();
  for (const part of parts) {
    for (const [measureIndex, measure] of part.measures.entries()) {
      const occurrences = new Map<string, number>();
      for (const [annotationIndex, chord] of (measure._x?.viritura.chordSymbols ?? []).entries()) {
        const staff = chord.displayStaff ?? 1;
        const key = harmonyTargetKey(part.id, staff);
        let lane = lanes.get(key);
        if (!lane) {
          lane = { partId: part.id, staff, events: [] };
          lanes.set(key, lane);
        }
        const onset = positionKey(chord);
        const occurrenceKey = `${staff}:${onset}`;
        const occurrence = occurrences.get(occurrenceKey) ?? 0;
        occurrences.set(occurrenceKey, occurrence + 1);
        lane.events.push({
          measureIndex,
          annotationIndex,
          slot: `${measureIndex}:${onset}:${occurrence}`,
          chord: semanticChord(chord),
        });
      }
    }
  }
  return [...lanes.values()];
}

function writeGlobalEvents(
  globalMeasures: MnxGlobalMeasure[],
  events: Array<{ measureIndex: number; chord: ChordSymbol }>,
): void {
  for (const { measureIndex, chord } of events) {
    const measure = globalMeasures[measureIndex];
    if (!measure) continue;
    const extension = (measure._x ??= { viritura: {} }).viritura;
    (extension.chordSymbols ??= []).push(chord);
  }
}

/**
 * Promote only rhythmic slots whose MusicXML harmony agrees across every
 * imported harmony lane. Differences stay part-local on their source staffs.
 */
export function consolidateImportedHarmony(parts: MnxPart[], globalMeasures: MnxGlobalMeasure[]): HarmonyConsolidation {
  const lanes = collectHarmonyLanes(parts);
  if (lanes.length === 0) return { globalTargets: new Set() };

  const slots = new Set(lanes.flatMap((lane) => lane.events.map((event) => event.slot)));
  const promoted: Array<{ measureIndex: number; chord: ChordSymbol }> = [];
  const removals = new Map<string, Set<number>>();
  for (const slot of slots) {
    const events = lanes.map((lane) => lane.events.find((event) => event.slot === slot));
    if (events.some((event) => event === undefined)) continue;
    const first = events[0]!;
    if (!events.every((event) => JSON.stringify(event!.chord) === JSON.stringify(first.chord))) continue;
    promoted.push({ measureIndex: first.measureIndex, chord: first.chord });
    for (const [laneIndex, event] of events.entries()) {
      const lane = lanes[laneIndex]!;
      const key = `${lane.partId}\u0000${event!.measureIndex}`;
      const indices = removals.get(key) ?? new Set<number>();
      indices.add(event!.annotationIndex);
      removals.set(key, indices);
    }
  }
  if (promoted.length === 0) return { globalTargets: new Set() };

  writeGlobalEvents(globalMeasures, promoted);
  for (const part of parts) {
    for (const [measureIndex, measure] of part.measures.entries()) {
      const extension = measure._x?.viritura;
      const chords = extension?.chordSymbols;
      const indices = removals.get(`${part.id}\u0000${measureIndex}`);
      if (!extension || !chords || !indices) continue;
      extension.chordSymbols = chords.filter((_, index) => !indices.has(index));
      if (extension.chordSymbols.length === 0) delete extension.chordSymbols;
      if (Object.keys(extension).length === 0) delete measure._x;
    }
  }

  return {
    globalTargets: new Set(lanes.map((lane) => harmonyTargetKey(lane.partId, lane.staff))),
  };
}

export function applyGlobalHarmonyVisibility(content: MnxLayoutContent[], globalTargets: ReadonlySet<string>): void {
  if (globalTargets.size === 0) return;
  for (const item of content) {
    if (item.type === "group") {
      applyGlobalHarmonyVisibility(item.content, globalTargets);
      continue;
    }
    const show = item.sources.some((source) => globalTargets.has(harmonyTargetKey(source.part, source.staff ?? 1)));
    item._x = {
      ...item._x,
      viritura: {
        ...item._x?.viritura,
        globalChordSymbolVisibility: show ? "show" : "hide",
      },
    };
  }
}
