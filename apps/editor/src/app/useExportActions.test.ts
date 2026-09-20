import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PAGE_SETUP, pageTurnConfigForLayout, type Score } from "@viritura/core";
import * as format from "@viritura/format";
import {
  exportPdf,
  exportSvg,
  getScoreInfo,
  wasmComputeFullScoreLayout,
  wasmComputeLayout,
  wasmComputeMnxScoreLayout,
  type DisplayList,
} from "@viritura/renderer";
import type { ScoreCanvasHandle } from "../components/ScoreCanvas";
import type { DocumentStore } from "../store/documentStore";
import { useViewStateStore } from "../store/viewStateStore";
import { resolvePageSetupForScore } from "../publish";
import { useExportActions } from "./useExportActions";

vi.mock("@viritura/renderer", () => ({
  exportPdf: vi.fn(),
  exportSvg: vi.fn(),
  getScoreInfo: vi.fn(),
  wasmComputeFullScoreLayout: vi.fn(),
  wasmComputeLayout: vi.fn(),
  wasmComputeMnxScoreLayout: vi.fn(),
}));

const engineDisplayList: DisplayList = {
  width: 2400,
  height: 3600,
  commands: [
    { type: "DrawLine", x1: 10, y1: 20, x2: 200, y2: 20, width: 1, color: "#000000" },
    { type: "DrawLine", x1: 10, y1: 40, x2: 200, y2: 40, width: 1, color: "#663399" },
  ],
};
const tintedDisplayList: DisplayList = {
  ...engineDisplayList,
  commands: engineDisplayList.commands.map((command) => ({ ...command, color: "#ff0000" })),
};

function makeScore(title = "Current score"): Score {
  return {
    mnx: { version: 1 },
    metadata: { title },
    global: {
      measures: [
        {
          chordSymbols: [
            {
              position: { fraction: [0, 1] },
              root: { step: "F", alter: 1 },
              bass: { step: "A", alter: 1 },
              quality: "major",
            },
          ],
        },
      ],
    },
    parts: [
      {
        id: "clarinet",
        name: "Clarinet",
        transposition: { interval: { halfSteps: 2, staffDistance: 1 } },
        chordSymbolVisibility: "hide",
        measures: [{ sequences: [] }],
      },
    ],
    scores: [
      { name: "Concert", useWritten: false },
      {
        name: "Written",
        useWritten: true,
        pageSetup: {
          ...DEFAULT_PAGE_SETUP,
          width: 190,
          height: 270,
          spatiumMm: 1.5,
          margins: { top: 12, bottom: 15, left: 18, right: 21 },
          pageTurns: { enabled: true, preset: "relaxed" },
        },
      },
    ],
  };
}

function createHarness(score: Score | null = makeScore(), withCanvas = false) {
  const state: { score: Score | null; workingScore: Score | null } = { score, workingScore: null };
  const store = { getState: () => state } as unknown as DocumentStore;
  const getDisplayList = vi.fn(() => tintedDisplayList);
  const getPageSetup = vi.fn(() => ({ ...DEFAULT_PAGE_SETUP, width: 90000, height: 1 }));
  const canvasRef = {
    current: withCanvas ? ({ getDisplayList, getPageSetup } as unknown as ScoreCanvasHandle) : null,
  };
  const hook = renderHook(() => useExportActions({ store, canvasRef }));
  return { ...hook, state, getDisplayList, getPageSetup };
}

const downloads: string[] = [];

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(format, "serializeMnx");
  vi.mocked(getScoreInfo).mockImplementation((json) => {
    const score = JSON.parse(json) as { scores?: { name?: string }[]; parts: { name: string }[] };
    return {
      scoreCount: score.scores?.length ?? 0,
      scoreNames: score.scores?.map((sd) => sd.name ?? "") ?? [],
      partCount: score.parts.length,
      partNames: score.parts.map((part) => part.name),
      measureCount: 1,
      layoutCount: 0,
    };
  });
  vi.mocked(wasmComputeMnxScoreLayout).mockReturnValue(engineDisplayList);
  vi.mocked(wasmComputeFullScoreLayout).mockReturnValue(engineDisplayList);
  vi.mocked(wasmComputeLayout).mockReturnValue(engineDisplayList);
  vi.mocked(exportPdf).mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
  vi.mocked(exportSvg).mockResolvedValue("<svg/>");
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:export");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  downloads.length = 0;
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push(this.download);
  });
  useViewStateStore.setState({ selectedScoreIndex: 0, selectedPartIds: [], viewMode: "horizon" });
});

afterEach(() => {
  vi.restoreAllMocks();
  useViewStateStore.setState({ selectedScoreIndex: 0, selectedPartIds: [], viewMode: "horizon" });
});

describe.each([
  { kind: "PDF", action: "handleExportPdf", exporter: exportPdf, extension: "pdf" },
  { kind: "SVG", action: "handleExportSvg", exporter: exportSvg, extension: "svg" },
] as const)("$kind export", ({ kind, action, exporter, extension }) => {
  it("lays out the invocation-time active score, ignoring tinted canvas and horizon settings", async () => {
    const score = makeScore();
    const { result, getDisplayList, getPageSetup } = createHarness(score, true);
    const handler = result.current[action];
    useViewStateStore.setState({ selectedScoreIndex: 1, selectedPartIds: ["clarinet"] });

    await act(handler);

    const ps = resolvePageSetupForScore(score, 1);
    const json = vi.mocked(getScoreInfo).mock.calls[0]![0];
    expect(format.serializeMnx).toHaveBeenCalledExactlyOnceWith(score);
    expect(wasmComputeMnxScoreLayout).toHaveBeenCalledExactlyOnceWith(
      json,
      ps.spatiumMm * 12,
      Math.round(ps.width * 12),
      1,
      JSON.stringify({
        page_height: ps.height / ps.spatiumMm,
        page_margin_top: ps.margins.top / ps.spatiumMm,
        page_margin_bottom: ps.margins.bottom / ps.spatiumMm,
        page_margin_left: ps.margins.left / ps.spatiumMm,
        page_margin_right: ps.margins.right / ps.spatiumMm,
        page_turns: pageTurnConfigForLayout(ps.pageTurns!),
      }),
    );
    expect(exporter).toHaveBeenCalledExactlyOnceWith(
      engineDisplayList,
      expect.objectContaining({
        pageWidthMm: 190,
        pageHeightMm: 270,
        spatiumMm: 1.5,
        spPixels: 18,
        bravuraFont: `${window.location.origin}/fonts/Bravura.otf`,
        serifFont: `${window.location.origin}/fonts/LibertinusSerif-Regular.otf`,
      }),
    );
    expect(vi.mocked(exporter).mock.calls[0]![0]).toBe(engineDisplayList);
    expect(getDisplayList).not.toHaveBeenCalled();
    expect(getPageSetup).not.toHaveBeenCalled();
    expect(wasmComputeLayout).not.toHaveBeenCalled();
    expect(wasmComputeFullScoreLayout).not.toHaveBeenCalled();
    expect(downloads).toEqual([`Current score.${extension}`]);
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:export");
    if (kind === "PDF") {
      expect(exportPdf).toHaveBeenCalledWith(
        engineDisplayList,
        expect.objectContaining({
          mnxJson: json,
          title: "Current score",
          pdfTextFont: `${window.location.origin}/fonts/LibertinusSerif-Regular.otf`,
          pdfTextFontBold: `${window.location.origin}/fonts/LibertinusSerif-Bold.otf`,
          pdfTextFontItalic: `${window.location.origin}/fonts/LibertinusSerif-Italic.otf`,
          pdfTextFontBoldItalic: `${window.location.origin}/fonts/LibertinusSerif-BoldItalic.otf`,
        }),
      );
    }
  });

  it("exports the latest working model without a canvas or waiting for publication", async () => {
    const { result, state } = createHarness(makeScore("Published"));
    const handler = result.current[action];
    const working = makeScore("Pending edit");
    state.workingScore = working;
    const canonical = JSON.stringify(format.serializeMnx(working));
    vi.mocked(format.serializeMnx).mockClear();

    await act(handler);

    expect(format.serializeMnx).toHaveBeenCalledExactlyOnceWith(working);
    expect(JSON.parse(vi.mocked(getScoreInfo).mock.calls[0]![0])).toEqual(JSON.parse(canonical));
    expect(exporter).toHaveBeenCalledOnce();
    expect(downloads).toEqual([`Pending edit.${extension}`]);
    expect(state.score?.metadata?.title).toBe("Published");
  });

  it("passes canonical root, bass, written-pitch and part visibility settings unchanged", async () => {
    const score = makeScore();
    score.scores = [score.scores![1]!];
    const before = structuredClone(score);
    const canonical = format.serializeMnx(score);
    vi.mocked(format.serializeMnx).mockClear();
    const { result } = createHarness(score);

    await act(result.current[action]);

    expect(wasmComputeMnxScoreLayout).toHaveBeenCalledOnce();
    const [json, , , index] = vi.mocked(wasmComputeMnxScoreLayout).mock.calls[0]!;
    expect(index).toBe(0);
    expect(JSON.parse(json)).toEqual(canonical);
    expect(JSON.parse(json)).toMatchObject({
      global: {
        measures: [
          {
            _x: {
              viritura: {
                chordSymbols: [
                  {
                    root: { step: "F", alter: 1 },
                    bass: { step: "A", alter: 1 },
                  },
                ],
              },
            },
          },
        ],
      },
      parts: [{ _x: { viritura: { chordSymbolVisibility: "hide" } } }],
      scores: [{ useWritten: true }],
    });
    expect(format.serializeMnx).toHaveBeenCalledExactlyOnceWith(score);
    expect(score).toEqual(before);
  });

  it("does nothing without a score, even if a stale canvas exists", async () => {
    const { result, getDisplayList } = createHarness(null, true);

    await act(result.current[action]);

    expect(format.serializeMnx).not.toHaveBeenCalled();
    expect(getScoreInfo).not.toHaveBeenCalled();
    expect(exporter).not.toHaveBeenCalled();
    expect(getDisplayList).not.toHaveBeenCalled();
    expect(downloads).toEqual([]);
  });

  it("keeps the invocation-time title while export is pending", async () => {
    const { result, state } = createHarness(makeScore("Original"));
    let finishExport!: () => void;
    const pending = new Promise<void>((resolve) => {
      finishExport = resolve;
    });
    vi.mocked(exportPdf).mockImplementationOnce(async () => {
      await pending;
      return new Uint8Array([37, 80, 68, 70]);
    });
    vi.mocked(exportSvg).mockImplementationOnce(async () => {
      await pending;
      return "<svg/>";
    });

    await act(async () => {
      const exporting = result.current[action]();
      state.workingScore = makeScore("Changed");
      state.score = state.workingScore;
      useViewStateStore.setState({ selectedScoreIndex: 1 });
      finishExport();
      await exporting;
    });

    expect(downloads).toEqual([`Original.${extension}`]);
    expect(wasmComputeMnxScoreLayout).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Number),
      expect.any(Number),
      0,
      expect.any(String),
    );
  });

  it("uses canonical default pages and the default download name without metadata", async () => {
    const score = makeScore();
    delete score.metadata;
    const { result } = createHarness(score);

    await act(result.current[action]);

    const ps = resolvePageSetupForScore(score, 0);
    expect(exporter).toHaveBeenCalledWith(
      engineDisplayList,
      expect.objectContaining({
        pageWidthMm: ps.width,
        pageHeightMm: ps.height,
        spatiumMm: ps.spatiumMm,
      }),
    );
    expect(downloads).toEqual([`score.${extension}`]);
  });

  it.each(["serialization", "layout", "export"] as const)("catches %s failures without downloading", async (stage) => {
    const failure = new Error(`${stage} failed`);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    if (stage === "serialization") {
      vi.mocked(format.serializeMnx).mockImplementationOnce(() => {
        throw failure;
      });
    } else if (stage === "layout") {
      vi.mocked(wasmComputeMnxScoreLayout).mockImplementationOnce(() => {
        throw failure;
      });
    } else {
      vi.mocked(exportPdf).mockRejectedValueOnce(failure);
      vi.mocked(exportSvg).mockRejectedValueOnce(failure);
    }
    const { result } = createHarness();

    await act(result.current[action]);

    expect(error).toHaveBeenCalledExactlyOnceWith(`${kind} export failed:`, failure);
    expect(downloads).toEqual([]);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    if (stage !== "export") expect(exporter).not.toHaveBeenCalled();
  });
});
