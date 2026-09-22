/**
 * Visible staff order for chord distribution.
 *
 * Distribution is a *visual* operation: "explode this chord onto the staves
 * below it" means the staves the user can see, in the order they appear on the
 * page. That is not the same as canonical part order. A condensed score merges
 * several parts onto one staff, so the canonical staff after Flute 1 is
 * Flute 2 — which the reader sees as the *same* staff, not the next one down.
 * Distributing in canonical order therefore hides notes inside the staff they
 * came from, which looks like nothing happened.
 *
 * A `VisibleStaff` is one rendered staff together with the canonical staves
 * that feed it. Sources pool every member's pitches; targets receive their
 * share on the primary member and rest the others, which is what makes a
 * condensed pair read as a single line after an explode.
 */

import type { LayoutContent, LayoutSource, Score } from "@viritura/core";
import { getActiveLayoutId } from "../condensingRouter";
import { sameStaff, scoreStaffOrder, type StaffRef } from "./staffOrder";

/** One rendered staff and the canonical staves it draws from, in source order. */
export interface VisibleStaff {
  members: StaffRef[];
}

/** The canonical staves a layout source names: one staff, or the part's whole set. */
function sourceStaves(score: Score, source: LayoutSource): StaffRef[] {
  const partIndex = score.parts.findIndex((part) => part.id === source.part);
  if (partIndex < 0) return [];
  if (source.staff !== undefined) return [{ partIndex, staff: source.staff }];
  const staves = Math.max(1, score.parts[partIndex]?.staves ?? 1);
  return Array.from({ length: staves }, (_, index) => ({ partIndex, staff: index + 1 }));
}

function collectStaves(score: Score, content: readonly LayoutContent[], into: VisibleStaff[]): void {
  for (const node of content) {
    if (node.type === "group") {
      collectStaves(score, node.content, into);
      continue;
    }
    if (node.type !== "staff") continue;
    const members = node.sources.flatMap((source) => sourceStaves(score, source));
    if (members.length > 0) into.push({ members });
  }
}

/**
 * The rendered staves of the active layout, top to bottom. Falls back to raw
 * canonical order when the score has no layout, where the two coincide.
 */
export function layoutStaffOrder(score: Score, selectedScoreIndex: number): VisibleStaff[] {
  const layoutId = getActiveLayoutId(score, selectedScoreIndex);
  const layout = layoutId ? score.layouts?.find((entry) => entry.id === layoutId) : undefined;
  if (!layout) return scoreStaffOrder(score).map((ref) => ({ members: [ref] }));
  const visible: VisibleStaff[] = [];
  collectStaves(score, layout.content, visible);
  return visible.length > 0 ? visible : scoreStaffOrder(score).map((ref) => ({ members: [ref] }));
}

export function visibleStaffHas(staff: VisibleStaff, ref: StaffRef): boolean {
  return staff.members.some((member) => sameStaff(member, ref));
}

/**
 * The rendered staves a set of canonical staves lands on, in layout order.
 * Canonical staves outside the layout become their own visible staff so a
 * selection is never silently dropped.
 */
export function visibleStavesFor(order: readonly VisibleStaff[], refs: readonly StaffRef[]): VisibleStaff[] {
  const chosen: VisibleStaff[] = [];
  const orphans: VisibleStaff[] = [];
  for (const ref of refs) {
    const found = order.find((staff) => visibleStaffHas(staff, ref));
    if (!found) {
      if (!orphans.some((staff) => visibleStaffHas(staff, ref))) orphans.push({ members: [ref] });
    } else if (!chosen.includes(found)) {
      chosen.push(found);
    }
  }
  chosen.sort((left, right) => order.indexOf(left) - order.indexOf(right));
  return [...chosen, ...orphans];
}

/**
 * Extend `sources` down the rendered order until `count` staves are addressed.
 * Returns fewer when the page runs out, which is the signal that overflow has
 * to chord-stack on the last target.
 */
export function extendVisibleDownward(
  order: readonly VisibleStaff[],
  sources: readonly VisibleStaff[],
  count: number,
): VisibleStaff[] {
  const targets = [...sources];
  if (targets.length >= count) return targets;
  const last = targets.at(-1);
  const startIndex = last ? order.indexOf(last) + 1 : 0;
  for (let index = Math.max(0, startIndex); index < order.length && targets.length < count; index++) {
    const candidate = order[index]!;
    if (!targets.includes(candidate)) targets.push(candidate);
  }
  return targets;
}
