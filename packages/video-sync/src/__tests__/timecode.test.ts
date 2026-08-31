import { describe, expect, it } from "vitest";
import { formatClockTime, formatPictureTimecode, formatShortClockTime, parseClockTime } from "../timecode";

describe("timecode", () => {
  it("formats seconds as HH:MM:SS.mmm", () => {
    expect(formatClockTime(0)).toBe("00:00:00.000");
    expect(formatClockTime(1.5)).toBe("00:00:01.500");
    expect(formatClockTime(61.25)).toBe("00:01:01.250");
    expect(formatClockTime(3661.001)).toBe("01:01:01.001");
  });

  it("keeps the sign visible for count-in / pre-roll positions", () => {
    expect(formatClockTime(-2.5)).toBe("-00:00:02.500");
  });

  it("carries millisecond rounding into the next second", () => {
    expect(formatClockTime(1.9996)).toBe("00:00:02.000");
  });

  it("renders a placeholder for non-finite input", () => {
    expect(formatClockTime(Number.NaN)).toBe("--:--:--.---");
    expect(formatClockTime(Number.POSITIVE_INFINITY)).toBe("--:--:--.---");
  });

  it("formats a short form without milliseconds", () => {
    expect(formatShortClockTime(3661.5)).toBe("01:01:01");
  });

  it("parses the shapes a composer is likely to type", () => {
    expect(parseClockTime("90")).toBe(90);
    expect(parseClockTime("1:30")).toBe(90);
    expect(parseClockTime("00:01:30")).toBe(90);
    expect(parseClockTime("00:01:30.500")).toBe(90.5);
    expect(parseClockTime("-0:02")).toBe(-2);
  });

  it("ignores the frame field of HH:MM:SS:FF rather than guessing a frame rate", () => {
    // Without a declared rate the frame count cannot be converted exactly, so
    // the whole-second position is returned and no false precision is invented.
    expect(parseClockTime("01:00:00:12")).toBe(3600);
  });

  it("rejects unparseable input instead of defaulting to zero", () => {
    expect(parseClockTime("")).toBeNull();
    expect(parseClockTime("abc")).toBeNull();
    expect(parseClockTime("1:2:3:4:5")).toBeNull();
    expect(parseClockTime("1::2")).toBeNull();
  });

  it("shifts the display by a delivery start timecode without moving media time", () => {
    expect(formatPictureTimecode(5, 3600)).toBe("01:00:05.000");
    expect(formatPictureTimecode(5)).toBe("00:00:05.000");
  });
});
