import { describe, expect, it, vi } from "vitest";
import { applyMasterVolume } from "./masterVolume";

function gainNode() {
  return {
    context: { currentTime: 2.5 },
    gain: {
      cancelScheduledValues: vi.fn(),
      setValueAtTime: vi.fn(),
    },
  } as unknown as GainNode;
}

describe("applyMasterVolume", () => {
  it("applies volume to the live master output", () => {
    const output = gainNode();

    expect(applyMasterVolume(output, 0.35)).toBe(0.35);
    expect(output.gain.cancelScheduledValues).toHaveBeenCalledWith(2.5);
    expect(output.gain.setValueAtTime).toHaveBeenCalledWith(0.35, 2.5);
  });

  it.each([
    { input: -1, expected: 0 },
    { input: 2, expected: 1 },
  ])("clamps $input to $expected", ({ input, expected }) => {
    const output = gainNode();

    expect(applyMasterVolume(output, input)).toBe(expected);
    expect(output.gain.setValueAtTime).toHaveBeenCalledWith(expected, 2.5);
  });

  it("retains the clamped value before an output exists", () => {
    expect(applyMasterVolume(null, 0.4)).toBe(0.4);
  });
});
