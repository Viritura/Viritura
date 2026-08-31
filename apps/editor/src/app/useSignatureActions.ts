import { useCallback } from "react";
import type {
  Barline,
  Clef,
  Ending,
  KeySignature,
  RepeatEnd,
  RepeatStart,
  Score,
  SequenceContent,
  TimeSignature,
} from "@viritura/core";
import {
  setBarline,
  setClef,
  setEnding,
  setKeySignature,
  setRepeatEnd,
  setRepeatStart,
  setTimeSignature,
} from "@viritura/core";
import { sequenceContentBeats } from "../commands/noteCommands";
import { resolveEventLocation } from "../score/ElementPath";
import { resolveSelectionScope, type MeasureRange } from "../store/selectionUtils";
import type { DocumentStore } from "../store/documentStore";
import type { SelectionState } from "../store/selectionStore";

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const r = x % y;
    x = y;
    y = r;
  }
  return x || 1;
}

function toReducedFraction(numerator: number, denominator: number): [number, number] {
  if (denominator === 0) return [0, 1];
  const sign = denominator < 0 ? -1 : 1;
  let n = numerator * sign;
  let d = Math.abs(denominator);
  const g = gcd(n, d);
  n /= g;
  d /= g;
  return [n, d];
}

export interface SignatureActionsDeps {
  store: DocumentStore;
  selection: SelectionState;
  updateScore: (score: Score) => void;
}

export interface SignatureActions {
  handleSetTimeSignature: (time: TimeSignature) => void;
  handleSetKeySignature: (key: KeySignature) => void;
  handleSetBarline: (barline: Barline) => void;
  handleSetClef: (clef: Clef) => void;
  handleSetRepeatStart: (repeatStart: RepeatStart | null) => void;
  handleSetRepeatEnd: (repeatEnd: RepeatEnd | null) => void;
  handleSetEnding: (ending: Ending | null) => void;
}

export function useSignatureActions(deps: SignatureActionsDeps): SignatureActions {
  const { store, selection, updateScore } = deps;

  // The measure/part rectangle the current selection touches. Signature and
  // structure edits apply at the START of this scope; endings span its full
  // measure range. Derived uniformly for every selection kind so all of these
  // actions behave consistently (see resolveSelectionScope).
  const selectedScope = useCallback((): MeasureRange | null => {
    const { score } = store.getState();
    if (!score) return null;
    return resolveSelectionScope(selection, score);
  }, [store, selection]);

  const handleSetTimeSignature = useCallback(
    (time: TimeSignature) => {
      const { score } = store.getState();
      if (!score) return;
      const idx = selectedScope()?.startMeasure ?? 0;
      updateScore(setTimeSignature(score, idx, time));
    },
    [store, selectedScope, updateScore],
  );

  const handleSetKeySignature = useCallback(
    (key: KeySignature) => {
      const { score } = store.getState();
      if (!score) return;
      const idx = selectedScope()?.startMeasure ?? 0;
      updateScore(setKeySignature(score, idx, key));
    },
    [store, selectedScope, updateScore],
  );

  const handleSetBarline = useCallback(
    (barline: Barline) => {
      const { score } = store.getState();
      if (!score) return;
      const idx = selectedScope()?.startMeasure ?? 0;
      updateScore(setBarline(score, idx, barline));
    },
    [store, selectedScope, updateScore],
  );

  const handleSetClef = useCallback(
    (clef: Clef) => {
      const { score } = store.getState();
      if (!score) return;
      const scope = selectedScope();
      const measureIndex = scope?.startMeasure ?? 0;
      const partIndex = scope?.startPart ?? 0;

      // A mid-measure clef change is only meaningful for a single anchored
      // event: it carries the beat offset + staff of that note. Range/multi/
      // measure selections set the clef at the measure boundary.
      let position: { fraction: [number, number] } | undefined;
      let staff: number | undefined;
      if (selection.kind === "single" && selection.elementId) {
        const loc = resolveEventLocation(selection.elementId, score);
        if (loc) {
          const sequence = score.parts[loc.partIndex]?.measures[loc.measureIndex]?.sequences[loc.sequenceIndex];
          if (sequence) {
            const beatOffset = sequence.content
              .slice(0, loc.eventIndex)
              .reduce((sum, content) => sum + sequenceContentBeats(content as SequenceContent), 0);

            if (beatOffset > 0) {
              const scaledNumerator = Math.round(beatOffset * 1024);
              const reduced = toReducedFraction(scaledNumerator, 4096);
              position = { fraction: reduced };
            }
            staff = sequence.staff;
          }
        }
      }

      updateScore(setClef(score, measureIndex, partIndex, clef, { position, staff }));
    },
    [store, selection, selectedScope, updateScore],
  );

  const handleSetRepeatStart = useCallback(
    (repeatStart: RepeatStart | null) => {
      const { score } = store.getState();
      if (!score) return;
      const idx = selectedScope()?.startMeasure ?? 0;
      updateScore(setRepeatStart(score, idx, repeatStart));
    },
    [store, selectedScope, updateScore],
  );

  const handleSetRepeatEnd = useCallback(
    (repeatEnd: RepeatEnd | null) => {
      const { score } = store.getState();
      if (!score) return;
      const idx = selectedScope()?.startMeasure ?? 0;
      updateScore(setRepeatEnd(score, idx, repeatEnd));
    },
    [store, selectedScope, updateScore],
  );

  const handleSetEnding = useCallback(
    (ending: Ending | null) => {
      const { score } = store.getState();
      if (!score) return;
      const scope = selectedScope();
      const idx = scope?.startMeasure ?? 0;
      const endingToSet =
        ending !== null && scope ? { ...ending, duration: scope.endMeasure - scope.startMeasure + 1 } : ending;
      updateScore(setEnding(score, idx, endingToSet));
    },
    [store, selectedScope, updateScore],
  );

  return {
    handleSetTimeSignature,
    handleSetKeySignature,
    handleSetBarline,
    handleSetClef,
    handleSetRepeatStart,
    handleSetRepeatEnd,
    handleSetEnding,
  };
}
