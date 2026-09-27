import { defaultPageSetupForScore, type PageSetup } from "@viritura/core";
import { parseMnxWithDiagnostics } from "@viritura/format";
import type { ScorePageMargins } from "@viritura/score-viewer-react";

/** Layout pixels per millimetre, matching the editor's page geometry. */
const PX_PER_MM = 12;

export interface DocumentPageLayout {
  readonly spatium: number;
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly pageMargins: ScorePageMargins;
}

/**
 * Staff size and page geometry the editor would use for a document's first
 * score: the full-score or part defaults, overridden by the score's
 * `_x.viritura.pageSetup`. Returns null when the MNX can't be parsed, so the
 * viewer can report the error itself.
 */
export function documentPageLayout(mnxJson: string): DocumentPageLayout | null {
  let score;
  try {
    score = parseMnxWithDiagnostics(JSON.parse(mnxJson)).score;
  } catch {
    return null;
  }
  const defaults = defaultPageSetupForScore(score.scores, 0, score.layouts, score.parts.length);
  const own = score.scores?.[0]?.pageSetup;
  const setup: PageSetup = { ...defaults, ...own, margins: { ...defaults.margins, ...own?.margins } };
  return {
    spatium: setup.spatiumMm * PX_PER_MM,
    pageWidth: Math.round(setup.width * PX_PER_MM),
    pageHeight: setup.height * PX_PER_MM,
    pageMargins: {
      top: setup.margins.top * PX_PER_MM,
      right: setup.margins.right * PX_PER_MM,
      bottom: setup.margins.bottom * PX_PER_MM,
      left: setup.margins.left * PX_PER_MM,
    },
  };
}
