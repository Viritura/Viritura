/**
 * Re-linking ties written in the copied music.
 *
 * Distribution mints fresh note ids, so a source tie's target id would dangle.
 * Every destination note is traced back to the source note it renders, and a
 * source tie is re-drawn from the last destination piece of its start note to
 * the first piece of its end note on the same destination staff. Allocation
 * keeps each tie chain on one staff, even when its pitch rank changes.
 */

import type { Note, Tie } from "@viritura/core";

interface RenderedPieces {
  first: Note;
  last: Note;
}

/** Destination pieces rendered for each source note, keyed by destination staff index. */
export type SourceNoteRenderings = Map<Note, Map<number, RenderedPieces>>;

/** Record that `rendered` sounds `source` on destination staff `targetIndex`; call in timeline order. */
export function recordRendering(
  renderings: SourceNoteRenderings,
  source: Note,
  targetIndex: number,
  rendered: Note,
): void {
  const byTarget = renderings.get(source) ?? new Map<number, RenderedPieces>();
  const pieces = byTarget.get(targetIndex);
  if (pieces) pieces.last = rendered;
  else byTarget.set(targetIndex, { first: rendered, last: rendered });
  renderings.set(source, byTarget);
}

function appendTie(note: Note, tie: Tie): void {
  if (tie.target && note.ties?.some((existing) => existing.target === tie.target)) return;
  note.ties = [...(note.ties ?? []), tie];
}

function destinationTie(tie: Tie, target: string): Tie {
  const { targetType, ...rest } = structuredClone(tie);
  // Both ends now share one destination voice, so a cross-voice tie becomes an ordinary one.
  return targetType && targetType !== "crossVoice" ? { ...rest, target, targetType } : { ...rest, target };
}

/** Re-draw every source tie between the destination pieces that render its two notes. */
export function relinkSourceTies(renderings: SourceNoteRenderings): void {
  const byId = new Map<string, Note>();
  for (const source of renderings.keys()) if (source.id) byId.set(source.id, source);

  for (const [source, byTarget] of renderings) {
    for (const tie of source.ties ?? []) {
      const partnerNote = tie.target ? byId.get(tie.target) : undefined;
      const partner = partnerNote && renderings.get(partnerNote);
      for (const [targetIndex, pieces] of byTarget) {
        if (!tie.target) {
          appendTie(pieces.last, structuredClone(tie));
          continue;
        }
        const end = partner?.get(targetIndex);
        if (end?.first.id) appendTie(pieces.last, destinationTie(tie, end.first.id));
      }
    }
  }
}
