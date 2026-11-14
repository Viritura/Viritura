import { produce } from "../score/scoreClone";
import { resolveEventLocation, resolveEventFromSubElement } from "../score/ElementPath";
import { findCondensingStaff } from "../score/condensingRouter";
import {
  parseChordSymbolText,
  compareChordSymbolPositions,
  transposeChordSymbol,
  upsertGlobalChordSymbol,
  textContentFromPlain,
  type Score,
} from "@viritura/core";
import type { ChordSymbolPopoverState, StaffTextPopoverState } from "../store/overlayStore";
import type { SelectionState } from "../store/selectionStore";
import type { NoteInputState } from "../store/noteInputStore";
import type { CondensingMode } from "../components/CondensingPopover";
import { beatPositionToFraction, eventBeatPosition } from "./timedAnnotationPosition";
import { resolveDisplayTransposition } from "../pitchContext";

// ─── Staff text ──────────────────────────────────────────────────
export function applyStaffTextEdit(score: Score, popover: StaffTextPopoverState, rawValue: string): Score {
  return produce(score, (draft) => {
    for (const target of popover.targets ?? [popover]) {
      const pm = draft.parts[target.partIndex]?.measures[target.measureIndex];
      if (!pm) continue;
      const seq = pm.sequences?.[target.sequenceIndex];
      const fraction = beatPositionToFraction(seq ? eventBeatPosition(seq, target) : 0);
      const existing = pm.expressions ?? [];
      existing.push({
        text: textContentFromPlain(rawValue.trim()),
        position: { fraction },
        placement: "above",
        ...(target.staff !== undefined && { staff: target.staff }),
      });
      pm.expressions = existing;
    }
  });
}

/** Insert or replace a global harmony event at the selected rhythmic position. */
export function applyChordSymbolEdit(
  score: Score,
  popover: ChordSymbolPopoverState,
  rawValue: string,
  selectedScoreIndex = 0,
): Score | undefined {
  const part = score.parts[popover.partIndex];
  const pm = part?.measures[popover.measureIndex];
  const sequence = pm?.sequences[popover.sequenceIndex];
  const measure = score.global.measures[popover.measureIndex];
  if (!part || !pm || !sequence || !measure || !rawValue.trim()) return undefined;

  const position = popover.rhythmicPosition ?? {
    fraction: beatPositionToFraction(eventBeatPosition(sequence, popover)),
  };
  const interval = popover.concertPitch
    ? undefined
    : resolveDisplayTransposition(score, popover.partIndex, popover.measureIndex, position.fraction, selectedScoreIndex)
        ?.interval;
  const parsed = parseChordSymbolText(rawValue, position);
  const parsedConcert = interval
    ? transposeChordSymbol(parsed, { halfSteps: -interval.halfSteps, staffDistance: -interval.staffDistance })
    : parsed;
  const existing = measure.chordSymbols?.find(
    (candidate) => compareChordSymbolPositions(candidate.position, position) === 0,
  );
  const chord = {
    ...parsedConcert,
    ...(existing?.textOverride !== undefined && { textOverride: existing.textOverride }),
  };
  const updated = upsertGlobalChordSymbol(measure, chord);

  return produce(score, (draft) => {
    draft.global.measures[popover.measureIndex] = updated;
    if (!popover.concertPitch) draft.parts[popover.partIndex]!.chordSymbolVisibility = "show";
  });
}

// ─── Condensing routing ──────────────────────────────────────────
export interface CondensingOverrideInput {
  score: Score;
  selection: SelectionState;
  noteInputState: NoteInputState;
  selectedScoreIndex: number;
  measureIndex: number;
  mode: CondensingMode;
}

export function applyCondensingOverride({
  score,
  selection,
  noteInputState,
  selectedScoreIndex,
  measureIndex,
  mode,
}: CondensingOverrideInput): Score {
  let partIndex = 0;
  if (noteInputState.active && noteInputState.cursorPosition) {
    partIndex = noteInputState.cursorPosition.partIndex;
  } else {
    const elementId =
      selection.kind === "single"
        ? selection.elementId
        : selection.kind === "range"
          ? selection.startElementId
          : selection.kind === "multi"
            ? selection.elementIds[0]
            : undefined;
    if (elementId) {
      const loc = resolveEventFromSubElement(elementId, score) ?? resolveEventLocation(elementId, score);
      if (loc) partIndex = loc.partIndex;
    }
  }
  const sd = score.scores?.[selectedScoreIndex];
  const layoutId = sd?.layout ?? sd?.pages?.[0]?.systems?.[0]?.layout;
  const csInfo = findCondensingStaff(score, layoutId, partIndex);
  if (!csInfo || csInfo.sourcePartIndices.length === 0) return score;
  const firstSourceIdx = csInfo.sourcePartIndices[0]!;
  return produce(score, (draft) => {
    const pm = draft.parts[firstSourceIdx]?.measures[measureIndex];
    if (pm) pm.condensingOverride = mode;
  });
}
