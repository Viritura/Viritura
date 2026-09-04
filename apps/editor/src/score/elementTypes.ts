/**
 * Element type classification utilities for the selection engine.
 *
 * Element IDs are hierarchical strings emitted by the Rust layout engine
 * (e.g. "p0/m1/s0/ev1", "p0/m2/dyn0", "p0/m1/clef").
 * This module parses those IDs to determine the selectable element type,
 * enabling context-sensitive selection, navigation, and inspector routing.
 */

export type SelectableElementType =
  | "event"
  | "rest"
  | "articulation"
  | "fermata"
  | "ornament"
  | "trill"
  | "fingering"
  | "arpeggio"
  | "tremolo"
  | "breath"
  | "dynamic"
  | "hairpin"
  | "pedal"
  | "ottava"
  | "expression"
  | "slur"
  | "tie"
  | "glissando"
  | "tempo"
  | "rehearsal"
  | "jump"
  | "volta"
  | "caesura"
  | "barline"
  | "clef"
  | "key-signature"
  | "time-signature"
  | "chord-symbol"
  | "measure-number"
  | "measure-repeat"
  | "beam"
  | "tuplet"
  | "grace-note"
  | "note"
  | "accidental"
  | "unknown";

/**
 * Prefix-to-type mapping, ordered from most specific to least.
 * Each entry is [prefix, SelectableElementType].
 * Checked with `startsWith` against the last segment of the element ID.
 */
const PREFIX_MAP: ReadonlyArray<readonly [string, SelectableElementType]> = [
  ["acc", "accidental"],
  ["art", "articulation"],
  ["ferm", "fermata"],
  ["orn", "ornament"],
  ["trill", "trill"],
  ["fing", "fingering"],
  ["arp", "arpeggio"],
  ["trem", "tremolo"],
  ["breath", "breath"],
  ["dyn", "dynamic"],
  ["hairpin", "hairpin"],
  ["pedal", "pedal"],
  ["ottava", "ottava"],
  ["expr", "expression"],
  ["slur", "slur"],
  ["tie", "tie"],
  ["gliss", "glissando"],
  ["tempo", "tempo"],
  ["rehearsal", "rehearsal"],
  ["jump", "jump"],
  ["volta", "volta"],
  ["caesura", "caesura"],
  ["barline", "barline"],
  ["clef", "clef"],
  ["key", "key-signature"],
  ["time", "time-signature"],
  ["chord", "chord-symbol"],
  ["mnum", "measure-number"],
  ["measurerepeat", "measure-repeat"],
  ["beam", "beam"],
  ["tuplet", "tuplet"],
  ["grace", "grace-note"],
] as const;

/**
 * Parse an element ID string and return its selectable element type.
 *
 * The element ID is a '/'-separated path produced by the Rust layout engine.
 * The last segment determines the type via prefix matching.
 *
 * Examples:
 * - "p0/m1/s0/ev1"       → "event"
 * - "p0/m2/dyn0"         → "dynamic"
 * - "p0/m1/clef"         → "clef"
 * - "p0/m1/s0/ev1/art0"  → "articulation"
 * - "p0/m1/s0/ev1/acc0"  → "accidental"
 * - "m0/time"            → "time-signature"
 */
export function parseElementType(elementId: string): SelectableElementType {
  if (!elementId) return "unknown";

  const segments = elementId.split("/");
  const last = segments[segments.length - 1];
  if (!last) return "unknown";

  for (const [prefix, elementType] of PREFIX_MAP) {
    if (last.startsWith(prefix)) {
      return elementType;
    }
  }

  // Individual chord note: "n" followed by a digit (e.g. "n0", "n1")
  if (/^n\d/.test(last)) {
    return "note";
  }

  // Fallback: if it doesn't match any known prefix, treat as an event.
  // Event IDs typically look like "e0", "ev1", or custom IDs that
  // don't match any known prefix, and sit under a voice/sequence path.
  return "event";
}

/** Element types that are attached to a specific note/rest event. */
const EVENT_ATTACHED: ReadonlySet<SelectableElementType> = new Set([
  "accidental",
  "articulation",
  "fermata",
  "ornament",
  "trill",
  "fingering",
  "arpeggio",
  "tremolo",
  "breath",
  "caesura",
  "slur",
  "tie",
  "glissando",
  "note",
]);

/** Element types scoped to a part-measure (below staff). */
const MEASURE_LEVEL: ReadonlySet<SelectableElementType> = new Set([
  "dynamic",
  "hairpin",
  "pedal",
  "ottava",
  "expression",
  "chord-symbol",
  "measure-number",
  "measure-repeat",
  "barline",
  "clef",
  "key-signature",
  "time-signature",
]);

/** Element types that belong to the global timeline. */
const GLOBAL_LEVEL: ReadonlySet<SelectableElementType> = new Set(["tempo", "rehearsal", "jump", "volta"]);

/** True if this element type is attached to a specific event (note/rest). */
export function isEventAttached(type: SelectableElementType): boolean {
  return EVENT_ATTACHED.has(type);
}

/** True if this element type belongs at the measure level (part-scoped). */
export function isMeasureLevel(type: SelectableElementType): boolean {
  return MEASURE_LEVEL.has(type);
}

/** True if this element type belongs at the global timeline level. */
export function isGlobalLevel(type: SelectableElementType): boolean {
  return GLOBAL_LEVEL.has(type);
}
