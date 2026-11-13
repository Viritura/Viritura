import type { LayoutDefinition, Score, ScoreDefinition } from "@viritura/core";
import { collectPartIdsInLayout } from "../../../score/scoreMembership";

interface NumberedLayout {
  index: number;
  partIds: Set<string>;
  namedFullScore: boolean;
}

interface LayoutNumbering {
  numbers: Map<number, string>;
  warnings: string[];
}

function layoutPartIds(definition: ScoreDefinition, layouts: ReadonlyMap<string, LayoutDefinition>): Set<string> {
  const firstSystemLayout = definition.pages?.flatMap((page) => page.systems).find((system) => system.layout)?.layout;
  const id = definition.layout ?? firstSystemLayout;
  const layout = id ? layouts.get(id) : undefined;
  return layout ? collectPartIdsInLayout(layout.content) : new Set();
}

export function numberLayoutsInScoreOrder(score: Score, selectedIndices: readonly number[]): LayoutNumbering {
  const layoutsById = new Map((score.layouts ?? []).map((layout) => [layout.id, layout]));
  const entries: NumberedLayout[] = (score.scores ?? []).map((definition, index) => ({
    index,
    partIds: layoutPartIds(definition, layoutsById),
    namedFullScore: definition.name?.trim().toLowerCase() === "full score",
  }));
  const namedFullScore =
    entries.find((entry) => entry.namedFullScore && entry.partIds.size > 0) ??
    entries.find((entry) => entry.namedFullScore);
  const fullestScore = entries.reduce<NumberedLayout | undefined>(
    (best, entry) => (entry.partIds.size > (best?.partIds.size ?? 1) ? entry : best),
    undefined,
  );
  const reference = namedFullScore?.partIds.size ? namedFullScore : fullestScore;
  const primaryScore = namedFullScore ?? reference;
  const orderedPartIds = new Set(reference?.partIds);
  for (const part of score.parts) if (part.id) orderedPartIds.add(part.id);
  const partRanks = new Map([...orderedPartIds].map((id, index) => [id, index]));

  const scores = entries.filter((entry) => entry.namedFullScore || entry.partIds.size > 1);
  scores.sort((a, b) => Number(b === primaryScore) - Number(a === primaryScore) || a.index - b.index);
  const parts = entries.filter((entry) => !entry.namedFullScore && entry.partIds.size === 1);
  const rank = (entry: NumberedLayout) => partRanks.get([...entry.partIds][0]!) ?? Number.POSITIVE_INFINITY;
  parts.sort((a, b) => (rank(a) === rank(b) ? a.index - b.index : rank(a) - rank(b)));
  const unknown = entries.filter((entry) => !entry.namedFullScore && entry.partIds.size === 0);
  const ordered = [...scores, ...parts, ...unknown];
  const width = Math.max(2, String(entries.length).length);
  const numbers = new Map(ordered.map((entry, index) => [entry.index, String(index + 1).padStart(width, "0")]));

  const selected = new Set(selectedIndices);
  const warnings: string[] = [];
  if (!reference) {
    warnings.push("No full score was identified; numbering uses the instrument list.");
  } else {
    if (reference !== namedFullScore) {
      warnings.push(
        "No usable Full score layout was identified; the score with the most instruments determines the order.",
      );
    }
    if (
      parts.some(
        (entry) =>
          selected.has(entry.index) && Number.isFinite(rank(entry)) && !reference.partIds.has([...entry.partIds][0]!),
      )
    ) {
      warnings.push("Parts absent from the full score follow the instrument list.");
    }
  }
  if (
    entries.some((entry) => selected.has(entry.index) && entry.partIds.size === 0) ||
    parts.some((entry) => selected.has(entry.index) && !Number.isFinite(rank(entry)))
  ) {
    warnings.push("Some layouts have no identifiable instruments; their placement may not reflect score order.");
  }
  return { numbers, warnings };
}
