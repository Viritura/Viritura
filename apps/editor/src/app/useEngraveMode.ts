/**
 * useEngraveMode — composes the engrave-mode logic so it can run inside the
 * Write tree against the *single shared* `ScoreCanvas`.
 *
 * Engrave mode used to be a separate view (`EngraveView`) that mounted its
 * own `ScoreCanvas`, which meant switching Write ↔ Engrave reset scroll/zoom
 * and lost the canvas context. The hybrid model keeps Write's persistent
 * canvas mounted and simply re-targets it: this hook produces the engrave
 * adornments + interaction callbacks + chrome data, all keyed off the shared
 * view-state store and the shared `canvasRef`. `AppWorkspace` spreads the
 * result onto the same canvas / panels when engrave is active.
 *
 * The hook is always called (rules of hooks); its effects are inert in Write
 * mode because no marker/slur is ever selected there.
 */

import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";
import type { Score, ScoreDefinition, SlurShape } from "@viritura/core";
import type {
  ScoreCanvasHandle,
  EngraveAdornments,
  EngraveBreakMarker,
  BarlineHit,
  EngraveClickModifiers,
  StaffEyeHit,
} from "../components/ScoreCanvas";
import { insertBreakInScore, clearAllBreaksInScore, setAnnotationOffsetInScore } from "../score/ScoreMutations";
import { useSelectionActions } from "../store/selectionStore";
import { defaultSystemStarts } from "../components/modes/engrave/defaultSystemStarts";
import { buildSystemRows } from "../components/modes/engrave/buildSystemRows";
import {
  useEngraveContextRefs,
  useMarkerSelection,
  useStaffVisibility,
  useSlurEditState,
  usePageSetupEditor,
} from "../components/modes/engrave/hooks";

interface UseEngraveModeArgs {
  score: Score | null;
  selectedScoreIndex: number;
  setSelectedScoreIndex: (i: number) => void;
  updateScore: (next: Score) => void;
  canvasRef: RefObject<ScoreCanvasHandle | null>;
  /**
   * Whether Engrave mode is currently active. The hook is always called (rules
   * of hooks) so its Delete/Backspace marker listener stays mounted; this flag
   * lets it clear engrave selection on exit so a break can't be deleted from
   * Write mode via a stale marker selection.
   */
  active: boolean;
}

export interface EngraveMode {
  // ── Document ────────────────────────────────────────────────
  score: Score | null;

  // ── Canvas adornments + interaction ─────────────────────────
  engraveAdornments: EngraveAdornments;
  selectedMarkerId: string | null;
  onBarlineClick: (hit: BarlineHit, mods: EngraveClickModifiers) => void;
  onMarkerClick: (markerId: string) => void;
  onEmptyClick: () => void;
  onStaffEyeClick: (hit: StaffEyeHit) => void;
  onSlurShapeEdit: (slurElementId: string, delta: SlurShape) => void;
  onSlurShapeReset: (slurElementId: string) => void;
  onSlurReanchor: (slurElementId: string, end: "start" | "end", newEventId: string) => void;
  onSlurSelectionChange: (slurElementId: string | null) => void;
  onTextExpressionOffsetEdit: (expressionElementId: string, delta: [number, number]) => void;

  // ── Left panel (scores) ─────────────────────────────────────
  scores: ScoreDefinition[];
  activeScoreIndex: number;
  setActiveScoreIndex: (i: number) => void;
  setExpandedSystem: (m: string | null) => void;

  // ── Right panel (slur properties) ───────────────────────────
  slurId: string | null;
  slurShape: SlurShape | null;
  onSlurChange: (shape: SlurShape) => void;
  onSlurReset: () => void;
  onSlurDeselect: () => void;
  slurPanelCollapsed: boolean;

  // ── Toolbar ─────────────────────────────────────────────────
  hasAnyHidden: boolean;
  handleResetAll: () => void;
  handleShowAllHidden: () => void;

  // ── Embedded page setup editor ───────────────────────────────
  pageSetup: ReturnType<typeof usePageSetupEditor>;
}

export function useEngraveMode({
  score,
  selectedScoreIndex,
  setSelectedScoreIndex,
  updateScore,
  canvasRef,
  active,
}: UseEngraveModeArgs): EngraveMode {
  const [, setExpandedSystem] = useState<string | null>(null);

  const refs = useEngraveContextRefs(score, selectedScoreIndex, updateScore);
  const { scoreRef, activeScoreIndexRef, updateScoreRef } = refs;
  const { selectedMarkerId, setSelectedMarkerId } = useMarkerSelection(refs, selectedScoreIndex);
  const staffVis = useStaffVisibility(refs, score, selectedScoreIndex, canvasRef);
  const slur = useSlurEditState(refs, score);
  const pageSetup = usePageSetupEditor(refs);

  const { clearSelection } = useSelectionActions();

  // Clear engrave selection when leaving Engrave mode. The marker-delete
  // listener (in useMarkerSelection) stays mounted because this hook is always
  // called; clearing on exit ensures Delete/Backspace in Write mode can't act
  // on a break that was selected before the switch.
  useEffect(() => {
    if (!active) {
      setSelectedMarkerId(null);
      slur.setSelectedSlurId(null);
      clearSelection();
    }
  }, [active, setSelectedMarkerId, slur.setSelectedSlurId, clearSelection]);

  const scores: ScoreDefinition[] = useMemo(() => score?.scores ?? [], [score]);

  const systemRows = useMemo(
    () => (score ? buildSystemRows(score, selectedScoreIndex) : []),
    [score, selectedScoreIndex],
  );

  // For each authored break, draw a marker at the LAST measure of the
  // previous system. Resolved via the global measures list (0-based index).
  const measureIndexById = useMemo(() => {
    const m = new Map<string, number>();
    score?.global.measures.forEach((mm, i) => {
      if (mm.id) m.set(mm.id, i);
    });
    return m;
  }, [score]);

  const engraveMarkers: EngraveBreakMarker[] = useMemo(() => {
    if (!score) return [];
    const out: EngraveBreakMarker[] = [];
    for (const row of systemRows) {
      if (!row.isAuthored) continue;
      const startIdx = measureIndexById.get(row.measure);
      if (startIdx === undefined || startIdx <= 0) continue;
      out.push({
        measureIndex: startIdx - 1,
        kind: row.pageBreak ? "page" : "system",
        id: row.measure,
      });
    }
    return out;
  }, [score, systemRows, measureIndexById]);

  const handleInsertBreak = useCallback(
    (measure: string, kind: "system" | "page") => {
      const sc = scoreRef.current;
      if (!sc) return;
      const seed = defaultSystemStarts(sc, canvasRef.current?.getDisplayList() ?? null);
      updateScoreRef.current(insertBreakInScore(sc, activeScoreIndexRef.current, measure, kind, seed));
    },
    [scoreRef, updateScoreRef, activeScoreIndexRef, canvasRef],
  );

  const handleResetAll = useCallback(() => {
    const sc = scoreRef.current;
    if (!sc) return;
    updateScoreRef.current(clearAllBreaksInScore(sc, activeScoreIndexRef.current));
    setExpandedSystem(null);
  }, [scoreRef, updateScoreRef, activeScoreIndexRef]);

  // Ctrl/Cmd+click on a barline = system break after that measure.
  // Shift+click on a barline = page break after that measure.
  const onBarlineClick = useCallback(
    (hit: BarlineHit, mods: EngraveClickModifiers) => {
      const sc = scoreRef.current;
      if (!sc) return;
      const next = sc.global.measures[hit.measureIndex + 1];
      if (!next?.id) return; // Can't break after the last measure
      const kind: "system" | "page" = mods.shiftKey ? "page" : "system";
      handleInsertBreak(next.id, kind);
      setSelectedMarkerId(next.id);
    },
    [scoreRef, handleInsertBreak, setSelectedMarkerId],
  );

  const onMarkerClick = useCallback(
    (markerId: string) => {
      setSelectedMarkerId((prev) => (prev === markerId ? null : markerId));
    },
    [setSelectedMarkerId],
  );

  const engraveAdornments: EngraveAdornments = useMemo(
    () => ({
      markers: engraveMarkers,
      // Hide staff-visibility affordances entirely when the score has fewer
      // than 2 parts in its base layout — nothing meaningful to hide/restore.
      staffEyeProvider: staffVis.hasMultipleParts ? staffVis.staffEyeProvider : undefined,
      ghostRailGroupProvider: staffVis.hasMultipleParts ? staffVis.ghostRailGroupProvider : undefined,
    }),
    [engraveMarkers, staffVis.hasMultipleParts, staffVis.staffEyeProvider, staffVis.ghostRailGroupProvider],
  );

  const slurPanelCollapsed = slur.selectedSlurId === null || slur.selectedSlurShape === null;

  const onTextExpressionOffsetEdit = useCallback(
    (expressionElementId: string, delta: [number, number]) => {
      const sc = scoreRef.current;
      if (!sc) return;
      const next = setAnnotationOffsetInScore(sc, expressionElementId, delta);
      if (next !== sc) updateScoreRef.current(next);
    },
    [scoreRef, updateScoreRef],
  );

  return {
    score,
    engraveAdornments,
    selectedMarkerId,
    onBarlineClick,
    onMarkerClick,
    onEmptyClick: useCallback(() => setSelectedMarkerId(null), [setSelectedMarkerId]),
    onStaffEyeClick: staffVis.handleStaffEyeClick,
    onSlurShapeEdit: slur.handleSlurShapeEdit,
    onSlurShapeReset: slur.handleSlurShapeReset,
    onSlurReanchor: slur.handleSlurReanchor,
    onSlurSelectionChange: slur.setSelectedSlurId,
    onTextExpressionOffsetEdit,

    scores,
    activeScoreIndex: selectedScoreIndex,
    setActiveScoreIndex: setSelectedScoreIndex,
    setExpandedSystem,

    slurId: slur.selectedSlurId,
    slurShape: slur.selectedSlurShape,
    onSlurChange: slur.handleSlurShapeReplace,
    onSlurReset: useCallback(() => {
      if (slur.selectedSlurId) slur.handleSlurShapeReset(slur.selectedSlurId);
    }, [slur]),
    onSlurDeselect: useCallback(() => slur.setSelectedSlurId(null), [slur]),
    slurPanelCollapsed,

    hasAnyHidden: staffVis.hasAnyHidden,
    handleResetAll,
    handleShowAllHidden: staffVis.handleShowAllHidden,

    pageSetup,
  };
}
