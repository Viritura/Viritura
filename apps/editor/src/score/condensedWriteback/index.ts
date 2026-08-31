import { walkSequenceEvents, type Score } from "@viritura/core";
import { produce } from "immer";
import type { SelectionState } from "../../store/selectionStore";
import {
  getEventAtLocation,
  resolveEventFromSubElement,
  resolveEventLocation,
  type EventLocation,
} from "../ElementPath";
import { detectCondensingMode, findCondensingStaff, getActiveLayoutId } from "../condensingRouter";
import { resolveSelectionEvents, resolveSelectionNotes } from "../../store/selectionUtils";

function locationKey(location: EventLocation): string {
  return [
    location.partIndex,
    location.measureIndex,
    location.sequenceIndex,
    location.tupletIndex ?? "",
    location.eventIndex,
  ].join("/");
}

type CondensedWritebackStrategy = "direct" | "broadcast";

export interface CondensedEventProvenance {
  /** The event named by the editable visual projection. */
  visualEvent: EventLocation;
  /** Canonical source events that produced the visual event. */
  sourceEvents: readonly EventLocation[];
  /** How an edit on the projection writes back to canonical source state. */
  strategy: CondensedWritebackStrategy;
}

export interface CondensedSelectionWritebackPlan {
  /** Provenance for each event in the visual selection. */
  events: readonly CondensedEventProvenance[];
  /** De-duplicated canonical targets for one atomic source transaction. */
  sourceEvents: readonly EventLocation[];
  /** Exact canonical note targets; noteIndex is retained for notehead selections. */
  sourceNotes: readonly EventLocation[];
}

interface EventWritebackOptions {
  /** A synthetic expansion staff always edits its named canonical source. */
  forceDirect?: boolean;
  /** Amalgamated chord notes retain source identity even though their events merge. */
  granularity?: "event" | "note";
}

/** Source part indices for the active visual staff, or the selected part alone. */
export function condensedStaffSourcePartIndices(score: Score, selectedScoreIndex: number, partIndex: number): number[] {
  const layoutId = getActiveLayoutId(score, selectedScoreIndex);
  return findCondensingStaff(score, layoutId, partIndex)?.sourcePartIndices ?? [partIndex];
}

/**
 * Build the write-back provenance for one event in the condensed projection.
 * Merged notation records every canonical contributor; divisi/solo notation
 * remains linked only to the source named by its visual element ID.
 */
export function planCondensedEventWriteback(
  score: Score,
  selectedScoreIndex: number,
  location: EventLocation,
  options: EventWritebackOptions = {},
): CondensedEventProvenance {
  if (options.forceDirect) {
    return { visualEvent: location, sourceEvents: [location], strategy: "direct" };
  }
  const layoutId = getActiveLayoutId(score, selectedScoreIndex);
  const staff = findCondensingStaff(score, layoutId, location.partIndex);
  if (!staff) {
    return { visualEvent: location, sourceEvents: [location], strategy: "direct" };
  }
  const mode = detectCondensingMode(score, staff, location.measureIndex);
  if (mode === "amalgamate" && options.granularity === "note") {
    return { visualEvent: location, sourceEvents: [location], strategy: "direct" };
  }
  if (mode !== "unison" && mode !== "amalgamate") {
    return { visualEvent: location, sourceEvents: [location], strategy: "direct" };
  }

  const targets = staff.sourcePartIndices
    .map((partIndex) => ({ ...location, partIndex }))
    .filter((target) => getEventAtLocation(score, target)?.type === "event");
  return targets.length > 0
    ? { visualEvent: location, sourceEvents: targets, strategy: "broadcast" }
    : { visualEvent: location, sourceEvents: [location], strategy: "direct" };
}

/** Build one atomic write-back plan for any editable selection shape. */
export function planCondensedSelectionWriteback(
  score: Score,
  selection: SelectionState,
  selectedScoreIndex: number,
): CondensedSelectionWritebackPlan {
  const forceDirect =
    (selection.kind === "single" || selection.kind === "range") && selection.measureAnchor?.isExpansion === true;
  const visualNotes = resolveSelectionNotes(selection, score).flatMap((target) =>
    target.notes === "all" ? [target.loc] : target.notes.map((noteIndex) => ({ ...target.loc, noteIndex })),
  );
  const events = visualNotes.map((location) =>
    planCondensedEventWriteback(score, selectedScoreIndex, location, {
      forceDirect,
      granularity: location.noteIndex === undefined ? "event" : "note",
    }),
  );
  const sourceNotes = events.flatMap((event) => event.sourceEvents);
  const sourceEvents = sourceNotes.map(({ noteIndex: _noteIndex, ...location }) => location);
  return {
    events,
    sourceEvents: [...new Map(sourceEvents.map((location) => [locationKey(location), location])).values()],
    sourceNotes: [
      ...new Map(
        sourceNotes.map((location) => [`${locationKey(location)}/${location.noteIndex ?? ""}`, location]),
      ).values(),
    ],
  };
}

/**
 * Plan write-back for either an individual-part view or a condensed projection.
 * Both views therefore feed the same canonical source transaction pipeline.
 */
export function planSelectionWriteback(
  score: Score,
  selection: SelectionState,
  selectedScoreIndex?: number,
): CondensedSelectionWritebackPlan {
  if (selectedScoreIndex !== undefined) {
    return planCondensedSelectionWriteback(score, selection, selectedScoreIndex);
  }
  const events = resolveSelectionEvents(selection, score).map<CondensedEventProvenance>((location) => ({
    visualEvent: location,
    sourceEvents: [location],
    strategy: "direct",
  }));
  const sourceEvents = events.map((event) => event.visualEvent);
  const sourceNotes = resolveSelectionNotes(selection, score).flatMap((target) =>
    target.notes === "all" ? [target.loc] : target.notes.map((noteIndex) => ({ ...target.loc, noteIndex })),
  );
  return { events, sourceEvents, sourceNotes };
}

/**
 * Apply one projection edit as an atomic canonical-source transaction. The
 * condensed score is not mutated or reverse-transformed; the next layout is
 * derived from the returned source model.
 */
export function applySelectionWriteback(
  score: Score,
  selection: SelectionState,
  mutate: (draft: Score, location: EventLocation) => void,
  selectedScoreIndex?: number,
): Score | null {
  const plan = planSelectionWriteback(score, selection, selectedScoreIndex);
  if (plan.sourceEvents.length === 0) return null;
  const nextScore = produce(score, (draft) => {
    for (const location of plan.sourceEvents) mutate(draft, location);
  });
  return nextScore !== score ? nextScore : null;
}

/** Compatibility accessor for command paths that only need canonical targets. */
export function resolveCondensedEventTargets(
  score: Score,
  selectedScoreIndex: number,
  location: EventLocation,
): EventLocation[] {
  return [...planCondensedEventWriteback(score, selectedScoreIndex, location).sourceEvents];
}

/** Compatibility accessor for command paths that only need canonical targets. */
export function resolveCondensedSelectionEvents(
  score: Score,
  selection: SelectionState,
  selectedScoreIndex: number,
): EventLocation[] {
  return [...planCondensedSelectionWriteback(score, selection, selectedScoreIndex).sourceEvents];
}

/** Resolve a selection while retaining exact notehead indices for pitch edits. */
export function resolveCondensedSelectionNotes(
  score: Score,
  selection: SelectionState,
  selectedScoreIndex: number,
): EventLocation[] {
  return [...planCondensedSelectionWriteback(score, selection, selectedScoreIndex).sourceNotes];
}

function eventElementId(score: Score, location: EventLocation): string | undefined {
  const event = getEventAtLocation(score, location);
  if (event?.type !== "event") return undefined;
  const suffix = event.id ?? `e${location.eventIndex}`;
  return `p${location.partIndex}/m${location.measureIndex}/s${location.sequenceIndex}/${suffix}`;
}

/**
 * Expand event-subobject IDs (articulations, ornaments, fingerings, etc.) to
 * parallel source IDs on a merged condensed staff.
 */
export function expandCondensedSubElementIds(
  score: Score,
  elementIds: readonly string[],
  selectedScoreIndex: number,
  forceDirect = false,
): string[] {
  const expanded = elementIds.flatMap((elementId) => {
    const location = resolveEventFromSubElement(elementId, score) ?? resolveEventLocation(elementId, score);
    if (!location) return [elementId];
    const sourcePrefix = eventElementId(score, location);
    if (!sourcePrefix || !elementId.startsWith(sourcePrefix)) return [elementId];
    const suffix = elementId.slice(sourcePrefix.length);
    const granularity = /\/(?:n|acc)\d+$/.test(elementId) ? "note" : "event";
    return planCondensedEventWriteback(score, selectedScoreIndex, location, {
      forceDirect,
      granularity,
    }).sourceEvents.flatMap((target) => {
      const targetPrefix = eventElementId(score, target);
      return targetPrefix ? [`${targetPrefix}${suffix}`] : [];
    });
  });
  return [...new Set(expanded)];
}

function findEventLocationByModelId(score: Score, eventId: string): EventLocation | undefined {
  for (let partIndex = 0; partIndex < score.parts.length; partIndex++) {
    const part = score.parts[partIndex]!;
    for (let measureIndex = 0; measureIndex < part.measures.length; measureIndex++) {
      const measure = part.measures[measureIndex]!;
      for (let sequenceIndex = 0; sequenceIndex < measure.sequences.length; sequenceIndex++) {
        const sequence = measure.sequences[sequenceIndex]!;
        if (![...walkSequenceEvents(sequence.content)].some(({ event }) => event.id === eventId)) continue;
        const location = resolveEventLocation(`p${partIndex}/m${measureIndex}/s${sequenceIndex}/${eventId}`, score);
        if (location) return location;
      }
    }
  }
  return undefined;
}

function findNoteLocation(score: Score, noteId: string): { event: EventLocation; noteIndex: number } | undefined {
  for (let partIndex = 0; partIndex < score.parts.length; partIndex++) {
    const part = score.parts[partIndex]!;
    for (let measureIndex = 0; measureIndex < part.measures.length; measureIndex++) {
      const measure = part.measures[measureIndex]!;
      for (let sequenceIndex = 0; sequenceIndex < measure.sequences.length; sequenceIndex++) {
        for (const { event } of walkSequenceEvents(measure.sequences[sequenceIndex]!.content)) {
          const noteIndex = event.notes?.findIndex((note) => note.id === noteId) ?? -1;
          if (noteIndex < 0 || !event.id) continue;
          const location = resolveEventLocation(`p${partIndex}/m${measureIndex}/s${sequenceIndex}/${event.id}`, score);
          if (location) return { event: location, noteIndex };
        }
      }
    }
  }
  return undefined;
}

/** Expand slur/tie connector IDs to parallel connectors on merged sources. */
export function expandCondensedSpannerIds(score: Score, elementId: string, selectedScoreIndex: number): string[] {
  const slur = elementId.match(/^slur\/([^/]+)\/([^/]+)$/);
  if (slur) {
    const source = findEventLocationByModelId(score, slur[1]!);
    const target = findEventLocationByModelId(score, slur[2]!);
    if (!source || !target) return [elementId];
    const sourceTargets = resolveCondensedEventTargets(score, selectedScoreIndex, source);
    const targetByPart = new Map(
      resolveCondensedEventTargets(score, selectedScoreIndex, target).map((location) => [location.partIndex, location]),
    );
    return sourceTargets.flatMap((sourceLocation) => {
      const targetLocation = targetByPart.get(sourceLocation.partIndex);
      const sourceEvent = getEventAtLocation(score, sourceLocation);
      const targetEvent = targetLocation && getEventAtLocation(score, targetLocation);
      return sourceEvent?.type === "event" && sourceEvent.id && targetEvent?.type === "event" && targetEvent.id
        ? [`slur/${sourceEvent.id}/${targetEvent.id}`]
        : [];
    });
  }

  const tie = elementId.match(/^tie\/([^/]+)\/([^/]+)$/);
  if (!tie) return [elementId];
  const source = findNoteLocation(score, tie[1]!);
  if (!source) return [elementId];
  const target = tie[2] === "lv" ? undefined : findNoteLocation(score, tie[2]!);
  const targetByPart = target
    ? new Map(
        resolveCondensedEventTargets(score, selectedScoreIndex, target.event).map((location) => [
          location.partIndex,
          location,
        ]),
      )
    : undefined;
  return resolveCondensedEventTargets(score, selectedScoreIndex, source.event).flatMap((sourceLocation) => {
    const sourceEvent = getEventAtLocation(score, sourceLocation);
    const sourceNote = sourceEvent?.type === "event" ? sourceEvent.notes?.[source.noteIndex] : undefined;
    const targetLocation = targetByPart?.get(sourceLocation.partIndex);
    const targetEvent = targetLocation && getEventAtLocation(score, targetLocation);
    const targetNote = target && targetEvent?.type === "event" ? targetEvent.notes?.[target.noteIndex] : undefined;
    if (!sourceNote?.id || (target && !targetNote?.id)) return [];
    return [`tie/${sourceNote.id}/${targetNote?.id ?? "lv"}`];
  });
}
