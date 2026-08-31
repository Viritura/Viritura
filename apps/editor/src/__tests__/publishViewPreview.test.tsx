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
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { TooltipPrimitives, type WriteViewMode as ViewMode } from "@viritura/ui";
import type { Score } from "@viritura/core";
import { DEFAULT_PAGE_SETUP } from "@viritura/core";
import { setCssPxPerMm, getLifeSizeZoom } from "../zoomScale";
import { useDialogStore } from "../store/dialogStore";
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
