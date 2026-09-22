/**
 * Notehead-scoped copy and cut.
 *
 * Selecting the top note of every chord is only useful if the clipboard then
 * honours that granularity — otherwise "select top note, cut, paste on another
 * staff" silently moves whole chords, which is the opposite of a manual
 * explode. The regular clipboard path captures whole events, so notehead
 * selections are handled by narrowing the *score* it reads:
 *
 * - **copy** builds its fragment from a projection where each addressed chord
 *   holds only the selected noteheads, so every downstream capture rule
 *   (ties, dynamics, tracks) keeps working untouched;
 * - **cut** copies that projection, then removes just those noteheads,
 *   collapsing a chord to a rest only when its last note goes.
 *
 * A selection that addresses no individual noteheads is left alone entirely.
 */

import { isRest, type NoteEvent, type Score } from "@viritura/core";
import { getEventAtLocation, type EventLocation } from "../score/ElementPath";
import { produce } from "../score/scoreClone";
import { resolveSelectionNotes } from "../store/selectionUtils";
import type { Selection } from "../store/selectionStore";

/** An event plus the notehead indices a selection picked out of it. */
interface NoteheadTarget {
  loc: EventLocation;
  notes: number[];
}

/**
 * The chords a selection addresses by individual notehead, or null when it
 * addresses none — the signal to use the ordinary whole-event clipboard path.
 */
function noteheadTargets(score: Score, selection: Selection): NoteheadTarget[] | null {
  const targets: NoteheadTarget[] = [];
  for (const target of resolveSelectionNotes(selection, score)) {
    if (target.notes === "all") continue;
    const event = getEventAtLocation(score, target.loc);
    if (!event || event.type !== "event" || isRest(event)) continue;
    const notes = [...target.notes].sort((left, right) => left - right);
    if (notes.length > 0) targets.push({ loc: target.loc, notes });
  }
  return targets.length > 0 ? targets : null;
}

function eventInDraft(draft: Score, loc: EventLocation): NoteEvent | null {
  const event = getEventAtLocation(draft, loc);
  return event && event.type === "event" ? event : null;
}

/**
 * A copy of `score` in which every chord the selection addresses by notehead
 * holds only those noteheads. Returns the original score when the selection is
 * not notehead-scoped.
 */
export function projectNoteheadSelection(score: Score, selection: Selection): Score {
  const targets = noteheadTargets(score, selection);
  if (!targets) return score;

  return produce(score, (draft) => {
    for (const target of targets) {
      const event = eventInDraft(draft, target.loc);
      if (!event?.notes) continue;
      const kept = target.notes.map((index) => event.notes![index]).filter((note) => note !== undefined);
      if (kept.length > 0) event.notes = kept;
    }
  });
}

/**
 * Remove the selected noteheads from `score`, turning a chord into a rest only
 * when its final note is removed. Returns null when nothing was notehead-scoped.
 */
export function removeSelectedNoteheads(score: Score, selection: Selection): Score | null {
  const targets = noteheadTargets(score, selection);
  if (!targets) return null;

  return produce(score, (draft) => {
    for (const target of targets) {
      const event = eventInDraft(draft, target.loc);
      if (!event?.notes) continue;
      const removed = new Set(target.notes);
      const kept = event.notes.filter((_, index) => !removed.has(index));
      if (kept.length > 0) {
        event.notes = kept;
        continue;
      }
      // Last note of the chord: the event becomes a rest of the same length.
      delete event.notes;
      delete event.slurs;
      event.rest = {};
    }
  });
}
