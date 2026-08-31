import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MidiOutputManager } from "./MidiOutputManager";
import { isWebMidiSupported, requestMidiAccess, listMidiOutputs } from "./webMidi";

// ── Mock helpers ────────────────────────────────────────────────────

function createMockOutput(overrides: Partial<MIDIOutput> = {}): MIDIOutput {
  return {
    id: "out-1",
    name: "Virtual MIDI Port",
    manufacturer: "Test Corp",
    state: "connected" as MIDIPortDeviceState,
    type: "output" as const,
    version: "1.0",
    connection: "open" as MIDIPortConnectionState,
    send: vi.fn(),
    open: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    onstatechange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn().mockReturnValue(true),
    ...overrides,
  } as unknown as MIDIOutput;
}

function createMockAccess(outputs: MIDIOutput[] = []): MIDIAccess & { _fireStateChange: () => void } {
  const outputMap = new Map<string, MIDIOutput>();
  for (const out of outputs) {
    outputMap.set(out.id, out);
  }

  const access = {
    inputs: new Map(),
    outputs: outputMap,
    onstatechange: null as ((evt: Event) => void) | null,
    sysexEnabled: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn().mockReturnValue(true),
    _fireStateChange() {
      if (typeof access.onstatechange === "function") {
        access.onstatechange(new Event("statechange") as unknown as MIDIConnectionEvent);
      }
    },
  } as unknown as MIDIAccess & { _fireStateChange: () => void };

  return access;
}

function mockNavigatorMidiAccess(access: MIDIAccess | null): () => void {
  const original = Object.getOwnPropertyDescriptor(navigator, "requestMIDIAccess");

  if (access) {
    Object.defineProperty(navigator, "requestMIDIAccess", {
      value: vi.fn().mockResolvedValue(access),
      configurable: true,
      writable: true,
    });
  } else {
    // Simulate unsupported browser
    const desc = Object.getOwnPropertyDescriptor(navigator, "requestMIDIAccess");
    if (desc) {
      Object.defineProperty(navigator, "requestMIDIAccess", {
        value: undefined,
        configurable: true,
        writable: true,
      });
    }
  }

  return () => {
    if (original) {
      Object.defineProperty(navigator, "requestMIDIAccess", original);
    } else {
      delete (navigator as unknown as Record<string, unknown>)["requestMIDIAccess"];
    }
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe("webMidi helpers", () => {
  let restore: () => void;

  afterEach(() => {
    restore?.();
  });

  it("isWebMidiSupported returns true when API present", () => {
    const access = createMockAccess();
    restore = mockNavigatorMidiAccess(access);
    expect(isWebMidiSupported()).toBe(true);
  });

  it("requestMidiAccess returns MIDIAccess on success", async () => {
    const access = createMockAccess();
    restore = mockNavigatorMidiAccess(access);
    const result = await requestMidiAccess();
    expect(result).toBe(access);
  });

  it("requestMidiAccess returns null when unsupported", async () => {
    restore = mockNavigatorMidiAccess(null);
    // Also need to remove the property
    delete (navigator as unknown as Record<string, unknown>)["requestMIDIAccess"];
    const result = await requestMidiAccess();
    expect(result).toBeNull();
  });

  it("listMidiOutputs enumerates ports sorted by name", () => {
    const portB = createMockOutput({ id: "b", name: "Zebra Port" });
    const portA = createMockOutput({ id: "a", name: "Alpha Port" });
    const access = createMockAccess([portB, portA]);
    const list = listMidiOutputs(access);
    expect(list).toHaveLength(2);
    expect(list[0]![1].name).toBe("Alpha Port");
    expect(list[1]![1].name).toBe("Zebra Port");
  });
});

describe("MidiOutputManager", () => {
  let mgr: MidiOutputManager;
  let output1: MIDIOutput;
  let output2: MIDIOutput;
  let access: MIDIAccess & { _fireStateChange: () => void };
  let restore: () => void;

  beforeEach(() => {
    output1 = createMockOutput({ id: "out-1", name: "Port A" });
    output2 = createMockOutput({ id: "out-2", name: "Port B" });
    access = createMockAccess([output1, output2]);
    restore = mockNavigatorMidiAccess(access);
    mgr = new MidiOutputManager();
  });

  afterEach(() => {
    mgr.dispose();
    restore();
  });

  // ── init ──────────────────────────────────────────────────────

  it("init() returns true when MIDI access is granted", async () => {
    expect(await mgr.init()).toBe(true);
    expect(mgr.isInitialized).toBe(true);
  });

  it("init() returns false when access denied", async () => {
    restore();
    restore = mockNavigatorMidiAccess(null);
    delete (navigator as unknown as Record<string, unknown>)["requestMIDIAccess"];
    const m = new MidiOutputManager();
    expect(await m.init()).toBe(false);
    expect(m.isInitialized).toBe(false);
  });

  // ── Port listing ──────────────────────────────────────────────

  it("getOutputs() lists available ports", async () => {
    await mgr.init();
    const outputs = mgr.getOutputs();
    expect(outputs).toHaveLength(2);
    expect(outputs[0]!.name).toBe("Port A");
    expect(outputs[1]!.name).toBe("Port B");
  });

  it("getOutputs() returns empty before init", () => {
    expect(mgr.getOutputs()).toEqual([]);
  });

  // ── Port selection ────────────────────────────────────────────

  it("selectOutput() sets the selected port", async () => {
    await mgr.init();
    mgr.selectOutput("out-1");
    expect(mgr.selectedOutput).toEqual({
      id: "out-1",
      name: "Port A",
      manufacturer: "Test Corp",
      state: "connected",
    });
  });

  it("selectOutput(null) deselects", async () => {
    await mgr.init();
    mgr.selectOutput("out-1");
    mgr.selectOutput(null);
    expect(mgr.selectedOutput).toBeNull();
  });

  it("emits outputchanged on selection", async () => {
    await mgr.init();
    const listener = vi.fn();
    mgr.on("outputchanged", listener);
    mgr.selectOutput("out-1");
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ id: "out-1", name: "Port A" }));
  });

  // ── Note On ───────────────────────────────────────────────────

  it("sendNoteOn sends correct MIDI bytes", async () => {
    await mgr.init();
    mgr.selectOutput("out-1");
    mgr.sendNoteOn(60, 100, 0);
    expect(output1.send).toHaveBeenCalledWith([0x90, 60, 100]);
  });

  it("sendNoteOn on channel 9 uses correct status byte", async () => {
    await mgr.init();
    mgr.selectOutput("out-1");
    mgr.sendNoteOn(36, 127, 9);
    // 0x90 | 9 = 0x99
    expect(output1.send).toHaveBeenCalledWith([0x99, 36, 127]);
  });

  it("sendNoteOn clamps note and velocity to 7-bit", async () => {
    await mgr.init();
    mgr.selectOutput("out-1");
    mgr.sendNoteOn(200, 200, 0);
    // 200 & 0x7F = 72 for note, 200 & 0x7F = 72 for velocity
    expect(output1.send).toHaveBeenCalledWith([0x90, 200 & 0x7f, 200 & 0x7f]);
  });

  // ── Note Off ──────────────────────────────────────────────────

  it("sendNoteOff sends correct MIDI bytes", async () => {
    await mgr.init();
    mgr.selectOutput("out-1");
    mgr.sendNoteOff(60, 0);
    expect(output1.send).toHaveBeenCalledWith([0x80, 60, 0]);
  });

  it("sendNoteOff on channel 5", async () => {
    await mgr.init();
    mgr.selectOutput("out-1");
    mgr.sendNoteOff(48, 5);
    // 0x80 | 5 = 0x85
    expect(output1.send).toHaveBeenCalledWith([0x85, 48, 0]);
  });

  // ── Control Change ────────────────────────────────────────────

  it("sendControlChange sends correct bytes", async () => {
    await mgr.init();
    mgr.selectOutput("out-1");
    mgr.sendControlChange(7, 64, 0); // CC7 = volume
    expect(output1.send).toHaveBeenCalledWith([0xb0, 7, 64]);
  });

  // ── Program Change ────────────────────────────────────────────

  it("sendProgramChange sends correct bytes", async () => {
    await mgr.init();
    mgr.selectOutput("out-1");
    mgr.sendProgramChange(42, 2);
    // 0xC0 | 2 = 0xC2
    expect(output1.send).toHaveBeenCalledWith([0xc2, 42]);
  });

  // ── All Notes Off / Panic ─────────────────────────────────────

  it("sendAllNotesOff sends CC 123 with value 0", async () => {
    await mgr.init();
    mgr.selectOutput("out-1");
    mgr.sendAllNotesOff(3);
    // 0xB0 | 3 = 0xB3, CC 123, value 0
    expect(output1.send).toHaveBeenCalledWith([0xb3, 123, 0]);
  });

  it("panic sends All Notes Off on all 16 channels", async () => {
    await mgr.init();
    mgr.selectOutput("out-1");
    mgr.panic();
    expect(output1.send).toHaveBeenCalledTimes(16);
    for (let ch = 0; ch < 16; ch++) {
      expect(output1.send).toHaveBeenCalledWith([0xb0 | ch, 123, 0]);
    }
  });

  // ── No-op when no port selected ───────────────────────────────

  it("sendNoteOn is a no-op when no port selected", async () => {
    await mgr.init();
    mgr.sendNoteOn(60, 100); // no selectedPort
    expect(output1.send).not.toHaveBeenCalled();
    expect(output2.send).not.toHaveBeenCalled();
  });

  // ── Port disconnect handling ──────────────────────────────────

  it("deselects port when it disconnects", async () => {
    await mgr.init();
    mgr.selectOutput("out-1");
    const listener = vi.fn();
    mgr.on("outputchanged", listener);

    // Simulate disconnect
    (output1 as { state: string }).state = "disconnected";
    access._fireStateChange();

    expect(mgr.selectedOutput).toBeNull();
    expect(listener).toHaveBeenCalledWith(null);
  });

  it("emits portschanged on state change", async () => {
    await mgr.init();
    const listener = vi.fn();
    mgr.on("portschanged", listener);

    access._fireStateChange();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(expect.any(Array));
  });

  // ── Event listener management ─────────────────────────────────

  it("off() removes a listener", async () => {
    await mgr.init();
    const listener = vi.fn();
    mgr.on("outputchanged", listener);
    mgr.off("outputchanged", listener);
    mgr.selectOutput("out-1");
    expect(listener).not.toHaveBeenCalled();
  });

  // ── dispose ───────────────────────────────────────────────────

  it("dispose clears state", async () => {
    await mgr.init();
    mgr.selectOutput("out-1");
    mgr.dispose();
    expect(mgr.isInitialized).toBe(false);
    expect(mgr.selectedOutput).toBeNull();
    expect(mgr.getOutputs()).toEqual([]);
  });
});
