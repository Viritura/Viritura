import { describe, expect, it, vi } from "vitest";
import { SamplerGroup } from "./SamplerGroup";
import type { ISampler } from "./types";

function sampler() {
  return {
    noteOn: vi.fn(),
    noteOff: vi.fn(),
    allNotesOff: vi.fn(),
    setProgram: vi.fn(),
    sendControl: vi.fn(),
    resetTechniqueState: vi.fn(),
    setVolume: vi.fn(),
    setPan: vi.fn(),
    setDetune: vi.fn(),
    setLayerEnabled: vi.fn(),
    setLayerPan: vi.fn(),
    dispose: vi.fn(),
  } satisfies ISampler & {
    setVolume(volume: number): void;
    setPan(pan: number): void;
    setDetune(cents: number): void;
    setLayerEnabled(index: number, enabled: boolean): void;
    setLayerPan(index: number, pan: number): void;
    dispose(): void;
  };
}

describe("SamplerGroup", () => {
  it("uses only the primary lane for preview notes", () => {
    const first = sampler();
    const second = sampler();
    const group = new SamplerGroup([first, second]);

    group.noteOn(60, 80, 1);
    group.noteOff(60, 2);

    expect(first.noteOn).toHaveBeenCalledWith(60, 80, 1, undefined);
    expect(first.noteOff).toHaveBeenCalledWith(60, 2, undefined);
    expect(second.noteOn).not.toHaveBeenCalled();
    expect(second.noteOff).not.toHaveBeenCalled();
  });

  it("fans persistent state, mixer controls, and panic across every lane", () => {
    const first = sampler();
    const second = sampler();
    const group = new SamplerGroup([first, second]);

    group.sendControl(11, 72, 1.5);
    group.setProgram(40, 1.5);
    group.setVolume(0.7);
    group.setPan(-0.2);
    group.setDetune(3);
    group.setLayerEnabled(0, false);
    group.setLayerPan(1, 0.4);
    group.resetTechniqueState();
    group.allNotesOff();

    for (const lane of [first, second]) {
      expect(lane.sendControl).toHaveBeenCalledWith(11, 72, 1.5);
      expect(lane.setProgram).toHaveBeenCalledWith(40, 1.5);
      expect(lane.setVolume).toHaveBeenCalledWith(0.7);
      expect(lane.setPan).toHaveBeenCalledWith(-0.2);
      expect(lane.setDetune).toHaveBeenCalledWith(3);
      expect(lane.setLayerEnabled).toHaveBeenCalledWith(0, false);
      expect(lane.setLayerPan).toHaveBeenCalledWith(1, 0.4);
      expect(lane.resetTechniqueState).toHaveBeenCalledOnce();
      expect(lane.allNotesOff).toHaveBeenCalledOnce();
    }
  });
});
