import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Score, SlurShape, PageSetup } from "@viritura/core";
import { produce } from "immer";
import type { ScoreCanvasHandle, StaffEyeHit } from "../../ScoreCanvas";
import {
  clearBreakInScore,
  hiddenPartsOnSystem,
  wouldHideMusic,
  ghostRailGroupsOnSystem,
  basePartOrder,
  setStaffVisibilityInScore,
  applyStaffVisibilityFromSystem,
  setSlurShapeInScore,
  clearSlurShapeInScore,
  replaceSlurShapeInScore,
  getSlurShapeFromScore,
  reanchoredSlurElementId,
  reanchorSlurInScore,
} from "../../../score/ScoreMutations";
import { defaultSystemStarts } from "./defaultSystemStarts";

/** Live refs for the current score / active score index / updateScore.
 *  Allows other engrave hooks to read the latest values from inside
 *  stable callbacks without re-creating them on every render. */
export interface EngraveContextRefs {
  scoreRef: React.MutableRefObject<Score | null>;
  activeScoreIndexRef: React.MutableRefObject<number>;
  updateScoreRef: React.MutableRefObject<(next: Score) => void>;
}

export function useEngraveContextRefs(
  score: Score | null,
  activeScoreIndex: number,
  updateScore: (next: Score) => void,
): EngraveContextRefs {
  const scoreRef = useRef(score);
  scoreRef.current = score;
  const activeScoreIndexRef = useRef(activeScoreIndex);
  activeScoreIndexRef.current = activeScoreIndex;
  const updateScoreRef = useRef(updateScore);
  updateScoreRef.current = updateScore;
  return { scoreRef, activeScoreIndexRef, updateScoreRef };
}

/** Tracks the currently selected engrave break marker and wires up the
 *  Delete/Backspace shortcut to clear it. Selection is cleared whenever
 *  the user switches to a different score. */
export function useMarkerSelection(
  refs: EngraveContextRefs,
  activeScoreIndex: number,
): {
  selectedMarkerId: string | null;
  setSelectedMarkerId: React.Dispatch<React.SetStateAction<string | null>>;
} {
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const id = selectedMarkerId;
      if (!id) return;
      const sc = refs.scoreRef.current;
      if (!sc) return;
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.isContentEditable)) return;
      e.preventDefault();
      refs.updateScoreRef.current(clearBreakInScore(sc, refs.activeScoreIndexRef.current, id));
      setSelectedMarkerId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedMarkerId, refs]);

  // Clear marker selection when switching scores so the Delete key never
  // targets a marker on the wrong score.
  useEffect(() => {
    setSelectedMarkerId(null);
  }, [activeScoreIndex]);

  return { selectedMarkerId, setSelectedMarkerId };
}

/** Resolves the ghost-rail provider data used by the engrave canvas:
 *  visibility lookup, ghost-rail group descriptions with display labels,
 *  staff-eye click handler, and convenience flags (`hasAnyHidden`,
 *  `hasMultipleParts`) for the toolbar `Show all hidden` affordance. */
export function useStaffVisibility(
  refs: EngraveContextRefs,
  score: Score | null,
  activeScoreIndex: number,
  previewCanvasRef: React.RefObject<ScoreCanvasHandle | null>,
) {
  const sd = score?.scores?.[activeScoreIndex];

  const staffEyeProvider = useCallback(
    (systemMeasureId: string, partId: string) => {
      const sc = refs.scoreRef.current;
      if (!sc) return null;
      const hidden = hiddenPartsOnSystem(sc, refs.activeScoreIndexRef.current, systemMeasureId);
      const visible = !hidden.has(partId);
      const hasMusicHidden = visible
        ? false
        : wouldHideMusic(sc, refs.activeScoreIndexRef.current, systemMeasureId, partId);
      return { visible, hasMusicHidden };
    },
    [refs],
  );

  const ghostRailGroupProvider = useCallback(
    (systemMeasureId: string) => {
      const sc = refs.scoreRef.current;
      if (!sc) return [];
      const groups = ghostRailGroupsOnSystem(sc, refs.activeScoreIndexRef.current, systemMeasureId);

      // Build per-part display labels. When multiple parts share the same
      // raw name (e.g. two flutes both named "Flute"), append a 1-based
      // ordinal so users can distinguish them in the popover ("Flute 1",
      // "Flute 2"). Parts with unique names stay as-is.
      const rawNameById = new Map<string, string>();
      for (const p of sc.parts ?? []) {
        if (p.id) rawNameById.set(p.id, (p as { name?: string }).name ?? p.id);
      }
      const countsByName = new Map<string, number>();
      for (const name of rawNameById.values()) {
        countsByName.set(name, (countsByName.get(name) ?? 0) + 1);
      }
      const labelById = new Map<string, string>();
      const seenByName = new Map<string, number>();
      for (const p of sc.parts ?? []) {
        if (!p.id) continue;
        const raw = rawNameById.get(p.id)!;
        const total = countsByName.get(raw) ?? 1;
        if (total <= 1) {
          labelById.set(p.id, raw);
        } else {
          const n = (seenByName.get(raw) ?? 0) + 1;
          seenByName.set(raw, n);
          labelById.set(p.id, `${raw} ${n}`);
        }
      }

      return groups.map((g) => {
        const partLabels = g.partIds.map((pid) => labelById.get(pid) ?? pid);
        const staffGroups = g.staffGroups ?? g.partIds.map((p) => [p]);
        const staffGroupLabels = staffGroups.map((arr) => arr.map((pid) => labelById.get(pid) ?? pid).join(" / "));
        return {
          id: g.id,
          partIds: g.partIds,
          partLabels,
          staffGroups,
          staffGroupLabels,
          staffGroupHasMusic: g.staffGroupHasMusic,
          aboveVisiblePartId: g.aboveVisiblePartId,
          belowVisiblePartId: g.belowVisiblePartId,
        };
      });
    },
    [refs],
  );

  const handleStaffEyeClick = useCallback(
    (hit: StaffEyeHit) => {
      const sc = refs.scoreRef.current;
      if (!sc) return;
      const nextVisible = !hit.visible;
      const seed = defaultSystemStarts(sc, previewCanvasRef.current?.getDisplayList() ?? null);
      refs.updateScoreRef.current(
        applyStaffVisibilityFromSystem(
          sc,
          refs.activeScoreIndexRef.current,
          hit.systemMeasureId,
          hit.partId,
          nextVisible,
          seed,
        ),
      );
    },
    [refs, previewCanvasRef],
  );

  const hasAnyHidden = useMemo(() => {
    if (!score || !sd) return false;
    const allSystems = (sd.pages ?? []).flatMap((p) => p.systems);
    return allSystems.some((s) => hiddenPartsOnSystem(score, activeScoreIndex, s.measure).size > 0);
  }, [score, sd, activeScoreIndex]);

  const hasMultipleParts = useMemo(() => {
    if (!score) return false;
    return basePartOrder(score, activeScoreIndex).length >= 2;
  }, [score, activeScoreIndex]);

  const handleShowAllHidden = useCallback(() => {
    const sc = refs.scoreRef.current;
    if (!sc || !sd) return;
    let next = sc;
    const allSystems = (sd.pages ?? []).flatMap((p) => p.systems);
    for (const sys of allSystems) {
      const hidden = hiddenPartsOnSystem(next, refs.activeScoreIndexRef.current, sys.measure);
      for (const partId of hidden) {
        next = setStaffVisibilityInScore(next, refs.activeScoreIndexRef.current, sys.measure, partId, true);
      }
    }
    if (next !== sc) refs.updateScoreRef.current(next);
  }, [refs, sd]);

  return {
    staffEyeProvider,
    ghostRailGroupProvider,
    handleStaffEyeClick,
    hasAnyHidden,
    hasMultipleParts,
    handleShowAllHidden,
  };
}

/** Slur edit state for engrave mode: selection id, live shape lookup, and
 *  the three mutation callbacks (edit/replace/reset). */
export function useSlurEditState(refs: EngraveContextRefs, score: Score | null) {
  const [selectedSlurId, setSelectedSlurId] = useState<string | null>(null);

  const selectedSlurShape: SlurShape | null = useMemo(() => {
    if (!score || !selectedSlurId) return null;
    return getSlurShapeFromScore(score, selectedSlurId);
  }, [score, selectedSlurId]);

  const handleSlurShapeEdit = useCallback(
    (slurElementId: string, delta: SlurShape) => {
      const sc = refs.scoreRef.current;
      if (!sc) return;
      const next = setSlurShapeInScore(sc, slurElementId, delta);
      if (next !== sc) refs.updateScoreRef.current(next);
    },
    [refs],
  );

  const handleSlurShapeReset = useCallback(
    (slurElementId: string) => {
      const sc = refs.scoreRef.current;
      if (!sc) return;
      const next = clearSlurShapeInScore(sc, slurElementId);
      if (next !== sc) refs.updateScoreRef.current(next);
    },
    [refs],
  );

  const handleSlurShapeReplace = useCallback(
    (shape: SlurShape) => {
      const sc = refs.scoreRef.current;
      const id = selectedSlurId;
      if (!sc || !id) return;
      const next = replaceSlurShapeInScore(sc, id, shape);
      if (next !== sc) refs.updateScoreRef.current(next);
    },
    [refs, selectedSlurId],
  );

  const handleSlurReanchor = useCallback(
    (slurElementId: string, end: "start" | "end", newEventId: string) => {
      const sc = refs.scoreRef.current;
      if (!sc) return;
      const next = reanchorSlurInScore(sc, slurElementId, end, newEventId);
      if (next === sc) return;
      refs.updateScoreRef.current(next);
      // Moving an endpoint rewrites the slur's element id, so the old selection
      // would dangle unless it follows the new anchors.
      const nextElementId = reanchoredSlurElementId(sc, slurElementId, end, newEventId);
      setSelectedSlurId((prev) => {
        if (prev !== slurElementId || !nextElementId) return prev;
        return nextElementId;
      });
    },
    [refs],
  );

  return {
    selectedSlurId,
    setSelectedSlurId,
    selectedSlurShape,
    handleSlurShapeEdit,
    handleSlurShapeReset,
    handleSlurShapeReplace,
    handleSlurReanchor,
  };
}

/** Persist page setup edits for the score selected in the global header switcher. */
export function usePageSetupEditor(refs: EngraveContextRefs) {
  const handleApplyPageSetup = useCallback(
    (setup: PageSetup) => {
      const sc = refs.scoreRef.current;
      if (!sc) return;
      const index = refs.activeScoreIndexRef.current;
      const updated = produce(sc, (draft) => {
        if (draft.scores && draft.scores[index]) {
          draft.scores[index].pageSetup = setup;
        }
      });
      refs.updateScoreRef.current(updated);
    },
    [refs],
  );

  const handleResetPageSetup = useCallback(() => {
    const sc = refs.scoreRef.current;
    if (!sc) return;
    const index = refs.activeScoreIndexRef.current;
    const updated = produce(sc, (draft) => {
      if (draft.scores && draft.scores[index]) {
        delete draft.scores[index].pageSetup;
      }
    });
    refs.updateScoreRef.current(updated);
  }, [refs]);

  return {
    handleApplyPageSetup,
    handleResetPageSetup,
  };
}
