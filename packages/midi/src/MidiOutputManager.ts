/**
 * MidiOutputManager — manages a selected MIDI output port and sends
 * real-time MIDI messages to external devices / DAWs via the Web MIDI API.
 *
 * Usage:
 *   const mgr = new MidiOutputManager();
 *   await mgr.init();            // requests MIDI access
 *   mgr.selectOutput(portId);    // pick a port from getOutputs()
 *   mgr.sendNoteOn(60, 100, 0);  // middle C, velocity 100, channel 0
 *   mgr.sendNoteOff(60, 0);      // release
 */

import { isWebMidiSupported, requestMidiAccess, listMidiOutputs } from "./webMidi";

// ── MIDI status bytes ───────────────────────────────────────────────
const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;
const CONTROL_CHANGE = 0xb0;
const PROGRAM_CHANGE = 0xc0;

// ── Public types ────────────────────────────────────────────────────

export interface MidiOutputPort {
  readonly id: string;
  readonly name: string;
  readonly manufacturer: string;
  readonly state: MIDIPortDeviceState;
}

export interface MidiOutputManagerEvents {
  /** Fired when the list of available ports changes (connect / disconnect). */
  portschanged: readonly MidiOutputPort[];
  /** Fired when the selected port changes (including deselection → null). */
  outputchanged: MidiOutputPort | null;
}

type Listener<K extends keyof MidiOutputManagerEvents> = (payload: MidiOutputManagerEvents[K]) => void;

// ── Implementation ──────────────────────────────────────────────────

export class MidiOutputManager {
  private access: MIDIAccess | null = null;
  private selectedPort: MIDIOutput | null = null;
  private listeners = new Map<keyof MidiOutputManagerEvents, Set<Listener<keyof MidiOutputManagerEvents>>>();

  /**
   * `true` after a successful {@link init} call.
   * When `false`, all send methods are no-ops.
   */
  get isInitialized(): boolean {
    return this.access !== null;
  }

  /** `true` when the browser exposes the Web MIDI API at all. */
  get isSupported(): boolean {
    return isWebMidiSupported();
  }

  /** The currently selected output port, or `null`. */
  get selectedOutput(): MidiOutputPort | null {
    return this.selectedPort ? portToInfo(this.selectedPort) : null;
  }

  // ── Lifecycle ───────────────────────────────────────────────────

  /**
   * Request MIDI access and begin listening for device changes.
   * Returns `true` on success, `false` if access was denied or unsupported.
   */
  async init(): Promise<boolean> {
    const access = await requestMidiAccess();
    if (!access) {
      return false;
    }
    this.access = access;
    access.onstatechange = () => {
      this.emit("portschanged", this.getOutputs());
      // If the selected port disconnected, deselect it
      if (this.selectedPort && this.selectedPort.state === "disconnected") {
        this.selectedPort = null;
        this.emit("outputchanged", null);
      }
    };
    return true;
  }

  /** Release resources and disconnect from all ports. */
  dispose(): void {
    if (this.selectedPort) {
      this.selectedPort = null;
    }
    if (this.access) {
      this.access.onstatechange = null;
      this.access = null;
    }
    this.listeners.clear();
  }

  // ── Port selection ──────────────────────────────────────────────

  /** Enumerate available MIDI output ports. */
  getOutputs(): readonly MidiOutputPort[] {
    if (!this.access) return [];
    return listMidiOutputs(this.access).map(([, port]) => portToInfo(port));
  }

  /**
   * Select an output port by its ID.
   * Pass `null` to deselect.
   */
  selectOutput(portId: string | null): void {
    if (!this.access) return;
    if (portId === null) {
      this.selectedPort = null;
      this.emit("outputchanged", null);
      return;
    }
    const port = this.access.outputs.get(portId);
    if (!port) return;
    this.selectedPort = port;
    this.emit("outputchanged", portToInfo(port));
  }

  // ── MIDI message sending ────────────────────────────────────────

  /**
   * Send a Note On message.
   * @param note     MIDI note number 0-127
   * @param velocity Velocity 1-127  (0 is treated as Note Off per MIDI spec)
   * @param channel  MIDI channel 0-15 (default 0)
   */
  sendNoteOn(note: number, velocity: number, channel: number = 0): void {
    this.send([NOTE_ON | (channel & 0x0f), note & 0x7f, velocity & 0x7f]);
  }

  /**
   * Send a Note Off message.
   * @param note    MIDI note number 0-127
   * @param channel MIDI channel 0-15 (default 0)
   */
  sendNoteOff(note: number, channel: number = 0): void {
    this.send([NOTE_OFF | (channel & 0x0f), note & 0x7f, 0]);
  }

  /**
   * Send a Control Change message.
   * @param controller CC number 0-127
   * @param value      Value 0-127
   * @param channel    MIDI channel 0-15 (default 0)
   */
  sendControlChange(controller: number, value: number, channel: number = 0): void {
    this.send([CONTROL_CHANGE | (channel & 0x0f), controller & 0x7f, value & 0x7f]);
  }

  /**
   * Send a Program Change message.
   * @param program Program number 0-127
   * @param channel MIDI channel 0-15 (default 0)
   */
  sendProgramChange(program: number, channel: number = 0): void {
    this.send([PROGRAM_CHANGE | (channel & 0x0f), program & 0x7f]);
  }

  /**
   * Send an All Notes Off (CC 123) on the given channel.
   * Useful for panic / stop scenarios.
   */
  sendAllNotesOff(channel: number = 0): void {
    this.sendControlChange(123, 0, channel);
  }

  /**
   * Send All Notes Off on every channel (0-15).
   */
  panic(): void {
    for (let ch = 0; ch < 16; ch++) {
      this.sendAllNotesOff(ch);
    }
  }

  // ── Event emitter ───────────────────────────────────────────────

  on<K extends keyof MidiOutputManagerEvents>(event: K, listener: Listener<K>): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener<keyof MidiOutputManagerEvents>);
  }

  off<K extends keyof MidiOutputManagerEvents>(event: K, listener: Listener<K>): void {
    this.listeners.get(event)?.delete(listener as Listener<keyof MidiOutputManagerEvents>);
  }

  // ── Internal ────────────────────────────────────────────────────

  private send(data: number[]): void {
    this.selectedPort?.send(data);
  }

  private emit<K extends keyof MidiOutputManagerEvents>(event: K, payload: MidiOutputManagerEvents[K]): void {
    this.listeners.get(event)?.forEach((fn) => {
      (fn as Listener<K>)(payload);
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────────

function portToInfo(port: MIDIOutput): MidiOutputPort {
  return {
    id: port.id,
    name: port.name ?? "(unnamed)",
    manufacturer: port.manufacturer ?? "",
    state: port.state,
  };
}
