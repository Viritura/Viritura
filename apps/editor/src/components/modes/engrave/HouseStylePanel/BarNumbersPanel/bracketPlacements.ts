import type { LayoutContent, Score } from "@viritura/core";

export interface BracketPlacement {
  parts: string[];
  label: string;
}

export function bracketMatchesSelection(group: BracketPlacement, selected: string[]): boolean {
  return group.parts.length > 0 && group.parts.every((part) => selected.includes(part));
}

export function bracketPlacements(score: Score | null, scoreIndex: number): BracketPlacement[] {
  const layout = score?.layouts?.find((layout) => layout.id === score.scores?.[scoreIndex]?.layout);
  if (!layout || !score) return [];
  const result: BracketPlacement[] = [];
  function partsIn(content: LayoutContent[]): string[] {
    return [
      ...new Set(
        content.flatMap((node) =>
          node.type === "staff" ? node.sources.map((source) => source.part) : partsIn(node.content),
        ),
      ),
    ].sort();
  }
  function visit(content: LayoutContent[], depth: number) {
    for (const node of content) {
      if (node.type !== "group") continue;
      const bracket = node.symbol === "bracket" || node.symbol === "square";
      if (bracket && depth === 0) {
        const parts = partsIn(node.content);
        if (parts.length) {
          const names = parts.map((id) => score?.parts.find((part) => part.id === id)?.name || id);
          result.push({ parts, label: node.label || names.join(", ") });
        }
      }
      visit(node.content, depth + (["bracket", "square"].includes(node.symbol ?? "bracket") ? 1 : 0));
    }
  }
  visit(layout.content, 0);
  return result;
}
