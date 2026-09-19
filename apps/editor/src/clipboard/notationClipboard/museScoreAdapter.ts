import type { MuseScoreClipboardData } from "@viritura/musescore-clipboard";
import type { PasteResult } from "../../commands/clipboardCommands";
import type { ClipboardFragment } from "../ClipboardFragment";
import { assignFreshTrackIds } from "../deserialize";
import { serializeFragment } from "../serialize";
import { writeNotationClipboard } from "./transport";

export async function writeClipboardFragment(fragment: Omit<ClipboardFragment, "type" | "version">): Promise<void> {
  const text = serializeFragment(
    fragment.content,
    fragment.timeSignature,
    fragment.keySignature,
    fragment.tracks,
    fragment.clef,
    fragment.transposition,
    fragment.dynamics,
    fragment.measureRepeats,
    fragment.lyrics,
    fragment.chordSymbols,
  );
  await writeNotationClipboard({ text });
}

export function pasteResultFromMuseScore(data: MuseScoreClipboardData): PasteResult {
  return {
    ...assignFreshTrackIds(data.content, data.tracks),
    transposition: data.transposition ? structuredClone(data.transposition) : undefined,
    dynamics: data.dynamics?.map((item) => structuredClone(item)),
    chordSymbols: data.chordSymbols?.map((item) => structuredClone(item)),
  };
}
