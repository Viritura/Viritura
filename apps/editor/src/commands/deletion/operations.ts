import type { Score } from "@viritura/core";
import { addressesWholeEvent } from "../../score/ElementPath";
import { parseElementType } from "../../score/elementTypes";
import { deleteAnnotation, deleteArpeggioByElementId, resolveDeletableAnnotationLocation } from "../deleteCommands";
import { removeAccidental } from "../accidentalCommands";
import { removeArticulation } from "../articulationDeletion";
import { removeCaesura, removeMarkings } from "../markingSelection";
import { deleteKeySignatureByElementId, deleteTimeSignaturesByElementIds } from "../signatureCommands";
import { deleteMeasureRepeatByElementId } from "../measureRepeatCommands";
import { removeLyricByElementId } from "../lyricCommands";
import { removeGlissandosByElementId } from "../glissandoCommands";
import { removeTrillExtensionByElementId } from "../../score/trillExtensionMutations";
import { expandCondensedSubElementIds } from "../../score/condensedWriteback";
import { cloneScore } from "../../score/scoreClone";
import { deleteTextFrameInScore, textFrameIdFromElementId, textFramesForScore } from "../../score/textFrameMutations";
import { removeTuplet } from "../tupletCommands";
import type { DeletionContext, DeletionOperation, DeletionTarget, DeletionTargetKind } from "./types";

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

function marking(remove: (score: Score, id: string) => Score | null): DeletionOperation {
  return {
    kind: "leaf",
    remove: (score, id, context) => {
      let changed = false;
      for (const target of expandCondensedSubElementIds(score, [id], context.scoreIndex, context.forceDirect)) {
        changed = remove(score, target) !== null || changed;
      }
      return changed ? score : null;
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
    remove: (score, id) => (id.startsWith("trill-line/") ? removeTrillExtensionByElementId(score, id) : null),
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
  fermata: unsupported("Fermata mutation exists but selection deletion is not yet wired."),
  ornament: unsupported("Ornament deletion will migrate from the keyboard adapter."),
  slur: unsupported("Slur deletion will migrate from the keyboard adapter."),
  tie: unsupported("Tie deletion will migrate from the keyboard adapter."),
  clef: unsupported("Protected clef deletion will migrate from the keyboard adapter."),
  fingering: unsupported("Individual fingering deletion is not implemented."),
  tremolo: unsupported("Delete the participating events or edit tremolo properties instead."),
  breath: unsupported("Breath deletion is not implemented."),
  barline: unsupported("Barline editing is structural, not element deletion."),
  "measure-number": unsupported("Measure numbering is structural, not element deletion."),
  beam: unsupported("Beam editing uses the beam commands."),
  unknown: unsupported("The rendered ID does not name a supported deletion target."),
};

export function resolveDeletionTarget(elementId: string): DeletionTarget {
  const marker = /^m\d+\/(segno|coda|fine)$/.exec(elementId)?.[1];
  if (marker === "segno" || marker === "coda" || marker === "fine") return { kind: marker, elementId };
  if (/^p\d+\/m\d+\/s\d+\/[^/]+\/grace\/[^/]+(?:\/n\d+)?$/.test(elementId)) {
    return { kind: "grace-note", elementId };
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
