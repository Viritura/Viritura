import type { Score } from "@viritura/core";
import { produce } from "../score/scoreClone";
import { customPageFields } from "./pageFields";

export interface LayoutOverrideSummary {
  /** Page fields set on the layout itself. */
  page: string[];
  /** Bar number settings set on the layout itself. */
  barNumbers: number;
  total: number;
}

/** What a layout sets for itself instead of inheriting from its profile and the house style. */
export function layoutOverrides(score: Score, index: number): LayoutOverrideSummary {
  const page = customPageFields(score, { kind: "layout", index }).map((field) => field.label);
  const stored = score.scores?.[index]?.barNumbers;
  const barNumbers = stored
    ? Object.entries(stored).filter(([key, value]) => key !== "style" && value !== undefined).length +
      Object.values(stored.style ?? {}).filter((value) => value !== undefined).length
    : 0;
  return { page, barNumbers, total: page.length + barNumbers };
}

/** Return a layout to its profile and house style values. Manual breaks are not affected. */
export function clearLayoutOverrides(score: Score, index: number): Score {
  return produce(score, (draft) => {
    const view = draft.scores?.[index];
    if (!view) return;
    delete view.pageSetup;
    delete view.barNumbers;
  });
}
