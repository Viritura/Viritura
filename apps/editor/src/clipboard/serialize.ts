import type { SequenceContent } from "@viritura/core";
import type { TimeSignature, KeySignature, Clef, Transposition } from "@viritura/core";
import {
  VIRITURA_FRAGMENT_TYPE,
  FRAGMENT_VERSION,
  type ClipboardFragment,
  type ClipboardTrack,
  type CapturedDynamic,
} from "./ClipboardFragment";

/**
 * Serialize score content into a ClipboardFragment JSON string.
 *
 * @param content - The events to copy (single track, backward compat)
 * @param timeSignature - Active time signature at the source location
 * @param keySignature - Active key signature at the source location
 * @param tracks - Optional multi-track content for cross-staff copy
 * @param clef - Optional active clef at the source location (primary track)
 * @param transposition - Optional source-part transposition (primary track)
 * @param dynamics - Optional captured dynamics (primary track)
 * @returns JSON string representing the clipboard fragment
 */
export function serializeFragment(
  content: SequenceContent[],
  timeSignature: TimeSignature,
  keySignature: KeySignature,
  tracks?: ClipboardTrack[],
  clef?: Clef,
  transposition?: Transposition,
  dynamics?: CapturedDynamic[],
): string {
  const fragment: ClipboardFragment = {
    type: VIRITURA_FRAGMENT_TYPE,
    version: FRAGMENT_VERSION,
    timeSignature,
    keySignature,
    content: content.map(stripInternalIds),
    ...(clef ? { clef } : {}),
    ...(transposition ? { transposition } : {}),
    ...(dynamics && dynamics.length > 0 ? { dynamics: structuredClone(dynamics) } : {}),
    ...(tracks
      ? {
          tracks: tracks.map((t) => ({
            partOffset: t.partOffset,
            voiceIndex: t.voiceIndex,
            content: t.content.map(stripInternalIds),
            ...(t.clef ? { clef: t.clef } : {}),
            ...(t.transposition ? { transposition: t.transposition } : {}),
            ...(t.dynamics && t.dynamics.length > 0 ? { dynamics: structuredClone(t.dynamics) } : {}),
          })),
        }
      : {}),
  };
  return JSON.stringify(fragment);
}

/**
 * Deep-clone a SequenceContent item. Event/note IDs are preserved so that
 * slur and tie target references can be remapped by assignFreshIds on paste.
 * All IDs will be replaced with fresh ones during paste.
 */
function stripInternalIds(item: SequenceContent): SequenceContent {
  return structuredClone(item);
}
