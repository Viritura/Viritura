import {
  MUSESCORE_STAFF_LIST_MIME,
  writeMuseScoreStaffList,
  type MuseScoreClipboardData,
  type MuseScoreClipboardWriteInput,
  type MuseScoreClipboardWriteResult,
} from "@viritura/musescore-clipboard";
import type { PasteResult } from "../../commands/clipboardCommands";
import type { ClipboardFragment } from "../ClipboardFragment";
import { assignFreshTrackIds } from "../deserialize";
import { serializeFragment } from "../serialize";
import { writeNotationClipboard } from "./transport";

function museScoreWriteInput(fragment: Omit<ClipboardFragment, "type" | "version">): MuseScoreClipboardWriteInput {
  return {
    events: fragment.content,
    tracks: fragment.tracks?.map((track) => ({
      partOffset: track.partOffset,
      voiceIndex: track.voiceIndex,
      staffOffset: track.staffOffset,
      sourceStaff: track.sourceStaff,
      leadIn: track.leadIn,
      content: track.content,
      transposition: track.transposition,
      dynamics: track.dynamics,
    })),
    transposition: fragment.transposition,
    dynamics: fragment.dynamics,
    chordSymbols: fragment.chordSymbols,
    measureRepeats: fragment.measureRepeats?.map(({ repeat }) => ({ repeat })),
  };
}

export async function writeClipboardFragment(
  fragment: Omit<ClipboardFragment, "type" | "version">,
  onConversionWarning?: (message: string) => void,
): Promise<void> {
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
  let museScore: MuseScoreClipboardWriteResult;
  try {
    museScore = writeMuseScoreStaffList(museScoreWriteInput(fragment));
  } catch {
    museScore = {
      xml: null,
      warning: "This selection cannot be exported to MuseScore. Viritura clipboard content is still available.",
    };
  }
  if (museScore.warning) onConversionWarning?.(museScore.warning);
  await writeNotationClipboard({
    text,
    museScore: museScore.xml ? { mime: MUSESCORE_STAFF_LIST_MIME, xml: museScore.xml } : null,
  });
}

export function pasteResultFromMuseScore(data: MuseScoreClipboardData): PasteResult {
  return {
    ...assignFreshTrackIds(data.content, data.tracks),
    transposition: data.transposition ? structuredClone(data.transposition) : undefined,
    dynamics: data.dynamics?.map((item) => structuredClone(item)),
    chordSymbols: data.chordSymbols?.map((item) => structuredClone(item)),
  };
}
