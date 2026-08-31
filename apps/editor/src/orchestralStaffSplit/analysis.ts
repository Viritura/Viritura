import type { Score } from "@viritura/core";
import { parsePlayerRoutingLabel } from "./routingText";
import { SPLIT_POLICIES } from "./splitPolicies";
import { splitOrchestralParts } from "./transform";

interface OrchestralPartSplitPartAnalysis {
  readonly id: string;
  readonly name: string;
  readonly resultingParts: readonly {
    readonly id: string;
    readonly name: string;
    readonly shortName: string;
  }[];
  readonly recognizedRoutingLabelCount: number;
}

interface OrchestralPartSplitAnalysis {
  readonly parts: readonly OrchestralPartSplitPartAnalysis[];
  readonly recognizedRoutingLabelCount: number;
  readonly error: string | null;
}

/** Analyze the fixed orchestral split policy without mutating the supplied score. */
export function analyzeOrchestralPartSplit(score: Score | null): OrchestralPartSplitAnalysis {
  if (!score) return { parts: [], recognizedRoutingLabelCount: 0, error: "No score is open." };

  const parts = SPLIT_POLICIES.flatMap((policy): OrchestralPartSplitPartAnalysis[] => {
    const part = score.parts.find((candidate) => candidate.id === policy.id);
    if (!part || !policy.acceptedNames.includes(part.name)) return [];
    const recognizedRoutingLabelCount = part.measures.reduce(
      (count, measure) =>
        count + (measure.expressions ?? []).filter((expression) => parsePlayerRoutingLabel(expression.text)).length,
      0,
    );
    return [
      {
        id: policy.id,
        name: part.name,
        resultingParts: policy.players.map((player, index) => ({
          id: `${policy.id}-${String(index + 1)}`,
          ...player,
        })),
        recognizedRoutingLabelCount,
      },
    ];
  });
  const recognizedRoutingLabelCount = parts.reduce((count, part) => count + part.recognizedRoutingLabelCount, 0);

  try {
    splitOrchestralParts(score);
    return { parts, recognizedRoutingLabelCount, error: null };
  } catch (error) {
    return {
      parts,
      recognizedRoutingLabelCount,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
