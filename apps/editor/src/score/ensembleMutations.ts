import type { Score } from "@viritura/core";
import { expandTemplate } from "./InstrumentCatalog";
import { addInstrumentToScore } from "./instrumentMutations";

export function addEnsembleToScore(score: Score, templateId: string): Score {
  const players = expandTemplate(templateId);
  if (players.length === 0) return score;
  return players.reduce<Score>((current, player) => addInstrumentToScore(current, player.instrumentId), score);
}
