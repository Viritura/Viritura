import { useEffect, type ReactNode } from "react";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Score } from "@viritura/core";
import { TooltipPrimitives } from "@viritura/ui";
import { EngraveLeftPanel } from "../components/modes/engrave/EngraveLeftPanel";
import { PageSetupDialog } from "../components/PageSetupDialog";
import { DocumentProvider, useDocumentStore } from "../store/DocumentContext";
import { resetSelectionStore, useSelectionStore } from "../store/selectionStore";
import { getGlobalPerfTracker } from "@viritura/renderer";
import { useDocumentStoreApi } from "../store/DocumentContext";
import type { DocumentStore } from "../store/documentStore";
import { AutoHideEmptyStavesControl } from "../components/modes/engrave/EngraveLeftPanel/AutoHideEmptyStavesControl";
import { useAutoHideEmptyParts, useEngraveContextRefs } from "../components/modes/engrave/hooks";
import { PageDefaultsPanel, usePageDefaultsStore } from "../pageSetup";
import { useStyleEditorStore } from "../components/modes/engrave/StyleEditor";

afterEach(() => {
  getGlobalPerfTracker().fastLayoutCallback = null;
  cleanup();
  resetSelectionStore();
  useStyleEditorStore.getState().openLayout();
  usePageDefaultsStore.setState({ defaults: {} });
  window.localStorage.removeItem("viritura.pageSetupDefaults");
});

const SCORE: Score = {
  mnx: { version: 1 },
  global: { measures: [{ id: "m1", time: { count: 4, unit: 4 } }] },
  parts: [
    { id: "p1", name: "Flute", measures: [{ sequences: [{ content: [] }] }] },
    { id: "p2", name: "Oboe", measures: [{ sequences: [{ content: [] }] }] },
  ],
  layouts: [
    {
      id: "full",
      content: [
        { type: "staff", sources: [{ part: "p1", labelRef: { ref: "auto" } }] },
        { type: "staff", sources: [{ part: "p2", labelRef: { ref: "auto" } }] },
      ],
    },
    { id: "wind.flutes.flute", content: [{ type: "staff", sources: [{ part: "p1", labelRef: { ref: "auto" } }] }] },
  ],
  scores: [
    {
      name: "Full Score",
      layout: "full",
      pageSetup: { width: 297, height: 420, spatiumMm: 1.25 },
      textFrames: [
        {
          id: "title",
          content: [{ text: "Program note" }],
          locator: { type: "page", pageIndex: 0 },
          placement: { anchor: "top-left", offset: { x: 0, y: 0 } },
          width: { unit: "staffSpaces", value: 20 },
        },
      ],
    },
    { name: "Flute", layout: "wind.flutes.flute" },
  ],
};

function WithScore({ children }: { readonly children: ReactNode }) {
  const loadScore = useDocumentStore((state) => state.loadScore);
  const loaded = useDocumentStore((state) => state.score !== null);
  useEffect(() => loadScore(SCORE, "engrave-tabs-test.mnx"), [loadScore]);
  return loaded ? children : null;
}

function LiveAutoHideControl({ scoreIndex, onStore }: { scoreIndex: number; onStore: (store: DocumentStore) => void }) {
  const store = useDocumentStoreApi();
  const score = useDocumentStore((state) => state.score);
  const updateScore = useDocumentStore((state) => state.updateScore);
  const refs = useEngraveContextRefs(score, scoreIndex, updateScore);
  const onChange = useAutoHideEmptyParts(refs);
  useEffect(() => onStore(store), [onStore, store]);
  return score ? <AutoHideEmptyStavesControl score={score} scoreIndex={scoreIndex} onChange={onChange} /> : null;
}

function LivePanel({ onStore }: { onStore: (store: DocumentStore) => void }) {
  const store = useDocumentStoreApi();
  const score = useDocumentStore((state) => state.workingScore ?? state.score);
  useEffect(() => onStore(store), [onStore, store]);
  return (
    <EngraveLeftPanel
      score={score}
      activeScoreIndex={0}
      onInstrumentNameDisplayChange={vi.fn()}
      onAutoHideEmptyPartsChange={vi.fn()}
      selectedBreakKind={null}
      hasLayoutOverrides={false}
      onRemoveSelectedBreak={vi.fn()}
      onResetAll={vi.fn()}
    />
  );
}

function renderLivePanel() {
  const handle: { store?: DocumentStore } = {};
  render(
    <TooltipPrimitives.Provider delayDuration={0}>
      <DocumentProvider>
        <WithScore>
          <LivePanel
            onStore={(value) => {
              handle.store = value;
            }}
          />
        </WithScore>
      </DocumentProvider>
    </TooltipPrimitives.Provider>,
  );
  return handle;
}

function renderPanel(onInstrumentNameDisplayChange = vi.fn()) {
  const onRemoveSelectedBreak = vi.fn();
  const onResetAll = vi.fn();
  const onAutoHideEmptyPartsChange = vi.fn();
  return {
    ...render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <DocumentProvider>
          <WithScore>
            <EngraveLeftPanel
              score={SCORE}
              activeScoreIndex={0}
              onInstrumentNameDisplayChange={onInstrumentNameDisplayChange}
              onAutoHideEmptyPartsChange={onAutoHideEmptyPartsChange}
              selectedBreakKind="page"
              selectedAfterMeasureNumber={12}
              hasLayoutOverrides
              onRemoveSelectedBreak={onRemoveSelectedBreak}
              onResetAll={onResetAll}
            />
          </WithScore>
        </DocumentProvider>
      </TooltipPrimitives.Provider>,
    ),
    onInstrumentNameDisplayChange,
    onAutoHideEmptyPartsChange,
    onRemoveSelectedBreak,
    onResetAll,
  };
}

describe("EngraveLeftPanel", () => {
  it("stores a sparse layout override and resets it to the inherited value", async () => {
    const user = userEvent.setup();
    const handle = renderLivePanel();
    await user.click(await screen.findByRole("combobox", { name: "Staff size" }));
    await user.click(await screen.findByRole("option", { name: "Rastral 0 — 8.0mm" }));
    expect(handle.store?.getState().workingScore?.scores?.[0]?.pageSetup).toEqual({
      width: 297,
      height: 420,
      spatiumMm: 2,
    });

    await user.click(screen.getByRole("button", { name: "Staff size actions" }));
    await user.click(await screen.findByRole("menuitem", { name: /^Reset to Rastral/ }));
    expect(handle.store?.getState().workingScore?.scores?.[0]?.pageSetup).toEqual({ width: 297, height: 420 });
    expect(handle.store?.getState().workingScore?.scores?.[0]?.textFrames).toEqual(SCORE.scores?.[0]?.textFrames);
  });

  it("edits the house style profile and links back to layouts that override it", async () => {
    const user = userEvent.setup();
    const handle = renderLivePanel();
    await user.click(await screen.findByRole("button", { name: "Edit house style" }));
    expect(screen.getByText("House style")).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Layout" })).toBeNull();

    await user.click(screen.getByRole("combobox", { name: "Staff size" }));
    await user.click(await screen.findByRole("option", { name: "Rastral 0 — 8.0mm" }));
    expect(handle.store?.getState().workingScore?.pageSetupDefaults?.score).toEqual({ spatiumMm: 2 });
    expect(handle.store?.getState().workingScore?.scores?.[0]?.pageSetup?.spatiumMm).toBe(1.25);

    expect(screen.getAllByRole("button", { name: "Full Score custom setting" })).toHaveLength(2);
    await user.click(screen.getAllByRole("button", { name: "Full Score custom setting" })[0]!);
    expect(useStyleEditorStore.getState().mode).toBe("layout");
    expect(await screen.findByTestId("layout-style-panel")).toBeTruthy();
  });

  it("saves score and part user defaults independently and restores the correct part defaults", async () => {
    const user = userEvent.setup();
    render(<PageDefaultsPanel />);
    await user.click(screen.getByRole("combobox", { name: "Preset", exact: true }));
    await user.click(await screen.findByRole("option", { name: "9×12 Arch" }));
    await user.click(screen.getByRole("button", { name: "Save defaults" }));
    await user.click(screen.getByRole("combobox", { name: "Page defaults for" }));
    await user.click(await screen.findByRole("option", { name: "Parts" }));
    await user.click(screen.getByRole("combobox", { name: "Preset", exact: true }));
    await user.click(await screen.findByRole("option", { name: "Letter" }));
    await user.click(screen.getByRole("button", { name: "Save defaults" }));
    expect(usePageDefaultsStore.getState().defaults.score?.width).toBe(228.6);
    expect(usePageDefaultsStore.getState().defaults.part?.width).toBe(215.9);
    expect(JSON.parse(window.localStorage.getItem("viritura.pageSetupDefaults") ?? "{}")).toEqual(
      usePageDefaultsStore.getState().defaults,
    );
    await user.click(screen.getByRole("button", { name: "Reset to app default" }));
    expect(usePageDefaultsStore.getState().defaults.part).toBeUndefined();
    expect(usePageDefaultsStore.getState().defaults.score?.width).toBe(228.6);
    expect(screen.getByRole("combobox", { name: "Rastral" }).textContent).toContain("6.5mm");
  });

  it("updates and coalesces rapid checkbox toggles before a pending layout finishes", async () => {
    const user = userEvent.setup();
    let store: DocumentStore | undefined;
    const onStore = (value: DocumentStore) => {
      store = value;
    };
    render(
      <DocumentProvider>
        <WithScore>
          <LiveAutoHideControl scoreIndex={0} onStore={onStore} />
        </WithScore>
      </DocumentProvider>,
    );
    const oboe = await screen.findByRole("checkbox", { name: "Auto-hide empty staves: Oboe" });
    const flute = screen.getByRole("checkbox", { name: "Auto-hide empty staves: Flute" });
    const layouts: string[] = [];
    const completions: Array<() => void> = [];
    const layout = vi.fn((json: string) => {
      layouts.push(json);
      return new Promise<void>((resolve) => completions.push(resolve));
    });
    getGlobalPerfTracker().fastLayoutCallback = layout;
    const paintedScore = store?.getState().score;

    await user.click(oboe);
    await user.click(flute);
    await user.click(oboe);
    expect((oboe as HTMLInputElement).checked).toBe(false);
    expect((flute as HTMLInputElement).checked).toBe(true);
    expect(store?.getState().workingScore?.scores?.[0]?.autoHideEmptyParts).toEqual(["p1"]);
    expect(store?.getState().score).toBe(paintedScore);
    expect(layout).toHaveBeenCalledTimes(1);

    await act(async () => completions.shift()?.());
    expect(layout).toHaveBeenCalledTimes(2);
    expect(JSON.parse(layouts[1]!).scores[0]._x.viritura.autoHideEmptyParts).toEqual(["p1"]);
    await act(async () => completions.shift()?.());
    expect(store?.getState().score?.scores?.[0]?.autoHideEmptyParts).toEqual(["p1"]);
    expect(store?.getState().score?.scores?.[1]?.autoHideEmptyParts).toBeUndefined();
  });

  it("keeps selections scoped to the active score while layout is pending", async () => {
    const user = userEvent.setup();
    let store: DocumentStore | undefined;
    const onStore = (value: DocumentStore) => {
      store = value;
    };
    const panel = (scoreIndex: number) => (
      <DocumentProvider>
        <WithScore>
          <LiveAutoHideControl scoreIndex={scoreIndex} onStore={onStore} />
        </WithScore>
      </DocumentProvider>
    );
    const { rerender } = render(panel(0));
    const oboe = await screen.findByRole("checkbox", { name: "Auto-hide empty staves: Oboe" });
    const completions: Array<() => void> = [];
    getGlobalPerfTracker().fastLayoutCallback = () => new Promise<void>((resolve) => completions.push(resolve));
    await user.click(oboe);
    rerender(panel(1));
    const flute = screen.getByRole("checkbox", { name: "Auto-hide empty staves: Flute" });
    expect((flute as HTMLInputElement).checked).toBe(false);
    await user.click(flute);
    expect(store?.getState().workingScore?.scores?.[0]?.autoHideEmptyParts).toEqual(["p2"]);
    expect(store?.getState().workingScore?.scores?.[1]?.autoHideEmptyParts).toEqual(["p1"]);
    rerender(panel(0));
    expect((screen.getByRole("checkbox", { name: "Auto-hide empty staves: Oboe" }) as HTMLInputElement).checked).toBe(
      true,
    );
    await act(async () => completions.shift()?.());
    await act(async () => completions.shift()?.());
  });

  it("lets the active score opt individual instruments into empty-staff hiding", async () => {
    const user = userEvent.setup();
    const { onAutoHideEmptyPartsChange } = renderPanel();
    await user.click(await screen.findByRole("tab", { name: "Layout" }));
    await user.click(screen.getByRole("checkbox", { name: "Auto-hide empty staves: Oboe" }));
    expect(onAutoHideEmptyPartsChange).toHaveBeenCalledWith({ kind: "parts", partIds: ["p2"] });
    expect((screen.getByRole("checkbox", { name: "Auto-hide empty staves: Flute" }) as HTMLInputElement).checked).toBe(
      false,
    );
  });

  it("states the view scope and stores the first-system choice on the active view", async () => {
    const user = userEvent.setup();
    let store: DocumentStore | undefined;
    render(
      <DocumentProvider>
        <WithScore>
          <LiveAutoHideControl
            scoreIndex={0}
            onStore={(value) => {
              store = value;
            }}
          />
        </WithScore>
      </DocumentProvider>,
    );
    expect(await screen.findByText(/Applies to this score view only/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Apply to all/ })).toBeNull();
    await user.click(screen.getByRole("checkbox", { name: "Show all staves on the first system" }));
    expect(store?.getState().workingScore?.scores?.[0]?.autoHideEmptyStaves).toEqual({ firstSystem: "show" });
    expect(store?.getState().workingScore?.scores?.[1]?.autoHideEmptyStaves).toBeUndefined();
  });

  it("opens existing frame properties on canvas selection without a Text tab or creation actions", async () => {
    renderPanel();
    await screen.findByRole("tab", { name: "Selection" });
    expect(screen.queryByRole("tab", { name: "Text" })).toBeNull();
    act(() => {
      useSelectionStore.setState({ selection: { kind: "single", elementId: "text-frame/title" } });
    });
    expect(screen.getByRole("tab", { name: "Selection" }).getAttribute("aria-selected")).toBe("true");
    expect((await screen.findByRole("textbox", { name: "Text", exact: true })).textContent).toBe("Program note");
    expect(screen.queryByRole("button", { name: /Add .*frame/ })).toBeNull();
  });
  it("offers selection properties as a left-panel tab", async () => {
    const user = userEvent.setup();
    renderPanel();

    const selectionTab = await screen.findByRole("tab", { name: "Selection" });
    await user.click(selectionTab);
    expect(selectionTab.getAttribute("aria-selected")).toBe("true");
  });

  it("manages forced breaks from the Layouts tab", async () => {
    const user = userEvent.setup();
    const { onRemoveSelectedBreak, onResetAll } = renderPanel();

    await user.click(await screen.findByRole("tab", { name: "Layout" }));
    expect(screen.getByText("Page break after measure 12.")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(onRemoveSelectedBreak).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Reset all" }));
    expect(screen.getByText("Reset all layout overrides?")).toBeTruthy();
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Reset all" }));
    expect(onResetAll).toHaveBeenCalledOnce();
  });

  it("edits instrument label display for the active layout", async () => {
    const user = userEvent.setup();
    const { onInstrumentNameDisplayChange } = renderPanel();

    await user.click(await screen.findByRole("tab", { name: "Layout" }));
    await user.click(screen.getByRole("combobox", { name: "First system" }));
    await user.click(await screen.findByRole("option", { name: "Hidden" }));

    expect(onInstrumentNameDisplayChange).toHaveBeenCalledWith({
      firstSystem: "hidden",
      subsequentSystems: "short",
    });
  });

  it("preserves an embedded draft across equivalent parent rerenders", async () => {
    const user = userEvent.setup();
    const setup = {
      width: 210,
      height: 297,
      orientation: "portrait" as const,
      margins: { top: 15, right: 15, bottom: 15, left: 15 },
      spatiumMm: 1.25,
    };
    const { rerender } = render(
      <PageSetupDialog embedded initialSetup={setup} onApply={() => {}} onResetToDefault={() => {}} />,
    );
    const width = screen.getByRole("textbox", { name: "Width (mm)" }) as HTMLInputElement;
    expect(screen.getByRole("radiogroup", { name: "Orientation" })).toBeTruthy();
    await user.clear(width);
    await user.type(width, "250");

    rerender(
      <PageSetupDialog
        embedded
        initialSetup={{ ...setup, margins: { ...setup.margins } }}
        onApply={() => {}}
        onResetToDefault={() => {}}
      />,
    );

    expect(width.value).toBe("250");
  });
});
