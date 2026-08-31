import type {
  Sound as RawSound,
  PerformOptions as RawPerformOptions,
  KitNote as RawKitNote,
  KitComponent as RawKitComponent,
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
 * MNX has no `notehead` field on `note` or `kit-component` — see W3C MNX
 * issue #249. We track notehead shape as a Viritura vendor extension on
 * `kit-component` (`_x.viritura.notehead`).
 */

/** A GM MIDI sound entry (MNX `sound`). Derived from MNX raw. */
export type Sound = RawSound;

/**
 * MNX `perform-options` — currently a stub object in the MNX spec.
 * Derived from MNX raw (carries only `id?` via global-attrs).
 */
export type PerformOptions = RawPerformOptions;

/**
 * Notehead shape for a drum-kit component (Viritura vendor extension).
 * Stored under `_x.viritura.notehead` because MNX lacks a `notehead` field.
 */
export type NoteheadShape = "normal" | "x" | "circleX" | "diamond" | "slash" | "triangleUp" | "triangleDown";

/** A single drum/percussion instrument on a staff (MNX `kit-component`).
 *  Derived from raw via `HoistVendor`: vendor fields are exposed at the top
 *  level (decoded shapes) while `_x.viritura` remains the wire representation.
 *  - `notehead`: MNX lacks a notehead field (issue #249).
 *  - `drumKit`: optional GS drum-kit program (bank 128) this component's sound
 *    plays on, overriding the part's default kit (e.g. a Tam-tam borrowed from
 *    the Ethnic kit). */
export type KitComponent = HoistVendor<RawKitComponent, { notehead?: NoteheadShape; drumKit?: number }>;

/**
 * A drum-hit "note" within an event (MNX `kit-note`). Unlike a pitched `Note`
 * it carries no pitch; it references a kit-component on the part's kit.
 * Derived from MNX raw, narrowing `ties` to the decoded `Tie` type.
 */
export type KitNote = Narrow<RawKitNote, { ties?: Tie[] }>;
