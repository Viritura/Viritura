import { useCallback, useMemo } from "react";
import type { ChordQuality, ChordSymbol, Score } from "@viritura/core";
import type { NotationSelectionTarget } from "../../commands/notationInspectorCommands";
import { produce } from "../../score/scoreClone";

interface Args {
  score: Score | null;
  target: NotationSelectionTarget | null;
  updateScore: (score: Score) => void;
}

export function useChordSymbolInspector({ score, target, updateScore }: Args) {
  const chordMatch = target?.elementType.match(/^chord(\d+)$/);
  const chordIndex = chordMatch ? Number.parseInt(chordMatch[1]!, 10) : undefined;
  const chord = useMemo<ChordSymbol | null>(() => {
    if (!score || !target || chordIndex === undefined) return null;
    return score.parts[target.partIndex]?.measures[target.measureIndex]?.chordSymbols?.[chordIndex] ?? null;
  }, [score, target, chordIndex]);

  const mutateChord = useCallback(
    (mutate: (chord: ChordSymbol) => void) => {
      if (!score || !target || chordIndex === undefined) return;
      const nextScore = produce(score, (draft) => {
        const selected = draft.parts[target.partIndex]?.measures[target.measureIndex]?.chordSymbols?.[chordIndex];
        if (selected) mutate(selected);
      });
      if (nextScore !== score) updateScore(nextScore);
    },
    [score, target, chordIndex, updateScore],
  );

  return {
    chord,
    setRootStep: (step: string) => mutateChord((selected) => (selected.root.step = step)),
    setRootAlter: (alter: number | undefined) => mutateChord((selected) => (selected.root.alter = alter)),
    setQuality: (quality: ChordQuality) =>
      mutateChord((selected) => {
        selected.quality = quality;
        if (quality !== "other") selected.kindText = undefined;
      }),
    setKindText: (kindText: string) =>
      mutateChord((selected) => (selected.kindText = kindText.trim() === "" ? undefined : kindText)),
    setExtension: (extension: ChordSymbol["extension"]) => mutateChord((selected) => (selected.extension = extension)),
    setBassStep: (step: string | undefined) =>
      mutateChord((selected) => {
        selected.bass = step
          ? { step, ...(selected.bass?.alter !== undefined && { alter: selected.bass.alter }) }
          : undefined;
      }),
    setBassAlter: (alter: number | undefined) =>
      mutateChord((selected) => {
        if (selected.bass) selected.bass.alter = alter;
      }),
    setDisplayStaff: (displayStaff: number | undefined) =>
      mutateChord((selected) => (selected.displayStaff = displayStaff)),
    setTextOverride: (text: string) =>
      mutateChord((selected) => (selected.textOverride = text.trim() === "" ? undefined : text)),
  };
}
