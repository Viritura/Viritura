import { useEffect, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { textContentFromPlain, type Score, type TextFrame } from "@viritura/core";
import { TooltipPrimitives } from "@viritura/ui";
import { DocumentProvider, useDocumentStore, useDocumentStoreApi } from "../../store/DocumentContext";
import { resetSelectionStore, useSelectionStore } from "../../store/selectionStore";
import { useViewStateStore } from "../../store/viewStateStore";
import { HorizonTextFrames } from "./HorizonTextFrames";
import { TextFramePalette } from "./TextFramePalette";
import { PalettePanel } from "../PalettePanel";
import { TextFramesPanel } from "./TextFramesPanel";
import { effectiveHorizontalAlignment, textFrameElementId, textFrameIdFromElementId } from "./textFrameContext";
import { usePublishRenderedPageCount, useRenderedPagesStore } from "./renderedPages";
import { useTextFrameSelectionStore } from "./textFrameSelection";

function frame(id: string, locator: TextFrame["locator"], text = id): TextFrame {
  return {
    id,
    locator,
    placement: { anchor: "top-left", offset: { x: 0, y: 0 } },
    width: { unit: "staffSpaces", value: 20 },
    content: textContentFromPlain(text),
  };
}

const SCORE: Score = {
  mnx: { version: 1 },
  global: { measures: [{ id: "m1" }, { id: "m2" }] },
  parts: [
    {
      id: "P1",
      name: "Violin",
      measures: [
        { sequences: [{ content: [{ type: "event", id: "e1", duration: { base: "whole" } }] }] },
        { sequences: [{ content: [{ type: "event", id: "e2", duration: { base: "whole" } }] }] },
      ],
    },
  ],
  layouts: [{ id: "full", content: [{ type: "staff", sources: [{ part: "P1" }] }] }],
  scores: [
    {
      name: "Full",
      layout: "full",
      textFrames: [
        frame("title", { type: "page", pageIndex: 0 }, "Program note"),
        frame("cue", { type: "globalMeasure", measureId: "m2" }, "Cue here"),
        frame("solo", { type: "event", partId: "P1", eventId: "e2" }, "Solo"),
        frame("m1note", { type: "globalMeasure", measureId: "m1" }, "Bar one"),
        frame("orphan", { type: "globalMeasure", measureId: "deleted" }, "Orphaned note"),
      ],
    },
  ],
};

let currentScore: () => Score | null = () => null;

function WithScore({ children }: { readonly children: ReactNode }) {
  const loadScore = useDocumentStore((state) => state.loadScore);
  const loaded = useDocumentStore((state) => state.score !== null);
  const api = useDocumentStoreApi();
  useEffect(() => {
    currentScore = () => api.getState().score;
    loadScore(SCORE, "text-frames.mnx");
  }, [api, loadScore]);
  return loaded ? children : null;
}

function renderWithDocument(ui: ReactNode) {
  return render(
    <TooltipPrimitives.Provider delayDuration={0}>
      <DocumentProvider>
        <WithScore>{ui}</WithScore>
      </DocumentProvider>
    </TooltipPrimitives.Provider>,
  );
}

const frames = () => currentScore()?.scores?.[0]?.textFrames ?? [];

beforeEach(() => {
  resetSelectionStore();
  useViewStateStore.setState({ selectedScoreIndex: 0 });
  useTextFrameSelectionStore.setState({ selectedFrameId: null });
  useRenderedPagesStore.setState({ rendered: null });
});
afterEach(cleanup);

describe("TextFramePalette", () => {
  it("creates a page frame from Write's Text palette, selects it, and edits its text", async () => {
    const user = userEvent.setup();
    renderWithDocument(<PalettePanel openSectionRequest={{ id: "text", requestId: 1 }} />);
    await user.click(await screen.findByRole("button", { name: "Add page frame" }));

    const created = frames().at(-1)!;
    expect(created.locator).toEqual({ type: "page", pageIndex: 0 });
    const editor = screen.getByTestId("text-frame-editor");
    const text = within(editor).getByLabelText("Text");
    text.innerHTML = "<span>Line one<br>Line two</span>";
    fireEvent.input(text);
    fireEvent.blur(text);
    expect(frames().at(-1)!.content).toEqual([{ text: "Line one\nLine two" }]);
  });

  it("creates a frame on the entered page and disables musical creation without selection", async () => {
    const user = userEvent.setup();
    renderWithDocument(<TextFramePalette />);
    const page = await screen.findByLabelText("Page number for new frame");
    expect(screen.getByRole("button", { name: "Add frame at selection" })).toHaveProperty("disabled", true);
    await user.clear(page);
    await user.type(page, "3");
    fireEvent.blur(page);
    await user.click(screen.getByRole("button", { name: "Add page frame" }));
    expect(frames().at(-1)!.locator).toEqual({ type: "page", pageIndex: 2 });
  });

  it("creates a music-linked page frame from a selected measure", async () => {
    const user = userEvent.setup();
    renderWithDocument(<TextFramePalette />);
    await screen.findByRole("button", { name: "Add page frame" });
    act(() => {
      useSelectionStore.setState({
        selection: {
          kind: "measure",
          startPartIndex: 0,
          endPartIndex: 0,
          startStaffIndex: 0,
          endStaffIndex: 0,
          startMeasure: 1,
          endMeasure: 1,
        },
      });
    });
    await user.click(screen.getByRole("button", { name: "Add frame at measure 2" }));
    expect(frames().at(-1)!.locator).toEqual({ type: "globalMeasure", measureId: "m2" });
  });

  it("creates an event-located page frame from a selected event", async () => {
    const user = userEvent.setup();
    renderWithDocument(<TextFramePalette />);
    await screen.findByRole("button", { name: "Add page frame" });
    act(() => {
      useSelectionStore.setState({
        selection: { kind: "single", elementId: "p0/m0/s0/e1", elementType: "note" },
      });
    });
    await user.click(screen.getByRole("button", { name: "Add frame at selected event" }));
    expect(frames().at(-1)!.locator).toEqual({ type: "event", partId: "P1", eventId: "e1" });
  });
});

describe("TextFramesPanel", () => {
  it("requires a selected destination for a new page frame, then moves it without duplication", async () => {
    const user = userEvent.setup();
    renderWithDocument(<TextFramesPanel />);
    await user.click(await screen.findByTestId("text-frame-row-title"));
    await user.click(screen.getByRole("combobox", { name: "Position relative to" }));
    await user.click(screen.getByRole("option", { name: "Staff", exact: true }));
    expect(screen.getByRole("alert").textContent).toContain("Select a staff and measure");
    expect(frames()).toHaveLength(5);
    act(() => {
      useSelectionStore.setState({ selection: { kind: "single", elementId: "p0/m1/s0/e2" } });
    });
    await user.click(screen.getByTestId("text-frame-row-title"));
    await user.click(screen.getByRole("combobox", { name: "Position relative to" }));
    await user.click(screen.getByRole("option", { name: "Staff", exact: true }));
    expect(frames()).toHaveLength(4);
    const expression = currentScore()!.parts[0]!.measures[1]!.expressions![0]!;
    expect(expression.text).toEqual([{ text: "Program note", style: { fontStyle: "normal" } }]);
    expect(expression.position.fraction).toEqual([0, 1]);
    expect(useSelectionStore.getState().selection).toMatchObject({ kind: "single", elementId: "p0/m1/expr0" });
  });

  it("edits fixed-page and follow-measure locators independently of page anchors", async () => {
    const user = userEvent.setup();
    renderWithDocument(<TextFramesPanel />);
    await user.click(await screen.findByTestId("text-frame-row-title"));
    const page = screen.getByLabelText("Page number");
    fireEvent.change(page, { target: { value: "2" } });
    fireEvent.blur(page);
    expect(frames()[0]!.locator).toEqual({ type: "page", pageIndex: 1 });
    await user.click(screen.getByRole("combobox", { name: "Page selection" }));
    await user.click(screen.getByRole("option", { name: "Follow measure / event" }));
    await user.click(screen.getByRole("combobox", { name: "Following measure" }));
    await user.click(screen.getByRole("option", { name: "Measure 2" }));
    expect(frames()[0]!.locator).toEqual({ type: "globalMeasure", measureId: "m2" });
    expect(frames()[0]!.placement).toEqual({ anchor: "top-left", offset: { x: 0, y: 0 } });
  });
  it("toggles Erase background on page frames without changing content or placement", async () => {
    const user = userEvent.setup();
    renderWithDocument(<TextFramesPanel />);
    await user.click(await screen.findByTestId("text-frame-row-title"));
    const original = frames()[0]!;
    const checkbox = screen.getByRole("checkbox", { name: "Erase background" });
    expect(checkbox).toHaveProperty("checked", false);
    expect(original).not.toHaveProperty("eraseBackground");
    for (const eraseBackground of [true, false]) {
      await user.click(checkbox);
      expect(checkbox).toHaveProperty("checked", eraseBackground);
      expect(frames()[0]).toEqual({ ...original, eraseBackground });
    }
  });

  it("edits existing frames without creation controls", async () => {
    renderWithDocument(<TextFramesPanel />);
    await screen.findByTestId("text-frame-row-title");
    expect(screen.queryByRole("button", { name: /Add .*frame/ })).toBeNull();
  });

  it("recognizes a canvas-selected frame when Properties mounts after selection", async () => {
    useSelectionStore.setState({ selection: { kind: "single", elementId: "text-frame/title" } });
    renderWithDocument(<TextFramesPanel />);
    const editor = await screen.findByTestId("text-frame-editor");
    expect(within(editor).getByLabelText("Text").textContent).toBe("Program note");
  });

  it("selects the frame hit on the canvas", async () => {
    renderWithDocument(<TextFramesPanel />);
    await screen.findByTestId("text-frame-row-title");
    act(() => {
      useSelectionStore.setState({ selection: { kind: "single", elementId: "text-frame/title" } });
    });
    expect(useTextFrameSelectionStore.getState().selectedFrameId).toBe("title");
    expect(screen.getByTestId("text-frame-editor")).toBeTruthy();
    act(() => {
      useSelectionStore.setState({ selection: { kind: "single", elementId: "p0/m0/s0/e1" } });
    });
    expect(useTextFrameSelectionStore.getState().selectedFrameId).toBeNull();
    expect(screen.queryByTestId("text-frame-editor")).toBeNull();
  });

  it("keeps a panel-selected frame through edits until the canvas selection changes", async () => {
    const user = userEvent.setup();
    renderWithDocument(<TextFramesPanel />);
    act(() => {
      useSelectionStore.setState({ selection: { kind: "single", elementId: "p0/m0/s0/e1" } });
    });
    await user.click(await screen.findByTestId("text-frame-row-cue"));
    await user.keyboard("{ArrowRight}");
    expect(useTextFrameSelectionStore.getState().selectedFrameId).toBe("cue");
    expect(frames().find((f) => f.id === "cue")!.placement.offset.x).toBe(1);
    act(() => {
      useSelectionStore.setState({ selection: { kind: "none" } });
    });
    expect(useTextFrameSelectionStore.getState().selectedFrameId).toBeNull();
  });
  it("marks page frames beyond the last rendered page as unplaced without rewriting them", async () => {
    const user = userEvent.setup();
    renderWithDocument(<TextFramesPanel />);
    const row = await screen.findByTestId("text-frame-row-title");
    expect(within(row).queryByText(/not placed in this view/)).toBeNull();
    act(() => {
      useRenderedPagesStore.getState().publish({ score: currentScore()!, scoreIndex: 0, pageCount: 1 });
    });
    expect(within(screen.getByTestId("text-frame-row-title")).queryByText(/not placed in this view/)).toBeNull();
    act(() => {
      useRenderedPagesStore.getState().publish({ score: currentScore()!, scoreIndex: 1, pageCount: 0 });
    });
    expect(within(screen.getByTestId("text-frame-row-title")).queryByText(/not placed in this view/)).toBeNull();
    act(() => {
      useRenderedPagesStore.getState().publish({ score: currentScore()!, scoreIndex: 0, pageCount: 0 });
    });
    expect(within(screen.getByTestId("text-frame-row-title")).getByText(/not placed in this view/)).toBeTruthy();
    expect(frames()[0]!.locator).toEqual({ type: "page", pageIndex: 0 });
    // A later edit invalidates the page count until the next paged layout publishes one.
    await user.click(screen.getByTestId("text-frame-row-cue"));
    await user.keyboard("{ArrowRight}");
    expect(within(screen.getByTestId("text-frame-row-title")).queryByText(/not placed in this view/)).toBeNull();
  });
  it("moves with arrow keys, reorders layers, and deletes the selected frame", async () => {
    const user = userEvent.setup();
    renderWithDocument(<TextFramesPanel />);
    const row = await screen.findByTestId("text-frame-row-title");
    await user.click(row);
    row.focus();
    await user.keyboard("{ArrowRight}{Shift>}{ArrowDown}{/Shift}");
    expect(frames()[0]!.placement.offset).toEqual({ x: 1, y: 5 });

    expect(screen.getByText("Layer 1 of 5")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Bring to front" }));
    expect(frames().map((f) => f.id)).toEqual(["cue", "solo", "m1note", "orphan", "title"]);
    expect(screen.getByText("Layer 5 of 5")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Delete frame" }));
    expect(frames().map((f) => f.id)).toEqual(["cue", "solo", "m1note", "orphan"]);
    expect(screen.queryByTestId("text-frame-editor")).toBeNull();
  });

  it("sets alignment and justification independently", async () => {
    const user = userEvent.setup();
    renderWithDocument(<TextFramesPanel />);
    await user.click(await screen.findByTestId("text-frame-row-title"));
    const alignment = screen.getByRole("radiogroup", { name: "Frame alignment" });
    await user.click(within(alignment).getByRole("radio", { name: "Right" }));
    const justification = screen.getByRole("radiogroup", { name: "Paragraph justification" });
    await user.click(within(justification).getByRole("radio", { name: "Justify" }));
    expect(frames()[0]).toMatchObject({ horizontalAlignment: "right", paragraphJustification: "justify" });
  });

  it("commits width once on blur", async () => {
    const user = userEvent.setup();
    renderWithDocument(<TextFramesPanel />);
    await user.click(await screen.findByTestId("text-frame-row-title"));
    const width = screen.getByLabelText("Width");
    await user.clear(width);
    await user.type(width, "32");
    expect(frames()[0]!.width).toEqual({ unit: "staffSpaces", value: 20 });
    fireEvent.blur(width);
    expect(frames()[0]!.width).toEqual({ unit: "staffSpaces", value: 32 });
  });
});

describe("HorizonTextFrames", () => {
  it("lists page frames document-wide and prompts for a musical selection", async () => {
    renderWithDocument(<HorizonTextFrames />);
    const pageList = await screen.findByRole("list", { name: "Text frames located by page" });
    expect(within(pageList).getByText("Program note")).toBeTruthy();
    expect(screen.getByText("Select a measure or note to see frames that follow it.")).toBeTruthy();
    const unplaced = screen.getByRole("list", { name: "Unplaced text frames" });
    expect(within(unplaced).getByText("Orphaned note")).toBeTruthy();
    expect(within(unplaced).getByText(/not placed in this view/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Add .*frame/ })).toBeNull();
  });

  it("shows measure and event frames next to the selected measure", async () => {
    renderWithDocument(<HorizonTextFrames />);
    await screen.findByTestId("horizon-text-frames");
    act(() => {
      useSelectionStore.setState({
        selection: {
          kind: "measure",
          startPartIndex: 0,
          endPartIndex: 0,
          startStaffIndex: 0,
          endStaffIndex: 0,
          startMeasure: 1,
          endMeasure: 1,
        },
      });
    });
    const nearby = screen.getByRole("list", { name: "Text frames at the selected measure" });
    expect(within(nearby).getByText("Cue here")).toBeTruthy();
    expect(within(nearby).getByText("Solo")).toBeTruthy();
    expect(within(nearby).queryByText("Bar one")).toBeNull();
    expect(within(nearby).queryByText("Program note")).toBeNull();

    expect(screen.queryByRole("button", { name: /Add .*frame/ })).toBeNull();
  });
});

describe("effectiveHorizontalAlignment", () => {
  it("matches the engine default derived from the page anchor", () => {
    const at = (anchor: TextFrame["placement"]["anchor"]): TextFrame => ({
      ...frame("x", { type: "page", pageIndex: 0 }, "x"),
      placement: { anchor, offset: { x: 0, y: 0 } },
    });
    expect(effectiveHorizontalAlignment(at("top-left"))).toBe("left");
    expect(effectiveHorizontalAlignment(at("left"))).toBe("left");
    expect(effectiveHorizontalAlignment(at("top"))).toBe("center");
    expect(effectiveHorizontalAlignment(at("bottom"))).toBe("center");
    expect(effectiveHorizontalAlignment(at("bottom-right"))).toBe("right");
    expect(effectiveHorizontalAlignment({ ...at("right"), horizontalAlignment: "left" })).toBe("left");
  });
});

describe("text frame element IDs", () => {
  // IDs that all collided under the engine's old `/` -> `_` sanitize rule.
  const AMBIGUOUS = ["a/b", "a_b", "a%b", "a%2Fb", "a%25b"];

  it("encodes `%` before `/`, matching the engine", () => {
    expect(textFrameElementId("a/b")).toBe("text-frame/a%2Fb");
    expect(textFrameElementId("a_b")).toBe("text-frame/a_b");
    expect(textFrameElementId("a%b")).toBe("text-frame/a%25b");
    expect(textFrameElementId("a%2Fb")).toBe("text-frame/a%252Fb");
    expect(textFrameElementId("tf1")).toBe("text-frame/tf1");
  });

  it("encodes distinct frame IDs injectively, with exactly one `/`", () => {
    const encoded = AMBIGUOUS.map(textFrameElementId);
    expect(new Set(encoded).size).toBe(AMBIGUOUS.length);
    for (const id of encoded) expect(id.split("/")).toHaveLength(2);
  });

  it("maps display-list IDs back to authored frame IDs", () => {
    const frames = AMBIGUOUS.map((id, index) => frame(id, { type: "page", pageIndex: 0 }, `t${index}`));
    for (const id of AMBIGUOUS) expect(textFrameIdFromElementId(textFrameElementId(id), frames)).toBe(id);
    expect(textFrameIdFromElementId("text-frame/missing", frames)).toBeNull();
    expect(textFrameIdFromElementId("m1/P1/e1", frames)).toBeNull();
  });
});

describe("usePublishRenderedPageCount", () => {
  it("publishes paged layouts only", () => {
    const displayListRef = { current: { pages: [{}, {}, {}] } };
    const { rerender } = renderHook(
      ({ paged, version }: { paged: boolean; version: number }) =>
        usePublishRenderedPageCount(displayListRef, version, SCORE, 0, paged),
      { initialProps: { paged: false, version: 1 } },
    );
    expect(useRenderedPagesStore.getState().rendered).toBeNull();
    rerender({ paged: true, version: 2 });
    expect(useRenderedPagesStore.getState().rendered).toEqual({ score: SCORE, scoreIndex: 0, pageCount: 3 });
  });
});
