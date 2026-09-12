import type { GlobalLyrics, Score, SequenceContent } from "@viritura/core";
import type { ClipboardSelection } from "../commands/clipboardCommands";
import { isLyricId } from "../commands/lyricCommands";
import type { SelectionState } from "../store/selectionStore";

function collectLyricLineIds(content: readonly SequenceContent[], lineIds: Set<string>): void {
  for (const item of content) {
    if (item.type === "event") {
      for (const lineId of Object.keys(item.lyrics?.lines ?? {})) lineIds.add(lineId);
    } else if (item.type === "tuplet" || item.type === "grace" || item.type === "tremolo") {
      collectLyricLineIds(item.content, lineIds);
    }
  }
}

export function withClipboardLyricMetadata(score: Score, selection: ClipboardSelection): ClipboardSelection {
  const usedLineIds = new Set<string>();
  collectLyricLineIds(selection.events, usedLineIds);
  for (const track of selection.tracks ?? []) collectLyricLineIds(track.content, usedLineIds);
  if (usedLineIds.size === 0) return selection;

  const source = score.global.lyrics;
  const ordered = (source?.lineOrder ?? []).filter((lineId) => usedLineIds.delete(lineId));
  ordered.push(...[...usedLineIds].sort((left, right) => left.localeCompare(right, undefined, { numeric: true })));
  const lineMetadata = Object.fromEntries(
    ordered.flatMap((lineId) => {
      const metadata = source?.lineMetadata?.[lineId];
      return metadata ? [[lineId, structuredClone(metadata)] as const] : [];
    }),
  );
  const lyrics: GlobalLyrics = {
    lineOrder: ordered,
    ...(Object.keys(lineMetadata).length > 0 ? { lineMetadata } : {}),
  };
  return { ...selection, lyrics };
}

export function withoutSelectedLyrics(
  selection: Extract<SelectionState, { kind: "multi" }>,
): Extract<SelectionState, { kind: "multi" }> {
  return {
    ...selection,
    elementIds: selection.elementIds.filter((elementId) => !isLyricId(elementId)),
  };
}
