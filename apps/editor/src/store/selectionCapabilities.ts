/**
 * Selection capability contract.
 *
 * Generic score-editing actions declare a `SelectionCapability`: which
 * selection kinds they accept and how they map the selection to concrete
 * targets. Specialized structural operations may still inspect the selection
 * directly when they need information outside these target modes
 * (for example clipboard shape, condensed writeback, or staff-specific marks).
 * Keeping generic action policy here replaces the hand-rolled
 * `selection.kind === ...` ladders that drifted apart
 * (e.g. fingering silently ignored multi/range while articulation didn't;
 * transpose was dead for ranges entirely).
 *
 * Two things flow from a capability:
 *  1. UI enablement — `selectionSupports(cap, selection)` tells a menu/toolbar
 *     whether to enable the action for the current selection.
 *  2. Target resolution — `resolveCapabilityTargets(cap, selection, score)`
 *     returns the concrete targets (event list / measure scope / anchor),
 *     resolved consistently through `resolveSelection`.
 *
 * The behavior matrix these capabilities encode is documented in
 * `docs/spec/selection-behavior-matrix.md`.
 */

import type { Score } from "@viritura/core";
import type { Selection } from "./selectionStore";
import {
  resolveSelection,
  resolveSelectionNotes,
  type ResolvedSelection,
  type MeasureRange,
  type NoteSelectionTarget,
} from "./selectionUtils";
import type { EventLocation } from "../score/ElementPath";

/** All selection kinds (mirrors the `Selection` union discriminant). */
const ALL_SELECTION_KINDS: ReadonlySet<Selection["kind"]> = new Set(["single", "multi", "range", "measure"] as const);

/** Selection kinds that resolve to one or more concrete events. */
const EVENT_SELECTION_KINDS: ReadonlySet<Selection["kind"]> = new Set(["single", "multi", "range", "measure"] as const);

/**
 * How an action maps a selection to its targets:
 *  - `events`: apply to every event the selection covers (articulations,
 *    tremolo, fingering, transpose, note deletion).
 *  - `notes`: apply to individual selected noteheads (accidentals).
 *  - `scope`: apply across the measure/part rectangle the selection touches
 *    (clef / key / time signature, measure operations).
 *  - `anchor`: act on a single primary element (editing one element's props).
 */
type SelectionTargetMode = "events" | "notes" | "scope" | "anchor";

/** A declared selection capability for one action. */
export interface SelectionCapability {
  readonly mode: SelectionTargetMode;
  readonly accepts: ReadonlySet<Selection["kind"]>;
}

/** Resolved targets for a capability, discriminated by the capability's mode. */
export type CapabilityTargets =
  | { readonly mode: "events"; readonly events: readonly EventLocation[] }
  | { readonly mode: "notes"; readonly notes: readonly NoteSelectionTarget[] }
  | { readonly mode: "scope"; readonly scope: MeasureRange }
  | { readonly mode: "anchor"; readonly anchor: string };

/** True if `cap` accepts the given selection kind (does not check emptiness). */
export function selectionSupports(cap: SelectionCapability, selection: Selection): boolean {
  return cap.accepts.has(selection.kind);
}

/**
 * Resolve the concrete targets for a capability against the current selection,
 * or `null` when the selection kind is unsupported or yields no targets.
 */
export function resolveCapabilityTargets(
  cap: SelectionCapability,
  selection: Selection,
  score: Score,
): CapabilityTargets | null {
  if (!cap.accepts.has(selection.kind)) return null;
  if (cap.mode === "notes") {
    const notes = resolveSelectionNotes(selection, score);
    return notes.length > 0 ? { mode: "notes", notes } : null;
  }
  const resolved: ResolvedSelection = resolveSelection(selection, score);
  switch (cap.mode) {
    case "events":
      return resolved.events.length > 0 ? { mode: "events", events: resolved.events } : null;
    case "scope":
      return resolved.scope ? { mode: "scope", scope: resolved.scope } : null;
    case "anchor":
      return resolved.anchor ? { mode: "anchor", anchor: resolved.anchor } : null;
  }
}

// ── Capability presets ──────────────────────────────────────────────
// Reusable shapes so families of actions share one declaration.

/** Applies to every covered event, for any non-empty selection. */
export const EVENT_ACTION: SelectionCapability = { mode: "events", accepts: EVENT_SELECTION_KINDS };

/** Applies to each covered notehead, preserving chord-member granularity. */
export const NOTE_ACTION: SelectionCapability = { mode: "notes", accepts: EVENT_SELECTION_KINDS };

/** Applies across the measure/part rectangle, for any non-empty selection. */
export const SCOPE_ACTION: SelectionCapability = { mode: "scope", accepts: ALL_SELECTION_KINDS };

/** Acts on a single primary element only. */
export const ANCHOR_ACTION: SelectionCapability = { mode: "anchor", accepts: new Set(["single"] as const) };

/**
 * Registry of known editing actions and their capabilities. Keep additions
 * here so the behavior matrix stays declarative and discoverable.
 */
export const SELECTION_CAPABILITIES = {
  articulation: EVENT_ACTION,
  tremolo: EVENT_ACTION,
  fingering: EVENT_ACTION,
  ornament: EVENT_ACTION,
  breath: EVENT_ACTION,
  transpose: EVENT_ACTION,
  deleteNotes: EVENT_ACTION,
  accidental: NOTE_ACTION,
  clef: SCOPE_ACTION,
  keySignature: SCOPE_ACTION,
  timeSignature: SCOPE_ACTION,
} as const satisfies Record<string, SelectionCapability>;
