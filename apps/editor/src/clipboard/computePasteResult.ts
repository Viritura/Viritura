import type { Score, SequenceContent } from "@viritura/core";
import { resolveEventLocation, eventId as buildEventId, eventSuffix as buildEventSuffix } from "../score/ElementPath";
import type { SelectionState } from "../store/selectionStore";
import { applyPaste, type PasteResult } from "../commands/clipboardCommands";

/**
 * Scan the target sequence for the IDs that paste content brought in, so the
 * caller can re-select the just-pasted region.
 */
export function findPastedSelection(
  newScore: Score,
  pasteContent: SequenceContent[],
  partIndex: number,
  measureIndex: number,
  sequenceIndex: number,
): { start: string; end: string } | null {
  const ids = new Set<string>();
  for (const ev of pasteContent) {
    const id = (ev as { id?: string }).id;
    if (id) ids.add(id);
    if (ev.type === "tuplet" && ev.content) {
      for (const inner of ev.content) {
        const iid = (inner as { id?: string }).id;
        if (iid) ids.add(iid);
      }
    }
  }
  if (ids.size === 0) return null;

  const part = newScore.parts[partIndex];
  if (!part) return null;

  let firstId: string | null = null;
  let lastId: string | null = null;
  for (let m = measureIndex; m < part.measures.length; m++) {
    const seq = part.measures[m]?.sequences[sequenceIndex];
    if (!seq) continue;
    for (let i = 0; i < seq.content.length; i++) {
      const item = seq.content[i]!;
      const checkEvent = (ev: { id?: string }, idx: number): string | null => {
        if (!ev.id || !ids.has(ev.id)) return null;
        const suf = buildEventSuffix(ev.id, idx, m, sequenceIndex);
        return buildEventId(partIndex, m, sequenceIndex, suf);
      };
      if (item.type === "tuplet" && item.content) {
        for (let j = 0; j < item.content.length; j++) {
          const eid = checkEvent(item.content[j] as { id?: string }, j);
          if (eid) {
            if (!firstId) firstId = eid;
            lastId = eid;
          }
        }
      } else {
        const eid = checkEvent(item as { id?: string }, i);
        if (eid) {
          if (!firstId) firstId = eid;
          lastId = eid;
        }
      }
    }
  }

  if (!firstId || !lastId) return null;
  return { start: firstId, end: lastId };
}

/**
 * Resolve the (part, measure, sequence, event) anchor for a paste based on the
 * current selection. Returns null when the selection can't anchor a paste.
 */
function resolvePasteAnchor(
  score: Score,
  selection: SelectionState,
): { partIndex: number; measureIndex: number; sequenceIndex: number; eventIndex: number } | null {
  if (selection.kind === "single") {
    const loc = resolveEventLocation(selection.elementId, score);
    if (loc) {
      return {
        partIndex: loc.partIndex,
        measureIndex: loc.measureIndex,
        sequenceIndex: loc.sequenceIndex,
        eventIndex: loc.eventIndex,
      };
    }
    const segments = selection.elementId.split("/");
    const pMatch = segments[0]?.match(/^p(\d+)$/);
    const mMatch = segments[1]?.match(/^m(\d+)$/);
    const sMatch = segments[2]?.match(/^s(\d+)$/);
    if (!pMatch || !mMatch) return null;
    return {
      partIndex: parseInt(pMatch[1]!, 10),
      measureIndex: parseInt(mMatch[1]!, 10),
      sequenceIndex: sMatch ? parseInt(sMatch[1]!, 10) : 0,
      eventIndex: 0,
    };
  }
  if (selection.kind === "measure") {
    return {
      partIndex: selection.startPartIndex,
      measureIndex: selection.startMeasure,
      sequenceIndex: 0,
      eventIndex: 0,
    };
  }
  return null;
}

/**
 * Apply a paste at the anchor derived from the current selection. Returns the
 * new score and the elementId range covering the pasted content (for
 * re-selection), or null if the selection can't anchor a paste.
 */
export function computePasteResult(
  score: Score,
  selection: SelectionState,
  paste: PasteResult,
): { newScore: Score; range: { start: string; end: string } | null } | null {
  const anchor = resolvePasteAnchor(score, selection);
  if (!anchor) return null;
  const newScore = applyPaste(
    score,
    paste,
    anchor.partIndex,
    anchor.measureIndex,
    anchor.sequenceIndex,
    anchor.eventIndex,
  );
  const range = findPastedSelection(
    newScore,
    paste.content,
    anchor.partIndex,
    anchor.measureIndex,
    anchor.sequenceIndex,
  );
  return { newScore, range };
}
