import type { SelectOption } from "@viritura/ui";
import type { NoteheadShape } from "@viritura/core";
import { PERCUSSION_PRESETS, type DrumKitPreset } from "../../score/percussionPresets";
import type { KitComponentEdit } from "./types";

/** Notehead-shape options with a compact glyph hint in the label. */
export const NOTEHEAD_OPTIONS: readonly SelectOption[] = [
  { value: "normal", label: "Normal ●" },
  { value: "x", label: "Cross ✕" },
  { value: "circleX", label: "Circle-X ⊗" },
  { value: "diamond", label: "Diamond ◆" },
  { value: "slash", label: "Slash ∕" },
  { value: "triangleUp", label: "Triangle ▲" },
  { value: "triangleDown", label: "Triangle ▽" },
];

/** Coerce an arbitrary string back to a NoteheadShape (Select gives strings). */
export function asNoteheadShape(v: string): NoteheadShape {
  return (NOTEHEAD_OPTIONS.some((o) => o.value === v) ? v : "normal") as NoteheadShape;
}

/**
 * A sensible default GM percussion key for a freshly-placed notehead, by staff
 * region (cymbals high, snare middle, toms below, bass drum lowest). Coarse on
 * purpose — the user refines it with the Sound dropdown.
 */
export function defaultKeyForStaffPosition(sp: number): number {
  if (sp >= 7) return 49; // Crash Cymbal 1
  if (sp >= 4) return 42; // Closed Hi-Hat
  if (sp >= -1) return 38; // Acoustic Snare
  if (sp >= -4) return 45; // Low Tom
  return 36; // Bass Drum 1
}

/** Generate a kit-component id not already present in `existing`. */
export function freshComponentId(existing: Iterable<string>): string {
  const taken = new Set(existing);
  for (let i = 1; ; i++) {
    const id = `kit-${i}`;
    if (!taken.has(id)) return id;
  }
}

/** Map a percussion preset to editable dialog rows. */
export function presetToEdits(preset: DrumKitPreset): KitComponentEdit[] {
  return preset.components.map((c) => ({
    id: c.id,
    name: c.name,
    staffPosition: c.staffPosition,
    notehead: (c.notehead ?? "normal") as NoteheadShape,
    drumKit: undefined,
    midiKey: c.midiNumber,
  }));
}

/** Order-independent signature of a mapping's musical identity (ignores the
 *  per-row id and display name — only the sound + notation matters). */
function mappingSignature(
  rows: ReadonlyArray<{ midiKey: number; staffPosition: number; notehead: string; drumKit: number | undefined }>,
): string {
  return rows
    .map((r) => `${r.midiKey}:${r.staffPosition}:${r.notehead}:${r.drumKit ?? ""}`)
    .sort()
    .join("|");
}

/** The id of the preset whose components match `rows` exactly, or "" if none.
 *  Lets the Presets picker reflect the active preset instead of always showing
 *  the "Load preset…" placeholder. */
export function matchPresetId(rows: readonly KitComponentEdit[]): string {
  const target = mappingSignature(rows);
  const preset = PERCUSSION_PRESETS.find(
    (p) =>
      mappingSignature(
        p.components.map((c) => ({
          midiKey: c.midiNumber,
          staffPosition: c.staffPosition,
          notehead: c.notehead ?? "normal",
          drumKit: undefined,
        })),
      ) === target,
  );
  return preset?.id ?? "";
}
