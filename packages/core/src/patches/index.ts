/**
 * `@viritura/core/patches` — the typed write surface for the Score model.
 *
 * Public API:
 *  - Types: `ScorePatch`, `ScorePatchKind`, `EventLocator`, `SequencePath`,
 *    plus per-variant interfaces for callers that need to construct patches
 *    via object literals.
 *  - Builders: `patch.*` — preferred way to construct patches.
 *  - Interpreter: `applyPatchesToScore`.
 *  - Errors: `PatchTargetMissing`.
 *
 * Note on collaboration: the Y.Doc projection lives in `@viritura/crdt` as
 * a schema-blind structural sync (`yProjection`), not in this package. The
 * editor's command pipeline calls `applyPatchesToScore` to mutate the
 * Score, the bridge re-serialises the post-edit MNX, and structural sync
 * computes the minimal Y.Doc deltas for peers.
 */

export type {
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
  ScorePatchKind,
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
export { patch, isPatchKind } from "./build";
export { applyPatchesToScore } from "./applyToScore";
export { PatchTargetMissing } from "./locate";
export { patchAffectedMeasures } from "./affectedMeasures";
