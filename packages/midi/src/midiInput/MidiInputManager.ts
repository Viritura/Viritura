import { isWebMidiSupported, listMidiInputs, requestMidiAccess } from "../webMidi";
import { decodeMidiInputMessage } from "./messageDecoder";
import type { MidiInputManagerEvents, MidiInputPort } from "./types";

type Listener<K extends keyof MidiInputManagerEvents> = (payload: MidiInputManagerEvents[K]) => void;

function portToInfo(port: MIDIInput): MidiInputPort {
  return {
    id: port.id,
    name: port.name ?? "(unnamed)",
    manufacturer: port.manufacturer ?? "",
    state: port.state,
    connection: port.connection,
  };
}

export class MidiInputManager {
  private access: MIDIAccess | null = null;
  private initialization: Promise<boolean> | null = null;
  private selectedPort: MIDIInput | null = null;
  private readonly listeners = new Map<keyof MidiInputManagerEvents, Set<Listener<keyof MidiInputManagerEvents>>>();

  get isInitialized(): boolean {
    return this.access !== null;
  }

  get isSupported(): boolean {
    return isWebMidiSupported();
  }

  get selectedInput(): MidiInputPort | null {
    return this.selectedPort ? portToInfo(this.selectedPort) : null;
  }

  async init(): Promise<boolean> {
    if (this.access) return true;
    if (this.initialization) return this.initialization;
    this.initialization = this.initialize();
    return this.initialization;
  }

  private async initialize(): Promise<boolean> {
    const access = await requestMidiAccess();
    if (!access) {
      this.initialization = null;
      return false;
    }

    this.access = access;
    access.onstatechange = () => {
      if (this.selectedPort?.state === "disconnected") {
        this.detachSelectedPort();
        this.emit("inputchanged", null);
      }
      this.emit("inputschanged", this.getInputs());
    };
    return true;
  }

  dispose(): void {
    this.detachSelectedPort();
    if (this.access) {
      this.access.onstatechange = null;
      this.access = null;
    }
    this.initialization = null;
    this.listeners.clear();
  }

  getInputs(): readonly MidiInputPort[] {
    if (!this.access) return [];
    return listMidiInputs(this.access).map(([, port]) => portToInfo(port));
  }

  selectInput(portId: string | null): boolean {
    if (!this.access) return false;

    this.detachSelectedPort();
    if (portId === null) {
      this.emit("inputchanged", null);
      return true;
    }

    const port = this.access.inputs.get(portId);
    if (!port || port.state === "disconnected") return false;

    this.selectedPort = port;
    port.onmidimessage = (event) => {
      if (event.data) {
        this.emit("message", decodeMidiInputMessage(port.id, event.timeStamp, event.data));
      }
    };
    this.emit("inputchanged", portToInfo(port));
    return true;
  }

  on<K extends keyof MidiInputManagerEvents>(event: K, listener: Listener<K>): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener<keyof MidiInputManagerEvents>);
  }

  off<K extends keyof MidiInputManagerEvents>(event: K, listener: Listener<K>): void {
    this.listeners.get(event)?.delete(listener as Listener<keyof MidiInputManagerEvents>);
  }

  private detachSelectedPort(): void {
    if (!this.selectedPort) return;
    this.selectedPort.onmidimessage = null;
    this.selectedPort = null;
  }

  private emit<K extends keyof MidiInputManagerEvents>(event: K, payload: MidiInputManagerEvents[K]): void {
    this.listeners.get(event)?.forEach((listener) => {
      (listener as Listener<K>)(payload);
    });
  }
}
