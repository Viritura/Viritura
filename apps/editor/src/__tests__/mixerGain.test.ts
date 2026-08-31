import { describe, expect, it } from "vitest";
import {
  MIXER_DEFAULT_GAIN,
  MIXER_MAX_GAIN,
  dbToGain,
  formatGainDb,
  gainToDb,
  gainToFaderPercent,
} from "../store/mixerGain";

describe("mixer dB gain law", () => {
  it("maps unity and common attenuation values", () => {
    expect(gainToDb(1)).toBe(0);
    expect(gainToDb(0.5)).toBeCloseTo(-6.0206, 3);
    expect(dbToGain(-6)).toBeCloseTo(0.5012, 3);
  });

  it("uses silence at the bottom and +6 dB at the top", () => {
    expect(dbToGain(-60)).toBe(0);
    expect(gainToFaderPercent(0)).toBe(0);
    expect(gainToFaderPercent(MIXER_MAX_GAIN)).toBe(100);
    expect(gainToFaderPercent(1)).toBeLessThan(100);
    expect(formatGainDb(0)).toBe("-inf dB");
  });

  it("defaults channels to -6 dB of headroom", () => {
    expect(gainToDb(MIXER_DEFAULT_GAIN)).toBeCloseTo(-6, 8);
    expect(formatGainDb(MIXER_DEFAULT_GAIN)).toBe("-6.0 dB");
  });

  it("formats useful mixer readouts rather than percentages", () => {
    expect(formatGainDb(1)).toBe("0.0 dB");
    expect(formatGainDb(dbToGain(-3))).toBe("-3.0 dB");
    expect(formatGainDb(dbToGain(-18))).toBe("-18 dB");
    expect(formatGainDb(MIXER_MAX_GAIN)).toBe("+6.0 dB");
  });
});
