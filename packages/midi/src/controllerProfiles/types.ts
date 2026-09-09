import type { NoteValueBase } from "@viritura/core";

export type ControllerAction =
  | { readonly type: "transport.play-stop" }
  | { readonly type: "history.undo" }
  | { readonly type: "note-input.toggle" }
  | { readonly type: "note-input.move-cursor"; readonly direction: "left" | "right" | "up" | "down" }
  | { readonly type: "note-input.set-duration"; readonly duration: NoteValueBase };

export interface ControllerPortProfile {
  readonly role: string;
  readonly names: readonly string[];
}

export interface ControllerBinding {
  readonly portRole: string;
  readonly message: "control-change" | "note-on";
  /** Human-readable MIDI channel number, 1-16. */
  readonly channel: number;
  readonly number: number;
  readonly value?: number;
  readonly action: ControllerAction;
}

export interface ControllerProfile {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly name: string;
  readonly manufacturer: string;
  readonly match: {
    readonly nameIncludes: readonly string[];
    readonly manufacturerIncludes: readonly string[];
  };
  readonly ports: readonly ControllerPortProfile[];
  readonly bindings: readonly ControllerBinding[];
  readonly notePreview?: {
    readonly portRole: string;
    /** Zero-based General MIDI program number. */
    readonly program?: number;
    /** Human-readable MIDI channel numbers, 1-16. */
    readonly channels: readonly number[];
  };
  readonly tested: {
    readonly operatingSystems: readonly string[];
    readonly firmware?: string;
    readonly notes: string;
  };
}
