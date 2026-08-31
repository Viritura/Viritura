import { describe, expect, it } from "vitest";
import { frameRateById } from "@viritura/video-sync";
import {
  originFieldsFromFrame,
  originPreset,
  originSecondsFromFields,
  sanitizeOriginField,
  stepOriginField,
} from "../components/modes/picture/timecodeOrigin";

describe("structured timecode origin", () => {
  it("round-trips an ordinary 24 fps origin", () => {
    const rate = frameRateById("24");
    const fields = originPreset(10);
    expect(originSecondsFromFields(fields, rate)).toBe(36_000);
    expect(originFieldsFromFrame(24 * 36_000, rate)).toEqual(fields);
  });

  it("round-trips the one-hour drop-frame label to one real hour", () => {
    const rate = frameRateById("29.97df");
    const seconds = originSecondsFromFields(originPreset(1), rate);
    if (seconds === null) throw new Error("The one-hour DF preset should be valid.");
    // DF numbering approximates wall clock; at 30000/1001 the residual is
    // 3.6 ms per hour, comfortably below one frame.
    expect(Math.abs(seconds - 3600)).toBeLessThan(rate.denominator / rate.numerator);
  });

  it("rejects frame labels skipped by drop-frame numbering", () => {
    const rate = frameRateById("29.97df");
    expect(originSecondsFromFields({ hours: "00", minutes: "01", seconds: "00", frames: "00" }, rate)).toBeNull();
    expect(originSecondsFromFields({ hours: "00", minutes: "01", seconds: "00", frames: "02" }, rate)).not.toBeNull();
  });

  it("wraps each field through its SMPTE range", () => {
    const rate = frameRateById("25");
    const base = originPreset(0);
    expect(stepOriginField(base, "hours", -1, rate).hours).toBe("23");
    expect(stepOriginField(base, "minutes", -1, rate).minutes).toBe("59");
    expect(stepOriginField(base, "frames", -1, rate).frames).toBe("24");
  });

  it("keeps only the first two numeric digits typed into a segment", () => {
    expect(sanitizeOriginField("1a2b3")).toBe("12");
    expect(sanitizeOriginField("x")).toBe("");
  });

  it("requires every segment before applying", () => {
    expect(
      originSecondsFromFields({ hours: "01", minutes: "", seconds: "00", frames: "00" }, frameRateById("24")),
    ).toBeNull();
  });

  it("rejects typed fields outside the editor's 24-hour SMPTE range", () => {
    const rate = frameRateById("24");
    for (const fields of [
      { hours: "24", minutes: "00", seconds: "00", frames: "00" },
      { hours: "00", minutes: "60", seconds: "00", frames: "00" },
      { hours: "00", minutes: "00", seconds: "60", frames: "00" },
      { hours: "00", minutes: "00", seconds: "00", frames: "24" },
    ]) {
      expect(originSecondsFromFields(fields, rate)).toBeNull();
    }
  });
});
