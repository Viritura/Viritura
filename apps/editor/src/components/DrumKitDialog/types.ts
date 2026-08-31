import type { NoteheadShape } from "@viritura/core";

/**
 * One editable drum-kit mapping row: a notated identity (staff position +
 * notehead) bound to a concrete sound (a MIDI key on a drum kit).
 */
export interface KitComponentEdit {
  /** Kit-component id (stable; referenced by kit-notes). */
  readonly id: string;
  /** Display name (e.g. "Snare", "Crash"). */
  name: string;
  /** MNX staff position: 0 = middle line, +N above, −N below (half-spaces). */
  staffPosition: number;
  /** Notehead shape rendered for hits on this component. */
  notehead: NoteheadShape;
  /** GS drum-kit program this component borrows its sound from, or undefined
   *  to play on the part's default kit. Maps to `_x.viritura.drumKit`. */
  drumKit: number | undefined;
  /** MIDI key (drum note number) that produces this component's sound. */
  midiKey: number;
}

/** The percussion part the dialog is editing. */
export interface DrumKitTarget {
  /** Index of the part within `score.parts`. */
  readonly partIndex: number;
  /** Part name, for the dialog header. */
  readonly partName: string;
  /** Initial mapping rows, resolved from `part.kit` + `global.sounds`. */
  readonly components: readonly KitComponentEdit[];
}
