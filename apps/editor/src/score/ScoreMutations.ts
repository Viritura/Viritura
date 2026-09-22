/**
 * ScoreMutations — top-level barrel + score-definition edit functions.
 *
 * The bulk of the per-feature mutation logic now lives in sibling files:
 *
 *  - {@link ./instrumentMutations}      add / remove / replace instrument parts
 *  - {@link ./layoutBuilder}            derive LayoutDefinition[] from players
 *  - {@link ./staffVisibilityMutations} hide / show staff per system
 *  - {@link ./slurShapeMutations}       engrave-mode slur shape overrides
 *  - {@link ./slurAnchorMutations}      engrave-mode slur endpoint re-anchoring
 *  - {@link ./scoreDefHelpers}          tiny shared helpers (measureOrder, withScoreDef)
 *
 * What still lives here: the small score-definition edit surface
 * (`applyScoreDefChanges`, forced-break authoring, pagination snapshot
 * extraction) plus re-exports so existing call-sites don't have to chase
 * the new file layout.
 */

import type { PartMeasure, Score, ScoreDefinition } from "@viritura/core";
import {
  applySnapshot,
  clearBreak as clearBreakInSnapshot,
  extractSnapshot,
  pruneUnusedDerivedLayouts,
  sortSnapshot,
} from "@viritura/core";
import { produce } from "./scoreClone";
import { measureOrder, withScoreDef } from "./scoreDefHelpers";
import { collectReferencedLayoutIds } from "./staffVisibilityMutations";

// ─── Re-exports — preserve the public surface used by App/tests/EngraveView ──

export {
  addInstrumentToScore,
  applyPlayerChanges,
  extractPlayersFromScore,
  removeInstrumentFromScore,
  reorderInstrumentInScore,
  synchronizePartScoreDefinitions,
} from "./instrumentMutations";
export { buildLayouts, buildScoreDefinitions } from "./layoutBuilder";
export { addEnsembleToScore } from "./ensembleMutations";
export {
  addPartToScoreLayout,
  collectConductorScores,
  collectPartIdsInLayout,
  createSectionScore,
  removePartFromScoreLayout,
  setScoreLayoutMembership,
  type ConductorScore,
} from "./scoreMembership";
export {
  applyStaffVisibilityFromSystem,
  basePartOrder,
  ghostRailGroupsOnSystem,
  hiddenPartsOnSystem,
  hiddenRangeHasMusic,
  setStaffVisibilityInScore,
  wouldHideMusic,
} from "./staffVisibilityMutations";
export {
  clearSlurShapeInScore,
  getSlurShapeFromScore,
  replaceSlurShapeInScore,
  setSlurShapeInScore,
} from "./slurShapeMutations";
export { findSlurAnchorInfo, reanchoredSlurElementId, reanchorSlurInScore } from "./slurAnchorMutations";
export { setAnnotationOffsetInScore } from "./annotationOffsetMutations";
export { setRestStaffPositionInScore } from "./restPositionMutations";
export { hiddenRestPlaceholderId, restMetadataLosses, setRestHiddenInScore } from "./hiddenRestMutations";

// ─── Score-definition edits (kept local — small, no complexity issues) ──

export interface ScoreDefEdit {
  name: string;
  layoutId: string;
  useWritten?: boolean;
}

/**
 * Apply edited score definitions to a Score.
 * Returns a new Score (does not mutate input).
 */
export function applyScoreDefChanges(score: Score, edits: ScoreDefEdit[]): Score {
  const scoreDefs: ScoreDefinition[] = edits.map((e, i) => {
    const existing = score.scores?.[i];
    return {
      name: e.name,
      layout: e.layoutId,
      ...(e.useWritten ? { useWritten: true } : {}),
      // Preserve engrave-mode authored state across edits to other fields.
      ...(existing?.pages ? { pages: existing.pages } : {}),
      ...(existing?.layoutBreaks ? { layoutBreaks: existing.layoutBreaks } : {}),
      ...(existing?.pageSetup ? { pageSetup: existing.pageSetup } : {}),
      ...(existing?.multimeasureRests ? { multimeasureRests: existing.multimeasureRests } : {}),
    };
  });

  return { ...score, scores: scoreDefs };
}

/**
 * Insert `count` empty measures (a full-measure rest in every part) into the score at
 * `atIndex` (0 = before the first measure, measures.length = append). The index
 * is clamped to a valid range. Returns a new Score; returns the input unchanged
 * when count < 1.
 *
 * Measure *numbers* are positional by default (the optional per-measure `number`
 * override is left untouched), so subsequent bars renumber automatically. This
 * is a structural edit: every measure index after `atIndex` shifts by `count`,
 * which collapses the engine's dirty-range scope into a full relayout.
 */
export function insertEmptyMeasures(score: Score, atIndex: number, count: number): Score {
  if (count < 1) return score;
  const clampedIndex = Math.max(0, Math.min(atIndex, score.global.measures.length));
  return produce(score, (draft) => {
    const globalBlanks = Array.from({ length: count }, () => ({}));
    draft.global.measures.splice(clampedIndex, 0, ...globalBlanks);
    for (const part of draft.parts) {
      const partBlanks = Array.from({ length: count }, (): PartMeasure => ({
        sequences: [{ content: [], fullMeasure: { visualDuration: { base: "whole" } } }],
      }));
      part.measures.splice(clampedIndex, 0, ...partBlanks);
    }
  });
}

/**
 * Append `count` empty measures (a full-measure rest in every part) to the end of the
 * score. Thin wrapper over {@link insertEmptyMeasures}.
 */
export function appendEmptyMeasures(score: Score, count: number): Score {
  return insertEmptyMeasures(score, score.global.measures.length, count);
}

/**
 * Insert (or update) a forced break at a measure in the active score.
 *
 * The first measure is materialised as the implicit start of page 1, but
 * automatic system boundaries are deliberately not copied into the document.
 * The engine remains free to reflow between authored break anchors.
 */
export function insertBreakInScore(
  score: Score,
  scoreIndex: number,
  measureId: string,
  kind: "system" | "page",
): Score {
  return withScoreDef(score, scoreIndex, (sd) => {
    const order = measureOrder(score);
    const rank = new Map(order.map((id, index) => [id, index]));
    const layoutBreaks = [...(sd.layoutBreaks ?? [])];
    const existingIndex = layoutBreaks.findIndex((entry) => entry.measure === measureId);
    const nextBreak = { measure: measureId, kind };
    if (existingIndex >= 0) {
      layoutBreaks[existingIndex] = nextBreak;
    } else {
      layoutBreaks.push(nextBreak);
    }
    const next = {
      ...sd,
      layoutBreaks: layoutBreaks
        .filter((entry) => rank.has(entry.measure))
        .sort((left, right) => rank.get(left.measure)! - rank.get(right.measure)!),
    };

    // Migrate break-only pagination authored by the previous Engrave control
    // into locks. Systems carrying layout overrides remain explicit MNX pages.
    if (
      next.pages?.length &&
      next.pages.every((page) => page.systems.every((system) => !system.layout && !system.layoutChanges?.length))
    ) {
      const legacy = extractSnapshot(next)
        .entries.slice(1)
        .map((entry) => ({
          measure: entry.measure,
          kind: entry.pageBreak ? ("page" as const) : ("system" as const),
        }));
      const merged = new Map(next.layoutBreaks.map((entry) => [entry.measure, entry]));
      legacy.forEach((entry) => {
        if (!merged.has(entry.measure)) merged.set(entry.measure, entry);
      });
      next.layoutBreaks = [...merged.values()].sort(
        (left, right) => rank.get(left.measure)! - rank.get(right.measure)!,
      );
      delete next.pages;
    }
    return next;
  });
}

/**
 * Clear a forced break at a measure in the active score. If only the synthetic
 * opening anchor remains, it is removed too so the score returns to automatic
 * flow. Authored layout overrides and other breaks are preserved. Pass
 * `wipeAll=true` to clear all pagination and layout anchors.
 */
export function clearBreakInScore(
  score: Score,
  scoreIndex: number,
  measureId: string,
  options: { wipeAll?: boolean } = {},
): Score {
  return withScoreDef(score, scoreIndex, (sd) => {
    if (options.wipeAll) {
      const next = applySnapshot(sd, { entries: [] });
      delete next.layoutBreaks;
      return next;
    }
    if (sd.layoutBreaks?.some((entry) => entry.measure === measureId)) {
      const remainingBreaks = sd.layoutBreaks.filter((entry) => entry.measure !== measureId);
      const next: ScoreDefinition = {
        ...sd,
        layoutBreaks: remainingBreaks,
      };
      if (remainingBreaks.length === 0) delete next.layoutBreaks;
      return next;
    }
    let snap = extractSnapshot(sd);
    snap = clearBreakInSnapshot(snap, measureId);
    const order = measureOrder(score);
    snap = sortSnapshot(snap, order);
    const onlyEntry = snap.entries.length === 1 ? snap.entries[0] : undefined;
    if (onlyEntry && onlyEntry.measure === order[0] && !onlyEntry.layout) {
      snap = { entries: [] };
    }
    return applySnapshot(sd, snap);
  });
}

/** Revert a score to fully automatic pagination. */
export function clearAllBreaksInScore(score: Score, scoreIndex: number): Score {
  const cleared = withScoreDef(score, scoreIndex, (sd) => {
    const next = applySnapshot(sd, { entries: [] });
    delete next.layoutBreaks;
    return next;
  });
  // Reset wipes pages[] (including system.layout overrides), so any derived
  // hide-staff layouts are now orphaned. GC them to avoid leaking.
  if (!cleared.layouts || cleared.layouts.length === 0) return cleared;
  const referenced = collectReferencedLayoutIds(cleared);
  const layouts = pruneUnusedDerivedLayouts(cleared.layouts, referenced);
  return { ...cleared, layouts };
}

// `LayoutContent` is re-exported below because a few external callers
// (older test fixtures) imported the type from here historically.
