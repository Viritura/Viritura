import {
  pageSetupRoleForScore,
  resolveScorePageSetup,
  type PageSetup,
  type PageSetupRole,
  type Score,
} from "@viritura/core";
import { produce } from "../score/scoreClone";

export function setProjectPageDefault(
  score: Score,
  role: PageSetupRole,
  setup: PageSetup,
  replaceOverrides: boolean,
): Score {
  return produce(score, (draft) => {
    for (const [index, definition] of (draft.scores ?? []).entries()) {
      if (pageSetupRoleForScore(score.scores, index, score.layouts, score.parts.length) !== role) continue;
      if (replaceOverrides) delete definition.pageSetup;
      else if (definition.pageSetup) definition.pageSetup = resolveScorePageSetup(score, index);
    }
    draft.pageSetupDefaults ??= {};
    draft.pageSetupDefaults[role] = structuredClone(setup);
  });
}
