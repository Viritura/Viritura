import { describe, expect, it } from "vitest";
import { LAYOUT_PRESETS, pageSetupsEqual, findMatchingPreset } from "../components/pageSetupHelpers";
import { DEFAULT_PAGE_SETUP } from "@viritura/core";

describe("PageSetupDialog presets", () => {
  it("ships at least the documented seven presets", () => {
    const ids = LAYOUT_PRESETS.map((p) => p.id);
    for (const id of [
      "conductor-score",
      "orchestral-part",
      "lead-sheet",
      "choral-score",
      "piano-solo",
      "worksheet",
      "manuscript-draft",
    ]) {
      expect(ids).toContain(id);
    }
  });

  it("each preset has a coherent PageSetup", () => {
    for (const preset of LAYOUT_PRESETS) {
      expect(preset.setup.width).toBeGreaterThan(0);
      expect(preset.setup.height).toBeGreaterThan(0);
      expect(preset.setup.spatiumMm).toBeGreaterThan(0);
      expect(preset.setup.margins.top).toBeGreaterThanOrEqual(0);
    }
  });

  describe("pageSetupsEqual", () => {
    it("returns true for identical setups", () => {
      expect(pageSetupsEqual(DEFAULT_PAGE_SETUP, { ...DEFAULT_PAGE_SETUP })).toBe(true);
    });

    it("tolerates sub-0.01 mm float drift", () => {
      const drifted = { ...DEFAULT_PAGE_SETUP, width: DEFAULT_PAGE_SETUP.width + 0.001 };
      expect(pageSetupsEqual(DEFAULT_PAGE_SETUP, drifted)).toBe(true);
    });

    it("returns false when dimensions differ meaningfully", () => {
      expect(pageSetupsEqual(DEFAULT_PAGE_SETUP, { ...DEFAULT_PAGE_SETUP, width: 999 })).toBe(false);
    });

    it("returns false when spatium differs", () => {
      expect(pageSetupsEqual(DEFAULT_PAGE_SETUP, { ...DEFAULT_PAGE_SETUP, spatiumMm: 99 })).toBe(false);
    });
  });

  describe("findMatchingPreset", () => {
    it("returns the preset whose setup matches", () => {
      const conductor = LAYOUT_PRESETS.find((p) => p.id === "conductor-score")!;
      const match = findMatchingPreset(conductor.setup);
      expect(match?.id).toBe("conductor-score");
    });

    it("returns null when no preset matches", () => {
      const weird = { ...DEFAULT_PAGE_SETUP, width: 12345, height: 67890, spatiumMm: 99 };
      expect(findMatchingPreset(weird)).toBeNull();
    });
  });
});
