import type { LayoutContent, Score } from "@viritura/core";

export interface BracketPlacement {
  parts: string[];
  label: string;
}

export function bracketMatchesSelection(group: BracketPlacement, selected: string[]): boolean {
  return (
    group.parts.length > 0 &&
    group.parts.length === selected.length &&
    group.parts.every((part) => selected.includes(part))
  );
}

export function bracketPlacements(score: Score | null, scoreIndex: number): BracketPlacement[] {
  const layout = score?.layouts?.find((layout) => layout.id === score.scores?.[scoreIndex]?.layout);
  if (!layout || !score) return [];
  const scoreParts = score.parts;
  const result: BracketPlacement[] = [];
  function partsIn(content: LayoutContent[]): string[] {
    return [
      ...new Set(
        content.flatMap((node) =>
          node.type === "staff" ? node.sources.map((source) => source.part) : partsIn(node.content),
        ),
      ),
    ];
  }
  function visit(content: LayoutContent[], depth: number) {
    for (const node of content) {
      if (node.type !== "group") continue;
      const bracket = node.symbol === "bracket" || node.symbol === "square";
      if (bracket && depth === 0) {
        const parts = partsIn(node.content);
        const firstPart = parts[0];
        if (firstPart) {
          const name = scoreParts.find((part) => part.id === firstPart)?.name || firstPart;
          result.push({ parts: parts.sort(), label: node.label || name });
        }
      }
      visit(node.content, depth + (["bracket", "square"].includes(node.symbol ?? "bracket") ? 1 : 0));
    }
  }
  visit(layout.content, 0);
  return result;
}
