/**
 * Percussion kit presets — single source of truth.
 *
 * Used in two places:
 *  - the Drum Kit editor's "Load preset…" control (replaces a part's mapping),
 *  - the instrument catalog (so presets are pickable in the New Score / add-
 *    instrument wizard as ready-made percussion parts).
 *
 * Staff positions follow widespread engraving practice (0 = middle line, even =
 * lines, odd = spaces, + above / − below): cymbals above the staff, drums on/
 * below the middle, kick & pedal below.
 */

import type { KitComponentDef } from "./InstrumentCatalog";

export interface DrumKitPreset {
  /** Stable preset id. */
  readonly id: string;
  /** Display name shown in the preset picker. */
  readonly name: string;
  /** One-line description of what the preset contains. */
  readonly description: string;
  /** Kit components (GM key + staff position + notehead) the preset installs. */
  readonly components: readonly KitComponentDef[];
}

/** Standard 5-piece drum set using the GM percussion key map. */
export const FULL_DRUM_KIT_COMPONENTS: readonly KitComponentDef[] = [
  { id: "crash", name: "Crash Cymbal", midiNumber: 49, staffPosition: 6, notehead: "x" },
  { id: "hihat-closed", name: "Hi-Hat Closed", midiNumber: 42, staffPosition: 5, notehead: "x" },
  { id: "hihat-open", name: "Hi-Hat Open", midiNumber: 46, staffPosition: 5, notehead: "circleX" },
  { id: "snare", name: "Snare", midiNumber: 38, staffPosition: 1 },
  { id: "tom-high", name: "High Tom", midiNumber: 50, staffPosition: 3 },
  { id: "tom-mid", name: "Mid Tom", midiNumber: 48, staffPosition: 0 },
  { id: "tom-floor", name: "Floor Tom", midiNumber: 43, staffPosition: -2 },
  { id: "kick", name: "Kick", midiNumber: 36, staffPosition: -3 },
  { id: "hihat-pedal", name: "Hi-Hat Pedal", midiNumber: 44, staffPosition: -5, notehead: "x" },
];

/** Standard orchestral percussion set on one staff: snare, bass drum, crash,
 *  tambourine, triangle. */
export const ORCHESTRAL_PERCUSSION_COMPONENTS: readonly KitComponentDef[] = [
  { id: "crash", name: "Crash Cymbals", midiNumber: 49, staffPosition: 6, notehead: "x" },
  { id: "triangle", name: "Triangle", midiNumber: 81, staffPosition: 4, notehead: "triangleUp" },
  { id: "tambourine", name: "Tambourine", midiNumber: 54, staffPosition: 2 },
  { id: "snare", name: "Snare Drum", midiNumber: 38, staffPosition: 0 },
  { id: "bass-drum", name: "Bass Drum", midiNumber: 35, staffPosition: -4 },
];

/** Minimal two-piece kit: snare + bass drum. */
const MINIMAL_PERCUSSION_COMPONENTS: readonly KitComponentDef[] = [
  { id: "snare", name: "Snare", midiNumber: 38, staffPosition: 1 },
  { id: "bass-drum", name: "Bass Drum", midiNumber: 36, staffPosition: -3 },
];

export const PERCUSSION_PRESETS: readonly DrumKitPreset[] = [
  {
    id: "full-drum-kit",
    name: "Full Drum Kit",
    description: "Kick, snare, hi-hats, toms, crash",
    components: FULL_DRUM_KIT_COMPONENTS,
  },
  {
    id: "orchestral-percussion",
    name: "Orchestral Percussion",
    description: "Snare, bass drum, crash, tambourine, triangle",
    components: ORCHESTRAL_PERCUSSION_COMPONENTS,
  },
  {
    id: "minimal",
    name: "Minimal (Snare + Bass)",
    description: "Snare and bass drum only",
    components: MINIMAL_PERCUSSION_COMPONENTS,
  },
];

/** Look up a preset by id. */
export function getPercussionPreset(id: string): DrumKitPreset | undefined {
  return PERCUSSION_PRESETS.find((p) => p.id === id);
}
