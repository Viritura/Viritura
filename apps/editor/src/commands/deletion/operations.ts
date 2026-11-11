import type { Score } from "@viritura/core";
import { addressesWholeEvent, eventId, eventSuffix, resolveFullMeasureRestLocation } from "../../score/ElementPath";
import { parseElementType } from "../../score/elementTypes";
import {
  deleteAnnotation,
  deleteAnnotations,
  expandCondensedDynamicLocations,
  deleteArpeggioByElementId,
  resolveDeletableAnnotationLocation,
} from "../deleteCommands";
import { removeAccidental } from "../accidentalCommands";
import { removeArticulation } from "../articulationDeletion";
import { removeCaesura, removeMarkings } from "../markingSelection";
import { deleteKeySignatureByElementId, deleteTimeSignaturesByElementIds } from "../signatureCommands";
import { deleteMeasureRepeatByElementId } from "../measureRepeatCommands";
import { removeLyricByElementId } from "../lyricCommands";
import { removeGlissandosByElementId } from "../glissandoCommands";
import { removeTrillExtensionByElementId } from "../../score/trillExtensionMutations";
import {
  expandCondensedSpannerIds,
  expandCondensedSubElementIds,
  resolveCondensedFullMeasureRestTargets,
} from "../../score/condensedWriteback";
import { cloneScore } from "../../score/scoreClone";
import { deleteTextFrameInScore, textFrameIdFromElementId, textFramesForScore } from "../../score/textFrameMutations";
import { removeTuplet } from "../tupletCommands";
import type { DeletionContext, DeletionOperation, DeletionTarget, DeletionTargetKind } from "./types";
import { deleteClefByElementId, deleteSlurByElementId, deleteTieByElementId } from "./structuralTargets";
import { removeEventOrnament, removeFermata } from "./eventLeaves";

const annotation: DeletionOperation = {
  kind: "leaf",
  remove: (score, id, context) => {
    const location = resolveDeletableAnnotationLocation(id);
    return location ? deleteAnnotation(score, location, context.forceDirect ? undefined : context.scoreIndex) : null;
  },
};

function unsupported(reason: string): DeletionOperation {
  return { kind: "unsupported", reason };
}

function marking(remove: (score: Score, id: string) => Score | null): Extract<DeletionOperation, { kind: "leaf" }> {
  return {
    kind: "leaf",
    remove: (score, id, context) => {
      let changed = false;
      for (const target of markingTargets(score, id, context)) {
        changed = remove(score, target) !== null || changed;
      }

      return changed ? score : null;
    },
  };
}

function markingTargets(score: Score, id: string, context: DeletionContext): string[] {
  const rest = id.endsWith("/ferm") ? resolveFullMeasureRestLocation(id, score) : null;
  if (rest && !context.forceDirect) {
    return resolveCondensedFullMeasureRestTargets(score, context.scoreIndex, rest).map(
      (location) =>
        `${eventId(
          location.partIndex,
          location.measureIndex,
          location.sequenceIndex,
          eventSuffix(undefined, 0, location.measureIndex, location.sequenceIndex),
        )}/ferm`,
    );
  }
  return expandCondensedSubElementIds(score, [id], context.scoreIndex, context.forceDirect);
}

const ornament = marking(removeEventOrnament);

function connector(remove: (score: Score, id: string) => Score | null): DeletionOperation {
  return {
    kind: "leaf",
    remove: (score, id, context) => {
      let next = score;
      let changed = false;
      const ids = context.forceDirect ? [id] : expandCondensedSpannerIds(score, id, context.scoreIndex);
      for (const target of new Set(ids)) {
        const candidate = remove(next, target);
        if (candidate) {
          next = candidate;
          changed = true;
        }
      }
      return changed ? next : null;
    },
  };
}

export const deletionOperations: Record<DeletionTargetKind, DeletionOperation> = {
  event: { kind: "event" },
  note: { kind: "event" },
  rest: { kind: "event" },
  "grace-note": { kind: "event" },
  articulation: marking(removeArticulation),
  accidental: marking(removeAccidental),
  caesura: marking(removeCaesura),
  "note-marking": {
    kind: "leaf",
    remove: (score, id, context) =>
      removeMarkings(score, expandCondensedSubElementIds(score, [id], context.scoreIndex, context.forceDirect))
        ? score
        : null,
  },
  "chord-symbol": annotation,
  dynamic: annotation,
  hairpin: annotation,
  pedal: annotation,
  ottava: annotation,
  expression: annotation,
  "system-text": annotation,
  tempo: annotation,
  rehearsal: annotation,
  jump: annotation,
  volta: annotation,
  segno: annotation,
  coda: annotation,
  fine: annotation,
  glissando: {
    kind: "leaf",
    remove: (score, id, context) => removeGlissandosByElementId(score, [id], context.scoreIndex, context.forceDirect),
  },
  trill: {
    kind: "leaf",
    remove: (score, id, context) =>
      id.startsWith("trill-line/") ? removeTrillExtensionByElementId(score, id) : ornament.remove(score, id, context),
  },
  lyric: { kind: "leaf", remove: removeLyricByElementId },
  arpeggio: { kind: "leaf", remove: deleteArpeggioByElementId },
  "measure-repeat": { kind: "leaf", remove: deleteMeasureRepeatByElementId },
  "key-signature": { kind: "leaf", remove: deleteKeySignatureByElementId },
  "time-signature": { kind: "leaf", remove: (score, id) => deleteTimeSignaturesByElementIds(score, [id]) },
  "text-frame": {
    kind: "leaf",
    remove: (score, id, context) => {
      const frameId = textFrameIdFromElementId(id, textFramesForScore(score, context.scoreIndex));
      return frameId ? deleteTextFrameInScore(score, context.scoreIndex, frameId) : null;
    },
  },
  tuplet: {
    kind: "leaf",
    remove: (score, id) => {
      const match = /^p(\d+)\/m(\d+)\/s(\d+)\/tuplet(\d+)$/.exec(id);
      if (!match) return null;
      return removeTuplet(score, {
        partIndex: Number(match[1]),
        measureIndex: Number(match[2]),
        voice: Number(match[3]),
        tupletOrdinal: Number(match[4]),
      })
        ? score
        : null;
    },
  },
  fermata: marking(removeFermata),
  ornament: marking(removeEventOrnament),
  slur: connector(deleteSlurByElementId),
  tie: connector(deleteTieByElementId),
  clef: { kind: "leaf", remove: deleteClefByElementId },
  fingering: unsupported("Individual fingering deletion is not implemented."),
  tremolo: unsupported("Delete the participating events or edit tremolo properties instead."),
  breath: unsupported("Breath deletion is not implemented."),
  barline: unsupported("Barline editing is structural, not element deletion."),
  "measure-number": unsupported("Measure numbering is structural, not element deletion."),
  beam: unsupported("Beam editing uses the beam commands."),
  unknown: unsupported("The rendered ID does not name a supported deletion target."),
};

export function resolveDeletionTarget(elementId: string): DeletionTarget {
  if (/^p\d+\/m\d+\/s\d+\/tuplet\d+$/.test(elementId)) return { kind: "tuplet", elementId };
  if (/^slur\/[^/]+\/[^/]+$/.test(elementId)) return { kind: "slur", elementId };
  if (/^tie\/[^/]+\/[^/]+$/.test(elementId)) return { kind: "tie", elementId };
  const marker = /^m\d+\/(segno|coda|fine)$/.exec(elementId)?.[1];
  if (marker === "segno" || marker === "coda" || marker === "fine") return { kind: marker, elementId };
  if (/^p\d+\/m\d+\/s\d+\/[^/]+\/grace\/[^/]+(?:\/n\d+)?$/.test(elementId)) {
    return { kind: "grace-note", elementId };
  }
  if (addressesWholeEvent(elementId)) {
    return { kind: /\/n\d+$/.test(elementId) ? "note" : "event", elementId };
  }
  // Classification is presentation-oriented and defaults to event. The stricter
  // address guard must remain authoritative for unknown event subobjects.
  const parsed = parseElementType(elementId);
  const kind = parsed === "event" && !addressesWholeEvent(elementId) ? "unknown" : parsed;
  return { kind, elementId };
}

export function deleteLeafTarget(score: Score, target: DeletionTarget, context: DeletionContext): Score | null {
  const operation = deletionOperations[target.kind];
  if (operation.kind !== "leaf") return null;
  return operation.remove(cloneScore(score), target.elementId, context);
}

export function deleteLeafTargets(score: Score, elementIds: readonly string[], context: DeletionContext): Score | null {
  const targets = [...new Set(elementIds)].map(resolveDeletionTarget);
  const annotations = targets.flatMap((target) => {
    const operation = deletionOperations[target.kind];
    const location = operation === annotation ? resolveDeletableAnnotationLocation(target.elementId) : null;
    return location ? [location] : [];
  });
  let next = score;
  let changed = false;
  if (annotations.length > 0) {
    const locations = context.forceDirect
      ? annotations
      : expandCondensedDynamicLocations(score, annotations, context.scoreIndex);
    const candidate = deleteAnnotations(next, locations);
    if (candidate) {
      next = candidate;
      changed = true;
    }
  }
  // Positional tuplet/lyric IDs must run backwards; duplicate rendered copies
  // of annotations were already coalesced by deleteAnnotations.
  const ordered = targets.sort((a, b) => b.elementId.localeCompare(a.elementId, undefined, { numeric: true }));
  for (const target of ordered) {
    if (deletionOperations[target.kind] === annotation) continue;
    const candidate = deleteLeafTarget(next, target, context);
    if (candidate) {
      next = candidate;
      changed = true;
    }
  }
  return changed ? next : null;
}
