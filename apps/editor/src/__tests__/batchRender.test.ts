import { describe, expect, it, afterEach } from "vitest";
import type { Score } from "@viritura/core";
import { DEFAULT_PAGE_SETUP, DEFAULT_PART_PAGE_SETUP } from "@viritura/core";
import {
  formatFilename,
  resolvePageSetupForScore,
  getScoreDisplayName,
  isDirectoryPickerSupported,
} from "../publish/batchRender";

const baseScore = (): Score =>
  ({
    metadata: { title: "My Étude" },
    parts: [{ id: "p1", name: "Violin I" }],
    scores: [
      { id: "s0", name: "Full Score", layout: undefined as unknown as string },
      {
        id: "s1",
        name: "Violin I Part",
        layout: undefined as unknown as string,
        pageSetup: { ...DEFAULT_PART_PAGE_SETUP, spatiumMm: 1.5 },
      },
    ],
    layouts: [],
  }) as unknown as Score;

describe("publish/batchRender helpers", () => {
  describe("formatFilename", () => {
    it("substitutes %TITLE% and %PART%", () => {
      const out = formatFilename("%TITLE% — %PART%", { title: "Sonata", part: "Violin I" });
      expect(out).toBe("Sonata — Violin I");
    });

    it("falls back to 'score' when title is undefined", () => {
      const out = formatFilename("%TITLE% — %PART%", { title: undefined, part: "Cello" });
      expect(out).toBe("score — Cello");
    });

    it("strips OS-illegal characters", () => {
      const out = formatFilename("%TITLE%/%PART%:bad?", { title: "A<B>C", part: "1|2" });
      // Every reserved char becomes "-"
      expect(out).not.toMatch(/[<>:"/\\|?*]/);
      expect(out).toContain("A-B-C");
    });

    it("supports patterns with no tokens", () => {
      expect(formatFilename("export", { title: "X", part: "Y" })).toBe("export");
    });

    it("substitutes repeated tokens", () => {
      const out = formatFilename("%PART%-%PART%", { title: "T", part: "Vn" });
      expect(out).toBe("Vn-Vn");
    });
  });

  describe("getScoreDisplayName", () => {
    it("returns the score's name when set", () => {
      const score = baseScore();
      expect(getScoreDisplayName(score, 0)).toBe("Full Score");
      expect(getScoreDisplayName(score, 1)).toBe("Violin I Part");
    });

    it("falls back to 'Full score' for index 0 with no name", () => {
      const score = { ...baseScore(), scores: [{ id: "s0" } as never] };
      expect(getScoreDisplayName(score as Score, 0)).toBe("Full score");
    });

    it("falls back to 'Score N' for higher indices with no name", () => {
      const score = { ...baseScore(), scores: [{ id: "s0" }, { id: "s1" }] as never };
      expect(getScoreDisplayName(score as Score, 1)).toBe("Score 2");
    });
  });

  describe("resolvePageSetupForScore", () => {
    it("returns the override when one is set on the score", () => {
      const score = baseScore();
      const ps = resolvePageSetupForScore(score, 1);
      expect(ps.spatiumMm).toBe(1.5);
    });

    it("falls back to defaults when no override is set", () => {
      const score = baseScore();
      const ps = resolvePageSetupForScore(score, 0);
      // First score is the conductor/full-score variant — uses DEFAULT_PAGE_SETUP spatium
      expect(ps.width).toBe(DEFAULT_PAGE_SETUP.width);
      expect(ps.height).toBe(DEFAULT_PAGE_SETUP.height);
    });

    it("merges overridden margins with default margins", () => {
      const score = baseScore();
      score.scores![1]!.pageSetup = {
        ...DEFAULT_PART_PAGE_SETUP,
        margins: { ...DEFAULT_PART_PAGE_SETUP.margins, top: 99 },
      };
      const ps = resolvePageSetupForScore(score, 1);
      expect(ps.margins.top).toBe(99);
      expect(ps.margins.bottom).toBe(DEFAULT_PART_PAGE_SETUP.margins.bottom);
    });
  });

  describe("isDirectoryPickerSupported", () => {
    const w = globalThis as unknown as { showDirectoryPicker?: unknown };
    const original = w.showDirectoryPicker;
    afterEach(() => {
      if (original === undefined) delete w.showDirectoryPicker;
      else w.showDirectoryPicker = original;
    });

    it("returns true when window.showDirectoryPicker is a function", () => {
      w.showDirectoryPicker = () => Promise.resolve({});
      expect(isDirectoryPickerSupported()).toBe(true);
    });

    it("returns false when window.showDirectoryPicker is missing", () => {
      delete w.showDirectoryPicker;
      expect(isDirectoryPickerSupported()).toBe(false);
    });
  });
});
