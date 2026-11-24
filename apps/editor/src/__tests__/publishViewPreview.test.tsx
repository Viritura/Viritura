/**
 * Tests for the Publish-mode preview wiring (hybrid path).
 *
 * Publish mode shares the single persistent `ScoreCanvas` with Write/Engrave:
 * the canvas flips to `printPreview` and the chrome swaps to the publish
 * layout/export panels + the shared `PreviewStatusBar`. Rather than spin up
 * the full WASM engine (or the whole Write tree) just to verify these props,
 * we render the two pure surfaces — `WorkspaceCanvas` + `WorkspaceStatusBar` —
 * driven by `usePublishMode`, exactly as `AppWorkspace` wires them in publish
 * mode, with `ScoreCanvas` mocked to a prop-recording stub.
 */
import React, { useRef, useState } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { TooltipPrimitives, type WriteViewMode as ViewMode } from "@viritura/ui";
import type { Score } from "@viritura/core";
import { DEFAULT_PAGE_SETUP } from "@viritura/core";
import { setCssPxPerMm, getLifeSizeZoom } from "../zoomScale";
import { useDialogStore } from "../store/dialogStore";
import { useProjectStore } from "../store/projectStore";
import { initialMixerState, mixerReducer, restoreMixerState } from "../store/mixerStore";
import type { ScoreCanvasHandle } from "../components/ScoreCanvas";

// Bare-bones provider so primitives that route their `tooltip` prop through
// Radix don't throw "must be used within `TooltipProvider`". Delay is 0 so
// the provider is effectively transparent for non-tooltip assertions.
function renderWithTooltips(node: React.ReactElement) {
  return render(<TooltipPrimitives.Provider delayDuration={0}>{node}</TooltipPrimitives.Provider>);
}

const scoreCanvasProps: Array<Record<string, unknown>> = [];
const setZoomSpy = vi.fn();

vi.mock("../components/ScoreCanvas", () => {
  const ScoreCanvas = React.forwardRef(function MockScoreCanvas(
    props: Record<string, unknown>,
    ref: React.Ref<unknown>,
  ) {
    scoreCanvasProps.push(props);
    React.useImperativeHandle(ref, () => ({
      scrollToPage: vi.fn(),
      fitPage: vi.fn(),
      fitWidth: vi.fn(),
      setZoom: setZoomSpy,
      resetViewport: vi.fn(),
      getCurrentPageIndex: () => 0,
      getPageCount: () => 0,
      getViewport: () => ({ zoom: 1, scrollX: 0, scrollY: 0 }),
    }));
    return (
      <div
        data-testid="mock-score-canvas"
        data-print-preview={String(props.printPreview ?? false)}
        data-view-mode={String(props.viewMode ?? "")}
        data-selected-score-index={String(props.selectedScoreIndex ?? "")}
      />
    );
  });
  return { ScoreCanvas };
});

import { WorkspaceCanvas } from "../app/WorkspaceCanvas";
import { usePublishMode } from "../app/usePublishMode";
import { buildPublishMode } from "../app/buildPublishMode";
import * as publishExport from "../components/modes/publishView/runPublishExport";
import * as audioExport from "../components/modes/publishView/runAudioExport";

/**
 * Mirrors how AppInner wires the publish branch around the shared canvas:
 * `usePublishMode` produces the data bag, `buildPublishMode` assembles the
 * `WorkspaceMode` (canvas props + status bar), and the shell renders them.
 */
function PublishHarness({ score }: { score: Score | null }) {
  const canvasRef = useRef<ScoreCanvasHandle | null>(null);
  const [selectedScoreIndex, setSelectedScoreIndex] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("page");
  const publish = usePublishMode({ score, selectedScoreIndex, setSelectedScoreIndex, canvasRef, active: true });
  const previewViewMode = viewMode === "horizon" ? "spread-h" : viewMode;
  // eslint-disable-next-line react-hooks/refs -- buildPublishMode captures canvasRef into status-bar event handlers; it never reads `.current` during render
  const mode = buildPublishMode({ publish, canvasRef, currentZoom: getLifeSizeZoom(), previewViewMode, setViewMode });
  return (
    <>
      <WorkspaceCanvas
        insets={{ left: 0, right: 0, top: 0, bottom: 0 }}
        canvasRef={canvasRef}
        selectedScoreIndex={selectedScoreIndex}
        expandedCondensingStaves={new Set()}
        viewMode={viewMode}
        onViewportChange={() => {}}
        onLayoutsChange={() => {}}
        canvasProps={mode.canvasProps}
      />
      {mode.panels}
      {mode.statusBar}
    </>
  );
}

const sampleScore: Score = {
  mnx: { version: 1 },
  metadata: { title: "Quartet" },
  parts: [
    { id: "p1", name: "Violin I", measures: [] },
    { id: "p2", name: "Cello", measures: [] },
  ],
  scores: [
    { id: "s0", name: "Full Score", layout: "" as never },
    {
      id: "s1",
      name: "Violin I",
      layout: "" as never,
      pageSetup: DEFAULT_PAGE_SETUP,
    },
  ],
  layouts: [],
  global: { measures: [] },
} as unknown as Score;

afterEach(() => {
  cleanup();
  scoreCanvasProps.length = 0;
  setZoomSpy.mockClear();
  setCssPxPerMm(null);
  useDialogStore.getState().closeDialog("calibration");
  useProjectStore.setState({ projectFolder: null });
  restoreMixerState(initialMixerState());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Publish destinations", () => {
  it.each(["PDF", "MP3", "WAV"])("reports successful %s exports only through the global toast", async (format) => {
    const user = userEvent.setup();
    const message = `Exported ${format}. Playback warning.`;
    const success = vi.spyOn(toast, "success").mockReturnValue("export-success");
    vi.spyOn(publishExport, "runPublishExport").mockResolvedValue({ kind: "ok", text: message });
    vi.spyOn(audioExport, "runAudioExport").mockResolvedValue({ kind: "ok", text: message });
    renderWithTooltips(<PublishHarness score={sampleScore} />);
    if (format !== "PDF") {
      await user.click(screen.getByRole("combobox", { name: "Export format" }));
      await user.click(screen.getByRole("option", { name: format }));
    }
    await user.click(screen.getByRole("button", { name: format === "PDF" ? "Export 2 layouts" : `Export ${format}` }));
    expect(success).toHaveBeenCalledExactlyOnceWith(message);
    expect(screen.queryByText(message)).toBeNull();
  });

  it("keeps export failures visible without reporting success", async () => {
    const user = userEvent.setup();
    const error = new Error("Disk is full");
    const success = vi.spyOn(toast, "success").mockReturnValue("export-success");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(publishExport, "runPublishExport").mockRejectedValue(error);
    renderWithTooltips(<PublishHarness score={sampleScore} />);
    await user.click(screen.getByRole("button", { name: "Export 2 layouts" }));
    expect(screen.getByText(error.message).closest('[role="status"]')).not.toBeNull();
    expect(success).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("Publish export failed:", error);
  });

  it("keeps audio progress and cancellation available without reporting success", async () => {
    const user = userEvent.setup();
    const success = vi.spyOn(toast, "success").mockReturnValue("export-success");
    vi.spyOn(audioExport, "runAudioExport").mockImplementation(({ onProgress, signal }) => {
      onProgress(0.25);
      return new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true });
      });
    });
    renderWithTooltips(<PublishHarness score={sampleScore} />);
    await user.click(screen.getByRole("combobox", { name: "Export format" }));
    await user.click(screen.getByRole("option", { name: "MP3" }));
    await user.click(screen.getByRole("button", { name: "Export MP3" }));
    expect(screen.getByText("Rendering MP3: 25%")).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Export MP3" }).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Cancel export" }));
    expect(screen.getByText("MP3 export cancelled.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancel export" })).toBeNull();
    expect(success).not.toHaveBeenCalled();
  });

  it("shows plain format names and keeps unsupported formats disabled", async () => {
    const user = userEvent.setup();
    renderWithTooltips(<PublishHarness score={sampleScore} />);
    await user.click(screen.getByRole("combobox", { name: "Export format" }));

    const options = screen.getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["PDF", "MusicXML", "MNX", "MIDI", "MP3", "WAV"]);
    for (const name of ["MusicXML", "MNX", "MIDI"]) {
      expect(screen.getByRole("option", { name }).getAttribute("aria-disabled")).toBe("true");
    }
    expect(screen.getByRole("option", { name: "PDF" }).querySelectorAll("svg")).toHaveLength(1);
    for (const name of ["MusicXML", "MNX", "MIDI", "MP3", "WAV"]) {
      expect(screen.getByRole("option", { name }).querySelectorAll("svg")).toHaveLength(0);
    }
  });

  it("exports the latest mixer snapshot including a muted Chords channel", async () => {
    const user = userEvent.setup();
    const runMp3 = vi.spyOn(audioExport, "runAudioExport").mockResolvedValue({ kind: "ok", text: "Exported MP3." });
    const score: Score = {
      ...sampleScore,
      global: {
        measures: [{ chordSymbols: [{ position: { fraction: [0, 1] }, root: { step: "C" } }] }],
      },
    };
    let mixer = mixerReducer(initialMixerState(), { type: "SYNC_PARTS", partCount: 2, hasChords: true });
    restoreMixerState(mixer);
    renderWithTooltips(<PublishHarness score={score} />);
    await user.click(screen.getByRole("combobox", { name: "Export format" }));
    await user.click(screen.getByRole("option", { name: "MP3" }));
    mixer = mixerReducer(mixer, { type: "TOGGLE_MUTE", partIndex: 2 });
    mixer = mixerReducer(mixer, { type: "SET_VOLUME", partIndex: 0, volume: 0.25 });
    act(() => restoreMixerState(mixer));
    await user.click(screen.getByRole("button", { name: "Export MP3" }));
    expect(runMp3).toHaveBeenCalledWith(
      expect.objectContaining({
        score,
        encoding: { format: "mp3", bitrate: 192 },
        mix: [
          expect.objectContaining({ volume: 0.25, muted: false }),
          expect.objectContaining({ muted: false }),
          expect.objectContaining({ muted: true }),
        ],
      }),
    );
  });

  it("switches between PDF layouts and whole-document MP3 without losing the PDF selection", async () => {
    const user = userEvent.setup();
    const runMp3 = vi.spyOn(audioExport, "runAudioExport").mockResolvedValue({ kind: "ok", text: "Exported MP3." });
    renderWithTooltips(<PublishHarness score={sampleScore} />);
    await user.click(screen.getByRole("button", { name: "None" }));
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Export 0 layouts" }).disabled).toBe(true);

    await user.click(screen.getByRole("combobox", { name: "Export format" }));
    await user.click(screen.getByRole("option", { name: "MP3" }));
    expect(screen.getByText("Audio export includes the whole document.")).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "Include Full Score in export" }).disabled).toBe(
      true,
    );
    expect(screen.queryByRole("radio", { name: /ZIP archive/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Export MP3" }));
    expect(runMp3).toHaveBeenCalledWith(expect.objectContaining({ score: sampleScore }));

    await user.click(screen.getByRole("combobox", { name: "Export format" }));
    await user.click(screen.getByRole("option", { name: "PDF" }));
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Export 0 layouts" }).disabled).toBe(true);
    expect(screen.getByRole("radio", { name: /ZIP archive/ })).toBeTruthy();
  });

  it("exports WAV at the selected bit depth", async () => {
    const user = userEvent.setup();
    const runAudio = vi.spyOn(audioExport, "runAudioExport").mockResolvedValue({ kind: "ok", text: "Exported WAV." });
    renderWithTooltips(<PublishHarness score={sampleScore} />);
    await user.click(screen.getByRole("combobox", { name: "Export format" }));
    await user.click(screen.getByRole("option", { name: "WAV" }));
    expect(screen.getByText(/about 16 MB\/min/)).toBeTruthy();
    await user.click(screen.getByRole("combobox", { name: "WAV bit depth" }));
    await user.click(screen.getByRole("option", { name: "16-bit" }));
    expect(screen.getByText(/about 11 MB\/min/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Export WAV" }));
    expect(runAudio).toHaveBeenCalledWith(expect.objectContaining({ encoding: { format: "wav", bitDepth: 16 } }));
  });

  it("exports MP3 at the selected bitrate", async () => {
    const user = userEvent.setup();
    const runAudio = vi.spyOn(audioExport, "runAudioExport").mockResolvedValue({ kind: "ok", text: "Exported MP3." });
    renderWithTooltips(<PublishHarness score={sampleScore} />);
    await user.click(screen.getByRole("combobox", { name: "Export format" }));
    await user.click(screen.getByRole("option", { name: "MP3" }));
    await user.click(screen.getByRole("combobox", { name: "MP3 bitrate" }));
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "128 kbps",
      "192 kbps",
      "256 kbps",
      "320 kbps",
    ]);
    await user.click(screen.getByRole("option", { name: "320 kbps" }));
    await user.click(screen.getByRole("button", { name: "Export MP3" }));
    expect(runAudio).toHaveBeenCalledWith(
      expect.objectContaining({ encoding: { format: "mp3", bitrate: 320 }, filenamePattern: "%TITLE% - %PART%" }),
    );
  });

  it("links to MP3 encoder notices on GitHub instead of downloading them", async () => {
    const user = userEvent.setup();
    renderWithTooltips(<PublishHarness score={sampleScore} />);
    await user.click(screen.getByRole("combobox", { name: "Export format" }));
    await user.click(screen.getByRole("option", { name: "MP3" }));
    const link = screen.getByRole("link", { name: "MP3 encoder licenses" });
    expect(link.getAttribute("href")).toBe(
      "https://github.com/Viritura/Viritura/blob/main/THIRD_PARTY_NOTICES.md#mp3-encoding",
    );
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.hasAttribute("download")).toBe(false);
  });

  it("does not report a missing score when exporting audio from a document without layouts", async () => {
    const user = userEvent.setup();
    renderWithTooltips(<PublishHarness score={{ ...sampleScore, scores: [] }} />);
    await user.click(screen.getByRole("combobox", { name: "Export format" }));
    await user.click(screen.getByRole("option", { name: "MP3" }));
    expect(screen.getByText("Layouts are not required for audio export.")).toBeTruthy();
    expect(screen.queryByText("No score loaded.")).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Export MP3" }).disabled).toBe(false);
  });

  it("advertises the score-order number token and passes a custom pattern to export", async () => {
    const runExport = vi.spyOn(publishExport, "runPublishExport").mockResolvedValue({ kind: "ok", text: "Exported." });
    renderWithTooltips(<PublishHarness score={sampleScore} />);
    expect(screen.getByText("%PART_NUMBER%")).toBeTruthy();

    fireEvent.change(screen.getByDisplayValue("%TITLE% - %PART%"), {
      target: { value: "%PART_NUMBER% - %PART%" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Export 2 layouts" }));
    });
    expect(runExport).toHaveBeenCalledWith(expect.objectContaining({ filenamePattern: "%PART_NUMBER% - %PART%" }));
  });

  it("defaults to a single ZIP download and does not offer separate downloads", () => {
    renderWithTooltips(<PublishHarness score={sampleScore} />);
    expect(screen.getByRole<HTMLInputElement>("radio", { name: /ZIP archive/ }).checked).toBe(true);
    expect(screen.queryByRole("radio", { name: /Separate files/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Use project folder" })).toBeNull();
  });

  it("defaults to direct project-folder PDFs and returns to ZIP when cleared", () => {
    useProjectStore.setState({ projectFolder: { name: "Quartet project" } as FileSystemDirectoryHandle });
    renderWithTooltips(<PublishHarness score={sampleScore} />);

    expect(screen.getByRole<HTMLInputElement>("radio", { name: /Separate files/ }).checked).toBe(true);
    expect(screen.getByRole("button", { name: 'Export 2 layouts to "Quartet project"' })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByRole<HTMLInputElement>("radio", { name: /ZIP archive/ }).checked).toBe(true);
    expect(screen.queryByRole("radio", { name: /Separate files/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Use project folder" }));
    expect(screen.getByRole("button", { name: 'Export 2 layouts to "Quartet project"' })).toBeTruthy();
  });

  it("follows the new project's folder after switching projects", () => {
    useProjectStore.setState({ projectFolder: { name: "First project" } as FileSystemDirectoryHandle });
    renderWithTooltips(<PublishHarness score={sampleScore} />);
    expect(screen.getByRole("button", { name: 'Export 2 layouts to "First project"' })).toBeTruthy();

    act(() => {
      useProjectStore.setState({ projectFolder: { name: "Second project" } as FileSystemDirectoryHandle });
    });
    expect(screen.getByRole("button", { name: 'Export 2 layouts to "Second project"' })).toBeTruthy();

    act(() => {
      useProjectStore.setState({ projectFolder: null });
    });
    expect(screen.getByRole<HTMLInputElement>("radio", { name: /ZIP archive/ }).checked).toBe(true);
    expect(screen.getByRole("button", { name: "Export 2 layouts" })).toBeTruthy();
  });

  it("switches a user-picked folder to direct PDFs without changing destination when the picker is cancelled", async () => {
    const showDirectoryPicker = vi.fn().mockResolvedValue({ name: "PDFs" });
    vi.stubGlobal("showDirectoryPicker", showDirectoryPicker);
    renderWithTooltips(<PublishHarness score={sampleScore} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Choose folder" }));
    });
    expect(showDirectoryPicker).toHaveBeenCalledWith({ mode: "readwrite" });
    expect(screen.getByRole<HTMLInputElement>("radio", { name: /Separate files/ }).checked).toBe(true);

    showDirectoryPicker.mockRejectedValueOnce(new DOMException("Cancelled", "AbortError"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Change" }));
    });
    expect(screen.getByRole("button", { name: 'Export 2 layouts to "PDFs"' })).toBeTruthy();
  });
});

describe("Publish mode preview wiring", () => {
  it("renders the shared canvas in print-preview for the focused layout", () => {
    renderWithTooltips(<PublishHarness score={sampleScore} />);
    const canvas = screen.getByTestId("mock-score-canvas");
    expect(canvas.getAttribute("data-print-preview")).toBe("true");
    expect(canvas.getAttribute("data-view-mode")).toBe("page");
    expect(canvas.getAttribute("data-selected-score-index")).toBe("0");
  });

  it("always passes printPreview while in publish mode", () => {
    renderWithTooltips(<PublishHarness score={sampleScore} />);
    expect(scoreCanvasProps.length).toBeGreaterThan(0);
    for (const props of scoreCanvasProps) {
      expect(props.printPreview).toBe(true);
    }
  });
});

describe("Publish mode preview status bar", () => {
  it("renders the shared preview controls", () => {
    renderWithTooltips(<PublishHarness score={sampleScore} />);
    const bar = screen.getByTestId("publish-preview-statusbar");
    expect(bar).toBeTruthy();
    expect(screen.getByRole("button", { name: "Preview view mode" })).toBeTruthy();
    expect(screen.getByRole("slider", { name: "Zoom slider" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset zoom" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Calibrate display" })).toBeTruthy();
    expect(bar.textContent).toContain("Page");
    expect(bar.textContent).toContain("100%");
  });

  it("lets the user switch preview view mode", () => {
    renderWithTooltips(<PublishHarness score={sampleScore} />);

    fireEvent.click(screen.getByRole("button", { name: "Preview view mode" }));
    fireEvent.click(screen.getByRole("option", { name: "Spread" }));

    expect(screen.getByTestId("mock-score-canvas").getAttribute("data-view-mode")).toBe("spread");
  });

  it("zoom slider drives the canvas zoom helper", () => {
    renderWithTooltips(<PublishHarness score={sampleScore} />);

    fireEvent.change(screen.getByRole("slider", { name: "Zoom slider" }), {
      target: { value: "1.25" },
    });

    expect(setZoomSpy).toHaveBeenCalledWith(1.25);
  });

  it("Reset zoom opens calibration before physical size is known", () => {
    renderWithTooltips(<PublishHarness score={sampleScore} />);
    fireEvent.click(screen.getByRole("button", { name: "Reset zoom" }));
    // When the user has never calibrated their display, "Actual Size" cannot
    // know what physical size means, so it opens the shared Calibration dialog
    // (via the dialog store) instead of zooming to a meaningless default.
    expect(setZoomSpy).not.toHaveBeenCalled();
    expect(useDialogStore.getState().open.calibration).toBe(true);
  });

  it("Actual Size uses the calibrated life-size zoom when calibration is set", () => {
    setCssPxPerMm(4.0); // any non-default value flips isCalibrated() → true
    try {
      renderWithTooltips(<PublishHarness score={sampleScore} />);
      fireEvent.click(screen.getByRole("button", { name: "Reset zoom" }));
      expect(setZoomSpy).toHaveBeenCalledTimes(1);
      const arg = setZoomSpy.mock.calls[0]![0] as number;
      expect(arg).toBeGreaterThan(0);
    } finally {
      setCssPxPerMm(null);
    }
  });
});
