import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkletSynthesizer } from "spessasynth_lib";
import { cancelScheduledNotes, registerSchedulingWorklet } from "./index";
import {
  createSamplerWorkletHarness,
  createWorkletHarness,
  midiEnvelope,
  type MidiEnvelope,
} from "./workletHarness.spec";

describe("SF2 scheduling worklet", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("registers the staged same-origin adapter URL without fetch or Blob APIs", async () => {
    vi.stubGlobal("fetch", undefined);
    vi.stubGlobal("Blob", undefined);
    vi.stubGlobal("URL", undefined);
    const addModule = vi.fn().mockResolvedValue(undefined);
    const context = { audioWorklet: { addModule } } as unknown as BaseAudioContext;

    await registerSchedulingWorklet(context, "/editor/sounds/viritura-sf2-processor.js");

    expect(addModule).toHaveBeenCalledExactlyOnceWith("/editor/sounds/viritura-sf2-processor.js");
  });

  it("shares concurrent registrations and caches successful registration per context", async () => {
    let complete!: () => void;
    const addModule = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    const context = { audioWorklet: { addModule } } as unknown as BaseAudioContext;
    const workletUrl = "/sounds/viritura-sf2-processor.js";
    const first = registerSchedulingWorklet(context, workletUrl);
    const second = registerSchedulingWorklet(context, workletUrl);
    expect(first).toBe(second);
    expect(addModule).toHaveBeenCalledExactlyOnceWith(workletUrl);
    complete();
    await first;
    expect(registerSchedulingWorklet(context, workletUrl)).toBe(first);
    expect(addModule).toHaveBeenCalledOnce();

    const otherAddModule = vi.fn().mockResolvedValue(undefined);
    const otherContext = { audioWorklet: { addModule: otherAddModule } } as unknown as BaseAudioContext;
    await registerSchedulingWorklet(otherContext, workletUrl);
    expect(otherAddModule).toHaveBeenCalledExactlyOnceWith(workletUrl);
  });

  it("retries registration without caching failures", async () => {
    const addModule = vi.fn().mockRejectedValueOnce(new Error("blocked by CSP")).mockResolvedValue(undefined);
    const context = { audioWorklet: { addModule } } as unknown as BaseAudioContext;
    const workletUrl = "/sounds/viritura-sf2-processor.js";
    const first = registerSchedulingWorklet(context, workletUrl);
    expect(registerSchedulingWorklet(context, workletUrl)).toBe(first);
    await expect(first).rejects.toThrow("blocked by CSP");
    const retry = registerSchedulingWorklet(context, workletUrl);
    expect(retry).not.toBe(first);
    await retry;
    expect(registerSchedulingWorklet(context, workletUrl)).toBe(retry);
    expect(addModule).toHaveBeenCalledTimes(2);
    expect(addModule).toHaveBeenNthCalledWith(2, workletUrl);
  });

  it("reports module failures with the URL, deployment guidance and original cause", async () => {
    const cause = new Error("Unable to load a worklet's module");
    const addModule = vi.fn().mockRejectedValue(cause);
    const context = { audioWorklet: { addModule } } as unknown as BaseAudioContext;
    await expect(registerSchedulingWorklet(context, "/sounds/missing.js")).rejects.toMatchObject({
      message:
        "Failed to load /sounds/missing.js: Unable to load a worklet's module. " +
        "Check that the staged worklet is deployed, reachable, and permitted by the Content Security Policy.",
      cause,
    });
    expect(addModule).toHaveBeenCalledExactlyOnceWith("/sounds/missing.js");
  });

  it("holds every timed MIDI message until its quantum, with stable time ordering and zero vendor time", () => {
    const received: MidiEnvelope[] = [];
    const rendered: number[] = [];
    const h = createWorkletHarness(
      undefined,
      (data) => received.push(data as MidiEnvelope),
      () => {
        rendered.push(received.length);
      },
    );
    h.port.postMessage(midiEnvelope([0x93, 62, 90], 12));
    h.port.postMessage(midiEnvelope([0xc3, 41], 11));
    h.port.postMessage(midiEnvelope([0xb3, 74, 32], 11));
    h.port.postMessage(midiEnvelope([0x93, 60, 90], 11));
    h.port.postMessage(midiEnvelope([0x83, 60, 0], 11));
    expect(received).toEqual([]);

    expect(h.advance(10.999)).toBe(true);
    expect(received).toEqual([]);
    h.advance(11);
    expect(received.map((message) => [...message.data.messageData])).toEqual([
      [0xc3, 41],
      [0xb3, 74, 32],
      [0x93, 60, 90],
      [0x83, 60, 0],
    ]);
    expect(rendered).toEqual([0, 4]);
    expect(received.every((message) => message.data.options.time === 0)).toBe(true);
    h.advance(12);
    expect(received.at(-1)!.data.messageData).toEqual(Uint8Array.from([0x93, 62, 90]));
    h.advance(13);
    expect(received).toHaveLength(5);
  });

  it.each([0, 11])("applies queued sustain before a restored key-up note at incoming time %s", (time) => {
    const h = createSamplerWorkletHarness();
    h.port.postMessage(midiEnvelope([0xb3, 64, 127], 11));
    h.port.postMessage(midiEnvelope([0x93, 62, 90], 11));
    h.port.postMessage(midiEnvelope([0x83, 62, 0], 11));
    h.port.postMessage(midiEnvelope([0xb3, 64, 0], 12));
    h.setClock(11);

    cancelScheduledNotes(h.port, [3], 11);
    expect(h.received).toEqual([]);
    h.port.postMessage(midiEnvelope([0x93, 60, 90], time));
    h.port.postMessage(midiEnvelope([0x83, 60, 0], time));

    expect(h.received.map((message) => [...message.data.messageData])).toEqual([
      [0xb3, 64, 127],
      [0x93, 60, 90],
      [0x83, 60, 0],
    ]);
    expect(h.channels[3]!.voices).toEqual(new Set([60]));
    expect(h.channels[3]!.released).toEqual(new Set([60]));
    h.advance(11);
    expect(h.received).toHaveLength(3);
    expect(h.attacks).toEqual([{ channel: 3, note: 60, time: 11 }]);
    h.advance(12);
    expect(h.channels[3]!.voices.size).toBe(0);
  });

  it("does not move later queued due MIDI ahead of an incoming earlier timestamp", () => {
    const received: MidiEnvelope[] = [];
    const h = createWorkletHarness(undefined, (data) => received.push(data as MidiEnvelope));
    h.port.postMessage(midiEnvelope([0xc3, 41], 11));
    h.port.postMessage(midiEnvelope([0xb3, 74, 32], 12));
    h.sandbox.currentTime = 12;

    h.port.postMessage(midiEnvelope([0x93, 60, 90], 11));
    h.advance(12);

    expect(received.map((message) => [...message.data.messageData])).toEqual([
      [0xc3, 41],
      [0x93, 60, 90],
      [0xb3, 74, 32],
    ]);
    expect(received.every((message) => message.data.options.time === 0)).toBe(true);
  });

  it("passes immediate MIDI and other vendor messages through without mutating worklet globals", () => {
    const received: unknown[] = [];
    const h = createWorkletHarness(undefined, (data) => received.push(data));
    const message = midiEnvelope([0x93, 60, 90]);
    const control = { type: "test-vendor-control", channelNumber: 3, data: true };
    h.port.postMessage(message);
    h.port.postMessage(control);
    expect(received).toEqual([message, control]);
    expect(h.sandbox.AudioWorkletProcessor).toBe(h.originalGlobals.AudioWorkletProcessor);
    expect(h.sandbox.registerProcessor).toBe(h.originalGlobals.registerProcessor);
  });

  it("filters both note statuses including velocity-zero attacks using channel nibble plus offset", () => {
    const received: MidiEnvelope[] = [];
    const h = createWorkletHarness(undefined, (data) => received.push(data as MidiEnvelope));
    const messages = [
      midiEnvelope([0x93, 60, 90], 11, 16),
      midiEnvelope([0x83, 60, 0], 12, 16),
      midiEnvelope([0x93, 61, 0], 12, 16),
      midiEnvelope([0x93, 62, 90], 10.5, 16),
      midiEnvelope([0x83, 62, 0], 10.75, 16),
      midiEnvelope([0x93, 63, 90], 12),
      midiEnvelope([0x94, 64, 90], 12, 16),
      midiEnvelope([0xb3, 120, 0], 12, 16),
      midiEnvelope([0xc3, 41], 12, 16),
      midiEnvelope([0xe3, 0, 64], 12, 16),
    ];
    for (const message of messages) h.port.postMessage(message);

    cancelScheduledNotes(h.port, [19], 11);
    h.advance(12);

    expect(received.map((message) => [...message.data.messageData])).toEqual(
      messages.slice(3).map((message) => [...message.data.messageData]),
    );
    expect(received.map((message) => message.data.channelOffset)).toEqual([16, 16, 0, 16, 16, 16, 16]);
    expect(messages[0]!.data.options.time).toBe(11);
  });

  it("keeps each processor queue isolated and accepts repeated empty cancellation", () => {
    const first: unknown[] = [];
    const second: unknown[] = [];
    const a = createWorkletHarness(undefined, (data) => first.push(data));
    const b = createWorkletHarness(undefined, (data) => second.push(data));
    for (const h of [a, b]) h.port.postMessage(midiEnvelope([0x93, 60, 90], 12));
    cancelScheduledNotes(a.port, [], -Infinity);
    cancelScheduledNotes(a.port, [3], -Infinity);
    cancelScheduledNotes(a.port, [3], -Infinity);
    a.advance(12);
    b.advance(12);
    expect(first).toEqual([]);
    expect(second).toHaveLength(1);
  });

  it("interoperates with the installed vendor node creator, async worklet bootstrap and MIDI envelope", async () => {
    const require = createRequire(import.meta.url);
    const dist = dirname(require.resolve("spessasynth_lib"));
    const source = readFileSync(join(dist, "spessasynth_processor.min.js"), "utf8");
    const h = createWorkletHarness(source);
    const context = { currentTime: 10, sampleRate: 48_000 } as BaseAudioContext;
    const worklet = vi.fn(
      () =>
        ({
          context,
          port: h.port,
          connect: vi.fn(),
          disconnect: vi.fn(),
        }) as unknown as AudioWorkletNode,
    );
    const synth = new WorkletSynthesizer(context, { audioNodeCreators: { worklet } });
    await synth.isReady;
    const releases: { channel: number; midiNote: number }[] = [];
    const controllers: { channel: number; controller: number; value: number }[] = [];
    synth.eventHandler.addEvent("noteOff", "test", (event) => releases.push(event));
    synth.eventHandler.addEvent("controllerChange", "test", (event) => controllers.push(event));

    synth.noteOff(3, 60, { time: 12 });
    synth.noteOn(3, 61, 0, { time: 12 });
    synth.noteOff(4, 62, { time: 12 });
    synth.controllerChange(3, 74, 32, { time: 12 });
    expect(h.sent.slice(-4)).toEqual([
      midiEnvelope([0x83, 60], 12),
      midiEnvelope([0x93, 61, 0], 12),
      midiEnvelope([0x84, 62], 12),
      midiEnvelope([0xb3, 74, 32], 12),
    ]);
    cancelScheduledNotes(h.port, [3], 12);
    h.advance(11.99);
    await Promise.resolve();
    expect(releases).toEqual([]);
    expect(controllers).toEqual([]);
    h.advance(12);
    await Promise.resolve();
    expect(releases).toEqual([{ channel: 4, midiNote: 62 }]);
    expect(controllers).toEqual([expect.objectContaining({ channel: 3, controller: 74, value: 32 })]);
    synth.noteOff(3, 63);
    await Promise.resolve();
    expect(releases.at(-1)).toEqual({ channel: 3, midiNote: 63 });
    expect(worklet).toHaveBeenCalledExactlyOnceWith(
      context,
      expect.any(String),
      expect.objectContaining({
        processorOptions: { oneOutput: false, eventsEnabled: true },
      }),
    );
    synth.destroy();
  });
});
