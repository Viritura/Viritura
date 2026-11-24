import { resolveScorePageSetup, type LayoutContent, type PageSetup, type Score } from "@viritura/core";
export { sourcePartMnx as clickPartMnx } from "../components/ScoreCanvas";

export interface ClickScoreView {
  readonly label: string;
  readonly isScore: boolean;
  readonly scoreIndex: number;
  readonly partIndex?: number;
  readonly partId?: string;
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
      isScore: layout ? parts.size > 1 : score.parts.length > 1,
      scoreIndex: index,
      pageSetup: resolveScorePageSetup(score, index),
    };
  });
  if (views.length === 0) {
    views.push({
      label: "Full score",
      isScore: score.parts.length > 1,
      scoreIndex: 0,
      pageSetup: resolveScorePageSetup(score, 0),
    });
  }
  if (score.parts.length > 1) {
    const pageSetup = resolveScorePageSetup({ ...score, scores: [{ pageSetupRole: "part" }] }, 0);
    score.parts.forEach((part, partIndex) => {
      if (part.id && extractedParts.has(part.id)) return;
      views.push({
        label: part.name || `Part ${partIndex + 1}`,
        isScore: false,
        scoreIndex: 0,
        partIndex,
        partId: part.id,
        pageSetup,
      });
    });
  }
  return views;
}
