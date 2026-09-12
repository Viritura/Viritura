import { produce } from "../score/scoreClone";
import { resolveEventLocation, resolveEventFromSubElement } from "../score/ElementPath";
import { durationToBeats, sequenceContentBeats } from "../commands/noteCommands";
import { findCondensingStaff } from "../score/condensingRouter";
import { parseChordSymbolText, type Score, type NoteValueBase, type Tempo, type Sequence } from "@viritura/core";
import type { ChordSymbolPopoverState, TempoPopoverState, StaffTextPopoverState } from "../store/overlayStore";
import type { SelectionState } from "../store/selectionStore";
import type { NoteInputState } from "../store/noteInputStore";
import type { CondensingMode } from "../components/CondensingPopover";

// ─── Tempo parsing ────────────────────────────────────────────────
// Supports "120", "q=120", "q.=120", "e140", "Allegro q=120", "Andante".
const TEMPO_PREFIX_MAP: Record<string, NoteValueBase> = {
  b: "breve",
  w: "whole",
  h: "half",
  q: "quarter",
  e: "eighth",
  s: "16th",
  t: "32nd",
};

interface ParsedTempo {
  base?: NoteValueBase;
  dots: number;
  bpm: string;
  text?: string;
}

function parseTempoInput(input: string): ParsedTempo {
  const trimmed = input.trim();
  const numericBpm = "(?:\\d+(?:\\.\\d*)?|\\.\\d+)";
  const m = new RegExp(`^(.*?)\\b([bwhqest])(\\.?)=?\\s*(${numericBpm})$`, "i").exec(trimmed);
  if (m) {
    const text = m[1]!.trim() || undefined;
    const base = TEMPO_PREFIX_MAP[m[2]!.toLowerCase()];
    const dots = m[3] === "." ? 1 : 0;
    return { base, dots, bpm: m[4]!, text };
  }
  if (new RegExp(`^${numericBpm}$`).test(trimmed)) {
    return { dots: 0, bpm: trimmed };
  }
  return { dots: 0, bpm: "", text: trimmed || undefined };
}

export function applyTempoEdit(score: Score, popover: TempoPopoverState, rawValue: string): Score {
  const parsed = parseTempoInput(rawValue);
  const base = parsed.base ?? popover.base;
  const dots = parsed.base ? parsed.dots : popover.dots;
  return produce(score, (draft) => {
    const gm = draft.global.measures[popover.measureIndex];
    if (!gm) return;
    if (!parsed.bpm.trim() && !parsed.text) {
      gm.tempos = [];
      return;
    }
    const existing = gm.tempos?.[0];
    const bpm = parsed.bpm.trim() ? Number(parsed.bpm) : (existing?.bpm ?? 120);
    if (parsed.bpm.trim() && (isNaN(bpm) || bpm <= 0)) return;
    const tempo: Tempo = {
      bpm,
      value: { base, ...(dots > 0 ? { dots } : {}) },
      ...(popover.location ? { location: popover.location } : {}),
    };
    if (parsed.text) tempo.text = parsed.text;
    if (parsed.text && !parsed.bpm.trim()) {
      tempo.showMetronomeMark = false;
    }
    gm.tempos = [tempo];
  });
}

// ─── Staff text ──────────────────────────────────────────────────
interface TimedAnnotationTarget {
  eventIndex: number;
  tupletIndex?: number;
  graceContainerIndex?: number;
}

function eventBeatPosition(sequence: Sequence, target: TimedAnnotationTarget): number {
  const topLevelIndex = target.tupletIndex ?? target.graceContainerIndex ?? target.eventIndex;
  let beat = sequence.content.slice(0, topLevelIndex).reduce((sum, content) => sum + sequenceContentBeats(content), 0);
  if (target.tupletIndex === undefined) return beat;

  const container = sequence.content[target.tupletIndex];
  if (container?.type !== "tuplet") return beat;
  const outerBeats = container.outer.multiple * durationToBeats(container.outer.duration);
  const innerBeats = container.inner.multiple * durationToBeats(container.inner.duration);
  const scale = innerBeats > 0 ? outerBeats / innerBeats : 1;
  beat += container.content
    .slice(0, target.eventIndex)
    .reduce((sum, content) => sum + sequenceContentBeats(content) * scale, 0);
  return beat;
}

function beatPositionToFraction(beat: number): [number, number] {
  const wholeNotes = beat / 4;
  let bestNumerator = 0;
  let bestDenominator = 1;
  let bestError = Math.abs(wholeNotes);
  for (let denominator = 1; denominator <= 4096; denominator++) {
    const numerator = Math.round(wholeNotes * denominator);
    const error = Math.abs(wholeNotes - numerator / denominator);
    if (error < bestError) {
      bestNumerator = numerator;
      bestDenominator = denominator;
      bestError = error;
      if (error < 1e-9) break;
    }
  }
  return [bestNumerator, bestDenominator];
}

export function applyStaffTextEdit(score: Score, popover: StaffTextPopoverState, rawValue: string): Score {
  return produce(score, (draft) => {
    for (const target of popover.targets ?? [popover]) {
      const pm = draft.parts[target.partIndex]?.measures[target.measureIndex];
      if (!pm) continue;
      const seq = pm.sequences?.[target.sequenceIndex];
      const fraction = beatPositionToFraction(seq ? eventBeatPosition(seq, target) : 0);
      const existing = pm.expressions ?? [];
      existing.push({
        text: rawValue.trim(),
        position: { fraction },
        placement: "above",
        ...(target.staff !== undefined && { staff: target.staff }),
      });
      pm.expressions = existing;
    }
  });
}

/** Insert or replace a harmony-lane event at the selected rhythmic position. */
export function applyChordSymbolEdit(
  score: Score,
  popover: ChordSymbolPopoverState,
  rawValue: string,
): Score | undefined {
  const pm = score.parts[popover.partIndex]?.measures[popover.measureIndex];
  const sequence = pm?.sequences[popover.sequenceIndex];
  if (!pm || !sequence) return undefined;

  const position = { fraction: beatPositionToFraction(eventBeatPosition(sequence, popover)) };
  const chord = parseChordSymbolText(rawValue, position);
  if (!chord) return undefined;

  return produce(score, (draft) => {
    const measure = draft.parts[popover.partIndex]?.measures[popover.measureIndex];
    if (!measure) return;
    const chords = measure.chordSymbols ?? [];
    const atSamePosition = (candidate: (typeof chords)[number]) =>
      candidate.position.fraction[0] * chord.position.fraction[1] ===
      chord.position.fraction[0] * candidate.position.fraction[1];
    const existingIndex = chords.findIndex(
      (candidate) => atSamePosition(candidate) && candidate.displayStaff === popover.anchorStaff,
    );
    const unscopedIndex = chords.findIndex(
      (candidate) => atSamePosition(candidate) && candidate.displayStaff === undefined,
    );
    const fallbackIndex = chords.findIndex(atSamePosition);
    const replaceIndex = existingIndex >= 0 ? existingIndex : unscopedIndex >= 0 ? unscopedIndex : fallbackIndex;
    if (replaceIndex >= 0) {
      const displayStaff = chords[replaceIndex]!.displayStaff;
      if (displayStaff !== undefined) chord.displayStaff = displayStaff;
      chords[replaceIndex] = chord;
    } else {
      chords.push(chord);
    }
    chords.sort(
      (left, right) =>
        left.position.fraction[0] / left.position.fraction[1] - right.position.fraction[0] / right.position.fraction[1],
    );
    measure.chordSymbols = chords;
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
