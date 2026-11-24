import type { DiagnosticCollector, LayoutContent, LayoutSource, Score, Sequence } from "@viritura/core";
import type { ExportPart, ExportSelection, MusicXmlExportOptions } from "./types";

function collectSources(content: readonly LayoutContent[]): LayoutSource[] {
  return content.flatMap((item) => (item.type === "group" ? collectSources(item.content) : item.sources));
}

export function includesSequence(part: ExportPart, sequence: Sequence): boolean {
  return part.sources.some(
    (source) =>
      (source.staff === undefined || source.staff === (sequence.staff ?? 1)) &&
      (source.voice === undefined || source.voice === sequence.voice),
  );
}

export function includesDirection(part: ExportPart, staff?: number, voice?: string): boolean {
  return part.sources.some(
    (source) =>
      (staff === undefined || source.staff === undefined || source.staff === staff) &&
      (voice === undefined || source.voice === undefined || source.voice === voice),
  );
}

function selectedDefinition(score: Score, index: number | undefined) {
  if (index === undefined) return undefined;
  if (!Number.isInteger(index) || index < 0 || !score.scores?.at(index))
    throw new Error("The selected score does not exist in this document.");
  return score.scores.at(index);
}

export function selectExport(
  score: Score,
  options: MusicXmlExportOptions,
  diagnostics: DiagnosticCollector,
): ExportSelection {
  const index = options.scoreIndex;
  const definition = selectedDefinition(score, index);
  const layouts = new Map((score.layouts ?? []).map((layout) => [layout.id, layout]));
  if (layouts.size !== (score.layouts?.length ?? 0)) throw new Error("The document contains duplicate layout IDs.");
  const systems = definition?.pages?.flatMap((page) => page.systems) ?? [];
  const layoutIds = [
    definition?.layout,
    ...systems.flatMap((system) => [system.layout, ...(system.layoutChanges ?? []).map((change) => change.layout)]),
  ].filter((id): id is string => id !== undefined && id !== "");
  const sources: LayoutSource[] = [];
  for (const id of new Set(layoutIds)) {
    const layout = layouts.get(id);
    if (!layout) throw new Error(`The selected score references missing layout "${id}".`);
    sources.push(...collectSources(layout.content));
  }
  if (layoutIds.length === 0) {
    if (definition)
      diagnostics.warn(
        `/scores/${index}`,
        "This score has no explicit layout; MusicXML includes all instruments.",
        "musicxml-implicit-layout",
      );
    score.parts.forEach((part, i) => sources.push({ part: part.id ?? `source-${i}` }));
  }
  const sourceParts = new Map(score.parts.map((part, i) => [part.id ?? `source-${i}`, i]));
  if (sourceParts.size !== score.parts.length) throw new Error("The document contains duplicate instrument IDs.");
  const byPart = new Map<number, LayoutSource[]>();
  for (const source of sources) {
    const sourceIndex = sourceParts.get(source.part);
    if (sourceIndex === undefined) throw new Error(`Layout references missing instrument "${source.part}".`);
    const partSources = byPart.get(sourceIndex) ?? [];
    partSources.push(source);
    byPart.set(sourceIndex, partSources);
  }
  const parts: ExportPart[] = [...byPart].map(([sourceIndex, partSources], outputIndex) => {
    const part = score.parts[sourceIndex]!;
    const availableStaves = new Set(Array.from({ length: part.staves ?? 1 }, (_, i) => i + 1));
    for (const measure of part.measures) {
      for (const sequence of measure.sequences) availableStaves.add(sequence.staff ?? 1);
      for (const clef of measure.clefs ?? []) availableStaves.add(clef.staff ?? 1);
      for (const config of measure.staffConfigs ?? []) availableStaves.add(config.staff ?? 1);
    }
    const staffNumbers = new Set<number>();
    for (const source of partSources) {
      if (source.staff !== undefined) staffNumbers.add(source.staff);
      else {
        for (const staff of availableStaves) staffNumbers.add(staff);
        for (const measure of part.measures) {
          for (const sequence of measure.sequences) {
            if (source.voice === undefined || source.voice === sequence.voice) staffNumbers.add(sequence.staff ?? 1);
          }
        }
      }
    }
    if ([...staffNumbers].some((staff) => !Number.isInteger(staff) || staff < 1 || !availableStaves.has(staff)))
      throw new Error("Layout contains an invalid staff number.");
    return {
      part,
      sourceIndex,
      xmlId: `P${outputIndex + 1}`,
      sources: partSources,
      staves: new Map([...staffNumbers].sort((a, b) => a - b).map((staff, i) => [staff, i + 1])),
    };
  });
  if (parts.length === 0) throw new Error("The selected score contains no instruments to export.");
  if (parts.some(({ part }) => part.measures.length !== score.global.measures.length)) {
    throw new Error("Instrument measures do not align with the document's measure list.");
  }
  if (layoutIds.length > 1 || sources.some((source) => source.stem !== undefined)) {
    diagnostics.info(
      `/scores/${index}`,
      "MusicXML retains the selected instruments and voices; changing staff groupings and condensing are reflowed by the receiving application.",
      "musicxml-layout-reflow",
    );
  }
  return {
    parts,
    definition,
    layout: layouts.get(layoutIds[0] ?? ""),
    useWritten: definition?.useWritten ?? index === undefined,
  };
}
