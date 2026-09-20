/**
 * useSelectionPruner — clears the current selection when its target
 * element no longer resolves in the score (e.g. after an edit deleted
 * or restructured the underlying event).
 *
 * Without this, selection IDs become stale: subsequent operations
 * either silently no-op or operate on the wrong element. See
 * SelectionContext.tsx — IDs without "/" are filtered, but valid-shape
 * IDs that point at deleted events were previously kept.
 */

import { useEffect } from "react";
import { walkSequenceEvents, type NoteEvent, type Score } from "@viritura/core";
import { useDocumentStoreApi } from "./DocumentContext";
import { useSelection, useSelectionActions } from "./selectionStore";
import {
  extractLyricLineId,
  getNoteEventAtLocation,
  resolveEventFromSubElement,
  resolveAnnotationLocation,
  resolveGraceLocation,
} from "../score/ElementPath";
import { articulationNamesInMarkings } from "../score/articulationNames";

/** True when the element ID still resolves against the current score. */
export function isSelectionIdValid(elementId: string, score: Score): boolean {
  if (!elementId.includes("/")) return false;
  if (elementId.startsWith("slur/")) return slurExists(elementId, score);
  if (elementId.startsWith("tie/")) return tieExists(elementId, score);
  if (elementId.startsWith("gliss/")) return glissandoExists(elementId, score);

  const graceMatch = elementId.match(/^(p\d+\/m\d+\/s\d+\/[^/]+\/grace\/[^/]+)(?:\/(.+))?$/);
  if (graceMatch) {
    const location = resolveGraceLocation(graceMatch[1]!, score);
    const event = location ? getGraceEvent(score, location) : undefined;
    return event ? !graceMatch[2] || eventSubElementExists(graceMatch[2], event) : false;
  }

  if (/^p\d+\/m\d+\/s\d+\//.test(elementId)) {
    const tuplet = elementId.match(/^p(\d+)\/m(\d+)\/s(\d+)\/tuplet(\d+)$/);
    if (tuplet) {
      const content =
        score.parts[Number(tuplet[1])]?.measures[Number(tuplet[2])]?.sequences[Number(tuplet[3])]?.content;
      return content?.filter((item) => item.type === "tuplet")[Number(tuplet[4])] !== undefined;
    }
    const location = resolveEventFromSubElement(elementId, score);
    const event = location ? getNoteEventAtLocation(score, location) : undefined;
    if (!event) return false;
    const suffix = elementId.split("/").slice(4).join("/");
    return suffix === "" || eventSubElementExists(suffix, event);
  }

  const annotation = resolveAnnotationLocation(elementId);
  if (annotation) return annotationExists(annotation, score);

  const partElement = elementId.match(/^p(\d+)\/m(\d+)\/(clef|key|beam|gracebeam|measurerepeat)(\d*)$/);
  if (partElement) return partElementExists(partElement, score);
  const globalElement = elementId.match(/^m(\d+)\/(time|barline|segno|coda|fine|jump|rehearsal|volta|mnum|mmrcount)$/);
  if (globalElement) return globalElementExists(globalElement, score);
  return false;
}

function eventSubElementExists(suffix: string, event: NoteEvent): boolean {
  const indexedNote = suffix.match(/^(?:n|acc)(\d+)$/);
  if (indexedNote) return event.notes?.[Number(indexedNote[1])] !== undefined;
  const articulationNames = articulationNamesInMarkings(event.markings);
  if (suffix === "artic") return articulationNames.length > 0;
  if (suffix.startsWith("art-")) return articulationNames.includes(suffix.slice(4));
  const exactChecks: Readonly<Record<string, boolean>> = {
    trem: event.markings?.tremolo !== undefined,
    ferm: event.fermata !== undefined,
    fermata: event.fermata !== undefined,
    ornament: (event.markings?.ornaments?.length ?? 0) > 0,
    trill: event.markings?.trill !== undefined,
    arp: event.markings?.arpeggio !== undefined,
    breath: event.markings?.breath !== undefined,
    caesura: event.markings?.caesura !== undefined,
  };
  if (suffix in exactChecks) return exactChecks[suffix]!;
  const fingering = suffix.match(/^fing(\d+)$/);
  if (fingering) return event.markings?.fingerings?.[Number(fingering[1])] !== undefined;
  if (suffix.startsWith("lyric-")) {
    const lineId = extractLyricLineId(`event/${suffix}`);
    return lineId !== null && event.lyrics?.lines?.[lineId] !== undefined;
  }
  const dot = suffix.match(/^dot\/\d+\/(\d+)$/);
  if (dot) return Number(dot[1]) < (event.duration.dots ?? 0);
  return false;
}

type AnnotationLocation = NonNullable<ReturnType<typeof resolveAnnotationLocation>>;

function annotationExists(location: AnnotationLocation, score: Score): boolean {
  if (location.kind === "global") return globalAnnotationExists(location, score);

  const measure = score.parts[location.partIndex ?? -1]?.measures[location.measureIndex];
  if (!measure) return false;
  const index = location.annotationIndex ?? -1;
  const id = location.annotationId;
  switch (location.type) {
    case "dyn":
    case "hairpin":
      return (
        measure.dynamics?.some(
          (item, itemIndex) =>
            (id !== undefined ? item.id === id : itemIndex === index) &&
            (location.type === "hairpin" ? item.type === "gradual" : item.type !== "gradual"),
        ) ?? false
      );
    case "expr":
      return measure.expressions?.[index] !== undefined;
    case "chord":
      return measure.chordSymbols?.[index] !== undefined;
    case "pedal":
      return measure.pedals?.[index] !== undefined;
    case "ottava":
      return measure.ottavas?.[index] !== undefined;
    default:
      return false;
  }
}

function globalAnnotationExists(location: AnnotationLocation, score: Score): boolean {
  const measure = score.global.measures[location.measureIndex];
  if (!measure) return false;
  switch (location.type) {
    case "tempo":
      return measure.tempos?.[location.annotationIndex ?? 0] !== undefined;
    case "chord":
      return measure.chordSymbols?.[location.annotationIndex ?? 0] !== undefined;
    case "rehearsal":
      return measure.rehearsalMark !== undefined;
    case "jump":
      return measure.jump !== undefined;
    case "volta":
      return measure.ending !== undefined;
    case "segno":
      return measure.segno !== undefined;
    case "coda":
      return measure.coda !== undefined;
    case "fine":
      return measure.fine !== undefined;
    case "mnum":
    case "barline":
      return true;
    default:
      return false;
  }
}

function partElementExists(match: RegExpMatchArray, score: Score): boolean {
  const measure = score.parts[Number(match[1])]?.measures[Number(match[2])];
  if (!measure) return false;
  switch (match[3]) {
    case "clef":
    case "key":
    case "beam":
    case "gracebeam":
      // These are engraving-derived: clefs and keys can be carried onto a new
      // system, while beam groups can be automatic. The owning measure is the
      // durable model boundary.
      return true;
    case "measurerepeat":
      return measure.measureRepeat !== undefined;
    default:
      return false;
  }
}

function globalElementExists(match: RegExpMatchArray, score: Score): boolean {
  const measure = score.global.measures[Number(match[1])];
  if (!measure) return false;
  switch (match[2]) {
    case "time":
    case "barline":
      // Time signatures can repeat at system starts and barlines have an
      // implicit default.
      return true;
    case "segno":
      return measure.segno !== undefined;
    case "coda":
      return measure.coda !== undefined;
    case "fine":
      return measure.fine !== undefined;
    case "jump":
      return measure.jump !== undefined;
    case "rehearsal":
      return measure.rehearsalMark !== undefined;
    case "volta":
      return measure.ending !== undefined;
    case "mnum":
    case "mmrcount":
      // Measure numbers have implicit defaults and MMR counts are
      // layout-derived.
      return true;
    default:
      return false;
  }
}

type GraceLocation = NonNullable<ReturnType<typeof resolveGraceLocation>>;

function getGraceEvent(score: Score, location: GraceLocation): NoteEvent | undefined {
  const sequence = score.parts[location.partIndex]?.measures[location.measureIndex]?.sequences[location.sequenceIndex];
  if (!sequence) return undefined;
  const container = location.tupletIndex === undefined ? undefined : sequence.content[location.tupletIndex];
  const parentContent =
    location.tupletIndex === undefined
      ? sequence.content
      : container?.type === "tuplet"
        ? container.content
        : undefined;
  const grace = parentContent?.[location.graceContainerIndex];
  return grace?.type === "grace" ? grace.content[location.graceNoteIndex] : undefined;
}

function tieExists(elementId: string, score: Score): boolean {
  const match = baseSpannerId(elementId).match(/^tie\/([^/]*)\/([^/]+)$/);
  if (!match) return false;
  const sourceId = match[1]!;
  const targetId = match[2]!;
  for (const part of score.parts) {
    for (const measure of part.measures) {
      for (const sequence of measure.sequences) {
        for (const { event } of walkSequenceEvents(sequence.content)) {
          const source = event.notes?.find((note) => note.id?.replace(/\//g, "_") === sourceId);
          if (!source?.ties?.length) continue;
          if (targetId === "lv" && source.ties.some((tie) => tie.lv)) return true;
          if (source.ties.some((tie) => tie.target?.replace(/\//g, "_") === targetId)) return true;
        }
      }
    }
  }
  return false;
}

function slurExists(elementId: string, score: Score): boolean {
  return connectionExists(elementId, "slur", score, (event, targetId) =>
    event.slurs?.some((slur) => slur.target.replace(/\//g, "_") === targetId),
  );
}

function glissandoExists(elementId: string, score: Score): boolean {
  return connectionExists(elementId, "gliss", score, (event, targetId) =>
    event.glissandos?.some((glissando) => glissando.target.replace(/\//g, "_") === targetId),
  );
}

function connectionExists(
  elementId: string,
  prefix: "slur" | "gliss",
  score: Score,
  matchesTarget: (event: NoteEvent, targetId: string) => boolean | undefined,
): boolean {
  const match = baseSpannerId(elementId).match(new RegExp(`^${prefix}/([^/]*)/([^/]+)$`));
  if (!match) return false;
  const sourceId = match[1]!;
  const targetId = match[2]!;
  for (const part of score.parts) {
    for (const measure of part.measures) {
      for (const sequence of measure.sequences) {
        for (const { event } of walkSequenceEvents(sequence.content)) {
          if (event.id?.replace(/\//g, "_") !== sourceId) continue;
          if (matchesTarget(event, targetId)) return true;
        }
      }
    }
  }
  return false;
}

function baseSpannerId(elementId: string): string {
  return elementId.replace(/\/(?:lh|rh|mid\/\d+)$/, "");
}

export function useSelectionPruner(): void {
  const store = useDocumentStoreApi();
  const selection = useSelection();
  const { clearSelection } = useSelectionActions();

  useEffect(() => {
    return store.subscribe((state, prev) => {
      if (state.score === prev.score) return;
      const score = state.score;
      if (!score) return;

      const ids: string[] =
        selection.kind === "single"
          ? [selection.elementId]
          : selection.kind === "range"
            ? [selection.startElementId, selection.endElementId]
            : selection.kind === "multi"
              ? [...selection.elementIds]
              : [];

      if (ids.length === 0) return;
      const allValid = ids.every((id) => isSelectionIdValid(id, score));
      if (!allValid) {
        console.debug("[Selection] Pruning stale selection after score change:", ids);
        clearSelection();
      }
    });
  }, [store, selection, clearSelection]);
}
