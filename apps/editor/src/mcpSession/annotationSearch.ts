import { formatChordSymbolText, plainTextContent, walkSequenceEvents, type Score } from "@viritura/core";
import { measureReference, resolveMeasureRange } from "./measureReferences";
import { pagination, selectParts } from "./queryFilters";

const KINDS = ["staffText", "systemText", "rehearsal", "tempo", "lyric", "chordSymbol"] as const;
type AnnotationKind = (typeof KINDS)[number];

export function searchAnnotations(score: Score, args: unknown): Record<string, unknown> {
  const input = isObject(args) ? args : {};
  const { startMeasure, endMeasure } = resolveMeasureRange(score, input, score.global.measures.length);
  const { offset, limit } = pagination(input.offset, input.limit);
  const parts = selectParts(score, input.partIds);
  if (input.query !== undefined && typeof input.query !== "string") throw new Error("query must be a string.");
  const query = typeof input.query === "string" ? input.query.toLowerCase() : "";
  const kinds = readKinds(input.kinds);
  const annotations: Record<string, unknown>[] = [];
  let total = 0;
  const add = (kind: AnnotationKind, text: string, details: Record<string, unknown>) => {
    if (!kinds.has(kind) || !text.toLowerCase().includes(query)) return;
    if (total >= offset && annotations.length < limit) annotations.push({ kind, text, ...details });
    total++;
  };

  for (let index = startMeasure - 1; index < endMeasure; index++) {
    const global = score.global.measures[index]!;
    const location = measureReference(score, index);
    if (global.rehearsalMark) add("rehearsal", plainTextContent(global.rehearsalMark.text), { ...location });
    global.systemText?.forEach((item, systemTextIndex) =>
      add("systemText", plainTextContent(item.text), {
        ...location,
        systemTextIndex,
        id: item.id,
        position: item.position,
      }),
    );
    global.tempos?.forEach((item, tempoIndex) => {
      if (item.text)
        add("tempo", plainTextContent(item.text), { ...location, tempoIndex, position: item.location ?? null });
    });
    global.chordSymbols?.forEach((item, chordSymbolIndex) =>
      add("chordSymbol", formatChordSymbolText(item), { ...location, chordSymbolIndex, position: item.position }),
    );
    for (const part of parts) {
      const measure = part.measures[index];
      if (!measure) continue;
      const partLocation = { ...location, partId: part.id ?? null, partIndex: score.parts.indexOf(part) };
      measure.expressions?.forEach((item, expressionIndex) =>
        add("staffText", plainTextContent(item.text), {
          ...partLocation,
          expressionIndex,
          position: item.position,
          staff: item.staff ?? null,
          voice: item.voice ?? null,
        }),
      );
      measure.sequences.forEach((sequence, voice) => {
        for (const { event, path } of walkSequenceEvents(sequence.content)) {
          for (const [line, lyric] of Object.entries(event.lyrics?.lines ?? {})) {
            add("lyric", lyric.text, {
              ...partLocation,
              voice,
              staff: sequence.staff ?? 1,
              eventId: event.id ?? null,
              eventPath: path,
              line,
            });
          }
        }
      });
    }
  }
  return {
    startMeasure,
    endMeasure,
    offset,
    total,
    nextOffset: offset + annotations.length < total ? offset + annotations.length : null,
    annotations,
  };
}

function readKinds(value: unknown): Set<AnnotationKind> {
  if (value === undefined) return new Set(KINDS);
  if (!Array.isArray(value)) {
    throw new Error(`kinds must contain only ${KINDS.join(", ")}.`);
  }
  const kinds = new Set<AnnotationKind>();
  for (const kind of value) {
    const match = KINDS.find((candidate) => candidate === kind);
    if (!match) throw new Error(`kinds must contain only ${KINDS.join(", ")}.`);
    kinds.add(match);
  }
  return kinds;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
