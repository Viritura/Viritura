import { produce } from "../score/scoreClone";
import { resolveEventLocation, resolveEventFromSubElement } from "../score/ElementPath";
import { durationToBeats } from "../commands/noteCommands";
import { findCondensingStaff } from "../score/condensingRouter";
import type { Score, NoteValueBase, Tempo, Duration } from "@viritura/core";
import type { TempoPopoverState, StaffTextPopoverState } from "../store/overlayStore";
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
export function applyStaffTextEdit(score: Score, popover: StaffTextPopoverState, rawValue: string): Score {
  return produce(score, (draft) => {
    const pm = draft.parts[popover.partIndex]?.measures[popover.measureIndex];
    if (!pm) return;
    const seq = pm.sequences?.[popover.sequenceIndex];
    let beat = 0;
    if (seq) {
      for (let i = 0; i < popover.eventIndex && i < seq.content.length; i++) {
        const ev = seq.content[i];
        if (ev && "duration" in ev) beat += durationToBeats(ev.duration as Duration);
      }
    }
    let num = beat;
    let den = 4;
    while (Math.abs(num - Math.round(num)) > 1e-9 && den < 4096) {
      num *= 2;
      den *= 2;
    }
    const fraction: [number, number] = [Math.round(num), den];
    const existing = pm.expressions ?? [];
    existing.push({ text: rawValue.trim(), position: { fraction }, placement: "above" });
    pm.expressions = existing;
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
