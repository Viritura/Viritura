import {
  formatChordSymbolText,
  parseChordSymbolText,
  transposeChordSymbol,
  type ChordQuality,
  type ChordSymbol,
  type Part,
  type Score,
} from "@viritura/core";
import { usePlaybackActions } from "@viritura/playback";
import type { NotationSelectionTarget } from "../../commands/notationInspectorCommands";
import { resolveChordSymbolSource } from "../../app/useAppKeyboardWiring";
import { produce } from "../../score/scoreClone";
import { useSelection, useSelectionStore } from "../../store/selectionStore";
import { useViewStateStore } from "../../store/viewStateStore";

interface Args {
  score: Score | null;
  target: NotationSelectionTarget | null;
  updateScore: (score: Score) => void;
}

function chordDisplayInterval(score: Score | null, scoreIndex: number, part: Part | undefined) {
  const useWritten = score?.scores?.[scoreIndex]?.useWritten || part?.transposition?.prefersWrittenPitches;
  return (useWritten ? part?.transposition?.interval : undefined) ?? { halfSteps: 0, staffDistance: 0 };
}

export function useChordSymbolInspector({ score, target, updateScore }: Args) {
  const selectedScoreIndex = useViewStateStore((state) => state.selectedScoreIndex);
  const selectedPartIds = useViewStateStore((state) => state.selectedPartIds);
  const selection = useSelection();
  useSelectionStore((state) => state.renderedStaffSources);
  const { previewChord } = usePlaybackActions();
  const match = target?.elementId.match(/^(m(\d+)\/chord(\d+))(?:\/p\d+\/staff\d+)?$/);
  const canonicalId = match?.[1];
  const measureIndex = match ? Number(match[2]) : undefined;
  const chordIndex = match ? Number(match[3]) : undefined;
  const sourcePartIndex =
    score && measureIndex !== undefined
      ? resolveChordSymbolSource(
          score,
          selection.kind === "single" && selection.elementId === target?.elementId ? selection : { kind: "none" },
          selectedScoreIndex,
          measureIndex,
          selectedPartIds,
        )?.partIndex
      : undefined;
  const sourcePart = sourcePartIndex === undefined ? undefined : score?.parts[sourcePartIndex];
  const displayInterval = chordDisplayInterval(score, selectedScoreIndex, sourcePart);
  const stored =
    measureIndex === undefined || chordIndex === undefined
      ? undefined
      : score?.global.measures[measureIndex]?.chordSymbols?.[chordIndex];
  const chord = stored && sourcePart ? transposeChordSymbol(stored, displayInterval) : null;

  function commit(displayChord: ChordSymbol) {
    if (!score || !stored || measureIndex === undefined || chordIndex === undefined) return;
    const concertChord = transposeChordSymbol(displayChord, {
      halfSteps: -displayInterval.halfSteps,
      staffDistance: -displayInterval.staffDistance,
    });
    if (JSON.stringify(concertChord) === JSON.stringify(stored)) return;
    const nextScore = produce(score, (draft) => {
      draft.global.measures[measureIndex]!.chordSymbols![chordIndex] = concertChord;
    });
    updateScore(nextScore);
    // Audio failures must not roll back an already committed notation edit.
    void previewChord(concertChord, nextScore).catch(() => {});
  }

  function mutateChord(mutate: (selected: ChordSymbol) => void) {
    if (!chord) return;
    const changed = produce(chord, mutate);
    if (changed === chord) return;
    const next: ChordSymbol = { ...changed, rawText: undefined };
    next.rawText = formatChordSymbolText({ ...next, textOverride: undefined });
    commit(next);
  }

  return {
    chord,
    canonicalId,
    sourcePart,
    editorKey: `${canonicalId}:${sourcePartIndex}:${displayInterval.halfSteps}:${displayInterval.staffDistance}`,
    setText: (text: string) => {
      if (chord && text.trim())
        commit({
          ...parseChordSymbolText(text, chord.position),
          ...(chord.textOverride !== undefined && { textOverride: chord.textOverride }),
        });
    },
    setRootStep: (step: string) =>
      mutateChord((selected) => {
        selected.root = { ...selected.root, step };
      }),
    setRootAlter: (alter: number | undefined) =>
      mutateChord((selected) => {
        if (selected.root) selected.root.alter = alter;
      }),
    setQuality: (quality: ChordQuality) =>
      mutateChord((selected) => {
        selected.quality = quality;
        if (quality !== "other") selected.kindText = undefined;
      }),
    setKindText: (kindText: string) =>
      mutateChord((selected) => {
        selected.kindText = kindText.trim() === "" ? undefined : kindText;
      }),
    setExtension: (extension: ChordSymbol["extension"]) =>
      mutateChord((selected) => {
        selected.extension = extension;
        if (selected.quality !== "other") selected.kindText = undefined;
      }),
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
    setVisibility: (visibility: NonNullable<Part["chordSymbolVisibility"]>) => {
      if (!score || sourcePartIndex === undefined || !sourcePart) return;
      const nextScore = produce(score, (draft) => {
        draft.parts[sourcePartIndex]!.chordSymbolVisibility = visibility;
      });
      if (nextScore !== score) updateScore(nextScore);
    },
    setTextOverride: (text: string) => {
      if (chord) commit({ ...chord, textOverride: text.trim() === "" ? undefined : text });
    },
  };
}
