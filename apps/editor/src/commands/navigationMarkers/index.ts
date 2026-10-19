import type { Jump, RhythmicPosition, Score, SequenceContent } from "@viritura/core";
import type { Selection } from "../../store/selectionStore";
import { resolveSelectionEvents } from "../../store/selectionUtils";
import { resolveFullMeasureRestLocation } from "../../score/ElementPath";
import { sequenceContentBeats, durationToBeats } from "../noteCommands";
import { getActiveTimeSignature } from "../cursorCommands";
import { beatPositionToFraction } from "../../app/timedAnnotationPosition";
import { produce } from "../../score/scoreClone";

export type NavigationMarkerKind = "segno" | "coda" | "fine" | "jump";
export type NavigationMarkerCommand = { kind: "segno" | "coda" | "fine" } | { kind: "jump"; type: Jump["type"] };

export const JUMP_LABELS: Record<Jump["type"], string> = {
  dc: "D.C.",
  dcAlCoda: "D.C. al Coda",
  dcAlFine: "D.C. al Fine",
  dsAlCoda: "D.S. al Coda",
  dsAlFine: "D.S. al Fine",
  segno: "D.S.",
  toCoda: "To Coda",
};

/** Walk the selected content path, scaling each enclosing tuplet's musical time. */
function eventBoundary(content: readonly SequenceContent[], path: readonly number[], end: boolean): number {
  const index = path[0]!;
  const before = content.slice(0, index).reduce((sum, item) => sum + sequenceContentBeats(item), 0);
  const item = content[index];
  if (!item) return before;
  if (path.length === 1) return before + (end ? sequenceContentBeats(item) : 0);
  if (item.type === "grace") return before;
  if (item.type !== "tuplet" && item.type !== "tremolo") return before;
  const innerTime = item.content.reduce((sum, child) => sum + sequenceContentBeats(child), 0);
  const outerTime =
    item.type === "tuplet" ? item.outer.multiple * durationToBeats(item.outer.duration) : sequenceContentBeats(item);
  return before + eventBoundary(item.content, path.slice(1), end) * (innerTime > 0 ? outerTime / innerTime : 1);
}

function navigationMarkerPosition(score: Score, selection: Selection, concluding: boolean) {
  if (selection.kind === "single") {
    const fullRest = resolveFullMeasureRestLocation(selection.elementId, score);
    if (fullRest) {
      const time = getActiveTimeSignature(score, fullRest.measureIndex);
      return {
        measureIndex: fullRest.measureIndex,
        location: {
          fraction: concluding ? ([time.count, time.unit] as [number, number]) : ([0, 1] as [number, number]),
        },
      };
    }
    const match = selection.elementId.match(/^m(\d+)\/(barline|segno|coda|fine|jump)$/);
    if (match) {
      const boundary = Number(match[1]);
      if (match[2] !== "barline") {
        const marker = score.global.measures[boundary]?.[match[2] as NavigationMarkerKind];
        return marker ? { measureIndex: boundary, location: marker.location } : null;
      }
      const measureIndex = concluding ? boundary - 1 : boundary;
      if (!score.global.measures[measureIndex]) return null;
      const time = getActiveTimeSignature(score, measureIndex);
      return {
        measureIndex,
        location: {
          fraction: concluding ? ([time.count, time.unit] as [number, number]) : ([0, 1] as [number, number]),
        },
      };
    }
  }
  if (selection.kind === "measure") {
    const measureIndex = concluding
      ? Math.max(selection.startMeasure, selection.endMeasure)
      : Math.min(selection.startMeasure, selection.endMeasure);
    const time = getActiveTimeSignature(score, measureIndex);
    return {
      measureIndex,
      location: { fraction: concluding ? ([time.count, time.unit] as [number, number]) : ([0, 1] as [number, number]) },
    };
  }
  const positions = resolveSelectionEvents(selection, score)
    .flatMap((event) => {
      const sequence = score.parts[event.partIndex]?.measures[event.measureIndex]?.sequences[event.sequenceIndex];
      if (!sequence) return [];
      const path =
        event.contentPath ??
        (event.tupletIndex !== undefined ? [event.tupletIndex, event.eventIndex] : [event.eventIndex]);
      const beat = eventBoundary(sequence.content, path, concluding);
      return [{ measureIndex: event.measureIndex, beat }];
    })
    .sort((a, b) => a.measureIndex - b.measureIndex || a.beat - b.beat);
  const position = concluding ? positions.at(-1) : positions[0];
  return position
    ? { measureIndex: position.measureIndex, location: { fraction: beatPositionToFraction(position.beat) } }
    : null;
}

/** Uses the same immutable update path as the editor's undoable score commands. */
export function toggleNavigationMarker(score: Score, selection: Selection, command: NavigationMarkerCommand): Score {
  const position = navigationMarkerPosition(score, selection, command.kind === "fine" || command.kind === "jump");
  if (!position) return score;
  return produce(score, (draft) => {
    const measure = draft.global.measures[position.measureIndex];
    if (!measure) return;
    if (command.kind === "jump") {
      if (measure.jump?.type === command.type) delete measure.jump;
      else measure.jump = { ...measure.jump, type: command.type, location: position.location };
    } else if (measure[command.kind]) delete measure[command.kind];
    else measure[command.kind] = { location: position.location };
  });
}

export function setNavigationMarkerProperties(
  score: Score,
  measureIndex: number,
  kind: NavigationMarkerKind,
  properties: { location?: RhythmicPosition; glyph?: string | null; color?: string | null; type?: Jump["type"] },
): Score {
  const location = properties.location;
  if (
    location &&
    (!Number.isSafeInteger(location.fraction[0]) ||
      !Number.isSafeInteger(location.fraction[1]) ||
      location.fraction[0] < 0 ||
      location.fraction[1] <= 0)
  )
    return score;
  return produce(score, (draft) => {
    const marker = draft.global.measures[measureIndex]?.[kind];
    if (!marker) return;
    if (location) marker.location = location;
    if ("glyph" in marker || kind === "segno" || kind === "coda") {
      const glyphMarker = marker as { glyph?: string };
      if (properties.glyph === null) delete glyphMarker.glyph;
      else if (properties.glyph !== undefined) glyphMarker.glyph = properties.glyph;
    }
    if (kind === "jump") {
      if (properties.type) (marker as Jump).type = properties.type;
    } else {
      const colored = marker as { color?: string };
      if (properties.color === null) delete colored.color;
      else if (properties.color !== undefined) colored.color = properties.color;
    }
  });
}
