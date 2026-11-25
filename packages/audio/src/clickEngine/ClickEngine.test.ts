import { createContext, runInContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClickEngine, ClickEngineError, type ClickEngineEvent } from "./ClickEngine";
import { compileClickProgram } from "./clickProgram";
import { buildClickWorklet, CLICK_PROCESSOR_NAME } from "./workletSource";
import { CLICK_SOUNDS, synthesizeClickVoices } from "../clickSound";

const SAMPLE_RATE = 48_000;
const BLOCK = 128;

interface TestPort {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(data: unknown, transfer?: Transferable[]): void;
}

interface TestProcessor {
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}

function createClickDevice() {
  const nodePort: TestPort = {
    onmessage: null,
    postMessage(data) {
      workerPort.onmessage?.({ data: structuredClone(data) });
    },
  };
  const workerPort: TestPort = {
    onmessage: null,
    postMessage(data) {
      const message = structuredClone(data);
      queueMicrotask(() => nodePort.onmessage?.({ data: message }));
    },
  };
  let Processor: (new (options: { processorOptions: unknown }) => TestProcessor) | undefined;
  const sandbox = createContext({
    AudioWorkletProcessor: class {
      get port() {
        return workerPort;
      }
    },
    registerProcessor(name: string, constructor: new (options: { processorOptions: unknown }) => TestProcessor) {
      expect(name).toBe(CLICK_PROCESSOR_NAME);
      Processor = constructor;
    },
    sampleRate: SAMPLE_RATE,
    currentFrame: 0,
  });
  let processor: TestProcessor | undefined;
  const left: number[] = [];
  const right: number[] = [];
  const context = {
    sampleRate: SAMPLE_RATE,
    state: "running" as AudioContextState,
    destination: {},
    get currentTime() {
      return (sandbox.currentFrame as number) / SAMPLE_RATE;
    },
    resume: vi.fn(async () => {}),
    close: vi.fn(async () => {
      context.state = "closed";
    }),
    audioWorklet: {
      addModule: vi.fn(async () => {
        runInContext(buildClickWorklet(), sandbox);
      }),
    },
  };
  vi.stubGlobal(
    "AudioWorkletNode",
    class {
      readonly port = nodePort;
      connect = vi.fn();
      disconnect = vi.fn();
      constructor(_context: AudioContext, _name: string, options: AudioWorkletNodeOptions) {
        if (!Processor) throw new Error("Click processor was not registered");
        processor = new Processor(structuredClone({ processorOptions: options.processorOptions }));
      }
    },
  );
  return {
    context: context as unknown as AudioContext,
    workerPort,
    left,
    right,
    get frame() {
      return sandbox.currentFrame as number;
    },
    render(untilFrame: number) {
      while ((sandbox.currentFrame as number) < untilFrame) {
        const outputs = [[new Float32Array(BLOCK), new Float32Array(BLOCK)]];
        processor!.process([], outputs);
        left.push(...outputs[0]![0]!);
        right.push(...outputs[0]![1]!);
        sandbox.currentFrame = (sandbox.currentFrame as number) + BLOCK;
      }
    },
  };
}

/** Absolute frames where a click voice begins (silence, zero-phase sample, then signal). */
function onsets(samples: readonly number[]): number[] {
  const found: number[] = [];
  for (let i = 0; i + 1 < samples.length; i++) {
    if (samples[i] === 0 && samples[i + 1] !== 0 && (i === 0 || samples[i - 1] === 0)) found.push(i);
  }
  return found;
}

async function createEngine(device = createClickDevice()) {
  const engine = await ClickEngine.create({ createContext: () => device.context, workletUrl: "/sounds/click.js" });
  return { device, engine };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("compileClickProgram", () => {
  it("rounds every click from its absolute time so long programs never drift", () => {
    const interval = 60 / 137;
    const events = Array.from({ length: 10_000 }, (_, index) => ({ time: index * interval, level: "beat" as const }));
    const { frames } = compileClickProgram(events, SAMPLE_RATE);
    expect(frames[9_999]).toBe(Math.round(9_999 * interval * SAMPLE_RATE));
  });

  it("rejects negative, non-finite, and out-of-order clicks instead of dropping them", () => {
    expect(() => compileClickProgram([{ time: -0.1, level: "beat" }], SAMPLE_RATE)).toThrow(RangeError);
    expect(() => compileClickProgram([{ time: Number.NaN, level: "beat" }], SAMPLE_RATE)).toThrow(RangeError);
    expect(() =>
      compileClickProgram(
        [
          { time: 1, level: "beat" },
          { time: 0.5, level: "beat" },
        ],
        SAMPLE_RATE,
      ),
    ).toThrow(RangeError);
  });
});

describe("ClickEngine", () => {
  it("keeps playing through the final beat until the supplied track endpoint", async () => {
    const { device, engine } = await createEngine();
    const events: ClickEngineEvent[] = [];
    engine.onEvent((event) => events.push(event));
    await engine.load([{ time: 0, level: "accent" }], 1);
    await engine.start(0, 0.01);
    device.render(24_000);
    await Promise.resolve();
    expect(events.map((event) => event.type)).toEqual(["started"]);
    device.render(49_000);
    await Promise.resolve();
    expect(events.map((event) => event.type)).toEqual(["started", "ended"]);
  });

  it("renders every click on its exact sample frame from the armed anchor", async () => {
    const { device, engine } = await createEngine();
    const events: ClickEngineEvent[] = [];
    engine.onEvent((event) => events.push(event));
    await expect(
      engine.load([
        { time: 0, level: "accent" },
        { time: 0.05, level: "beat" },
        { time: 0.1, level: "subdivision" },
      ]),
    ).resolves.toBe(3);

    const receipt = await engine.start(0, 0.01);
    expect(receipt.contextTime).toBe(480 / SAMPLE_RATE);
    device.render(8_000);
    await Promise.resolve();

    expect(onsets(device.left)).toEqual([480, 480 + 2_400, 480 + 4_800]);
    expect(device.right).toEqual(device.left);
    const peak = (from: number) => Math.max(...device.left.slice(from, from + 200).map(Math.abs));
    expect(peak(480)).toBeGreaterThan(peak(2_880));
    expect(peak(2_880)).toBeGreaterThan(peak(5_280));
    expect(events).toEqual([{ type: "started", contextTime: 480 / SAMPLE_RATE }, { type: "ended" }]);
  });

  it("switches future clicks without changing their frames or interrupting an active voice", async () => {
    const { device, engine } = await createEngine();
    const tick = synthesizeClickVoices(SAMPLE_RATE, "tick")[0];
    const woodblock = synthesizeClickVoices(SAMPLE_RATE, "woodblock")[1];
    await engine.load([
      { time: 0, level: "accent" },
      { time: 0.07, level: "beat" },
    ]);
    await engine.start(0, 0.01);
    device.render(512);
    await engine.setSound("woodblock");
    device.render(7_000);

    expect(onsets(device.left)).toEqual([480, 480 + 3_360]);
    expect(device.left.slice(480, 480 + tick.length).every((sample, index) => sample === tick[index])).toBe(true);
    expect(
      device.left.slice(3_840, 3_840 + woodblock.length).every((sample, index) => sample === woodblock[index]),
    ).toBe(true);
  });

  it.each(CLICK_SOUNDS)("keeps %s on the same scheduled frames", async (sound) => {
    const { device, engine } = await createEngine();
    await engine.setSound(sound);
    await engine.load([
      { time: 0, level: "accent" },
      { time: 0.07, level: "beat" },
      { time: 0.14, level: "subdivision" },
    ]);
    await engine.start(0, 0.01);
    device.render(10_000);
    expect(onsets(device.left)).toEqual([480, 3_840, 7_200]);
  });

  it("rejects an unknown sound rather than silently selecting a different one", async () => {
    const { engine } = await createEngine();
    // @ts-expect-error Exercise validation for untyped callers.
    await expect(engine.setSound("unknown")).rejects.toThrow("Unknown click sound");
  });

  it("refuses an anchor that has already passed rather than starting late", async () => {
    const { device, engine } = await createEngine();
    await engine.load([{ time: 0, level: "accent" }]);
    device.render(BLOCK * 4);

    const start = engine.start(0, -0.001);
    await expect(start).rejects.toBeInstanceOf(ClickEngineError);
    await expect(start).rejects.toMatchObject({ code: "late-start" });
    device.render(BLOCK * 40);
    expect(device.left.every((sample) => sample === 0)).toBe(true);
  });

  it("silences immediately on stop and resumes from the reported program position", async () => {
    const { device, engine } = await createEngine();
    await engine.load([
      { time: 0, level: "accent" },
      { time: 0.05, level: "beat" },
      { time: 0.1, level: "beat" },
    ]);
    await engine.start(0, 0.01);
    device.render(3_072);

    const position = await engine.stop();
    expect(position * SAMPLE_RATE).toBe(3_072 - 480);
    device.render(3_200);
    expect(device.left.slice(3_072, 3_200).every((sample) => sample === 0)).toBe(true);

    await engine.start(position, 0.01);
    device.render(8_000);
    // Anchor 3_200 + 480 plays program frame 2_592; the next click (4_800) follows 2_208 frames later.
    expect(onsets(device.left.slice(3_072))).toEqual([3_680 + 2_208 - 3_072]);
  });

  it("fails visibly when the audio thread does not acknowledge", async () => {
    const device = createClickDevice();
    const engine = await ClickEngine.create({ createContext: () => device.context, ackTimeoutMs: 5 });
    device.workerPort.onmessage = null;
    await expect(engine.load([{ time: 0, level: "beat" }])).rejects.toMatchObject({ code: "timeout" });
    await engine.dispose();
    expect(device.context.close).toHaveBeenCalledOnce();
    await expect(engine.stop()).rejects.toMatchObject({ code: "disposed" });
  });

  it("reports worklet load failures and closes its private context", async () => {
    const device = createClickDevice();
    vi.mocked(device.context.audioWorklet.addModule).mockRejectedValueOnce(new Error("blocked by CSP"));
    await expect(ClickEngine.create({ createContext: () => device.context })).rejects.toMatchObject({
      code: "worklet-load",
    });
    expect(device.context.close).toHaveBeenCalledOnce();
  });
});
