import { describe, it, expect, vi } from "vitest";
import { LayeredSampler } from "./LayeredSampler";
import type { ISampler } from "./types";

function mockSampler(): ISampler & {
  noteOnCalls: { midiNote: number; velocity: number; time?: number }[];
  noteOffCalls: { midiNote: number; time?: number }[];
  allNotesOffCount: number;
  setVolume: ReturnType<typeof vi.fn>;
  setPan: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
} {
  const s = {
    noteOnCalls: [] as { midiNote: number; velocity: number; time?: number }[],
    noteOffCalls: [] as { midiNote: number; time?: number }[],
    allNotesOffCount: 0,
    noteOn(midiNote: number, velocity: number, time?: number) {
      s.noteOnCalls.push({ midiNote, velocity, time });
    },
    noteOff(midiNote: number, time?: number) {
      s.noteOffCalls.push({ midiNote, time });
    },
    allNotesOff() {
      s.allNotesOffCount++;
    },
    setVolume: vi.fn(),
    setPan: vi.fn(),
    dispose: vi.fn(),
  };
  return s;
}

describe("LayeredSampler", () => {
  describe("noteOn / noteOff forwarding", () => {
    it("forwards noteOn to primary and all enabled layers", () => {
      const primary = mockSampler();
      const layer1 = mockSampler();
      const layer2 = mockSampler();
      const layered = new LayeredSampler(primary, [
        { sampler: layer1, volumeRatio: 0.5 },
        { sampler: layer2, volumeRatio: 0.3 },
      ]);

      layered.noteOn(60, 100, 1.5);

      expect(primary.noteOnCalls).toEqual([{ midiNote: 60, velocity: 100, time: 1.5 }]);
      expect(layer1.noteOnCalls).toEqual([{ midiNote: 60, velocity: 100, time: 1.5 }]);
      expect(layer2.noteOnCalls).toEqual([{ midiNote: 60, velocity: 100, time: 1.5 }]);
    });

    it("forwards noteOff to primary and all enabled layers", () => {
      const primary = mockSampler();
      const layer1 = mockSampler();
      const layered = new LayeredSampler(primary, [{ sampler: layer1, volumeRatio: 0.5 }]);

      layered.noteOff(60, 2.0);

      expect(primary.noteOffCalls).toEqual([{ midiNote: 60, time: 2.0 }]);
      expect(layer1.noteOffCalls).toEqual([{ midiNote: 60, time: 2.0 }]);
    });

    it("does not forward noteOn to disabled layers", () => {
      const primary = mockSampler();
      const layer1 = mockSampler();
      const layered = new LayeredSampler(primary, [{ sampler: layer1, volumeRatio: 0.5 }]);

      layered.setLayerEnabled(0, false);
      layered.noteOn(60, 100);

      expect(primary.noteOnCalls).toHaveLength(1);
      expect(layer1.noteOnCalls).toHaveLength(0);
    });
  });

  describe("allNotesOff", () => {
    it("calls allNotesOff on primary and all layers (even disabled)", () => {
      const primary = mockSampler();
      const layer1 = mockSampler();
      const layered = new LayeredSampler(primary, [{ sampler: layer1, volumeRatio: 0.5 }]);

      layered.setLayerEnabled(0, false);
      layered.allNotesOff();

      expect(primary.allNotesOffCount).toBe(1);
      // Layer gets allNotesOff from disable + explicit call
      expect(layer1.allNotesOffCount).toBe(2);
    });
  });

  describe("layer enable/disable", () => {
    it("layers are enabled by default", () => {
      const primary = mockSampler();
      const layer1 = mockSampler();
      const layered = new LayeredSampler(primary, [{ sampler: layer1, volumeRatio: 0.5 }]);

      expect(layered.isLayerEnabled(0)).toBe(true);
    });

    it("disabling a layer calls allNotesOff on it", () => {
      const primary = mockSampler();
      const layer1 = mockSampler();
      const layered = new LayeredSampler(primary, [{ sampler: layer1, volumeRatio: 0.5 }]);

      layered.setLayerEnabled(0, false);
      expect(layer1.allNotesOffCount).toBe(1);
      expect(layered.isLayerEnabled(0)).toBe(false);
    });

    it("re-enabling does not call allNotesOff", () => {
      const primary = mockSampler();
      const layer1 = mockSampler();
      const layered = new LayeredSampler(primary, [{ sampler: layer1, volumeRatio: 0.5 }]);

      layered.setLayerEnabled(0, false);
      layer1.allNotesOffCount = 0;
      layered.setLayerEnabled(0, true);
      expect(layer1.allNotesOffCount).toBe(0);
    });

    it("isLayerEnabled returns false for out-of-range index", () => {
      const layered = new LayeredSampler(mockSampler(), []);
      expect(layered.isLayerEnabled(99)).toBe(false);
    });
  });

  describe("setVolume", () => {
    it("scales volume by each layer's ratio", () => {
      const primary = mockSampler();
      const layer1 = mockSampler();
      const layered = new LayeredSampler(primary, [{ sampler: layer1, volumeRatio: 0.5 }], 0.8);

      layered.setVolume(1.0);

      expect(primary.setVolume).toHaveBeenCalledWith(0.8); // 1.0 * 0.8
      expect(layer1.setVolume).toHaveBeenCalledWith(0.5); // 1.0 * 0.5
    });
  });

  describe("setPan / setLayerPan", () => {
    it("setPan forwards to primary only", () => {
      const primary = mockSampler();
      const layer1 = mockSampler();
      const layered = new LayeredSampler(primary, [{ sampler: layer1, volumeRatio: 0.5 }]);

      layered.setPan(-0.3);

      expect(primary.setPan).toHaveBeenCalledWith(-0.3);
      expect(layer1.setPan).not.toHaveBeenCalled();
    });

    it("setLayerPan clamps to [-1, 1]", () => {
      const primary = mockSampler();
      const layer1 = mockSampler();
      const layered = new LayeredSampler(primary, [{ sampler: layer1, volumeRatio: 0.5 }]);

      layered.setLayerPan(0, 2.0);
      expect(layer1.setPan).toHaveBeenCalledWith(1);

      layered.setLayerPan(0, -5.0);
      expect(layer1.setPan).toHaveBeenCalledWith(-1);
    });
  });

  describe("dispose", () => {
    it("disposes primary and all layers", () => {
      const primary = mockSampler();
      const layer1 = mockSampler();
      const layered = new LayeredSampler(primary, [{ sampler: layer1, volumeRatio: 0.5 }]);

      layered.dispose();

      expect(primary.dispose).toHaveBeenCalled();
      expect(layer1.dispose).toHaveBeenCalled();
    });
  });

  describe("setDetune", () => {
    it("delegates to primary when primary has setDetune", () => {
      const primary = mockSampler();
      const setDetuneFn = vi.fn();
      (primary as Record<string, unknown>).setDetune = setDetuneFn;

      const layer1 = mockSampler();
      const layered = new LayeredSampler(primary, [{ sampler: layer1, volumeRatio: 0.5 }]);

      layered.setDetune(3);

      expect(setDetuneFn).toHaveBeenCalledWith(3);
    });

    it("does not call setDetune on ensemble layers", () => {
      const primary = mockSampler();
      (primary as Record<string, unknown>).setDetune = vi.fn();

      const layer1 = mockSampler();
      const layerDetune = vi.fn();
      (layer1 as Record<string, unknown>).setDetune = layerDetune;

      const layered = new LayeredSampler(primary, [{ sampler: layer1, volumeRatio: 0.5 }]);

      layered.setDetune(-5);

      expect(layerDetune).not.toHaveBeenCalled();
    });

    it("is a no-op when primary lacks setDetune", () => {
      const primary = mockSampler();
      const layer1 = mockSampler();
      const layered = new LayeredSampler(primary, [{ sampler: layer1, volumeRatio: 0.5 }]);

      // Should not throw
      expect(() => layered.setDetune(3)).not.toThrow();
    });
  });
});
