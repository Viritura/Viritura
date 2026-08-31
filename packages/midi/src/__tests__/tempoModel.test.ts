import { describe, it, expect } from "vitest";
import { TempoModel } from "../tempoModel";

/** A constant-tempo region helper. */
function constReg(startBeat: number, endBeat: number, bpm: number) {
  return { startBeat, endBeat, startBpm: bpm, endBpm: bpm };
}

describe("TempoModel — constant tempo", () => {
  it("maps beats to seconds at a single constant tempo (120 = 0.5s/beat)", () => {
    const m = TempoModel.build([constReg(0, Infinity, 120)]);
    expect(m.timeAtBeat(0)).toBeCloseTo(0, 6);
    expect(m.timeAtBeat(1)).toBeCloseTo(0.5, 6);
    expect(m.timeAtBeat(4)).toBeCloseTo(2.0, 6);
  });

  it("inverts time → beat", () => {
    const m = TempoModel.build([constReg(0, Infinity, 120)]);
    expect(m.beatAtTime(0)).toBeCloseTo(0, 6);
    expect(m.beatAtTime(0.5)).toBeCloseTo(1, 6);
    expect(m.beatAtTime(2.0)).toBeCloseTo(4, 6);
  });

  it("round-trips beat → time → beat", () => {
    const m = TempoModel.build([constReg(0, Infinity, 90)]);
    for (const b of [0, 1.5, 3.33, 10, 42.7]) {
      expect(m.beatAtTime(m.timeAtBeat(b))).toBeCloseTo(b, 6);
    }
  });

  it("secondsForBeats gives a duration", () => {
    const m = TempoModel.build([constReg(0, Infinity, 120)]);
    expect(m.secondsForBeats(2, 1)).toBeCloseTo(0.5, 6); // a quarter at beat 2
    expect(m.secondsForBeats(0, 4)).toBeCloseTo(2.0, 6); // a whole
  });
});

describe("TempoModel — sub-bar tempo change (step)", () => {
  // 4/4 bar at 120 for beats [0,2), then 60 for [2,4): a mid-bar tempo change.
  const m = TempoModel.build([constReg(0, 2, 120), constReg(2, Infinity, 60)]);

  it("times beats before the change at the first tempo", () => {
    expect(m.timeAtBeat(1)).toBeCloseTo(0.5, 6);
    expect(m.timeAtBeat(2)).toBeCloseTo(1.0, 6);
  });

  it("times beats after the mid-bar change at the second tempo", () => {
    // beat 2 at 1.0s; beat 3 is one beat at 60bpm (1.0s) later → 2.0s.
    expect(m.timeAtBeat(3)).toBeCloseTo(2.0, 6);
    expect(m.timeAtBeat(4)).toBeCloseTo(3.0, 6);
  });

  it("inverts across the change", () => {
    expect(m.beatAtTime(2.0)).toBeCloseTo(3, 6);
    expect(m.beatAtTime(3.0)).toBeCloseTo(4, 6);
  });
});

describe("TempoModel — gradual ramp (rit./accel.)", () => {
  // accel. from 60 → 120 BPM over beats [0, 4).
  const m = TempoModel.build([{ startBeat: 0, endBeat: 4, startBpm: 60, endBpm: 120 }, constReg(4, Infinity, 120)]);

  it("starts at the start tempo and ends at the end tempo", () => {
    expect(m.bpmAtBeat(0)).toBeCloseTo(60, 4);
    expect(m.bpmAtBeat(4)).toBeCloseTo(120, 4);
    expect(m.bpmAtBeat(2)).toBeCloseTo(90, 4); // linear in BPM
  });

  it("integrates time monotonically and faster than the slow end, slower than the fast end", () => {
    const t4 = m.timeAtBeat(4);
    // 4 beats: at constant 60 it'd be 4s; at constant 120 it'd be 2s. An accel
    // from 60→120 must land strictly between.
    expect(t4).toBeGreaterThan(2.0);
    expect(t4).toBeLessThan(4.0);
  });

  it("round-trips beat → time → beat through the ramp", () => {
    for (const b of [0.25, 1, 2, 3.5, 4]) {
      expect(m.beatAtTime(m.timeAtBeat(b))).toBeCloseTo(b, 5);
    }
  });

  it("continues at the post-ramp constant tempo", () => {
    const t4 = m.timeAtBeat(4);
    expect(m.timeAtBeat(5) - t4).toBeCloseTo(0.5, 6); // one beat at 120
  });
});

describe("TempoModel — point insertions (caesura)", () => {
  // 120 throughout; a 1s caesura inserted at beat 2.
  const m = TempoModel.build([constReg(0, Infinity, 120)], [{ beat: 2, seconds: 1.0 }]);

  it("shifts all time at/after the insertion by the gap", () => {
    expect(m.timeAtBeat(2)).toBeCloseTo(1.0 + 1.0, 6); // 1.0s music + 1.0s gap
    expect(m.timeAtBeat(3)).toBeCloseTo(1.5 + 1.0, 6); // 1.5s music + 1.0s gap
  });

  it("does not shift time before the insertion", () => {
    expect(m.timeAtBeat(1)).toBeCloseTo(0.5, 6);
  });

  it("freezes position during the gap on inverse", () => {
    // The gap occupies [1.0s, 2.0s); any time inside maps to beat 2.
    expect(m.beatAtTime(1.0)).toBeCloseTo(2, 6);
    expect(m.beatAtTime(1.5)).toBeCloseTo(2, 6);
    expect(m.beatAtTime(2.0)).toBeCloseTo(2, 6);
    expect(m.beatAtTime(2.5)).toBeCloseTo(3, 6);
  });

  it("a note ending AT the caesura beat does NOT absorb the gap (release endpoint)", () => {
    // A note over [1,2) ends exactly at the caesura beat. Its duration is the
    // music time (0.5s), NOT 0.5s + the 1.0s gap.
    expect(m.secondsForBeats(1, 1)).toBeCloseTo(0.5, 6);
    expect(m.timeAtBeat(2, "release")).toBeCloseTo(1.0, 6); // before the gap
    expect(m.timeAtBeat(2, "onset")).toBeCloseTo(2.0, 6); // after the gap
  });
});

describe("TempoModel — fermata as a flat tempo dip", () => {
  // 120 bar, but a fermata over beat [2,3) halves the tempo (×2 length) → 60 there.
  const m = TempoModel.build([constReg(0, 2, 120), constReg(2, 3, 60), constReg(3, Infinity, 120)]);

  it("stretches the dipped beat to double its length", () => {
    // beat 2 at 1.0s; the dipped beat [2,3) at 60bpm takes 1.0s (not 0.5).
    expect(m.timeAtBeat(2)).toBeCloseTo(1.0, 6);
    expect(m.timeAtBeat(3)).toBeCloseTo(2.0, 6);
  });

  it("resumes a-tempo after the dip, shifted by the extra time", () => {
    // beat 4 = beat 3 (2.0s) + one beat at 120 (0.5s) = 2.5s.
    expect(m.timeAtBeat(4)).toBeCloseTo(2.5, 6);
  });

  it("a note sounding under the dip stretches with it (secondsForBeats)", () => {
    // A whole note from beat 0 spanning the dip: [0,4) = 0.5+0.5+1.0+0.5 = 2.5s.
    expect(m.secondsForBeats(0, 4)).toBeCloseTo(2.5, 6);
  });
});

describe("TempoModel — click track", () => {
  it("returns absolute times for a flat beat grid", () => {
    const m = TempoModel.build([constReg(0, Infinity, 120)]);
    expect(m.clickTimes([0, 1, 2, 3])).toEqual([0, 0.5, 1.0, 1.5].map((t) => expect.closeTo(t, 6)));
  });

  it("click grid respects a mid-stream tempo change", () => {
    const m = TempoModel.build([constReg(0, 2, 120), constReg(2, Infinity, 60)]);
    const clicks = m.clickTimes([0, 1, 2, 3]);
    expect(clicks[0]).toBeCloseTo(0, 6);
    expect(clicks[1]).toBeCloseTo(0.5, 6);
    expect(clicks[2]).toBeCloseTo(1.0, 6);
    expect(clicks[3]).toBeCloseTo(2.0, 6); // beat 3 after the slowdown
  });
});
