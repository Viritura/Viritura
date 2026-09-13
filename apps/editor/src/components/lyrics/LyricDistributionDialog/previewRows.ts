import type { LyricDistributionPlan } from "../../../lyrics";

export interface LyricPreviewRow {
  readonly index: number;
  readonly tokenLabel: string;
  readonly destinationLabel: string;
  readonly invalid: boolean;
}

export function buildLyricPreviewRows(plan: LyricDistributionPlan): LyricPreviewRow[] {
  return Array.from({ length: Math.max(plan.tokens.length, plan.destinations.length) }, (_, index) => {
    const token = plan.tokens[index];
    const destination = plan.destinations[index];
    const invalid =
      !token ||
      !destination ||
      plan.issues.some(
        (issue) => issue.destinationIndex === index || (issue.tokenIndex === index && destination === undefined),
      );
    let destinationLabel = "No destination";
    if (destination?.kind === "rest") destinationLabel = "Rest";
    else if (destination?.tieContinuation) destinationLabel = "Tie continuation";
    else if (destination?.existingText) destinationLabel = `Existing: ${destination.existingText}`;
    else if (destination) destinationLabel = "Note";
    return {
      index,
      tokenLabel: token ? (token.skip ? "_" : (token.text ?? "")) : "No token",
      destinationLabel,
      invalid,
    };
  });
}
