/**
 * Builder helpers for ScorePatch variants.
 *
 * Equivalent in spirit to a constructor; using plain functions keeps the
 * patches as bare JSON-safe data. Callers should prefer these over inline
 * object literals to get the field-name discipline of named parameters and a
 * single place to evolve a variant's shape.
 */

import type { Pitch } from "../model/pitch";
import type { Markings, Note, SequenceContent } from "../model/event";
import type { DynamicGroup, GlobalMeasure, IdPair, RhythmicPosition } from "../model/measure";
import type { Part } from "../model/part";
import type { ScoreMetadata } from "../model/score";
import type {
  AddNoteToEventPatch,
  AddPartPatch,
  ArpeggioMarkKind,
  EventLocator,
  EventScalarField,
  GlobalMeasureField,
  InsertMeasuresPatch,
  MeasurePath,
  NoteScalarField,
  PartField,
  PartMeasureField,
  RemoveMeasuresPatch,
  RemoveNoteFromEventPatch,
  RemovePartPatch,
  ScoreExtensionField,
  ScorePatch,
  SequencePath,
  SetEventFieldPatch,
  SetEventMarkingPatch,
  SetGlobalMeasureFieldPatch,
  SetMeasureArpeggioPatch,
  SetMeasureDynamicGroupPatch,
  SetNoteFieldPatch,
  SetNotePitchPatch,
  SetPartFieldPatch,
  SetPartMeasureFieldPatch,
  SetScoreExtensionPatch,
  SetScoreMetadataPatch,
  SetSequenceContentPatch,
  SpliceSequenceContentPatch,
} from "./types";

export const patch = {
  setNotePitch(locator: EventLocator, noteId: string, pitch: Pitch): SetNotePitchPatch {
    return { kind: "setNotePitch", locator, noteId, pitch };
  },

  setNoteField(locator: EventLocator, noteId: string, update: NoteScalarField): SetNoteFieldPatch {
    return { kind: "setNoteField", locator, noteId, update };
  },

  addNoteToEvent(locator: EventLocator, note: Note, index?: number): AddNoteToEventPatch {
    return { kind: "addNoteToEvent", locator, note, ...(index === undefined ? {} : { index }) };
  },

  removeNoteFromEvent(locator: EventLocator, noteId: string): RemoveNoteFromEventPatch {
    return { kind: "removeNoteFromEvent", locator, noteId };
  },

  setEventField(locator: EventLocator, update: EventScalarField): SetEventFieldPatch {
    return { kind: "setEventField", locator, update };
  },

  setEventMarking<K extends keyof Markings>(
    locator: EventLocator,
    markingKey: K,
    value: Markings[K] | undefined,
  ): SetEventMarkingPatch {
    return { kind: "setEventMarking", locator, markingKey, value };
  },

  setMeasureDynamicGroup(
    measurePath: MeasurePath,
    groupId: string,
    value: DynamicGroup | undefined,
  ): SetMeasureDynamicGroupPatch {
    return { kind: "setMeasureDynamicGroup", measurePath, groupId, value };
  },

  setMeasureArpeggio(
    measurePath: MeasurePath,
    position: RhythmicPosition,
    span: IdPair,
    mark: ArpeggioMarkKind | undefined,
  ): SetMeasureArpeggioPatch {
    return { kind: "setMeasureArpeggio", measurePath, position, span, mark };
  },

  spliceSequenceContent(args: {
    sequencePath: SequencePath;
    removeFromEventId: string;
    removeToEventId: string;
    insert: SequenceContent[];
  }): SpliceSequenceContentPatch {
    return {
      kind: "spliceSequenceContent",
      sequencePath: args.sequencePath,
      removeFromEventId: args.removeFromEventId,
      removeToEventId: args.removeToEventId,
      insert: args.insert,
    };
  },

  setGlobalMeasureField(measureIndex: number, update: GlobalMeasureField): SetGlobalMeasureFieldPatch {
    return { kind: "setGlobalMeasureField", measureIndex, update };
  },

  insertMeasures(atIndex: number, globalMeasures: GlobalMeasure[]): InsertMeasuresPatch {
    return { kind: "insertMeasures", atIndex, globalMeasures };
  },

  removeMeasures(startIndex: number, count: number): RemoveMeasuresPatch {
    return { kind: "removeMeasures", startIndex, count };
  },

  setPartMeasureField(measurePath: MeasurePath, update: PartMeasureField): SetPartMeasureFieldPatch {
    return { kind: "setPartMeasureField", measurePath, update };
  },

  setSequenceContent(sequencePath: SequencePath, content: SequenceContent[]): SetSequenceContentPatch {
    return { kind: "setSequenceContent", sequencePath, content };
  },

  addPart(part: Part, index?: number): AddPartPatch {
    return { kind: "addPart", part, ...(index === undefined ? {} : { index }) };
  },

  removePart(partId: string): RemovePartPatch {
    return { kind: "removePart", partId };
  },

  setPartField(partId: string, update: PartField): SetPartFieldPatch {
    return { kind: "setPartField", partId, update };
  },

  setScoreMetadata(value: ScoreMetadata | undefined): SetScoreMetadataPatch {
    return { kind: "setScoreMetadata", value };
  },

  setScoreExtension(update: ScoreExtensionField): SetScoreExtensionPatch {
    return { kind: "setScoreExtension", update };
  },
} as const;

/** Type guard / narrowing helper. */
export function isPatchKind<K extends ScorePatch["kind"]>(
  p: ScorePatch,
  kind: K,
): p is Extract<ScorePatch, { kind: K }> {
  return p.kind === kind;
}
