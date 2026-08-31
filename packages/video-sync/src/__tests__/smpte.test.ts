import { describe, expect, it } from "vitest";
import {
  DEFAULT_FRAME_RATE_ID,
  FRAME_RATES,
  formatFrameTimecode,
  formatTimecode,
  frameError,
  frameForSeconds,
  frameRateById,
  labelFps,
  parseFrameTimecode,
  parseTimecodeSeconds,
  secondsForFrame,
  snapToFrame,
} from "../smpte";

const r24 = frameRateById("24");
const r2398 = frameRateById("23.976");
const r2997 = frameRateById("29.97");
const r2997df = frameRateById("29.97df");
const r5994df = frameRateById("59.94df");

describe("frame rate table", () => {
  it("stores NTSC rates as exact fractions rather than decimals", () => {
    expect(r2398.numerator / r2398.denominator).toBeCloseTo(23.976023976, 9);
    expect(r2997.numerator / r2997.denominator).toBeCloseTo(29.97002997, 9);
  });

  it("labels NTSC frames with the rounded rate, not the true one", () => {
    expect(labelFps(r2398)).toBe(24);
    expect(labelFps(r2997)).toBe(30);
  });

  it("falls back to the default for an unknown id", () => {
    expect(frameRateById("nonsense").id).toBe(DEFAULT_FRAME_RATE_ID);
    expect(frameRateById(undefined).id).toBe(DEFAULT_FRAME_RATE_ID);
  });

  it("offers drop-frame only where it exists", () => {
    for (const rate of FRAME_RATES) {
      if (!rate.dropFrame) continue;
      expect(rate.denominator).toBe(1001);
    }
  });
});

describe("frame ↔ seconds", () => {
  it("floors to the frame you are looking at", () => {
    // Frame 0 covers [0, 1/24); 40 ms in is still frame 0.
    expect(frameForSeconds(0.04, r24)).toBe(0);
    expect(frameForSeconds(1 / 24, r24)).toBe(1);
  });

  it("survives the float error at exact frame boundaries", () => {
    for (let frame = 0; frame < 5000; frame += 137) {
      expect(frameForSeconds(secondsForFrame(frame, r2398), r2398)).toBe(frame);
      expect(frameForSeconds(secondsForFrame(frame, r2997), r2997)).toBe(frame);
    }
  });

  it("snaps to the start of the containing frame", () => {
    expect(snapToFrame(0.06, r24)).toBeCloseTo(1 / 24, 12);
  });

  it("does not drift over an hour at 23.976", () => {
    // A decimal 23.976 would be ~1.4 frames out here.
    const oneHourOfFrames = 24 * 3600;
    expect(secondsForFrame(oneHourOfFrames, r2398)).toBeCloseTo(3603.6, 6);
  });
});

describe("frame error", () => {
  it("is signed and expressed in frames", () => {
    expect(frameError(1.0, 1.0 - 1 / 24, r24)).toBeCloseTo(1, 9);
    expect(frameError(1.0 - 1 / 24, 1.0, r24)).toBeCloseTo(-1, 9);
  });
});

describe("non-drop formatting", () => {
  it("formats whole seconds", () => {
    expect(formatFrameTimecode(0, r24)).toBe("00:00:00:00");
    expect(formatFrameTimecode(24, r24)).toBe("00:00:01:00");
    expect(formatFrameTimecode(24 * 60, r24)).toBe("00:01:00:00");
    expect(formatFrameTimecode(24 * 3600, r24)).toBe("01:00:00:00");
  });

  it("formats a media time through the true rate", () => {
    // One hour of 23.976 media is 3603.6 s but reads as 01:00:00:00.
    expect(formatTimecode(3603.6, r2398)).toBe("01:00:00:00");
  });

  it("applies a delivery start offset", () => {
    expect(formatTimecode(0, r24, 24 * 3600)).toBe("01:00:00:00");
  });
});

describe("drop-frame", () => {
  it("marks the frame field with a semicolon", () => {
    expect(formatFrameTimecode(0, r2997df)).toBe("00:00:00;00");
  });

  it("skips :00 and :01 at the top of most minutes", () => {
    // 29.97 DF has 1798 frames in the first minute (1800 labels minus 2 skipped).
    expect(formatFrameTimecode(1798, r2997df)).toBe("00:00:59;28");
    expect(formatFrameTimecode(1799, r2997df)).toBe("00:00:59;29");
    expect(formatFrameTimecode(1800, r2997df)).toBe("00:01:00;02");
  });

  it("does not skip at the tenth minute", () => {
    const framesInTenMinutes = 30 * 600 - 9 * 2;
    expect(formatFrameTimecode(framesInTenMinutes, r2997df)).toBe("00:10:00;00");
  });

  it("tracks wall clock within a frame over an hour", () => {
    // The whole point of drop-frame: one hour of media reads as one hour.
    const framesInOneHour = Math.round(3600 * (30000 / 1001));
    expect(formatFrameTimecode(framesInOneHour, r2997df)).toBe("01:00:00;00");
  });

  it("drops four labels per minute at 59.94", () => {
    expect(formatFrameTimecode(3600 - 1, r5994df)).toBe("00:00:59;59");
    expect(formatFrameTimecode(3600, r5994df)).toBe("00:01:00;04");
  });

  it("runs at the same speed as non-drop", () => {
    // Same media time, different labels — that is the entire difference.
    expect(secondsForFrame(1800, r2997df)).toBe(secondsForFrame(1800, r2997));
  });
});

describe("parsing", () => {
  it("round-trips non-drop", () => {
    for (const frame of [0, 1, 23, 24, 1234, 24 * 3600 + 7]) {
      expect(parseFrameTimecode(formatFrameTimecode(frame, r24), r24)).toBe(frame);
    }
  });

  it("round-trips drop-frame", () => {
    for (const frame of [0, 1799, 1800, 1801, 17982, 107892]) {
      expect(parseFrameTimecode(formatFrameTimecode(frame, r2997df), r2997df)).toBe(frame);
    }
  });

  it("accepts short forms typed off a cue sheet", () => {
    expect(parseFrameTimecode("12", r24)).toBe(null); // ambiguous: no separator
    expect(parseFrameTimecode("02:12", r24)).toBe(2 * 24 + 12);
    expect(parseFrameTimecode("01:02:12", r24)).toBe(62 * 24 + 12);
  });

  it("rejects a frame field the rate cannot produce", () => {
    expect(parseFrameTimecode("00:00:00:24", r24)).toBe(null);
    expect(parseFrameTimecode("00:00:60:00", r24)).toBe(null);
  });

  it("rejects label numbers that drop-frame skips", () => {
    expect(parseFrameTimecode("00:01:00;00", r2997df)).toBe(null);
    expect(parseFrameTimecode("00:01:00;01", r2997df)).toBe(null);
    expect(parseFrameTimecode("00:10:00;00", r2997df)).not.toBe(null);
  });

  it("rejects junk rather than seeking to zero", () => {
    expect(parseFrameTimecode("", r24)).toBe(null);
    expect(parseFrameTimecode("bar 12", r24)).toBe(null);
    expect(parseFrameTimecode("1:2:3:4:5", r24)).toBe(null);
  });

  it("parses straight to seconds for seeking", () => {
    expect(parseTimecodeSeconds("00:00:01:00", r24)).toBeCloseTo(1, 12);
    expect(parseTimecodeSeconds("01:00:00:00", r2398)).toBeCloseTo(3603.6, 6);
  });
});
