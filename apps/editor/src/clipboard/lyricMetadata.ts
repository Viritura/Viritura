import type { GlobalLyrics, Score, SequenceContent } from "@viritura/core";
import type { ClipboardSelection } from "../commands/clipboardCommands";
import { isLyricId } from "../commands/lyricCommands";
import type { SelectionState } from "../store/selectionStore";

export function collectLyricLineIds(content: readonly SequenceContent[], lineIds: Set<string>): boolean {
  let hasLyrics = false;
  for (const item of content) {
    if (item.type === "event") {
      hasLyrics ||= item.lyrics !== undefined;
      for (const lineId of Object.keys(item.lyrics?.lines ?? {})) lineIds.add(lineId);
    } else if (item.type === "tuplet" || item.type === "grace" || item.type === "tremolo") {
      hasLyrics = collectLyricLineIds(item.content, lineIds) || hasLyrics;
    }
  }
  return hasLyrics;
}

export function withClipboardLyricMetadata(score: Score, selection: ClipboardSelection): ClipboardSelection {
  const usedLineIds = new Set<string>();
  let hasLyrics = collectLyricLineIds(selection.events, usedLineIds);
  for (const track of selection.tracks ?? []) {
    hasLyrics = collectLyricLineIds(track.content, usedLineIds) || hasLyrics;
  }
  if (!hasLyrics) return selection;

  const source = score.global.lyrics;
  const ordered =
    usedLineIds.size === 0
      ? [...(source?.lineOrder ?? [])]
      : (source?.lineOrder ?? []).filter((lineId) => usedLineIds.delete(lineId));
  ordered.push(...[...usedLineIds].sort((left, right) => left.localeCompare(right, undefined, { numeric: true })));
  if (ordered.length === 0) throw new Error("Cannot copy event lyrics without a global lyric line order.");
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
