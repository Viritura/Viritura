import {
  collectMeasureEventSpans,
  projectGlobalFermata,
  walkSequenceEvents,
  type NoteEvent,
  type Score,
  type SequenceContent,
} from "@viritura/core";
import type { ClipboardSelection } from "../../commands/clipboardCommands";
import { mergeGlobalFermata } from "../../commands/globalFermatas";
import { beatPositionToFraction } from "../../app/timedAnnotationPosition";
import { getActiveTimeSignature } from "../../commands/cursorCommands";

const CLIPBOARD_FERMATA_MARKER = "clipboard-projection";

interface ClipboardFermataVendor {
  [key: string]: unknown;
  globalFermataId?: string;
  localOnly?: boolean;
  clipboardFermataOffsets?: [number, number][];
}

export function projectedClipboardEvent(event: NoteEvent, offsets: [number, number][] = [[0, 1]]): NoteEvent {
  const copy = structuredClone(event);
  const local = copy.fermata;
  const vendor: ClipboardFermataVendor = {
    ...local?._x?.viritura,
    globalFermataId: CLIPBOARD_FERMATA_MARKER,
    localOnly: local !== undefined,
    clipboardFermataOffsets: offsets,
  };
  copy.fermata = {
    ...(local ?? {}),
    _x: {
      ...local?._x,
      viritura: vendor,
    },
  };
  return copy;
}

export function captureProjectedFermatas(score: Score, selection: ClipboardSelection): ClipboardSelection {
  const projected = new Map<NoteEvent, [number, number][]>();
  const ids = new Map<string, [number, number][]>();
  for (const [mi, measure] of score.global.measures.entries()) {
    for (const fermata of measure.fermatas ?? []) {
      for (const span of projectGlobalFermata(score, mi, fermata)) {
        if (!span.event) continue;
        const offsets = projected.get(span.event) ?? [];
        offsets.push(
          beatPositionToFraction((fermata.position.fraction[0] / fermata.position.fraction[1]) * 4 - span.onset),
        );
        projected.set(span.event, offsets);
        if (span.event.id) ids.set(span.event.id, offsets);
      }
    }
  }
  const capture = (content: SequenceContent[]): SequenceContent[] => {
    const copy = structuredClone(content);
    const originals = [...walkSequenceEvents(content)];
    for (const [index, { event }] of [...walkSequenceEvents(copy)].entries()) {
      const source = originals[index]!.event;
      const offsets = projected.get(source) ?? (source.id ? ids.get(source.id) : undefined);
      if (!offsets) continue;
      event.fermata = projectedClipboardEvent(event, offsets).fermata;
    }
    return copy;
  };
  return {
    ...selection,
    events: capture(selection.events),
    ...(selection.tracks
      ? { tracks: selection.tracks.map((track) => ({ ...track, content: capture(track.content) })) }
      : {}),
  };
}

export function materializePastedFermatas(score: Score): void {
  for (const [mi] of score.global.measures.entries()) {
    for (const span of collectMeasureEventSpans(score, mi)) {
      const event = span.event;
      const marker = event?.fermata?._x?.viritura as ClipboardFermataVendor | undefined;
      if (!event || marker?.globalFermataId !== CLIPBOARD_FERMATA_MARKER) continue;
      for (const fraction of marker.clipboardFermataOffsets ?? [[0, 1]]) {
        const offset = (fraction[0] / fraction[1]) * 4;
        if (!Number.isFinite(offset) || offset < 0) continue;
        let targetMeasure = mi;
        let beat = span.onset + offset;
        while (targetMeasure < score.global.measures.length) {
          const time = getActiveTimeSignature(score, targetMeasure);
          const duration = (time.count * 4) / time.unit;
          if (beat < duration - 1e-9) {
            mergeGlobalFermata(score, targetMeasure, { fraction: beatPositionToFraction(beat) });
            break;
          }
          beat -= duration;
          targetMeasure++;
        }
      }
      if (!marker.localOnly) delete event.fermata;
      else {
        delete marker.globalFermataId;
        delete marker.clipboardFermataOffsets;
      }
    }
  }
}
