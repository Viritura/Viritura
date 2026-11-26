/**
 * autoHideEmptyStaves — edits for a score view's automatic empty-staff
 * policy: eligible parts, first-system behavior, per-system force-show
 * decisions, and copying the policy to other views of the same role.
 */

import type { AutoHideKeepVisible, Score, ScoreDefinition } from "@viritura/core";
import { pageSetupRoleForScore } from "@viritura/core";
import { produce } from "./scoreClone";
import { collectPartIdsInLayout } from "./scoreMembership";
import { basePartOrder, hiddenPartsOnSystem } from "./staffVisibilityMutations";

/** Part ids staffed by any layout this score view references. */
export function partIdsInScoreView(score: Score, scoreIndex: number): Set<string> {
  const definition = score.scores?.[scoreIndex];
  const ids = new Set<string>();
  if (!definition) return ids;
  const layoutIds = new Set<string>();
  if (definition.layout) layoutIds.add(definition.layout);
  for (const page of definition.pages ?? []) {
    for (const system of page.systems) {
      if (system.layout) layoutIds.add(system.layout);
      for (const change of system.layoutChanges ?? []) layoutIds.add(change.layout);
    }
  }
  for (const layout of score.layouts ?? []) {
    if (!layoutIds.has(layout.id)) continue;
    for (const id of collectPartIdsInLayout(layout.content)) ids.add(id);
  }
  return ids;
}

function normalizeOptions(definition: ScoreDefinition): void {
  const options = definition.autoHideEmptyStaves;
  if (!options) return;
  if (options.keepVisible?.length === 0) delete options.keepVisible;
  if (options.firstSystem !== "show") delete options.firstSystem;
  if (Object.keys(options).length === 0) delete definition.autoHideEmptyStaves;
}

function editDefinition(score: Score, scoreIndex: number, edit: (definition: ScoreDefinition) => void): Score {
  if (!score.scores?.[scoreIndex]) return score;
  return produce(score, (draft) => {
    const definition = draft.scores![scoreIndex]!;
    edit(definition);
    normalizeOptions(definition);
  });
}

function setAutoHideEmptyParts(score: Score, scoreIndex: number, partIds: string[]): Score {
  return editDefinition(score, scoreIndex, (definition) => {
    definition.autoHideEmptyParts = partIds;
    const eligible = new Set(partIds);
    const keepVisible = definition.autoHideEmptyStaves?.keepVisible;
    if (!keepVisible) return;
    definition.autoHideEmptyStaves!.keepVisible = keepVisible
      .map((entry) => ({ ...entry, parts: entry.parts.filter((id) => eligible.has(id)) }))
      .filter((entry) => entry.parts.length > 0);
  });
}

function setAutoHideFirstSystem(score: Score, scoreIndex: number, firstSystem: "hide" | "show"): Score {
  return editDefinition(score, scoreIndex, (definition) => {
    definition.autoHideEmptyStaves = { ...definition.autoHideEmptyStaves, firstSystem };
  });
}

/** True when a force-show decision for `partId` sits on any of the system's measures. */
export function isKeptVisibleOnSystem(
  score: Score,
  scoreIndex: number,
  systemMeasureIds: readonly string[],
  partId: string,
): boolean {
  const measures = new Set(systemMeasureIds);
  return (score.scores?.[scoreIndex]?.autoHideEmptyStaves?.keepVisible ?? []).some(
    (entry) => measures.has(entry.measure) && entry.parts.includes(partId),
  );
}

/**
 * Add (`keep = true`) a force-show decision anchored at the system's first
 * measure, or remove every decision for `partId` on the system's measures.
 */
export function setAutoHideKeepVisible(
  score: Score,
  scoreIndex: number,
  systemMeasureIds: readonly string[],
  partId: string,
  keep: boolean,
): Score {
  const anchor = systemMeasureIds[0];
  if (!anchor) return score;
  const measures = new Set(systemMeasureIds);
  return editDefinition(score, scoreIndex, (definition) => {
    const entries: AutoHideKeepVisible[] = (definition.autoHideEmptyStaves?.keepVisible ?? [])
      .map((entry) =>
        measures.has(entry.measure) ? { ...entry, parts: entry.parts.filter((id) => id !== partId) } : entry,
      )
      .filter((entry) => entry.parts.length > 0);
    if (keep) {
      const existing = entries.find((entry) => entry.measure === anchor);
      if (existing) existing.parts = [...existing.parts, partId];
      else entries.push({ measure: anchor, parts: [partId] });
    }
    definition.autoHideEmptyStaves = { ...definition.autoHideEmptyStaves, keepVisible: entries };
  });
}

/**
 * Parts the automatic policy removed from a rendered system: eligible,
 * staffed by the base layout, absent from the render, and not manually hidden.
 */
export function autoHiddenPartsOnSystem(
  score: Score,
  scoreIndex: number,
  systemMeasureId: string,
  visiblePartIds: ReadonlySet<string>,
): Set<string> {
  const eligible = new Set(score.scores?.[scoreIndex]?.autoHideEmptyParts ?? []);
  if (eligible.size === 0) return new Set();
  const manual = hiddenPartsOnSystem(score, scoreIndex, systemMeasureId);
  return new Set(
    basePartOrder(score, scoreIndex).filter((id) => eligible.has(id) && !visiblePartIds.has(id) && !manual.has(id)),
  );
}

/** One edit from the auto-hide control. */
export type AutoHideEmptyStavesChange =
  | { kind: "parts"; partIds: string[] }
  | { kind: "firstSystem"; firstSystem: "hide" | "show" }
  | { kind: "applyToRole" };

export function applyAutoHideChange(score: Score, scoreIndex: number, change: AutoHideEmptyStavesChange): Score {
  switch (change.kind) {
    case "parts":
      return setAutoHideEmptyParts(score, scoreIndex, change.partIds);
    case "firstSystem":
      return setAutoHideFirstSystem(score, scoreIndex, change.firstSystem);
    case "applyToRole":
      return applyAutoHideToRole(score, scoreIndex);
  }
}

/**
 * Copy this view's eligible parts and first-system behavior to every other
 * view with the same role. Each target keeps only parts it staffs; per-system
 * decisions stay with their own view because systems differ between views.
 */
function applyAutoHideToRole(score: Score, scoreIndex: number): Score {
  const source = score.scores?.[scoreIndex];
  if (!source) return score;
  const roleOf = (index: number) => pageSetupRoleForScore(score.scores, index, score.layouts, score.parts.length);
  const role = roleOf(scoreIndex);
  const selected = source.autoHideEmptyParts ?? [];
  const firstSystem = source.autoHideEmptyStaves?.firstSystem ?? "hide";
  let next = score;
  score.scores!.forEach((_, index) => {
    if (index === scoreIndex || roleOf(index) !== role) return;
    const present = partIdsInScoreView(score, index);
    next = setAutoHideEmptyParts(
      next,
      index,
      selected.filter((id) => present.has(id)),
    );
    next = setAutoHideFirstSystem(next, index, firstSystem);
  });
  return next;
}
