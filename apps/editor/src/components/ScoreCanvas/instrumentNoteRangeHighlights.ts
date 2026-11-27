import {
  initialInstrumentState,
  listInstrumentChanges,
  pitchToMidi,
  walkSequenceEvents,
  type ActiveInstrumentState,
  type Score,
} from "@viritura/core";
import type { DisplayList, RenderCommand } from "@viritura/renderer";
import { sequenceEventTiming } from "../../commands/noteCommandsDurations";
import { classifyCatalogNoteRange, getCatalogInstrument, type CatalogInstrument } from "../../score/InstrumentCatalog";

export const OUT_OF_RANGE_NOTE_COLOR = "#C62828";
export const EXTENDED_RANGE_NOTE_COLOR = "#967500";

export function highlightOutOfRangeNoteheads(displayList: DisplayList, score: Score | null): DisplayList {
  if (!score) return displayList;
  const noteheadColors = collectNoteheadColors(score);
  if (noteheadColors.size === 0) return displayList;

  const highlighted: DisplayList = { ...displayList };
  applyHighlights(highlighted, displayList, noteheadColors);
  const finalizeRetainedFrame = displayList.finalizeRetainedFrame;
  if (finalizeRetainedFrame) {
    Object.defineProperty(highlighted, "finalizeRetainedFrame", {
      configurable: true,
      writable: true,
      value: () => {
        finalizeRetainedFrame();
        Object.assign(highlighted, displayList);
        delete highlighted.finalizeRetainedFrame;
        applyHighlights(highlighted, displayList, noteheadColors);
      },
    });
  }
  return highlighted;
}

function applyHighlights(target: DisplayList, source: DisplayList, noteheadColors: ReadonlyMap<string, string>): void {
  target.commands = highlightCommands(source, noteheadColors);

  if (!source.retainedRenderLayers) return;
  const retainedRenderLayers = source.retainedRenderLayers.map((layer) => {
    const layerCommands = highlightCommands(layer.displayList, noteheadColors);
    if (layerCommands === layer.displayList.commands) return layer;
    return { ...layer, displayList: { ...layer.displayList, commands: layerCommands } };
  });
  Object.defineProperty(target, "retainedRenderLayers", {
    configurable: true,
    writable: true,
    value: retainedRenderLayers,
  });
}

function collectNoteheadColors(score: Score): Map<string, string> {
  const colors = new Map<string, string>();
  score.parts.forEach((part, partIndex) => {
    const catalogForState = (state: ActiveInstrumentState) => {
      const instrumentId =
        state.instrumentKey !== undefined ? state.instrument?.instrumentId : part._x?.viritura?.instrumentId;
      return instrumentId ? getCatalogInstrument(instrumentId) : undefined;
    };
    const changes = listInstrumentChanges(part);
    let changeIndex = 0;
    let currentCatalog = catalogForState(initialInstrumentState(part));
    part.measures.forEach((measure, measureIndex) => {
      const measureChanges: { beat: number; catalog: CatalogInstrument | undefined }[] = [];
      while (changes[changeIndex]?.measureIndex === measureIndex) {
        const change = changes[changeIndex]!;
        measureChanges.push({
          beat: (change.position[0] / change.position[1]) * 4,
          catalog: catalogForState(change.state),
        });
        changeIndex++;
      }
      if (!currentCatalog && measureChanges.length === 0) return;

      measure.sequences.forEach((sequence, sequenceIndex) => {
        let eventIndex = 0;
        for (const { event, path } of walkSequenceEvents(sequence.content)) {
          const timing =
            path.length > 1 || measureChanges.length > 0
              ? sequenceEventTiming(sequence.content, path, event)
              : undefined;
          if (timing?.timing === "graceAnchor") continue;
          const suffix = (event.id ?? `__auto_m${measureIndex}_v${sequenceIndex}_e${eventIndex}`).replaceAll("/", "_");
          eventIndex++;
          let catalog = currentCatalog;
          if (timing) {
            for (const change of measureChanges) {
              if (change.beat > timing.onsetBeat + 1e-9) break;
              catalog = change.catalog;
            }
          }
          if (!catalog) continue;
          for (const [noteIndex, note] of (event.notes ?? []).entries()) {
            const range = classifyCatalogNoteRange(catalog, pitchToMidi(note.pitch));
            const color =
              range === "extension" ? EXTENDED_RANGE_NOTE_COLOR : range ? OUT_OF_RANGE_NOTE_COLOR : undefined;
            if (color) colors.set(`p${partIndex}/m${measureIndex}/s${sequenceIndex}/${suffix}/n${noteIndex}`, color);
          }
        }
      });
      if (measureChanges.length > 0) currentCatalog = measureChanges.at(-1)!.catalog;
    });
  });
  return colors;
}

function highlightCommands(displayList: DisplayList, noteheadColors: ReadonlyMap<string, string>): RenderCommand[] {
  let changed = false;
  const commands = displayList.commands.map((command, index) => {
    const color = noteheadColors.get(displayList.elementIds?.[index] ?? "");
    if (command.type !== "DrawGlyph" || !color) return command;
    changed = true;
    return { ...command, color };
  });
  return changed ? commands : displayList.commands;
}
