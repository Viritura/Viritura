import { patch, type EventLocator, type Score, type ScorePatch } from "@viritura/core";
import { findForwardSlurTargetId } from "../commands/noteCommands";
import { getEventAtLocation, type EventLocation } from "../score/ElementPath";
import { groupEventsByVoice } from "../store/selectionUtils";

function eventLocator(score: Score, loc: EventLocation): EventLocator | null {
  const part = score.parts[loc.partIndex];
  const event = getEventAtLocation(score, loc);
  if (!part?.id || event?.type !== "event" || !event.id) return null;
  return {
    sequencePath: {
      partId: part.id,
      measureIndex: loc.measureIndex,
      voice: loc.sequenceIndex,
    },
    eventId: event.id,
  };
}

export function planSlurSpanPatches(score: Score, events: EventLocation[]): ScorePatch[] | null {
  const patches: ScorePatch[] = [];
  for (const group of groupEventsByVoice(events)) {
    if (group.length < 2) continue;
    const first = group[0];
    const last = group[group.length - 1];
    if (!first || !last) continue;
    const locator = eventLocator(score, first);
    const source = getEventAtLocation(score, first);
    const target = getEventAtLocation(score, last);
    if (!locator || source?.type !== "event" || target?.type !== "event" || !target.id) continue;
    patches.push(
      patch.setEventField(locator, { field: "slurs", value: [...(source.slurs ?? []), { target: target.id }] }),
    );
  }
  return patches.length > 0 ? patches : null;
}

export function planSlurSinglePatch(score: Score, loc: EventLocation): ScorePatch | null {
  const locator = eventLocator(score, loc);
  const event = getEventAtLocation(score, loc);
  if (!locator || event?.type !== "event") return null;
  if (event.slurs && event.slurs.length > 0) {
    return patch.setEventField(locator, { field: "slurs", value: undefined });
  }
  const targetEventId = findForwardSlurTargetId(score, loc);
  return targetEventId ? patch.setEventField(locator, { field: "slurs", value: [{ target: targetEventId }] }) : null;
}
