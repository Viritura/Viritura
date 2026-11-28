import type { Score } from "./score";
import {
  applyPageSetupOverride,
  builtInPageSetup,
  pageSetupRoleForScore,
  type LayoutProfile,
  type PageSetup,
  type PageSetupRole,
} from "./layout";

const POINTS_PER_MM = 72 / 25.4;

/** Convert a staff-space font size to points for a page setup's staff size. */
export function staffSpacesToPoints(sizeSp: number, spatiumMm: number): number {
  return sizeSp * spatiumMm * POINTS_PER_MM;
}

/** Convert a point size back to the staff-space value stored in the score. */
export function pointsToStaffSpaces(sizePt: number, spatiumMm: number): number {
  return sizePt / (spatiumMm * POINTS_PER_MM);
}

/** Role of a score view, inferred from layout membership unless stored explicitly. */
export function scorePageSetupRole(score: Score | null, scoreIndex: number): PageSetupRole {
  return pageSetupRoleForScore(score?.scores, scoreIndex, score?.layouts, score?.parts.length);
}

/** Named profile assigned to a score view, ignoring missing IDs and role mismatches. */
export function assignedLayoutProfile(score: Score | null, scoreIndex: number): LayoutProfile | undefined {
  const id = score?.scores?.[scoreIndex]?.layoutProfile;
  if (!id) return undefined;
  const role = scorePageSetupRole(score, scoreIndex);
  return score?.layoutProfiles?.find((profile) => profile.id === id && profile.role === role);
}

/** Page setup a score view inherits before its own overrides: built-in default, then its profile. */
export function profilePageSetupForScore(score: Score | null, scoreIndex: number): PageSetup {
  const role = scorePageSetupRole(score, scoreIndex);
  const named = assignedLayoutProfile(score, scoreIndex);
  return applyPageSetupOverride(builtInPageSetup(role), named ? named.pageSetup : score?.pageSetupDefaults?.[role]);
}

/** Effective page setup: built-in default, then the layout profile, then the score view's overrides. */
export function resolveScorePageSetup(score: Score | null, scoreIndex: number): PageSetup {
  return applyPageSetupOverride(profilePageSetupForScore(score, scoreIndex), score?.scores?.[scoreIndex]?.pageSetup);
}
