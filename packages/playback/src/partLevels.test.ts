import { describe, it, expect } from "vitest";
import {
  sectionGainTarget,
  flooredRelProx,
  normalizedPartVolume,
  partDepthGain,
  partSpatialGain,
  webPartOutputGain,
} from "./partLevels";

// SPATIAL_GEOM_FLOOR = MIN_AUDIBLE_GAIN / SOFT_DYNAMIC_REF = 0.02 / 0.07 ≈ 0.2857.
const FLOOR = 0.02 / 0.07;

describe("sectionGainTarget", () => {
  it("clamps proximity into the protected GainNode range [0.4, 1.5]", () => {
    expect(sectionGainTarget(0.1)).toBe(0.4); // distant section floored
    expect(sectionGainTarget(1.0)).toBe(1.0); // reference passes through
    expect(sectionGainTarget(3.0)).toBe(1.5); // very close section capped
  });
});

describe("flooredRelProx — combined audibility floor", () => {
  it("leaves a part untouched when the spatial product clears the floor", () => {
    // Close part (relProx 1) in a reference section (gain 1): product 1 ≥ floor.
    expect(flooredRelProx(1, 1)).toBe(1);
    // Mid part still above the floor.
    expect(flooredRelProx(0.6, 1)).toBe(0.6);
  });

  describe("partDepthGain", () => {
    it("uses stage-relative depth when Stage mode is enabled", () => {
      expect(partDepthGain(true, 0.5, 1, 1)).toBe(0.5);
    });

    describe("web mixer headroom", () => {
      it("preserves cascaded positive gain without a MIDI ceiling", () => {
        const unity = webPartOutputGain(1, 1, 1);
        const plusSix = webPartOutputGain(Math.pow(10, 6 / 20), 1, 1);
        expect(plusSix / unity).toBeCloseTo(Math.pow(10, 6 / 20), 8);
        expect(webPartOutputGain(Math.pow(10, 18 / 20), 1, 1)).toBeGreaterThan(1);
      });

      it("preserves low nonzero gain continuously", () => {
        const quiet = webPartOutputGain(Math.pow(10, -59.5 / 20), 1, 1);
        const boosted = webPartOutputGain(Math.pow(10, 18 / 20), 1, 1);
        const normalized = normalizedPartVolume(quiet, boosted);
        expect(normalized).toBeGreaterThan(0);
        expect(Math.round(normalized * 0x3fff)).toBeGreaterThan(0);
      });

      it("inverse-maps linear gain through SoundFont's squared CC7 amplitude curve", () => {
        const controller = normalizedPartVolume(0.5, 1);
        expect(controller).toBeCloseTo(Math.SQRT1_2, 8);
        expect(controller * controller).toBeCloseTo(0.5, 8);
      });

      it("keeps the most extreme valid nonzero mix above the 14-bit floor", () => {
        const quietStage = Math.pow(10, -59.5 / 20) * (0.02 / 0.07);
        const loudStage = Math.pow(10, 18 / 20) * 1.5 * Math.SQRT2;
        const controller = normalizedPartVolume(quietStage, loudStage);
        expect(Math.round(controller * 0x3fff)).toBeGreaterThan(0);
      });

      it("bypasses both section and relative depth in Stereo mode", () => {
        expect(partSpatialGain(false, 0.4, 0.3)).toBe(1);
        expect(partSpatialGain(true, 0.4, 0.3)).toBeCloseTo(0.12, 8);
      });
    });

    it("bypasses depth attenuation in Stereo mode", () => {
      expect(partDepthGain(false, 0.1, 1, 0.4)).toBe(1);
    });
  });

  it("lifts a distant part whose combined spatial product falls below the floor", () => {
    // Far section (gain 0.4), far part (relProx 0.3): product 0.12 < floor.
    const lifted = flooredRelProx(0.3, 0.4);
    expect(lifted).toBeGreaterThan(0.3);
    // The lifted product equals the floor.
    expect(0.4 * lifted).toBeCloseTo(FLOOR, 5);
  });

  it("never lifts relProx above 1 (stays a valid CC7 ratio)", () => {
    // Even an extreme case stays clamped.
    expect(flooredRelProx(0.01, 0.4)).toBeLessThanOrEqual(1);
    expect(flooredRelProx(0.01, 0.1)).toBe(1); // floor/0.1 > 1 → clamped
  });

  it("guarantees the combined dynamics×spatial gain stays audible at pp", () => {
    // Worst case: far part (relProx→0) in a far section (gain 0.4).
    const lifted = flooredRelProx(0.0001, 0.4);
    const spatial = 0.4 * lifted;
    const ppDynamics = 0.07; // SOFT_DYNAMIC_REF
    expect(spatial * ppDynamics).toBeGreaterThanOrEqual(0.02 - 1e-9); // ≥ MIN_AUDIBLE_GAIN
  });

  it("is a no-op for a soloed/no-section part (sectionGain 1, relProx 1)", () => {
    expect(flooredRelProx(1, 1)).toBe(1);
  });

  it("returns relProx unchanged when sectionGain is non-positive (guard)", () => {
    expect(flooredRelProx(0.5, 0)).toBe(0.5);
  });
});
