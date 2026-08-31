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
  insertBreak as insertBreakInSnapshot,
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
      const partBlanks = Array.from(
        { length: count },
        (): PartMeasure => ({
          sequences: [{ content: [], fullMeasure: { visualDuration: { base: "whole" } } }],
        }),
      );
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
 * The first call on a score must be seeded with the full engine-computed
 * pagination — pass `computedSystemStarts` for that. On subsequent calls
 * the existing snapshot is used as-is.
 */
export function insertBreakInScore(
  score: Score,
  scoreIndex: number,
  measureId: string,
  kind: "system" | "page",
  computedSystemStarts: readonly { measure: string; pageBreak: boolean }[],
): Score {
  return withScoreDef(score, scoreIndex, (sd) => {
    let snap = extractSnapshot(sd);
    if (snap.entries.length === 0) {
      snap = {
        entries: computedSystemStarts.map((s) => ({
          measure: s.measure,
          pageBreak: s.pageBreak,
        })),
      };
    }
    snap = insertBreakInSnapshot(snap, measureId, kind);
    snap = sortSnapshot(snap, measureOrder(score));
    return applySnapshot(sd, snap);
  });
}

/**
 * Clear a forced break at a measure in the active score. If clearing the
 * last entry leaves only the implicit page-0 starts, the snapshot is
 * preserved (still all-or-nothing). Pass `wipeAll=true` to fully revert
 * the score to automatic pagination.
 */
export function clearBreakInScore(
  score: Score,
  scoreIndex: number,
  measureId: string,
  options: { wipeAll?: boolean } = {},
): Score {
  return withScoreDef(score, scoreIndex, (sd) => {
    if (options.wipeAll) return applySnapshot(sd, { entries: [] });
    let snap = extractSnapshot(sd);
    snap = clearBreakInSnapshot(snap, measureId);
    snap = sortSnapshot(snap, measureOrder(score));
    return applySnapshot(sd, snap);
  });
}

/** Revert a score to fully automatic pagination. */
export function clearAllBreaksInScore(score: Score, scoreIndex: number): Score {
  const cleared = withScoreDef(score, scoreIndex, (sd) => applySnapshot(sd, { entries: [] }));
  // Reset wipes pages[] (including system.layout overrides), so any derived
  // hide-staff layouts are now orphaned. GC them to avoid leaking.
  if (!cleared.layouts || cleared.layouts.length === 0) return cleared;
  const referenced = collectReferencedLayoutIds(cleared);
  const layouts = pruneUnusedDerivedLayouts(cleared.layouts, referenced);
  return { ...cleared, layouts };
}

// `LayoutContent` is re-exported below because a few external callers
// (older test fixtures) imported the type from here historically.
