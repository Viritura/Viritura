import type { MouseEvent, ReactElement } from "react";
import { cleanup, fireEvent, render as renderUi, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChordSymbol, Score } from "@viritura/core";
import { SpatialIndex, type DisplayList } from "@viritura/renderer";
import { TooltipPrimitives } from "@viritura/ui";
import { resolveChordSymbolSource } from "../../../app/useAppKeyboardWiring";
import { useSelectionStore, type MeasureSelectionPoint } from "../../../store/selectionStore";
import { selectionReducer, type Selection } from "../../../store/selectionStore";
import { resolveSelectionEvents } from "../../../store/selectionUtils";
import { computeDeleteSelection } from "../../../commands/computeDeleteSelection";
import { handleCanvasClickImpl, type CanvasHandlerCtx } from "../canvasHandlers";
import { globalChordForElement, previewClickedChord } from "../chordFeedback";
import { UnsupportedChordOverlay } from "../UnsupportedChordOverlay";

const MESSAGE = "Unsupported chord: cannot play this symbol.";
const supported: ChordSymbol = { position: { fraction: [0, 1] }, root: { step: "C" }, bass: { step: "E" } };
const unsupported: ChordSymbol = { position: { fraction: [1, 4] }, rawText: "C mystery" };
const silent: ChordSymbol = { position: { fraction: [1, 2] }, rawText: "N.C." };

function render(ui: ReactElement) {
  return renderUi(ui, {
    wrapper: ({ children }) => <TooltipPrimitives.Provider>{children}</TooltipPrimitives.Provider>,
  });
}

function score(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ chordSymbols: [supported, unsupported, silent] }] },
    parts: [{ measures: [], transposition: { interval: { halfSteps: 2, staffDistance: 1 } } }],
  };
}

function displayList(): DisplayList {
  return {
    width: 800,
    height: 1200,
    commands: [
      {
        type: "DrawText",
        x: 100,
        y: 40,
        text: "C mystery",
        font: "serif",
        size: 16,
        color: "#000000",
        align: "left",
        baseline: "alphabetic",
      },
    ],
    elementIds: ["m0/chord1/p0/staff0"],
  };
}

function reorderedLayout(yOffset = 0) {
  const document = score();
  document.parts = [
    { ...document.parts[0]!, id: "clarinet", chordSymbolVisibility: "show" },
    { id: "piano", measures: [], chordSymbolVisibility: "show" },
  ];
  document.layouts = [
    {
      id: "reordered",
      content: [
        { type: "staff", sources: [{ part: "piano" }] },
        { type: "staff", sources: [{ part: "clarinet" }] },
      ],
    },
  ];
  document.scores = [{ name: "Reordered", layout: "reordered" }];
  const list = displayList();
  list.measureBounds = [
    {
      index: 0,
      partIndex: 1,
      staffIndex: 0,
      x: 0,
      y: yOffset + 50,
      width: 400,
      height: 40,
      prefixWidth: 0,
      totalBeats: 4,
      beatAnchors: [],
    },
    {
      index: 0,
      partIndex: 0,
      staffIndex: 1,
      x: 0,
      y: yOffset + 150,
      width: 400,
      height: 40,
      prefixWidth: 0,
      totalBeats: 4,
      beatAnchors: [],
    },
  ];
  useSelectionStore.setState({
    renderedStaffSources: [
      { measureIndex: 0, staffIndex: 0, partIds: ["piano"] },
      { measureIndex: 0, staffIndex: 1, partIds: ["clarinet"] },
    ],
  });
  return { document, list };
}

function expectClarinetSource(document: Score, id: string, anchor?: MeasureSelectionPoint) {
  expect(anchor).toMatchObject({
    partIndex: 0,
    staffIndex: 1,
    localStaffIndex: 0,
    measureIndex: 0,
    isExpansion: undefined,
  });
  const selection = { kind: "single", elementId: id, elementType: "chord-symbol", measureAnchor: anchor } as const;
  expect(resolveChordSymbolSource(document, selection, 0, 0, [])).toEqual({
    partIndex: 0,
    staff: 1,
  });
}

function context(id = "m0/chord0/p0/staff0") {
  const canvas = document.createElement("canvas");
  const previewChord = vi.fn().mockResolvedValue(undefined);
  const selectElement = vi.fn();
  const ctx = {
    viewport: { zoom: 1, scrollX: 0, scrollY: 0 },
    viewMode: "horizon",
    selectedScoreIndex: 0,
    selectedIds: new Set([id]),
    performanceOverlayEnabled: false,
    canvasRef: { current: canvas },
    spatialIndexRef: { current: new SpatialIndex([{ id, x: 100, y: 20, width: 60, height: 20 }]) },
    displayListRef: { current: displayList() },
    dragOccurredRef: { current: false },
    spannerDragRef: { current: null },
    interactionModeRef: { current: "write" },
    selectedSlurIdRef: { current: null },
    docScoreRef: { current: score() },
    pageSetupRef: { current: { margins: { left: 0 } } },
    engraveAdornmentsRef: { current: undefined },
    onEngraveEmptyClickRef: { current: undefined },
    previewChord,
    selectElement,
    clearSelection: vi.fn(),
    extendSelection: vi.fn(),
    toggleSelection: vi.fn(),
  } as unknown as CanvasHandlerCtx;
  return { ctx, previewChord, selectElement };
}

const click = { clientX: 110, clientY: 30 } as MouseEvent<HTMLCanvasElement>;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useSelectionStore.setState(useSelectionStore.getInitialState());
});

describe("direct canvas chord preview", () => {
  it("keeps hidden staff 1 out of a range started from a warning in a nondefault staff-2-only view", () => {
    const document = score();
    document.parts = [
      {
        id: "piano",
        staves: 2,
        measures: [
          {
            sequences: [1, 2].map((staff) => ({
              staff,
              content: [
                {
                  type: "event" as const,
                  id: `staff-${staff}`,
                  duration: { base: "quarter" as const },
                  notes: [{ pitch: { step: "C" as const, octave: 4 } }],
                },
              ],
            })),
          },
        ],
      },
    ];
    document.layouts = [{ id: "lower-only", content: [{ type: "staff", sources: [{ part: "piano", staff: 2 }] }] }];
    document.scores = [{}, { layout: "lower-only" }];
    const list = displayList();
    list.measureBounds = [
      {
        index: 0,
        partIndex: 0,
        staffIndex: 0,
        x: 0,
        y: 50,
        width: 400,
        height: 40,
        prefixWidth: 0,
        totalBeats: 4,
        beatAnchors: [],
      },
    ];
    let selection: Selection = { kind: "none" };
    const onSelect = (elementId: string, measureAnchor?: MeasureSelectionPoint) => {
      selection = selectionReducer(selection, { type: "SELECT_ELEMENT", elementId, measureAnchor });
    };
    render(
      <UnsupportedChordOverlay
        {...overlayProps()}
        score={document}
        displayList={list}
        selectedScoreIndex={1}
        spatialIndex={new SpatialIndex([{ id: "m0/chord1/p0/staff0", x: 100, y: 20, width: 60, height: 20 }])}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: MESSAGE }));
    expect(selection).toMatchObject({ measureAnchor: { localStaffIndex: 0, sourceStaff: 2 } });
    selection = selectionReducer(selection, { type: "EXTEND_SELECTION", elementId: "p0/m0/s1/staff-2" });
    expect(resolveSelectionEvents(selection, document)).toEqual([
      { partIndex: 0, measureIndex: 0, sequenceIndex: 1, eventIndex: 0 },
    ]);
    const result = computeDeleteSelection(structuredClone(document), selection);
    expect(result.kind).toBe("multi");
    if (result.kind !== "multi") throw new Error("Expected range deletion");
    expect(result.score.parts[0]!.measures[0]!.sequences[0]).toEqual(document.parts[0]!.measures[0]!.sequences[0]);
    expect(result.score.global).toEqual(document.global);
  });
  it.each(["m0/chord0", "m0/chord0/p0/staff0", "m0/chord0/p1/staff1"])(
    "auditions concert harmony on every click of already-selected %s",
    (id) => {
      const { ctx, previewChord, selectElement } = context(id);
      const before = JSON.stringify(ctx.docScoreRef.current);
      handleCanvasClickImpl(click, ctx);
      handleCanvasClickImpl(click, ctx);
      expect(previewChord).toHaveBeenCalledTimes(2);
      expect(previewChord).toHaveBeenNthCalledWith(1, supported, ctx.docScoreRef.current);
      expect(previewChord.mock.calls[0]![0]).toBe(supported);
      expect(selectElement).toHaveBeenCalledWith(id);
      expect(JSON.stringify(ctx.docScoreRef.current)).toBe(before);
    },
  );

  it("also previews a chord copy in engrave mode", () => {
    const { ctx, previewChord, selectElement } = context();
    ctx.interactionModeRef.current = "engrave";
    handleCanvasClickImpl(click, ctx);
    expect(previewChord).toHaveBeenCalledWith(supported, ctx.docScoreRef.current);
    expect(selectElement).toHaveBeenCalledWith("m0/chord0/p0/staff0");
  });

  describe.each(["write", "engrave"] as const)("%s source selection", (mode) => {
    it.each([0, 1, 2])("selects the real reordered source of chord %i, not its copy suffix", (chordIndex) => {
      const id = `m0/chord${chordIndex}/p1/staff1`;
      const { document, list } = reorderedLayout();
      const { ctx, previewChord, selectElement } = context(id);
      ctx.docScoreRef.current = document;
      ctx.displayListRef.current = list;
      ctx.interactionModeRef.current = mode;
      ctx.spatialIndexRef.current = new SpatialIndex([{ id, x: 100, y: 120, width: 60, height: 20 }]);
      handleCanvasClickImpl({ ...click, clientY: 130 }, ctx);
      expect(selectElement).toHaveBeenCalledOnce();
      expect(selectElement.mock.calls[0]![0]).toBe(id);
      expectClarinetSource(document, id, selectElement.mock.calls[0]![1]);
      expect(selectElement.mock.calls[0]![1]?.sourceStaff).toBe(1);
      if (chordIndex === 0) expect(previewChord).toHaveBeenCalledExactlyOnceWith(supported, document);
      else expect(previewChord).not.toHaveBeenCalled();
    });
  });

  it.each(["m0/chord1/p0/staff0", "m0/chord2", "m99/chord0", "p0/m0/s0/ev0"])(
    "does not audition unsupported, silent, stale, or non-chord hit %s",
    (id) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { ctx, previewChord, selectElement } = context(id);
      handleCanvasClickImpl(click, ctx);
      expect(previewChord).not.toHaveBeenCalled();
      expect(selectElement).toHaveBeenCalledWith(id);
      if (id === "m99/chord0") {
        expect(warn).toHaveBeenCalledWith("[Audio] Cannot resolve clicked chord:", id);
      } else expect(warn).not.toHaveBeenCalled();
    },
  );

  it("does not audition after a drag", () => {
    const { ctx, previewChord } = context();
    ctx.dragOccurredRef.current = true;
    handleCanvasClickImpl(click, ctx);
    expect(previewChord).not.toHaveBeenCalled();
  });

  it("reports asynchronous audition failures without interrupting selection", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = new Error("Device unavailable");
    const previewChord = vi.fn().mockRejectedValue(error);
    previewClickedChord(score(), "m0/chord0", previewChord);
    await Promise.resolve();
    expect(previewChord).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith("[Audio] Clicked chord preview failed:", "m0/chord0", error);
  });

  it.each(["m0/chord0/junk", "m0/chord0/p0", "p0/m0/chord0"])(
    "diagnoses unknown chord selection %s rather than silently falling through",
    (id) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { ctx, previewChord, selectElement } = context(id);
      handleCanvasClickImpl(click, ctx);
      expect(selectElement).toHaveBeenCalledWith(id);
      expect(previewChord).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith("[Audio] Cannot resolve clicked chord:", id);
    },
  );

  it("reports a missing playback action", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    previewClickedChord(score(), "m0/chord0", undefined);
    expect(warn).toHaveBeenCalledWith("[Audio] Clicked chord preview is unavailable:", "m0/chord0");
  });

  it.each(["m99/chord0", "m0/chord0/junk"])("diagnoses unresolved engrave hit %s", (id) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { ctx, previewChord } = context(id);
    ctx.interactionModeRef.current = "engrave";
    handleCanvasClickImpl(click, ctx);
    expect(previewChord).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith("[Audio] Cannot resolve clicked chord:", id);
  });

  it("rejects malformed copies and part-local IDs", () => {
    for (const id of ["m0/chord0/junk", "p0/m0/chord0", "m0/chord0/p0", "m-1/chord0", "g/m0/chord0"]) {
      expect(globalChordForElement(score(), id)).toBeUndefined();
    }
  });
});

function overlayProps() {
  const entries = [
    { id: "m0/chord0", x: 20, y: 20, width: 50, height: 20 },
    { id: "m0/chord1/p0/staff0", x: 100, y: 20, width: 60, height: 20 },
    { id: "m0/chord1/p1/staff1", x: 100, y: 120, width: 60, height: 20 },
    { id: "m0/chord2", x: 200, y: 20, width: 50, height: 20 },
    { id: "m1/chord1", x: 300, y: 20, width: 50, height: 20 },
  ];
  return {
    score: score(),
    displayList: displayList(),
    spatialIndex: new SpatialIndex(entries),
    displayListVersion: 1,
    viewport: { zoom: 2, scrollX: 10, scrollY: 5 },
    viewMode: "horizon" as const,
    printPreview: false,
    onSelect: vi.fn(),
  };
}

describe("editor-only unsupported chord overlay", () => {
  it("warns on each rendered unsupported copy, not supported or NC; preserves authored display commands", () => {
    const props = overlayProps();
    const before = JSON.stringify({ score: props.score, displayList: props.displayList });
    const { container, rerender } = render(<UnsupportedChordOverlay {...props} />);
    expect(screen.getAllByRole("button", { name: MESSAGE })).toHaveLength(2);
    expect(container.querySelectorAll("[data-chord-warning]")).toHaveLength(2);
    const warning = container.querySelector<HTMLElement>("[data-chord-warning]")!;
    expect(warning.style.left).toBe("180px");
    expect(warning.style.top).toBe("30px");
    expect(warning.style.width).toBe("120px");
    expect(warning.style.height).toBe("40px");
    fireEvent.click(screen.getAllByRole("button", { name: MESSAGE })[0]!);
    expect(props.onSelect).toHaveBeenCalledWith("m0/chord1/p0/staff0");
    rerender(<UnsupportedChordOverlay {...props} viewport={{ zoom: 1, scrollX: 0, scrollY: 0 }} />);
    expect(JSON.stringify({ score: props.score, displayList: props.displayList })).toBe(before);
  });

  it("provides the exact tooltip on keyboard focus", async () => {
    render(<UnsupportedChordOverlay {...overlayProps()} />);
    fireEvent.focus(screen.getAllByRole("button", { name: MESSAGE })[0]!);
    expect((await screen.findByRole("tooltip")).textContent).toBe(MESSAGE);
  });

  it("omits warnings in print preview and before layout publication", () => {
    const props = overlayProps();
    const { rerender } = render(<UnsupportedChordOverlay {...props} printPreview />);
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<UnsupportedChordOverlay {...props} displayListVersion={0} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("removes stale warnings after authored harmony becomes supported", () => {
    const props = overlayProps();
    const { rerender } = render(<UnsupportedChordOverlay {...props} />);
    const next = score();
    next.global.measures[0]!.chordSymbols = [supported, supported, silent];
    rerender(<UnsupportedChordOverlay {...props} score={next} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it.each(["horizon", "page", "spread", "spread-h"] as const)(
    "selects the warning's real reordered source using engine coordinates in %s",
    (viewMode) => {
      const props = overlayProps();
      const yOffset = viewMode === "horizon" ? 0 : 600;
      const { document, list } = reorderedLayout(yOffset);
      list.pages = [
        { yOffset: 0, height: 600, pageNumber: 1, systemIndices: [0] },
        { yOffset: 600, height: 600, pageNumber: 2, systemIndices: [1] },
      ];
      const id = "m0/chord1/p1/staff1";
      const previewChord = vi.fn().mockResolvedValue(undefined);
      const onSelect = vi.fn((elementId: string, anchor?: MeasureSelectionPoint) => {
        useSelectionStore.setState({
          selection: { kind: "single", elementId, elementType: "chord-symbol", measureAnchor: anchor },
        });
        previewClickedChord(document, elementId, previewChord);
      });
      const anchoredProps = {
        ...props,
        score: document,
        displayList: list,
        spatialIndex: new SpatialIndex([{ id, x: 100, y: yOffset + 120, width: 60, height: 20 }]),
        onSelect,
        viewMode,
      };
      const { rerender } = render(<UnsupportedChordOverlay {...anchoredProps} />);
      fireEvent.click(screen.getByRole("button", { name: MESSAGE }));
      expect(onSelect).toHaveBeenCalledOnce();
      expect(onSelect.mock.calls[0]![0]).toBe(id);
      expectClarinetSource(document, id, onSelect.mock.calls[0]![1]);
      rerender(<UnsupportedChordOverlay {...anchoredProps} viewport={{ zoom: 3, scrollX: 50, scrollY: 100 }} />);
      expect(onSelect).toHaveBeenCalledOnce();
      expect(previewChord).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["page", 0, 680],
    ["spread", 0, 680],
    ["spread-h", 1720, 0],
  ] as const)("uses existing %s page placements", (viewMode, dx, dy) => {
    const props = overlayProps();
    props.displayList.pages = [
      { yOffset: 0, height: 600, pageNumber: 1, systemIndices: [0] },
      { yOffset: 600, height: 600, pageNumber: 2, systemIndices: [1] },
    ];
    props.spatialIndex = new SpatialIndex([{ id: "m0/chord1", x: 100, y: 620, width: 60, height: 20 }]);
    const { container } = render(
      <UnsupportedChordOverlay {...props} viewMode={viewMode} viewport={{ zoom: 1, scrollX: 0, scrollY: 0 }} />,
    );
    const warning = container.querySelector<HTMLElement>("[data-chord-warning]")!;
    expect(warning.style.left).toBe(`${100 + dx}px`);
    expect(warning.style.top).toBe(`${20 + dy}px`);
  });
});
