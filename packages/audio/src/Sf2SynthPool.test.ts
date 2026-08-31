import { describe, it, expect } from "vitest";

/**
 * Tests for Sf2SynthPool channel allocation logic.
 *
 * Since Sf2SynthPool.allocate() requires AudioContext + spessasynth,
 * we test the allocation algorithm directly with the same math.
 */

const USABLE_CHANNELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];

/** Simulate the pool's channel allocation for N parts. */
function simulateAllocations(count: number): { synthIndex: number; channel: number }[] {
  const results: { synthIndex: number; channel: number }[] = [];
  for (let i = 0; i < count; i++) {
    const synthIndex = Math.floor(i / USABLE_CHANNELS.length);
    const channelIndex = i % USABLE_CHANNELS.length;
    results.push({ synthIndex, channel: USABLE_CHANNELS[channelIndex]! });
  }
  return results;
}

describe("Sf2SynthPool channel allocation", () => {
  it("assigns channels 0-8, 10-15 for the first 15 parts", () => {
    const allocs = simulateAllocations(15);
    expect(allocs).toHaveLength(15);

    const channels = allocs.map((a) => a.channel);
    expect(channels).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15]);

    // All on first synth instance
    expect(allocs.every((a) => a.synthIndex === 0)).toBe(true);
  });

  it("never assigns channel 9 (GM percussion)", () => {
    const allocs = simulateAllocations(60);
    const ch9 = allocs.filter((a) => a.channel === 9);
    expect(ch9).toHaveLength(0);
  });

  it("creates a second synth instance for parts 16+", () => {
    const allocs = simulateAllocations(20);

    // Parts 0-14: synth 0
    for (let i = 0; i < 15; i++) {
      expect(allocs[i]!.synthIndex).toBe(0);
    }

    // Parts 15-19: synth 1
    for (let i = 15; i < 20; i++) {
      expect(allocs[i]!.synthIndex).toBe(1);
    }
  });

  it("second synth instance starts at channel 0 again", () => {
    const allocs = simulateAllocations(18);

    // Part 15 should be synth 1, channel 0
    expect(allocs[15]).toEqual({ synthIndex: 1, channel: 0 });
    // Part 16 should be synth 1, channel 1
    expect(allocs[16]).toEqual({ synthIndex: 1, channel: 1 });
    // Part 17 should be synth 1, channel 2
    expect(allocs[17]).toEqual({ synthIndex: 1, channel: 2 });
  });

  it("no two parts on the same synth instance share a channel", () => {
    const allocs = simulateAllocations(45); // 3 synth instances

    // Group by synthIndex
    const bySynth = new Map<number, number[]>();
    for (const a of allocs) {
      const existing = bySynth.get(a.synthIndex) ?? [];
      existing.push(a.channel);
      bySynth.set(a.synthIndex, existing);
    }

    // Each synth's channels should be unique
    for (const [, channels] of bySynth) {
      const unique = new Set(channels);
      expect(unique.size).toBe(channels.length);
    }
  });

  it("handles exactly 30 parts with 2 synth instances", () => {
    const allocs = simulateAllocations(30);

    // 15 parts on synth 0
    expect(allocs.filter((a) => a.synthIndex === 0)).toHaveLength(15);
    // 15 parts on synth 1
    expect(allocs.filter((a) => a.synthIndex === 1)).toHaveLength(15);
  });

  it("handles 31 parts requiring a third synth instance", () => {
    const allocs = simulateAllocations(31);

    expect(allocs[30]).toEqual({ synthIndex: 2, channel: 0 });
  });
});
