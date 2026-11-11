import { walkSequenceEvents, type NoteEvent, type Score } from "@viritura/core";
import { getEventAtLocation, type EventLocation } from "../../score/ElementPath";
import { deleteNote } from "../noteCommands";

/** Re-resolve by identity after each rest merge or container unwrapping. */
export function deleteEventTargets(score: Score, locations: readonly EventLocation[]): Score {
  const targets = [...locations].reverse().flatMap((location) => {
    const event = getEventAtLocation(score, location);
    return event?.type === "event" ? [{ location, event }] : [];
  });
  const replacements = new Map<NoteEvent, NoteEvent>();
  for (const target of targets) {
    const { partIndex, measureIndex, sequenceIndex } = target.location;
    const sequence = score.parts[partIndex]!.measures[measureIndex]!.sequences[sequenceIndex]!;
    const event = replacements.get(target.event) ?? target.event;
    const found = [...walkSequenceEvents(sequence.content)].find((entry) => entry.event === event);
    // A previous selected ancestor can legitimately remove this target's tree.
    if (!found) continue;
    if (found.path.length > 2) throw new Error("Deletion does not support this nested event path.");
    const rootIndex = found.path[0]!;
    const childIndex = found.path[1];
    const container = sequence.content[rootIndex];
    const tremoloEvents = container?.type === "tremolo" ? [...container.content] : null;
    deleteNote(score, {
      partIndex,
      measureIndex,
      voice: sequenceIndex,
      eventIndex: childIndex ?? rootIndex,
      tupletIndex: childIndex === undefined ? undefined : rootIndex,
    });
    if (tremoloEvents) {
      for (const [index, original] of tremoloEvents.entries()) {
        const restored = sequence.content[rootIndex + index];
        if (restored?.type === "event") replacements.set(original, restored);
      }
    }
  }
  return score;
}
