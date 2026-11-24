import { resolveScorePageSetup, type LayoutContent, type PageSetup, type Score } from "@viritura/core";
import { parseMnx, serializeMnx } from "@viritura/format";

export interface ClickScoreView {
  readonly label: string;
  readonly scoreIndex: number;
  readonly partIndex?: number;
  readonly pageSetup: PageSetup;
}

function layoutParts(content: readonly LayoutContent[]): Set<string> {
  const parts = new Set<string>();
  for (const node of content) {
    if (node.type === "staff") {
      for (const source of node.sources) parts.add(source.part);
    } else {
      for (const part of layoutParts(node.content)) parts.add(part);
    }
  }
  return parts;
}

export function clickScoreViews(score: Score): ClickScoreView[] {
  const extractedParts = new Set<string>();
  const views: ClickScoreView[] = (score.scores ?? []).map((definition, index) => {
    const layoutId = definition.layout ?? definition.pages?.[0]?.systems?.[0]?.layout;
    const layout = score.layouts?.find((candidate) => candidate.id === layoutId);
    const parts = layout ? layoutParts(layout.content) : new Set(score.parts.flatMap((part) => part.id ?? []));
    if (parts.size === 1) for (const part of parts) extractedParts.add(part);
    return {
      label: definition.name ?? (index === 0 ? "Full score" : `Score ${index + 1}`),
      scoreIndex: index,
      pageSetup: resolveScorePageSetup(score, index),
    };
  });
  if (views.length === 0) {
    views.push({ label: "Full score", scoreIndex: 0, pageSetup: resolveScorePageSetup(score, 0) });
  }
  if (score.parts.length > 1) {
    const pageSetup = resolveScorePageSetup({ ...score, scores: [{ pageSetupRole: "part" }] }, 0);
    score.parts.forEach((part, partIndex) => {
      if (part.id && extractedParts.has(part.id)) return;
      views.push({ label: part.name || `Part ${partIndex + 1}`, scoreIndex: 0, partIndex, pageSetup });
    });
  }
  return views;
}

export function clickPartMnx(mnx: string, partIndex: number): string {
  const score = parseMnx(JSON.parse(mnx));
  const part = score.parts[partIndex];
  if (!part) throw new RangeError(`Missing part ${partIndex + 1}`);
  return JSON.stringify(
    serializeMnx({
      ...score,
      parts: [part],
      layouts: undefined,
      scores: [{ name: part.name, useWritten: true, pageSetupRole: "part" }],
    }),
  );
}
