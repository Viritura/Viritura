import type {
  Sound as RawSound,
  PerformOptions as RawPerformOptions,
  KitNote as RawKitNote,
  KitComponent as RawKitComponent,
  Notehead as RawNotehead,
} from "../raw";
import type { Narrow, HoistVendor } from "./_derive";
import type { Tie } from "./event";

/**
 * Drum kit / unpitched percussion model.
 *
 * MNX models a drum kit as:
 *   - `global.sounds`: a registry of named GM-MIDI sound entries
 *   - `parts[i].kit`: the kit-component list defining each drum on the staff
 *   - event notes that reference a kit-component instead of a pitch (kit-note)
 *
 * Noteheads are native MNX objects on notes, kit notes and components.
 */

/** A GM MIDI sound entry (MNX `sound`). Derived from MNX raw. */
export type Sound = RawSound;

/**
 * MNX `perform-options` — currently a stub object in the MNX spec.
 * Derived from MNX raw (carries only `id?` via global-attrs).
 */
export type PerformOptions = RawPerformOptions;

/**
 * Shape names used by Viritura's notehead editing controls.
 */
export type NoteheadShape =
  | "normal"
  | "x"
  | "circleX"
  | "circled"
  | "slashed"
  | "backSlashed"
  | "diamond"
  | "slash"
  | "triangleUp"
  | "triangleDown"
  | "plus"
  | "square"
  | "custom";

export type Notehead = RawNotehead;

/** Convert editor shape names to the native MNX spelling. */
export function noteheadFromEditorShape(shape: NoteheadShape): Notehead {
  if (shape === "custom") throw new Error("Custom noteheads require a SMuFL glyph");
  return { shape: shape === "normal" ? "oval" : shape === "triangleUp" ? "triangle" : shape };
}

export function noteheadEditorShape(notehead: Notehead | undefined): NoteheadShape {
  const shape = notehead?.shape;
  if (shape === undefined || shape === "oval") return "normal";
  if (shape === "triangle") return "triangleUp";
  return shape;
}

/** A single drum/percussion instrument on a staff (MNX `kit-component`).
 *  Derived from raw via `HoistVendor`: vendor fields are exposed at the top
 *  level (decoded shapes) while `_x.viritura` remains the wire representation.
 *  - `drumKit`: optional GS drum-kit program (bank 128) this component's sound
 *    plays on, overriding the part's default kit (e.g. a Tam-tam borrowed from
 *    the Ethnic kit). */
export type KitComponent = HoistVendor<RawKitComponent, { drumKit?: number }>;

/**
 * A drum-hit "note" within an event (MNX `kit-note`). Unlike a pitched `Note`
 * it carries no pitch; it references a kit-component on the part's kit.
 * Derived from MNX raw, narrowing `ties` to the decoded `Tie` type.
 */
export type KitNote = Narrow<RawKitNote, { ties?: Tie[] }>;
