export interface MidiInputPort {
  readonly id: string;
  readonly name: string;
  readonly manufacturer: string;
  readonly state: MIDIPortDeviceState;
  readonly connection: MIDIPortConnectionState;
}

export type MidiInputMessageKind =
  | "note-off"
  | "note-on"
  | "polyphonic-key-pressure"
  | "control-change"
  | "program-change"
  | "channel-pressure"
  | "pitch-bend"
  | "system"
  | "unknown";

export interface MidiInputMessage {
  readonly inputId: string;
  readonly receivedTime: number;
  readonly data: readonly number[];
  readonly kind: MidiInputMessageKind;
  /** Zero-based MIDI channel, or null for system messages. */
  readonly channel: number | null;
  readonly data1: number | null;
  readonly data2: number | null;
}

export interface MidiInputManagerEvents {
  readonly inputschanged: readonly MidiInputPort[];
  readonly inputchanged: MidiInputPort | null;
  readonly message: MidiInputMessage;
}
