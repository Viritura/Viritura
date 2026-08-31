import { describe, it, expect } from "vitest";
import { DURATION_BEATS, STAFF_LINES, STEP_SEMITONES } from "../constants";

describe("constants", () => {
  it("should define 5 staff lines", () => {
    expect(STAFF_LINES).toBe(5);
  });

  it("should map whole note to 4 quarter-note beats", () => {
    expect(DURATION_BEATS["whole"]).toBe(4);
  });

  it("should map quarter note to 1 beat", () => {
    expect(DURATION_BEATS["quarter"]).toBe(1);
  });

  it("should map C to semitone 0 and A to semitone 9", () => {
    expect(STEP_SEMITONES["C"]).toBe(0);
    expect(STEP_SEMITONES["A"]).toBe(9);
  });
});
