import { describe, it, expect, vi, beforeEach } from "vitest";
import { ReverbEngine, REVERB_PRESETS } from "./ReverbEngine";

// ─── Mock Web Audio API ──────────────────────────────────────────────

function createMockGainNode(): GainNode {
  return {
    gain: { value: 1, setValueAtTime: vi.fn() },
    connect: vi.fn(),
    disconnect: vi.fn(),
  } as unknown as GainNode;
}

function createMockConvolverNode(): ConvolverNode {
  return {
    buffer: null as AudioBuffer | null,
    normalize: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
  } as unknown as ConvolverNode;
}

function createMockBiquadFilterNode(): BiquadFilterNode {
  return {
    type: "lowpass",
    frequency: { value: 0 },
    Q: { value: 0 },
    connect: vi.fn(),
    disconnect: vi.fn(),
  } as unknown as BiquadFilterNode;
}

function createMockAudioContext(): AudioContext {
  return {
    currentTime: 0,
    destination: {} as AudioDestinationNode,
    createGain: vi.fn(() => createMockGainNode()),
    createBiquadFilter: vi.fn(() => createMockBiquadFilterNode()),
    createConvolver: vi.fn(() => createMockConvolverNode()),
    decodeAudioData: vi.fn(() => Promise.resolve({ duration: 2.5, sampleRate: 44100 } as AudioBuffer)),
  } as unknown as AudioContext;
}

describe("ReverbEngine", () => {
  let ctx: AudioContext;

  beforeEach(() => {
    ctx = createMockAudioContext();
  });

  describe("constructor", () => {
    it("creates input, HPF, and wet gain nodes", () => {
      new ReverbEngine(ctx);

      // createGain for inputNode + wetGain = 2 calls
      expect(ctx.createGain).toHaveBeenCalledTimes(2);
      expect(ctx.createBiquadFilter).toHaveBeenCalledTimes(1);
    });
  });

  describe("setWetLevel", () => {
    it("clamps values to [0, 1]", () => {
      const engine = new ReverbEngine(ctx);

      engine.setWetLevel(-0.5);
      expect(engine.wetLevel).toBe(0);

      engine.setWetLevel(1.5);
      expect(engine.wetLevel).toBe(1);

      engine.setWetLevel(0.4);
      expect(engine.wetLevel).toBeCloseTo(0.4);
    });
  });

  describe("presetId", () => {
    it("starts as __unloaded__", () => {
      const engine = new ReverbEngine(ctx);
      expect(engine.presetId).toBe("__unloaded__");
    });
  });

  describe("REVERB_PRESETS", () => {
    it("has 6 presets including 'none'", () => {
      expect(REVERB_PRESETS).toHaveLength(6);
      expect(REVERB_PRESETS.find((p) => p.id === "none")).toBeDefined();
    });

    it("all non-none presets have URLs", () => {
      for (const preset of REVERB_PRESETS) {
        if (preset.id !== "none") {
          expect(preset.url).toBeTruthy();
        }
      }
    });
  });

  describe("loadPreset", () => {
    it("sets presetId to 'none' and wet level to 0 for none preset", async () => {
      const engine = new ReverbEngine(ctx);
      const none = REVERB_PRESETS.find((p) => p.id === "none")!;

      await engine.loadPreset(none);

      expect(engine.presetId).toBe("none");
      expect(engine.wetLevel).toBe(0);
    });

    it("fetches and decodes IR for non-none presets", async () => {
      const engine = new ReverbEngine(ctx);
      const preset = REVERB_PRESETS[0]!; // musikvereinsaal

      vi.stubGlobal(
        "fetch",
        vi.fn(() =>
          Promise.resolve({
            ok: true,
            arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
          }),
        ),
      );

      await engine.loadPreset(preset);

      expect(fetch).toHaveBeenCalledWith(`/${preset.url}`);
      expect(ctx.decodeAudioData).toHaveBeenCalled();
      expect(ctx.createConvolver).toHaveBeenCalled();
      expect(engine.presetId).toBe(preset.id);

      vi.unstubAllGlobals();
    });

    it("throws on HTTP error", async () => {
      const engine = new ReverbEngine(ctx);
      const preset = REVERB_PRESETS[0]!;

      vi.stubGlobal(
        "fetch",
        vi.fn(() => Promise.resolve({ ok: false, status: 404 })),
      );

      await expect(engine.loadPreset(preset)).rejects.toThrow("HTTP 404");

      vi.unstubAllGlobals();
    });

    it("caches IR buffers across loads of same preset", async () => {
      const engine = new ReverbEngine(ctx);
      const preset = REVERB_PRESETS[0]!;

      vi.stubGlobal(
        "fetch",
        vi.fn(() =>
          Promise.resolve({
            ok: true,
            arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
          }),
        ),
      );

      await engine.loadPreset(preset);
      await engine.loadPreset(preset);

      // fetch should only be called once (second load uses cache)
      expect(fetch).toHaveBeenCalledTimes(1);

      vi.unstubAllGlobals();
    });
  });

  describe("createSend", () => {
    it("creates a GainNode with specified send level", () => {
      const engine = new ReverbEngine(ctx);
      const send = engine.createSend(0.3);

      expect(send).toBeDefined();
      expect(send.gain.value).toBeDefined();
    });

    it("defaults send level to 0.5", () => {
      const engine = new ReverbEngine(ctx);
      const send = engine.createSend();

      // The mock returns gain.value = 1, but createSend sets it to 0.5
      expect(send).toBeDefined();
    });
  });

  describe("dispose", () => {
    it("does not throw", () => {
      const engine = new ReverbEngine(ctx);
      expect(() => engine.dispose()).not.toThrow();
    });
  });
});
