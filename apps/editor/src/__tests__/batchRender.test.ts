import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import type { Score } from "@viritura/core";
import { DEFAULT_PAGE_SETUP, DEFAULT_PART_PAGE_SETUP } from "@viritura/core";
import { serializeMnx } from "@viritura/format";
import {
  type DisplayList,
  exportPdf,
  getScoreInfo,
  wasmComputeMnxScoreLayout,
  wasmComputeFullScoreLayout,
  wasmComputeLayout,
} from "@viritura/renderer";
import {
  exportScoresToPdf,
  formatFilename,
  resolvePageSetupForScore,
  getScoreDisplayName,
  isDirectoryPickerSupported,
} from "../publish/batchRender";

vi.mock("@viritura/renderer", () => ({
  exportPdf: vi.fn(),
  getScoreInfo: vi.fn(),
  wasmComputeMnxScoreLayout: vi.fn(),
  wasmComputeFullScoreLayout: vi.fn(),
  wasmComputeLayout: vi.fn(),
}));

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

describe("exportScoresToPdf layout routing", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    { scoreCount: 0, partCount: 0, scoreIndex: 0, route: "full" },
    { scoreCount: 0, partCount: 1, scoreIndex: 0, route: "part" },
    { scoreCount: 0, partCount: 2, scoreIndex: 0, route: "full" },
    { scoreCount: 1, partCount: 0, scoreIndex: 0, route: "full" },
    { scoreCount: 1, partCount: 1, scoreIndex: 0, route: "part" },
    { scoreCount: 1, partCount: 2, scoreIndex: 0, route: "full" },
    { scoreCount: 2, partCount: 0, scoreIndex: 1, route: "mnx" },
    { scoreCount: 2, partCount: 1, scoreIndex: 1, route: "mnx" },
    { scoreCount: 2, partCount: 2, scoreIndex: 1, route: "mnx" },
  ] as const)(
    "exports score $scoreIndex with $scoreCount scores and $partCount parts via $route layout",
    async ({ scoreCount, partCount, scoreIndex, route }) => {
      const score: Score = {
        mnx: { version: 1 },
        metadata: { title: "My Étude" },
        global: { measures: [] },
        parts: Array.from({ length: partCount }, (_, i) => ({
          id: `p${i}`,
          name: `Part ${i + 1}`,
          measures: [],
        })),
        scores: Array.from({ length: scoreCount }, (_, i) => ({
          name: `Edition ${i + 1}`,
          pageSetup: { ...DEFAULT_PAGE_SETUP, width: 200, spatiumMm: 1.5 },
        })),
      };
      const mnxJson = JSON.stringify(serializeMnx(score));
      vi.mocked(getScoreInfo).mockReturnValue({
        scoreCount,
        partCount,
        scoreNames: score.scores!.map((sd) => sd.name!),
        partNames: score.parts.map((part) => part.name),
        measureCount: 0,
        layoutCount: 0,
      });
      const renderers = {
        full: vi.mocked(wasmComputeFullScoreLayout),
        part: vi.mocked(wasmComputeLayout),
        mnx: vi.mocked(wasmComputeMnxScoreLayout),
      };
      const displayList: DisplayList = { commands: [], width: 2400, height: 3500 };
      renderers[route].mockReturnValue(displayList);
      const bytes = new Uint8Array([37, 80, 68, 70]);
      vi.mocked(exportPdf).mockResolvedValue(bytes);
      const onProgress = vi.fn();

      const results = await exportScoresToPdf(score, { scoreIndices: [scoreIndex], embedMnx: true, onProgress });

      const name = scoreCount === 0 ? "Full score" : `Edition ${scoreIndex + 1}`;
      expect(results).toEqual([{ scoreIndex, name, bytes }]);
      expect(getScoreInfo).toHaveBeenCalledExactlyOnceWith(mnxJson);
      const ps = resolvePageSetupForScore(score, scoreIndex);
      const pageSetupJson = JSON.stringify({
        page_height: ps.height / ps.spatiumMm,
        page_margin_top: ps.margins.top / ps.spatiumMm,
        page_margin_bottom: ps.margins.bottom / ps.spatiumMm,
        page_margin_left: ps.margins.left / ps.spatiumMm,
        page_margin_right: ps.margins.right / ps.spatiumMm,
      });
      const sp = ps.spatiumMm * 12;
      const width = Math.round(ps.width * 12);
      const expectedArgs = {
        full: [mnxJson, sp, width, pageSetupJson],
        part: [mnxJson, 0, sp, width, pageSetupJson],
        mnx: [mnxJson, sp, width, scoreIndex, pageSetupJson],
      };
      expect(renderers[route]).toHaveBeenCalledExactlyOnceWith(...expectedArgs[route]);
      for (const [key, renderer] of Object.entries(renderers)) {
        if (key !== route) expect(renderer).not.toHaveBeenCalled();
      }
      expect(exportPdf).toHaveBeenCalledExactlyOnceWith(
        displayList,
        expect.objectContaining({
          pageWidthMm: ps.width,
          pageHeightMm: ps.height,
          spatiumMm: ps.spatiumMm,
          spPixels: sp,
          title: `My Étude — ${name}`,
          mnxJson: JSON.stringify(serializeMnx(score), null, 2),
        }),
      );
      expect(vi.mocked(exportPdf).mock.calls[0]?.[0]).toBe(displayList);
      expect(onProgress).toHaveBeenCalledExactlyOnceWith(1, 1, name);
    },
  );
});

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
