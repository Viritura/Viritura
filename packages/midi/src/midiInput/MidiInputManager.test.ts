import { afterEach, describe, expect, it, vi } from "vitest";
import { MidiInputManager } from "./MidiInputManager";
import { decodeMidiInputMessage } from "./messageDecoder";
import { queryMidiPermission } from "../webMidi";

function createMockInput(overrides: Partial<MIDIInput> = {}): MIDIInput {
  return {
    id: "input-1",
    name: "Test Controller",
    manufacturer: "Test Corp",
    state: "connected",
    type: "input",
    version: "1.0",
    connection: "open",
    onmidimessage: null,
    onstatechange: null,
    open: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn().mockReturnValue(true),
    ...overrides,
  } as unknown as MIDIInput;
}

function createMockAccess(inputs: MIDIInput[]): MIDIAccess & { fireStateChange: () => void } {
  const inputMap = new Map(inputs.map((input) => [input.id, input]));
  const access = {
    inputs: inputMap,
    outputs: new Map(),
    onstatechange: null as ((event: MIDIConnectionEvent) => void) | null,
    sysexEnabled: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn().mockReturnValue(true),
    fireStateChange() {
      access.onstatechange?.(new Event("statechange") as MIDIConnectionEvent);
    },
  };
  return access as unknown as MIDIAccess & { fireStateChange: () => void };
}

function installMidiAccess(access: MIDIAccess): () => void {
  const original = Object.getOwnPropertyDescriptor(navigator, "requestMIDIAccess");
  Object.defineProperty(navigator, "requestMIDIAccess", {
    configurable: true,
    value: vi.fn().mockResolvedValue(access),
  });
  return () => {
    if (original) Object.defineProperty(navigator, "requestMIDIAccess", original);
    else delete (navigator as unknown as Record<string, unknown>).requestMIDIAccess;
  };
}

describe("decodeMidiInputMessage", () => {
  it("decodes channel messages and normalizes zero-velocity note-on", () => {
    expect(decodeMidiInputMessage("keyboard", 12, [0x92, 60, 100])).toMatchObject({
      kind: "note-on",
      channel: 2,
      data1: 60,
      data2: 100,
    });
    expect(decodeMidiInputMessage("keyboard", 13, [0x92, 60, 0]).kind).toBe("note-off");
  });

  it("preserves raw bytes for system messages", () => {
    expect(decodeMidiInputMessage("keyboard", 12, [0xf8])).toEqual({
      inputId: "keyboard",
      receivedTime: 12,
      data: [0xf8],
      kind: "system",
      channel: null,
      data1: null,
      data2: null,
    });
  });
});

describe("MidiInputManager", () => {
  let restore: (() => void) | undefined;
  let manager: MidiInputManager | undefined;

  afterEach(() => {
    manager?.dispose();
    restore?.();
  });

  it("lists, selects, and receives messages from an input", async () => {
    const input = createMockInput();
    restore = installMidiAccess(createMockAccess([input]));
    manager = new MidiInputManager();
    const listener = vi.fn();
    manager.on("message", listener);

    expect(await manager.init()).toBe(true);
    expect(manager.getInputs()).toEqual([
      {
        id: "input-1",
        name: "Test Controller",
        manufacturer: "Test Corp",
        state: "connected",
        connection: "open",
      },
    ]);
    expect(manager.selectInput("input-1")).toBe(true);

    input.onmidimessage?.({
      data: new Uint8Array([0xb0, 74, 96]),
      timeStamp: 42,
    } as MIDIMessageEvent);

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        inputId: "input-1",
        kind: "control-change",
        channel: 0,
        data1: 74,
        data2: 96,
      }),
    );
  });

  it("coalesces concurrent initialization requests", async () => {
    restore = installMidiAccess(createMockAccess([]));
    manager = new MidiInputManager();

    await Promise.all([manager.init(), manager.init()]);

    expect(navigator.requestMIDIAccess).toHaveBeenCalledTimes(1);
  });

  it("detaches and reports when the selected input disconnects", async () => {
    const input = createMockInput();
    const access = createMockAccess([input]);
    restore = installMidiAccess(access);
    manager = new MidiInputManager();
    const listener = vi.fn();
    manager.on("inputchanged", listener);
    await manager.init();
    manager.selectInput(input.id);

    Object.defineProperty(input, "state", { configurable: true, value: "disconnected" });
    access.fireStateChange();

    expect(input.onmidimessage).toBeNull();
    expect(manager.selectedInput).toBeNull();
    expect(listener).toHaveBeenLastCalledWith(null);
  });
});

describe("queryMidiPermission", () => {
  it("reports previously granted access without requesting MIDI access", async () => {
    const original = Object.getOwnPropertyDescriptor(navigator, "permissions");
    const query = vi.fn().mockResolvedValue({ state: "granted" });
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: { query },
    });

    try {
      await expect(queryMidiPermission()).resolves.toBe("granted");
      expect(query).toHaveBeenCalledWith({ name: "midi", sysex: false });
    } finally {
      if (original) Object.defineProperty(navigator, "permissions", original);
      else delete (navigator as unknown as Record<string, unknown>).permissions;
    }
  });
});
