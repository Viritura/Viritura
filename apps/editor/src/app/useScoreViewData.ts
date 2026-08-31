import { useCallback, useEffect, useMemo, useState } from "react";
import type { ScoreDefinition } from "@viritura/core";
import { useDocumentStore } from "../store/DocumentContext";
import { collectPartIds } from "./layoutHelpers";
import { useConcertPitch } from "./useConcertPitch";

interface UseScoreViewDataParams {
  updateScore: (score: import("@viritura/core").Score) => void;
  selectedScoreIndex: number;
  selectedPartIds: string[];
  onVisiblePartsChange?: (ids: string[]) => void;
}

export interface UseScoreViewDataResult {
  scoreDefNames: string[];
  handleLayoutsChange: (layouts: string[]) => void;
  resolvedScoreDefs: ScoreDefinition[];
  visiblePartIds: string[];
  useWritten: boolean;
  handleConcertPitchToggle: (written: boolean) => void;
}

/**
 * Bundles the derived "score view" state used by the workspace:
 * - resolved ScoreDefinition list for the LeftPanel
 * - visible part IDs (for playback filtering)
 * - useWritten (concert pitch toggle) state synced with the active score
 */
export function useScoreViewData(params: UseScoreViewDataParams): UseScoreViewDataResult {
  const { updateScore, selectedScoreIndex, selectedPartIds, onVisiblePartsChange } = params;

  const [scoreDefNames, setScoreDefNames] = useState<string[]>([]);
  const handleLayoutsChange = useCallback((layouts: string[]) => {
    setScoreDefNames(layouts);
  }, []);

  const scoreScores = useDocumentStore((s) => s.score?.scores);
  const resolvedScoreDefs = useMemo((): ScoreDefinition[] => {
    if (!scoreScores || scoreScores.length === 0) {
      if (scoreDefNames.length > 0) return scoreDefNames.map((name) => ({ name }));
      return [];
    }
    return scoreScores;
  }, [scoreScores, scoreDefNames]);

  const scoreLayouts = useDocumentStore((s) => s.score?.layouts);
  const scoreParts = useDocumentStore((s) => s.score?.parts);
  const visiblePartIds = useMemo((): string[] => {
    if (selectedPartIds.length > 0) return selectedPartIds;
    if (!scoreParts) return [];
    if (selectedScoreIndex === 0) return [];
    const sd = resolvedScoreDefs[selectedScoreIndex];
    if (!sd?.layout || !scoreLayouts) return [];
    const layout = scoreLayouts.find((l) => l.id === sd.layout);
    if (!layout) return [];
    const ids = new Set<string>();
    collectPartIds(layout.content, ids);
    return Array.from(ids);
  }, [selectedPartIds, selectedScoreIndex, resolvedScoreDefs, scoreLayouts, scoreParts]);

  useEffect(() => {
    onVisiblePartsChange?.(visiblePartIds);
  }, [visiblePartIds, onVisiblePartsChange]);

  const { useWritten, handleConcertPitchToggle } = useConcertPitch(selectedScoreIndex, updateScore);

  return {
    scoreDefNames,
    handleLayoutsChange,
    resolvedScoreDefs,
    visiblePartIds,
    useWritten,
    handleConcertPitchToggle,
  };
}
