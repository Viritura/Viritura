import type { LyricLine, LyricLineType, NoteEvent, Score } from "@viritura/core";
import { produce } from "../score/scoreClone";
import { extractLyricLineId, getContentArrayForLocation, resolveEventFromSubElement } from "../score/ElementPath";
import type { SelectionState } from "../store/selectionStore";

export interface SelectedLyric {
  lineId: string;
  line: LyricLine;
  occupiedLineIds: string[];
}

export function isLyricId(elementId: string): boolean {
  return extractLyricLineId(elementId) !== null;
}

export function resolveSelectedLyric(score: Score, elementId: string): SelectedLyric | null {
  const lineId = extractLyricLineId(elementId);
  if (lineId === null) return null;
  const location = resolveEventFromSubElement(elementId, score);
  if (!location) return null;
  const content = getContentArrayForLocation(score, location);
  const event = content?.[location.eventIndex];
  if (event?.type !== "event") return null;
  const line = event.lyrics?.lines?.[lineId];
  if (!line) return null;
  return {
    lineId,
    line,
    occupiedLineIds: Object.keys(event.lyrics?.lines ?? {}),
  };
}

export function selectedLyricText(score: Score, selection: SelectionState): string | null {
  if (selection.kind !== "single") return null;
  return resolveSelectedLyric(score, selection.elementId)?.line.text ?? null;
}

export function pasteTextIntoSelectedLyric(score: Score, selection: SelectionState, text: string): Score | null {
  if (selection.kind !== "single") return null;
  return setLyricText(score, selection.elementId, text);
}

function editSelectedLyric(
  score: Score,
  elementId: string,
  edit: (event: NoteEvent, lineId: string, line: LyricLine) => void,
): Score | null {
  const lineId = extractLyricLineId(elementId);
  if (lineId === null) return null;
  const location = resolveEventFromSubElement(elementId, score);
  if (!location) return null;
  let changed = false;
  const next = produce(score, (draft) => {
    const content = getContentArrayForLocation(draft, location);
    const event = content?.[location.eventIndex];
    if (event?.type !== "event") return;
    const line = event.lyrics?.lines?.[lineId];
    if (!line) return;
    edit(event, lineId, line);
    changed = true;
  });
  return changed ? next : null;
}

export function setLyricText(score: Score, elementId: string, text: string): Score | null {
  return editSelectedLyric(score, elementId, (_event, _lineId, line) => {
    line.text = text;
  });
}

export function setLyricSyllabicType(score: Score, elementId: string, type: LyricLineType): Score | null {
  return editSelectedLyric(score, elementId, (_event, _lineId, line) => {
    if (type === "whole") delete line.type;
    else line.type = type;
  });
}

export function moveLyricToLine(score: Score, elementId: string, nextLineId: string): Score | null {
  const selected = resolveSelectedLyric(score, elementId);
  if (!selected || selected.lineId === nextLineId || selected.occupiedLineIds.includes(nextLineId)) return null;
  return editSelectedLyric(score, elementId, (event, lineId, line) => {
    event.lyrics!.lines![nextLineId] = { ...line };
    delete event.lyrics!.lines![lineId];
  });
}

export function removeLyricByElementId(score: Score, elementId: string): Score | null {
  return editSelectedLyric(score, elementId, (event, lineId) => {
    delete event.lyrics!.lines![lineId];
    if (Object.keys(event.lyrics!.lines!).length === 0) delete event.lyrics;
  });
}

export function removeLyricsByElementId(score: Score, elementIds: readonly string[]): boolean {
  let removed = false;
  for (const elementId of elementIds) {
    const lineId = extractLyricLineId(elementId);
    if (lineId === null) continue;
    const location = resolveEventFromSubElement(elementId, score);
    if (!location) continue;
    const content = getContentArrayForLocation(score, location);
    const event = content?.[location.eventIndex];
    if (event?.type !== "event" || !event.lyrics?.lines?.[lineId]) continue;
    delete event.lyrics.lines[lineId];
    if (Object.keys(event.lyrics.lines).length === 0) delete event.lyrics;
    removed = true;
  }
  return removed;
}

export function removeLyrics(score: Score, elementIds: readonly string[]): { score: Score; removed: boolean } {
  let next = score;
  let removed = false;
  for (const elementId of elementIds) {
    const candidate = removeLyricByElementId(next, elementId);
    if (!candidate) continue;
    next = candidate;
    removed = true;
  }
  return { score: next, removed };
}
