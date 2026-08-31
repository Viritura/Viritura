/**
 * Fast edit-path projection: translate a `ScorePatch[]` directly into Yjs
 * ops on the existing score tree, bypassing the full
 * `serializeMnx(newScore) → JSON.parse → syncJsonToYDoc` round trip.
 *
 * Why this exists
 * ───────────────
 *
 * The cold paths in {@link syncJsonToYDoc} (and {@link projectJsonIntoYDoc})
 * stay the canonical, schema-blind way to write a whole MNX document into a
 * Y.Doc — initial load, format imports, paste-replace-all, and any code path
 * that lacks a typed patch list keeps going through them.
 *
 * The **steady-state editing path**, however, already has an exact
 * structural diff in hand: the `ScorePatch[]` the editor command produced.
 * Throwing that diff away and re-deriving it from a full JSON walk is
 * O(score size) per keystroke; this adapter makes it O(patch size).
 *
 * Drift surface
 * ─────────────
 *
 * This module is intentionally **schema-aware**. To stay correct it needs to
 * know:
 *
 *   1. How to navigate from the score root to each patch's target sub-tree
 *      (`resolveEventOwner`, `resolveMeasureYMap`, `resolveSequenceContent`).
 *   2. Where each patch's payload lives inside the wire shape of that sub-tree.
 *
 * The conversion from the decoded model to the wire shape is **delegated to
 * the shared serializer in `@viritura/format`** (`serializeEvent`,
 * `serializeArpeggio`, …). That is the single source of truth for the wire
 * shape and is already round-trip tested against the full MNX corpus, so
 * this adapter cannot drift independently of the serializer.
 *
 * The remaining drift surface is just the path-resolution helpers below and
 * the per-patch dispatch in {@link applyScorePatchesToYDoc}. A property
 * test (`yProjection.patchesParity.test.ts`) asserts that this fast path
 * and the slow `setMnxJson` path produce byte-identical Y.Doc state for
 * every patch kind on the full MNX corpus, so a divergence between the two
 * fails CI before it can ship.
 */

import * as Y from "yjs";

import type { EventLocator, MeasurePath, Score, ScorePatch, SequencePath } from "@viritura/core";
import {
  serializeArpeggio,
  serializeDynamicGroup,
  serializeEvent,
  serializeNonArpeggio,
  serializeSequenceContent,
} from "@viritura/format";

import { toYValue } from "./jsonToYDoc";
import { syncYArray, syncYMap } from "./syncJsonToYDoc";

/**
 * Apply a list of patches to a Y.Doc score tree, emitting the minimal ops
 * needed to reflect `newScore` (the post-patch decoded Score the caller
 * already produced via `applyPatchesToScore`).
 *
 * Wraps everything in a single Yjs transaction tagged with `origin` so
 * subscribers see one coherent delta and the local-write origin filter on
 * `MnxYjsBridge.onRemoteUpdate` works correctly.
 *
 * Throws if a patch's target cannot be resolved inside the Y.Doc tree —
 * the caller (typically `MnxYjsBridge.applyPatches`) should catch and
 * fall back to a full `setMnxJson` sync in that case, so a divergence
 * heals on the next edit instead of stalling collaboration.
 */
export function applyScorePatchesToYDoc(
  patches: readonly ScorePatch[],
  newScore: Score,
  ydoc: Y.Doc,
  rootKey: string,
  origin?: unknown,
): void {
  if (patches.length === 0) return;
  ydoc.transact(() => {
    const root = ydoc.getMap<unknown>(rootKey);
    for (const patch of patches) {
      applyOnePatch(patch, newScore, root);
    }
  }, origin);
}

function applyOnePatch(patch: ScorePatch, newScore: Score, root: Y.Map<unknown>): void {
  switch (patch.kind) {
    // ── Event-targeted patches: re-sync the affected event Y.Map ────────
    //
    // The six event-targeted patches all collapse to "the event at this
    // locator has changed; rewrite its wire shape." Re-serialising the
    // whole event is O(event size) ≈ a handful of keys + notes, vastly
    // cheaper than O(score). `syncYMap` then issues the minimal Y ops
    // inside that sub-tree (typically one or two `.set` calls).
    case "setNotePitch":
    case "setNoteField":
    case "addNoteToEvent":
    case "removeNoteFromEvent":
    case "setEventField":
    case "setEventMarking": {
      syncEventFromScore(root, patch.locator, newScore);
      return;
    }
    // ── Measure-targeted attribute patches ──────────────────────────────
    //
    // Each writes one named array under the measure's wire object. The
    // measure object has stable identity across patches, so we keep the
    // measure Y.Map itself and only rewrite the named key.
    case "setMeasureDynamicGroup": {
      syncMeasureArrayKey(root, patch.measurePath, newScore, "dynamics", (pm) =>
        (pm.dynamics ?? []).map(serializeDynamicGroup),
      );
      return;
    }
    case "setMeasureArpeggio": {
      syncMeasureArrayKey(root, patch.measurePath, newScore, "arpeggios", (pm) =>
        (pm.arpeggios ?? []).map(serializeArpeggio),
      );
      syncMeasureArrayKey(root, patch.measurePath, newScore, "nonArpeggios", (pm) =>
        (pm.nonArpeggios ?? []).map(serializeNonArpeggio),
      );
      return;
    }
    // ── Sequence content splice ─────────────────────────────────────────
    //
    // Re-sync the whole sequence's `content` Y.Array. Bounded by measure
    // size (a few dozen items) and the existing structural diff handles
    // the insert/delete shape minimally.
    case "spliceSequenceContent": {
      const sequenceMap = resolveSequenceYMap(root, patch.sequencePath);
      const sequence = resolveSequenceInScore(newScore, patch.sequencePath);
      const wireContent = sequence.content.map(serializeSequenceContent);
      const existing = sequenceMap.get("content");
      if (existing instanceof Y.Array) {
        syncYArray(existing, wireContent);
      } else {
        sequenceMap.set("content", toYValue(wireContent));
      }
      return;
    }
    // ── Structural / global patches: no bounded sub-tree projection ─────
    //
    // Global-measure, whole-part, and score-level edits (adding measures or
    // parts, rewriting global tempo/meter/key, replacing a sequence wholesale,
    // score metadata / extensions) reshape the tree beyond a local sub-map.
    // There is no cheap incremental Y projection, so we signal the caller to
    // fall back to a full `setMnxJson` resync — the same recovery path used
    // when any locator fails to resolve (`PatchTargetNotInYDoc`).
    case "setGlobalMeasureField":
    case "insertMeasures":
    case "removeMeasures":
    case "setPartMeasureField":
    case "setSequenceContent":
    case "addPart":
    case "removePart":
    case "setPartField":
    case "setScoreMetadata":
    case "setScoreExtension": {
      throw new PatchTargetNotInYDoc(`Structural ScorePatch kind requires full resync: ${patch.kind}`);
    }
    default: {
      const _exhaustive: never = patch;
      throw new Error(`Unhandled ScorePatch kind: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

// ─── Event sync ──────────────────────────────────────────────────────────

/**
 * Locate the event by `locator` in both the Y.Doc tree and the decoded
 * `newScore`, then sync the Y.Map for that event to the wire shape of the
 * decoded event.
 */
function syncEventFromScore(root: Y.Map<unknown>, locator: EventLocator, newScore: Score): void {
  const owner = resolveEventOwner(root, locator);
  const event = resolveEventInScore(newScore, locator);
  const eventWire = serializeEvent(event) as Record<string, unknown>;
  syncYMap(owner.eventMap, eventWire);
}

// ─── Measure sync ────────────────────────────────────────────────────────

/**
 * Sync one array-valued key on a measure's Y.Map. If the new array is
 * empty the key is removed; if the key didn't exist before it's created;
 * otherwise the existing Y.Array is reconciled in place.
 */
function syncMeasureArrayKey(
  root: Y.Map<unknown>,
  measurePath: MeasurePath,
  newScore: Score,
  key: string,
  collect: (pm: Score["parts"][number]["measures"][number]) => unknown[],
): void {
  const measureMap = resolveMeasureYMap(root, measurePath);
  const part = newScore.parts.find((p) => p.id === measurePath.partId);
  if (!part) throw new PatchTargetNotInYDoc(`Part "${measurePath.partId}" not found in newScore`);
  const partMeasure = part.measures[measurePath.measureIndex];
  if (!partMeasure) {
    throw new PatchTargetNotInYDoc(
      `Measure ${measurePath.measureIndex} not found in newScore part "${measurePath.partId}"`,
    );
  }
  const wireArray = collect(partMeasure);
  const existing = measureMap.get(key);
  if (wireArray.length === 0) {
    if (existing !== undefined) measureMap.delete(key);
    return;
  }
  if (existing instanceof Y.Array) {
    syncYArray(existing, wireArray);
  } else {
    measureMap.set(key, toYValue(wireArray));
  }
}

// ─── Y.Doc path resolvers ────────────────────────────────────────────────

/**
 * Walk `root.parts` (a `Y.Array<Y.Map>`) and return the part Y.Map whose
 * `id` field matches `partId`.
 */
function resolvePartYMap(root: Y.Map<unknown>, partId: string): Y.Map<unknown> {
  const parts = root.get("parts");
  if (!(parts instanceof Y.Array)) {
    throw new PatchTargetNotInYDoc(`Y.Doc has no \`parts\` array`);
  }
  for (let i = 0; i < parts.length; i++) {
    const part = parts.get(i);
    if (part instanceof Y.Map && part.get("id") === partId) {
      return part as Y.Map<unknown>;
    }
  }
  throw new PatchTargetNotInYDoc(`Part "${partId}" not found in Y.Doc`);
}

function resolveMeasureYMap(root: Y.Map<unknown>, path: MeasurePath): Y.Map<unknown> {
  const partMap = resolvePartYMap(root, path.partId);
  const measures = partMap.get("measures");
  if (!(measures instanceof Y.Array)) {
    throw new PatchTargetNotInYDoc(`Part "${path.partId}" has no \`measures\` array in Y.Doc`);
  }
  const measure = measures.get(path.measureIndex);
  if (!(measure instanceof Y.Map)) {
    throw new PatchTargetNotInYDoc(`Measure ${path.measureIndex} not found in Y.Doc part "${path.partId}"`);
  }
  return measure as Y.Map<unknown>;
}

function resolveSequenceYMap(root: Y.Map<unknown>, path: SequencePath): Y.Map<unknown> {
  const measureMap = resolveMeasureYMap(root, path);
  const sequences = measureMap.get("sequences");
  if (!(sequences instanceof Y.Array)) {
    throw new PatchTargetNotInYDoc(
      `Measure ${path.measureIndex} in part "${path.partId}" has no \`sequences\` array in Y.Doc`,
    );
  }
  const sequence = sequences.get(path.voice);
  if (!(sequence instanceof Y.Map)) {
    throw new PatchTargetNotInYDoc(
      `Voice ${path.voice} not found in Y.Doc part "${path.partId}" measure ${path.measureIndex}`,
    );
  }
  return sequence as Y.Map<unknown>;
}

interface EventOwnerHit {
  /** The `Y.Array` directly containing the event (sequence content, or a
   *  tuplet/grace/tremolo content array). */
  container: Y.Array<unknown>;
  /** Index within `container`. */
  index: number;
  /** The event Y.Map itself, hoisted for the common syncYMap case. */
  eventMap: Y.Map<unknown>;
}

/**
 * Locate the event Y.Map for `locator`, walking into nested tuplet / grace
 * / tremolo content arrays as needed. Mirrors
 * `@viritura/core/patches/locate.findOwningContentArray` on the Y.Doc
 * side: any wire-shape sub-array that lives inside a tuplet/grace/tremolo
 * wrapper is searched recursively, by event id.
 */
function resolveEventOwner(root: Y.Map<unknown>, locator: EventLocator): EventOwnerHit {
  const sequenceMap = resolveSequenceYMap(root, locator.sequencePath);
  const content = sequenceMap.get("content");
  if (!(content instanceof Y.Array)) {
    throw new PatchTargetNotInYDoc(
      `Sequence has no \`content\` array (part "${locator.sequencePath.partId}" measure ${locator.sequencePath.measureIndex} voice ${locator.sequencePath.voice})`,
    );
  }
  const hit = findEventInYContent(content, locator.eventId);
  if (!hit) {
    throw new PatchTargetNotInYDoc(`Event "${locator.eventId}" not found in Y.Doc sequence`);
  }
  return hit;
}

/**
 * Recursive scan of a wire-shape content `Y.Array`, looking for an event
 * with the given id. Tuplet / grace / tremolo wrappers have their own
 * nested `content` arrays which are walked transparently. Events have no
 * `type` discriminant on the wire (only the wrappers do), so the id check
 * is sufficient to identify them.
 */
function findEventInYContent(content: Y.Array<unknown>, eventId: string): EventOwnerHit | null {
  for (let i = 0; i < content.length; i++) {
    const item = content.get(i);
    if (!(item instanceof Y.Map)) continue;
    const type = item.get("type");
    if (typeof type === "string") {
      // Wrapper: tuplet, grace, tremolo, or space. Space has no `content`;
      // the others recurse.
      if (type === "tuplet" || type === "grace" || type === "tremolo") {
        const inner = item.get("content");
        if (inner instanceof Y.Array) {
          const hit = findEventInYContent(inner, eventId);
          if (hit) return hit;
        }
      }
      continue;
    }
    // No `type` field → event. Match by id.
    if (item.get("id") === eventId) {
      return { container: content, index: i, eventMap: item as Y.Map<unknown> };
    }
  }
  return null;
}

// ─── Decoded-side mirrors of the same lookups ────────────────────────────
//
// These walk the post-patch Score tree to find the same sub-trees, so the
// adapter can read fresh wire shapes out of `newScore` and feed them into
// the Y.Doc sub-tree it just located. They could re-use the equivalent
// helpers in `@viritura/core/patches/locate`, but those are not part of
// the package's public surface — re-implementing here (a handful of lines)
// avoids exporting internal lookup helpers from `@viritura/core` just for
// this adapter.

function resolveEventInScore(score: Score, locator: EventLocator): import("@viritura/core").NoteEvent {
  const sequence = resolveSequenceInScore(score, locator.sequencePath);
  const hit = findEventInDecodedContent(sequence.content, locator.eventId);
  if (!hit) {
    throw new PatchTargetNotInYDoc(
      `Event "${locator.eventId}" not found in newScore sequence (post-patch state is out of sync with patch)`,
    );
  }
  return hit;
}

function resolveSequenceInScore(score: Score, path: SequencePath): import("@viritura/core").Sequence {
  const part = score.parts.find((p) => p.id === path.partId);
  if (!part) throw new PatchTargetNotInYDoc(`Part "${path.partId}" not found in newScore`);
  const partMeasure = part.measures[path.measureIndex];
  if (!partMeasure) {
    throw new PatchTargetNotInYDoc(`Measure ${path.measureIndex} not found in newScore part "${path.partId}"`);
  }
  const sequence = partMeasure.sequences[path.voice];
  if (!sequence) {
    throw new PatchTargetNotInYDoc(
      `Voice ${path.voice} not found in newScore part "${path.partId}" measure ${path.measureIndex}`,
    );
  }
  return sequence;
}

function findEventInDecodedContent(
  content: readonly import("@viritura/core").SequenceContent[],
  eventId: string,
): import("@viritura/core").NoteEvent | null {
  for (const item of content) {
    if (item.type === "event" && item.id === eventId) return item;
    if (item.type === "tuplet") {
      const hit = findEventInDecodedContent(item.content, eventId);
      if (hit) return hit;
    } else if (item.type === "grace" || item.type === "tremolo") {
      const hit = findEventInDecodedContent(item.content as import("@viritura/core").SequenceContent[], eventId);
      if (hit) return hit;
    }
  }
  return null;
}

// ─── Error type ──────────────────────────────────────────────────────────

/**
 * Thrown when a patch's target sub-tree cannot be resolved in the Y.Doc or
 * in the post-patch `Score`. Surfaced as a distinct error so the bridge
 * can recognise it and fall back to a full `setMnxJson` sync rather than
 * letting the throw propagate into the editor.
 */
export class PatchTargetNotInYDoc extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PatchTargetNotInYDoc";
  }
}
