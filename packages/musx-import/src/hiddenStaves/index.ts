import type { DenigmaDiagnostic } from "../types";
import { cutawayDiagnostic } from "./cutawayStaves";
import { mapHiddenEmptyStaves } from "./emptyStaffPolicy";

export interface HiddenStaffAdaptation {
  mnxJson: string;
  diagnostics: DenigmaDiagnostic[];
}

/**
 * Map Finale's whole-system staff hiding onto Viritura's automatic
 * empty-staff policy and report cutaway hiding, which has no equivalent yet.
 * `enigmaXml` is the decoded Finale document; when it is unavailable the
 * cutaway check is skipped.
 */
export function adaptHiddenStaves(
  mnxJson: string,
  enigmaXml: string | undefined,
  indentSpaces?: number,
): HiddenStaffAdaptation {
  const document = JSON.parse(mnxJson) as Record<string, unknown>;
  const diagnostics = mapHiddenEmptyStaves(document);
  const cutaway = enigmaXml === undefined ? undefined : cutawayDiagnostic(enigmaXml);
  if (cutaway) diagnostics.push(cutaway);
  return {
    mnxJson: diagnostics.length > 0 ? JSON.stringify(document, null, indentSpaces) : mnxJson,
    diagnostics,
  };
}
