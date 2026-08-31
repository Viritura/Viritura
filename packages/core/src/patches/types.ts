/**
 * ScorePatch — the discriminated-union write surface for the Score model.
 *
 * Every command that mutates the Score does so by returning a `ScorePatch[]`,
 * which is then applied by `applyPatchesToScore` (Immer-based). The CRDT
 * layer lives in `@viritura/crdt` and works on MNX JSON via a schema-blind
 * structural sync — patches do not need a separate Y-transaction
 * interpreter.
 *
 * Design rules:
 *  1. Patches are pure data. No methods, no class instances. They must be
 *     `JSON.stringify`-able and `structuredClone`-able without loss.
 *  2. Patches identify their target by **MNX id** wherever possible
 *     (`partId`, `measureId`, `eventId`, `noteId`). Index-based addressing is
 *     only used for sequences (per-voice content arrays), where MNX ids on
 *     children are sufficient for the CRDT mapping to identify positions.
 *  3. New variants extend the union; the interpreter's exhaustive `switch`
 *     will surface every site that needs updating at compile time.
 */

import type { Pitch } from "../model/pitch";
import type {
  AccidentalDisplay,
  Duration,
  Fermata,
  Markings,
  Note,
  Orientation,
  SequenceContent,
  Slur,
  Tie,
  Written,
} from "../model/event";
import type {
  DynamicGroup,
  Ending,
  GlobalMeasure,
  IdPair,
  RepeatEnd,
  RepeatStart,
  RhythmicPosition,
  Tempo,
} from "../model/measure";
import type { PositionedClef } from "../model/clef";
import type { TimeSignature } from "../model/time";
import type { KeySignature } from "../model/key";
import type { Barline } from "../model/barline";
import type { Part, Transposition } from "../model/part";
import type { ScoreMetadata, SoundProfileAssignment, TextStyles, VideoSyncSettings } from "../model/score";
import type { StemDirection } from "../enums";

// ─────────────────────────────────────────────────────────────────────────────
// Path types — addresses inside the Score tree.
//
// Sequences and tuplet-inner content are addressed by structural path because
// a "voice within a measure within a part" has no first-class id in MNX.
// Individual events and notes within those sequences are addressed by id.
// ─────────────────────────────────────────────────────────────────────────────

/** Locates a voice (sequence) inside the score. */
export interface SequencePath {
  partId: string;
  /** Global measure index. (MNX measures don't carry stable ids of their own; the
   *  array position is the identity, and inserts/removes shift everything after.) */
  measureIndex: number;
  /** 0-based voice index within the measure's `sequences` array. */
  voice: number;
}

/**
 * Locates a measure within a part (the parent of a sequence). Used by
 * measure-level attribute patches (dynamics, arpeggios) where the attribute
 * lives on the `PartMeasure` itself rather than inside a particular voice.
 */
export interface MeasurePath {
  partId: string;
  measureIndex: number;
}

/**
 * Locates an event within a sequence. Events have unique ids assigned by the
 * parser (including events nested inside tuplets, grace groups, and tremolos),
 * so addressing by event id alone is sufficient — the interpreter walks the
 * sequence's content recursively to find the owning content array.
 */
export interface EventLocator {
  sequencePath: SequencePath;
  /** Event id. Required — every patch that targets an event must name it by id. */
  eventId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Note-level patches
// ─────────────────────────────────────────────────────────────────────────────

export interface SetNotePitchPatch {
  kind: "setNotePitch";
  locator: EventLocator;
  noteId: string;
  pitch: Pitch;
}

export type NoteScalarField =
  | { field: "accidentalDisplay"; value: AccidentalDisplay | undefined }
  | { field: "ties"; value: Tie[] | undefined }
  | { field: "written"; value: Written | undefined }
  | { field: "staff"; value: number | undefined };

export interface SetNoteFieldPatch {
  kind: "setNoteField";
  locator: EventLocator;
  noteId: string;
  /** Tagged-union field update so each field's value type is enforced. */
  update: NoteScalarField;
}

export interface AddNoteToEventPatch {
  kind: "addNoteToEvent";
  locator: EventLocator;
  /** Insert position within the event's `notes` array. If absent, appends. */
  index?: number;
  note: Note;
}

export interface RemoveNoteFromEventPatch {
  kind: "removeNoteFromEvent";
  locator: EventLocator;
  noteId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Event-level patches
// ─────────────────────────────────────────────────────────────────────────────

export type EventScalarField =
  | { field: "duration"; value: Duration }
  | { field: "stemDirection"; value: StemDirection | undefined }
  | { field: "orient"; value: Orientation | undefined }
  | { field: "staff"; value: number | undefined }
  | { field: "slurs"; value: Slur[] | undefined }
  | { field: "fermata"; value: Fermata | undefined };

export interface SetEventFieldPatch {
  kind: "setEventField";
  locator: EventLocator;
  update: EventScalarField;
}

/**
 * Set or clear a single key on an event's `markings` object.
 *
 * Why a dedicated patch instead of folding into `setEventField`:
 *   - Concurrent peers toggling DIFFERENT articulations on the same event
 *     (e.g. one adds staccato, another adds accent) should merge cleanly.
 *     `setEventMarking` writes one key at a time so the Y-doc interpreter
 *     can keep the rest of the markings object intact.
 *   - `EventScalarField` is a tagged union over field names with the field's
 *     value type; markings have a 20+-way variant of value types that would
 *     dwarf the union.
 *
 * When `value` is undefined the key is removed. When the resulting markings
 * object would be empty, the `markings` field itself is removed from the
 * event so structural equality checks remain meaningful.
 */
export interface SetEventMarkingPatch {
  kind: "setEventMarking";
  locator: EventLocator;
  markingKey: keyof Markings;
  /** New value for the key, or `undefined` to remove it. */
  value: Markings[keyof Markings] | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Measure-level attribute patches
//
// These address positioned attributes attached to a `PartMeasure` —
// dynamics, arpeggios, non-arpeggios. The natural identity of an entry in
// these lists is the dynamic-group id and (position + span) for
// arpeggios/non-arpeggios, so two peers editing DIFFERENT entries merge
// cleanly under the structural CRDT projection.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Set or clear one dynamic group by stable MNX id.
 * Multiple groups may start at the same position, so position is not identity.
 */
export interface SetMeasureDynamicGroupPatch {
  kind: "setMeasureDynamicGroup";
  measurePath: MeasurePath;
  groupId: string;
  /** Complete replacement group, or `undefined` to remove the group. */
  value: DynamicGroup | undefined;
}

/**
 * The kind of arpeggio mark at (position, span):
 *   - "up" / "down": arpeggio with arrow in that direction
 *   - "auto": arpeggio with arrow, default direction
 *   - "plain": arpeggio without arrow (direction "auto", arrow false)
 *   - "nonArpeggio": non-arpeggio bracket
 */
export type ArpeggioMarkKind = "up" | "down" | "auto" | "plain" | "nonArpeggio";

/**
 * Set or clear the arpeggio/non-arpeggio mark covering the given span at
 * the given position. The two lists (`arpeggios` and `nonArpeggios`) share
 * the (position, span) addressing space — installing one kind first clears
 * any existing entry of EITHER list at that key, then writes the new entry.
 *
 * `mark === undefined` clears any existing entry at (position, span). The
 * Immer interpreter strips empty `arpeggios` / `nonArpeggios` fields.
 */
export interface SetMeasureArpeggioPatch {
  kind: "setMeasureArpeggio";
  measurePath: MeasurePath;
  position: RhythmicPosition;
  span: IdPair;
  mark: ArpeggioMarkKind | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sequence-level patches
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Atomic splice of a sequence's (or nested tuplet's) content array. The remove
 * range is bounded by event ids (inclusive on both ends); both ends must name
 * events that live in the same containing array.
 *
 * For the rare case of an empty splice (pure prepend/append with `insert` and
 * no removal), use a non-null anchor and an empty range — `removeFromEventId`
 * equal to `removeToEventId` with an empty `insert` is a no-op; differing
 * anchors define the inclusive range.
 *
 * This is the "escape hatch" patch for genuinely complex mutations (addNote,
 * addRest, changeDuration-with-split, paste). Most commands should prefer the
 * more specific patches above when possible.
 */
export interface SpliceSequenceContentPatch {
  kind: "spliceSequenceContent";
  sequencePath: SequencePath;
  /** Inclusive start of removal, by event id (must exist in the target array). */
  removeFromEventId: string;
  /** Inclusive end of removal, by event id (must be in the same array as `from`). */
  removeToEventId: string;
  insert: SequenceContent[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Structural patches — global measures, part measures, parts, score-level.
//
// These reach the parts of the tree the note/event/measure-attribute patches
// above cannot: score-wide meter/key/tempo (on `global.measures`), the measure
// list itself, whole parts, and root-level metadata / vendor extensions. They
// are what lets an MCP client (or any planner) author a score from nothing
// rather than only edit inside an existing part-measure.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single field update on a `GlobalMeasure`. `undefined` clears the field.
 * These are score-wide: meter, key, tempo, barline, repeats and voltas all
 * live on the shared `global.measures[i]`, not on any part.
 */
export type GlobalMeasureField =
  | { field: "time"; value: TimeSignature | undefined }
  | { field: "key"; value: KeySignature | undefined }
  | { field: "tempos"; value: Tempo[] | undefined }
  | { field: "barline"; value: Barline | undefined }
  | { field: "repeatStart"; value: RepeatStart | undefined }
  | { field: "repeatEnd"; value: RepeatEnd | undefined }
  | { field: "ending"; value: Ending | undefined };

export interface SetGlobalMeasureFieldPatch {
  kind: "setGlobalMeasureField";
  /** Global measure index (0-based). */
  measureIndex: number;
  /** Tagged-union field update so each field's value type is enforced. */
  update: GlobalMeasureField;
}

/**
 * Insert one or more measures into the score at `atIndex`, keeping every part
 * aligned. Each supplied `globalMeasure` gets a matching blank `PartMeasure`
 * (a single full-bar rest voice) appended to every part at the same position,
 * so `global.measures` and every `part.measures` stay index-parallel. Fill the
 * new bars afterwards with `setSequenceContent`.
 */
export interface InsertMeasuresPatch {
  kind: "insertMeasures";
  /** Position in `global.measures` to insert before (0..measureCount). */
  atIndex: number;
  /** Global-measure properties for each inserted measure (>= 1 entry). */
  globalMeasures: GlobalMeasure[];
}

/** Remove a contiguous run of measures from the score and every part. */
export interface RemoveMeasuresPatch {
  kind: "removeMeasures";
  /** First global measure index to remove (0-based). */
  startIndex: number;
  /** Number of measures to remove (>= 1). */
  count: number;
}

/**
 * A single field update on a `PartMeasure` (the part-specific side of a
 * measure). Currently only clef changes; the tagged union leaves room for more.
 */
export type PartMeasureField = { field: "clefs"; value: PositionedClef[] | undefined };

export interface SetPartMeasureFieldPatch {
  kind: "setPartMeasureField";
  measurePath: MeasurePath;
  update: PartMeasureField;
}

/**
 * Replace a voice's content array wholesale. Unlike `spliceSequenceContent`
 * this needs no anchor events, so it is the only patch that can fill an empty
 * (freshly inserted) measure — the empty-measure bootstrap. If the addressed
 * `voice` index does not exist yet, intervening voices are created empty so the
 * target voice lands at the requested index.
 */
export interface SetSequenceContentPatch {
  kind: "setSequenceContent";
  sequencePath: SequencePath;
  content: SequenceContent[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Part-level and score-level patches
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Add a whole part to the score. The part's `measures` are normalized to the
 * current `global.measures.length` — padded with blank full-bar-rest measures
 * or truncated — so the new part stays index-parallel with the rest of the
 * score.
 */
export interface AddPartPatch {
  kind: "addPart";
  /** Insert position in `parts[]`; appends when absent or out of range. */
  index?: number;
  part: Part;
}

/** Remove a part (and all its measures) by id. */
export interface RemovePartPatch {
  kind: "removePart";
  partId: string;
}

/** A single field update on a `Part`. `undefined` clears optional fields. */
export type PartField =
  | { field: "name"; value: string }
  | { field: "shortName"; value: string | undefined }
  | { field: "staves"; value: number | undefined }
  | { field: "transposition"; value: Transposition | undefined };

export interface SetPartFieldPatch {
  kind: "setPartField";
  partId: string;
  update: PartField;
}

/** Replace (or clear) the whole score metadata block. */
export interface SetScoreMetadataPatch {
  kind: "setScoreMetadata";
  /** Complete replacement metadata, or `undefined` to remove it. */
  value: ScoreMetadata | undefined;
}

/**
 * Set or clear a root-level Viritura vendor extension. `undefined` removes it.
 * The value's shape is validated downstream when the edited score round-trips
 * through `serializeMnx` → `parseMnx` (which validates `_x.viritura` against
 * the extensions JSON schema), so the interpreter only writes the field.
 */
export type ScoreExtensionField =
  | { field: "videoSync"; value: VideoSyncSettings | undefined }
  | { field: "soundProfile"; value: SoundProfileAssignment | undefined }
  | { field: "textStyles"; value: TextStyles | undefined };

export interface SetScoreExtensionPatch {
  kind: "setScoreExtension";
  update: ScoreExtensionField;
}

// ─────────────────────────────────────────────────────────────────────────────
// (More variants will land here as commands are converted.)
//
// Still anticipated but not yet implemented in the interpreter:
//   - addSpanner / removeSpanner / setSpannerField
//   - addDirection / removeDirection / setDirectionField
//   - setLayoutOverride
//
// They are intentionally not declared here so the exhaustive `switch` in
// applyPatchesToScore reflects only what's actually wired up. Adding a variant
// to this union will flag every interpreter as needing the new case.
// ─────────────────────────────────────────────────────────────────────────────

export type ScorePatch =
  | SetNotePitchPatch
  | SetNoteFieldPatch
  | AddNoteToEventPatch
  | RemoveNoteFromEventPatch
  | SetEventFieldPatch
  | SetEventMarkingPatch
  | SetMeasureDynamicGroupPatch
  | SetMeasureArpeggioPatch
  | SpliceSequenceContentPatch
  | SetGlobalMeasureFieldPatch
  | InsertMeasuresPatch
  | RemoveMeasuresPatch
  | SetPartMeasureFieldPatch
  | SetSequenceContentPatch
  | AddPartPatch
  | RemovePartPatch
  | SetPartFieldPatch
  | SetScoreMetadataPatch
  | SetScoreExtensionPatch;

/** Discriminant strings, exported for runtime introspection (tests, devtools). */
export type ScorePatchKind = ScorePatch["kind"];
