/**
 * textFrameContext — relates frames to the musical/page context the user is
 * looking at. Horizon mode paints no pages, so every frame is hidden there;
 * musically located frames are surfaced next to their measure and page-index
 * frames through a document-level list.
 */

import { plainTextContent, type Score, type TextFrame, type TextFrameLocator } from "@viritura/core";
import { extractMeasureIndex, getEventAtLocation, resolveEventLocation } from "../../score/ElementPath";
import { textFrameLocatorMeasureIndex, textFrameLocatorResolvesInView } from "../../score/textFrameMutations";
export { textFrameElementId, textFrameIdFromElementId } from "../../score/textFrameMutations";
import type { useSelection } from "../../store/selectionStore";
import { buildNavigationIndex } from "../../navigation/NavigationIndex";
import { beatPositionToFraction } from "../../app/timedAnnotationPosition";
import type { StaffTextDestination } from "../../score/textFrameAttachment";

type Selection = ReturnType<typeof useSelection>;

export function selectedStaffDestination(score: Score, selection: Selection): StaffTextDestination | undefined {
  if (selection.kind === "measure") {
    const staffIndex = selection.startLocalStaffIndex ?? selection.startStaffIndex;
    return {
      partIndex: selection.startPartIndex,
      measureIndex: selection.startMeasure,
      expression: { position: { fraction: [0, 1] }, staff: staffIndex + 1, placement: "above" },
    };
  }
  if (selection.kind !== "single") return undefined;
  const location = resolveEventLocation(selection.elementId, score);
  if (!location) return undefined;
  const event = getEventAtLocation(score, location);
  const entry = buildNavigationIndex(score).entries.find((candidate) => {
    const target = resolveEventLocation(candidate.elementId, score);
    return (
      target &&
      target.partIndex === location.partIndex &&
      target.measureIndex === location.measureIndex &&
      target.sequenceIndex === location.sequenceIndex &&
      getEventAtLocation(score, target) === event
    );
  });
  if (!entry) return undefined;
  const sequence = score.parts[location.partIndex]!.measures[location.measureIndex]!.sequences[location.sequenceIndex]!;
  return {
    partIndex: location.partIndex,
    measureIndex: location.measureIndex,
    expression: {
      position: { fraction: beatPositionToFraction(entry.sortKey) },
      staff: sequence.staff ?? 1,
      ...(sequence.voice ? { voice: sequence.voice } : {}),
      placement: "above",
    },
  };
}

/** The musical location the current selection points at. */
export interface SelectionMusicalContext {
  measureIndex: number;
  /** Event locator for a selected event that carries a stable MNX ID. */
  eventLocator?: Extract<TextFrameLocator, { type: "event" }>;
}

function eventLocatorFor(score: Score, elementId: string): SelectionMusicalContext["eventLocator"] {
  const location = resolveEventLocation(elementId, score);
  if (!location) return undefined;
  const event = getEventAtLocation(score, location);
  const partId = score.parts[location.partIndex]?.id;
  if (event?.type !== "event" || !event.id || !partId) return undefined;
  return { type: "event", partId, eventId: event.id };
}

export function selectionMusicalContext(selection: Selection, score: Score | null): SelectionMusicalContext | null {
  if (!score) return null;
  switch (selection.kind) {
    case "none":
      return null;
    case "measure":
      return { measureIndex: selection.startMeasure };
    case "single": {
      const measureIndex = selection.measureAnchor?.measureIndex ?? extractMeasureIndex(selection.elementId);
      if (measureIndex === undefined) return null;
      const eventLocator = eventLocatorFor(score, selection.elementId);
      return eventLocator ? { measureIndex, eventLocator } : { measureIndex };
    }
    case "range": {
      const measureIndex = selection.measureAnchor?.measureIndex ?? extractMeasureIndex(selection.startElementId);
      return measureIndex === undefined ? null : { measureIndex };
    }
    case "multi": {
      const first = selection.elementIds[0];
      const measureIndex =
        selection.measureAnchor?.measureIndex ??
        selection.rhythmicRange?.start.measureIndex ??
        (first ? extractMeasureIndex(first) : undefined);
      return measureIndex === undefined ? null : { measureIndex };
    }
  }
}

/** Frames whose measure or event locator resolves in this view to `measureIndex`, in paint order. */
export function framesAtMeasure(
  score: Score,
  scoreIndex: number,
  frames: readonly TextFrame[],
  measureIndex: number,
): TextFrame[] {
  return frames.filter(
    (frame) =>
      textFrameLocatorResolvesInView(score, scoreIndex, frame.locator) &&
      textFrameLocatorMeasureIndex(score, frame.locator) === measureIndex,
  );
}

/** IDs of frames whose measure/event target is missing from this view; they are authored but not drawn. */
export function unplacedFrameIds(
  score: Score,
  scoreIndex: number,
  frames: readonly TextFrame[],
  pageCount: number | null = null,
): Set<string> {
  return new Set(
    frames
      .filter(
        (frame) =>
          !textFrameLocatorResolvesInView(score, scoreIndex, frame.locator) ||
          (frame.locator.type === "page" && pageCount !== null && frame.locator.pageIndex >= pageCount),
      )
      .map((frame) => frame.id),
  );
}

/** Frames located directly by page index, in paint order. */
export function pageIndexFrames(frames: readonly TextFrame[]): TextFrame[] {
  return frames.filter((frame) => frame.locator.type === "page");
}

/** Human-readable locator summary. Measure numbers are 1-based for display. */
export function describeTextFrameLocator(score: Score, locator: TextFrameLocator): string {
  if (locator.type === "page") return `Page ${locator.pageIndex + 1}`;
  const measureIndex = textFrameLocatorMeasureIndex(score, locator);
  if (locator.type === "globalMeasure") {
    return measureIndex === null ? "Measure (missing target)" : `Measure ${measureIndex + 1}`;
  }
  const part = score.parts.find((candidate) => candidate.id === locator.partId);
  const where = measureIndex === null ? "missing target" : `measure ${measureIndex + 1}`;
  return `Event in ${part?.name ?? locator.partId}, ${where}`;
}

/** One-line preview of a frame's text for lists. */
export function textFramePreview(frame: TextFrame): string {
  const text = plainTextContent(frame.content).replace(/\s+/g, " ").trim();
  return text.length > 0 ? text : "(empty frame)";
}

/**
 * Alignment the layout engine applies when `horizontalAlignment` is absent:
 * the frame side matching its page anchor (top/bottom anchors centre it).
 */
export function effectiveHorizontalAlignment(frame: TextFrame): NonNullable<TextFrame["horizontalAlignment"]> {
  if (frame.horizontalAlignment) return frame.horizontalAlignment;
  const { anchor } = frame.placement;
  if (anchor === "left" || anchor.endsWith("-left")) return "left";
  if (anchor === "right" || anchor.endsWith("-right")) return "right";
  return "center";
}
