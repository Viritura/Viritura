import type { LayoutContent, LayoutGroup } from "@viritura/core";
import { FAMILY_META, type InstrumentFamily } from "./InstrumentCatalog";

/**
 * Conventional nested-bracket policy for generated orchestral layouts.
 * This belongs to layout construction rather than the instrument catalog:
 * the same catalog instrument may be used without orchestral grouping.
 */
const ORCHESTRAL_INSTRUMENT_GROUPS: Readonly<Record<string, string>> = {
  piccolo: "flutes",
  flute: "flutes",
  "alto-flute": "flutes",
  oboe: "oboes",
  "english-horn": "oboes",
  "bflat-clarinet": "clarinets",
  "a-clarinet": "clarinets",
  "eflat-clarinet": "clarinets",
  "bass-clarinet": "clarinets",
  bassoon: "bassoons",
  contrabassoon: "bassoons",
  "soprano-sax": "saxophones",
  "alto-sax": "saxophones",
  "tenor-sax": "saxophones",
  "baritone-sax": "saxophones",
  horn: "horns",
  trumpet: "trumpets",
  "c-trumpet": "trumpets",
  cornet: "trumpets",
  flugelhorn: "trumpets",
  trombone: "trombones",
  "bass-trombone": "trombones",
  euphonium: "trombones",
  tuba: "tubas",
  violin: "violins",
  viola: "violas",
  cello: "cellos",
  "double-bass": "double-basses",
};

export function orchestralInstrumentGroup(instrumentId: string | undefined): string | undefined {
  return instrumentId ? ORCHESTRAL_INSTRUMENT_GROUPS[instrumentId] : undefined;
}

export interface OrchestralLayoutEntry {
  family?: InstrumentFamily;
  subGroup?: string;
  node: LayoutContent;
}

export function buildOrchestralLayoutGroups(entries: readonly OrchestralLayoutEntry[]): LayoutContent[] {
  const buckets = new Map<InstrumentFamily | "other", OrchestralLayoutEntry[]>();
  for (const entry of entries) {
    const key = entry.family ?? "other";
    buckets.set(key, [...(buckets.get(key) ?? []), entry]);
  }
  const order = (family: InstrumentFamily | "other") => (family === "other" ? 99 : FAMILY_META[family].order);
  const result: LayoutContent[] = [];
  for (const family of [...buckets.keys()].sort((left, right) => order(left) - order(right))) {
    const familyEntries = buckets.get(family)!;
    if (family === "other" || familyEntries.length === 1) {
      result.push(...familyEntries.map((entry) => entry.node));
      continue;
    }
    const content: LayoutContent[] = [];
    let activeSubGroup: string | undefined;
    let activeSubGroupNode: LayoutGroup | undefined;
    for (const entry of familyEntries) {
      const shouldGroup =
        entry.subGroup && familyEntries.filter((candidate) => candidate.subGroup === entry.subGroup).length > 1;
      if (!shouldGroup) {
        activeSubGroup = undefined;
        activeSubGroupNode = undefined;
        content.push(entry.node);
        continue;
      }
      if (activeSubGroup === entry.subGroup && activeSubGroupNode) {
        activeSubGroupNode.content.push(entry.node);
        continue;
      }
      activeSubGroup = entry.subGroup;
      activeSubGroupNode = { type: "group", symbol: "bracket", content: [entry.node] };
      content.push(activeSubGroupNode);
    }
    result.push({
      type: "group",
      symbol: "bracket",
      label: FAMILY_META[family].label,
      content,
    } as LayoutGroup);
  }
  return result;
}
