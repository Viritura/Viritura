import { useEffect, type ReactNode } from "react";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PART_PAGE_SETUP, resolveScorePageSetup, type Score } from "@viritura/core";
import { TooltipPrimitives } from "@viritura/ui";
import { EngraveLeftPanel } from "../components/modes/engrave/EngraveLeftPanel";
import { PageSetupDialog } from "../components/PageSetupDialog";
import { DocumentProvider, useDocumentStore } from "../store/DocumentContext";
import { resetSelectionStore, useSelectionStore } from "../store/selectionStore";
import { getGlobalPerfTracker } from "@viritura/renderer";
import { useDocumentStoreApi } from "../store/DocumentContext";
import type { DocumentStore } from "../store/documentStore";
import { AutoHideEmptyStavesControl } from "../components/modes/engrave/EngraveLeftPanel/AutoHideEmptyStavesControl";
import { useAutoHideEmptyParts, useEngraveContextRefs, usePageSetupEditor } from "../components/modes/engrave/hooks";
import { PageDefaultsPanel, ProjectPageSetup, usePageDefaultsStore } from "../pageSetup";

afterEach(() => {
  getGlobalPerfTracker().fastLayoutCallback = null;
  cleanup();
  resetSelectionStore();
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
        { type: "staff", sources: [{ part: "p1", labelref: "name" }] },
        { type: "staff", sources: [{ part: "p2", labelref: "name" }] },
      ],
    },
    { id: "wind.flutes.flute", content: [{ type: "staff", sources: [{ part: "p1", labelref: "name" }] }] },
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

function LiveProjectPages({ onStore }: { onStore: (store: DocumentStore) => void }) {
  const store = useDocumentStoreApi();
  const score = useDocumentStore((state) => state.score);
  const updateScore = useDocumentStore((state) => state.updateScore);
  const refs = useEngraveContextRefs(score, 0, updateScore);
  const { handleApplyPageSetup, handleResetPageSetup } = usePageSetupEditor(refs);
  useEffect(() => onStore(store), [onStore, store]);
  return score ? (
    <ProjectPageSetup
      score={score}
      scoreIndex={0}
      preamble={null}
      onApply={handleApplyPageSetup}
      onReset={handleResetPageSetup}
    />
  ) : null;
}

function renderPanel(onApplyPageSetup = vi.fn(), onResetPageSetup = vi.fn(), onInstrumentNameDisplayChange = vi.fn()) {
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
              onApplyPageSetup={onApplyPageSetup}
              onResetPageSetup={onResetPageSetup}
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
    onApplyPageSetup,
    onResetPageSetup,
    onInstrumentNameDisplayChange,
    onAutoHideEmptyPartsChange,
    onRemoveSelectedBreak,
    onResetAll,
  };
}

describe("EngraveLeftPanel", () => {
  it("keeps batch defaults when a current-layout edit and reset happen during pending layout", async () => {
    const user = userEvent.setup();
    let store: DocumentStore | undefined;
    render(
      <DocumentProvider>
        <WithScore>
          <LiveProjectPages
            onStore={(value) => {
              store = value;
            }}
          />
        </WithScore>
      </DocumentProvider>,
    );
    const completions: Array<() => void> = [];
    getGlobalPerfTracker().fastLayoutCallback = () => new Promise<void>((resolve) => completions.push(resolve));
    await user.click(await screen.findByRole("combobox", { name: "Page setup for" }));
    await user.click(await screen.findByRole("option", { name: "Project score defaults" }));
    await user.click(screen.getByRole("combobox", { name: "Preset", exact: true }));
    await user.click(await screen.findByRole("option", { name: "Letter" }));
    await user.click(screen.getByRole("button", { name: "Apply to all scores" }));
    expect(store?.getState().score?.pageSetupDefaults).toBeUndefined();
    await user.click(screen.getByRole("combobox", { name: "Page setup for" }));
    await user.click(await screen.findByRole("option", { name: "Full Score" }));
    await user.click(screen.getByRole("button", { name: "Apply", exact: true }));
    expect(store?.getState().workingScore?.pageSetupDefaults?.score?.width).toBe(215.9);
    await user.click(screen.getByRole("button", { name: "Reset to document default" }));
    expect(store?.getState().workingScore?.scores?.[0]?.pageSetup).toBeUndefined();
    expect((screen.getByRole("textbox", { name: "Width (mm)" }) as HTMLInputElement).value).toBe("215.9");
    await act(async () => completions.shift()?.());
    await act(async () => completions.shift()?.());
    expect(store?.getState().score?.pageSetupDefaults?.score?.width).toBe(215.9);
  });

  it("edits project defaults, preserves custom layouts, and explicitly replaces and resets overrides", async () => {
    const user = userEvent.setup();
    let store: DocumentStore | undefined;
    render(
      <DocumentProvider>
        <WithScore>
          <LiveProjectPages
            onStore={(value) => {
              store = value;
            }}
          />
        </WithScore>
      </DocumentProvider>,
    );
    await user.click(await screen.findByRole("combobox", { name: "Page setup for" }));
    await user.click(await screen.findByRole("option", { name: "Project score defaults" }));
    await user.click(screen.getByRole("combobox", { name: "Preset", exact: true }));
    await user.click(await screen.findByRole("option", { name: "Letter" }));
    await user.click(screen.getByRole("button", { name: "Apply to all scores" }));
    expect(store?.getState().workingScore?.pageSetupDefaults?.score?.width).toBe(215.9);
    expect(store?.getState().workingScore?.scores?.[0]?.pageSetup?.width).toBe(297);
    expect(resolveScorePageSetup(store!.getState().workingScore, 1)).toEqual(DEFAULT_PART_PAGE_SETUP);

    await user.click(screen.getByRole("checkbox", { name: "Replace custom layouts" }));
    await user.click(screen.getByRole("button", { name: "Apply to all scores" }));
    expect(store?.getState().workingScore?.scores?.[0]?.pageSetup).toBeUndefined();

    await user.click(screen.getByRole("combobox", { name: "Page setup for" }));
    await user.click(await screen.findByRole("option", { name: "Full Score" }));
    await user.click(screen.getByRole("combobox", { name: "Preset", exact: true }));
    await user.click(await screen.findByRole("option", { name: "A3" }));
    await user.click(screen.getByRole("button", { name: "Apply", exact: true }));
    expect(store?.getState().workingScore?.scores?.[0]?.pageSetup?.width).toBe(297);
    await user.click(screen.getByRole("button", { name: "Reset to document default" }));
    expect(store?.getState().workingScore?.scores?.[0]?.pageSetup).toBeUndefined();
    expect((screen.getByRole("textbox", { name: "Width (mm)" }) as HTMLInputElement).value).toBe("215.9");
    expect(store?.getState().workingScore?.scores?.[0]?.textFrames).toEqual(SCORE.scores?.[0]?.textFrames);
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
    await user.click(await screen.findByRole("tab", { name: "Layouts" }));
    await user.click(screen.getByRole("checkbox", { name: "Auto-hide empty staves: Oboe" }));
    expect(onAutoHideEmptyPartsChange).toHaveBeenCalledWith(["p2"]);
    expect((screen.getByRole("checkbox", { name: "Auto-hide empty staves: Flute" }) as HTMLInputElement).checked).toBe(
      false,
    );
  });

  it("opens existing frame properties on canvas selection without a Text tab or creation actions", async () => {
    renderPanel();
    await screen.findByRole("tab", { name: "Properties" });
    expect(screen.queryByRole("tab", { name: "Text" })).toBeNull();
    act(() => {
      useSelectionStore.setState({ selection: { kind: "single", elementId: "text-frame/title" } });
    });
    expect(screen.getByRole("tab", { name: "Properties" }).getAttribute("aria-selected")).toBe("true");
    expect((await screen.findByRole("textbox", { name: "Text", exact: true })).textContent).toBe("Program note");
    expect(screen.queryByRole("button", { name: /Add .*frame/ })).toBeNull();
  });
  it("switches between House Style and Layouts", async () => {
    const user = userEvent.setup();
    renderPanel();

    expect(await screen.findByLabelText("Search house style")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "Layouts" }));

    expect(screen.getByText("Instrument Labels")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Apply" })).toBeTruthy();
  });

  it("offers notation properties as a left-panel tab", async () => {
    const user = userEvent.setup();
    renderPanel();

    const propertiesTab = await screen.findByRole("tab", { name: "Properties" });
    await user.click(propertiesTab);
    expect(propertiesTab.getAttribute("aria-selected")).toBe("true");
  });

  it("edits page setup for the globally active score in place", async () => {
    const user = userEvent.setup();
    const { onApplyPageSetup } = renderPanel();

    await user.click(await screen.findByRole("tab", { name: "Layouts" }));
    await user.click(screen.getByRole("button", { name: "Apply" }));

    expect(onApplyPageSetup).toHaveBeenCalledWith(
      expect.objectContaining({ width: 297, height: 420, spatiumMm: 1.25 }),
    );
    expect(screen.queryByRole("button", { name: "Flute" })).toBeNull();
    expect(screen.queryByText("297 mm × 420 mm · 5 mm staff")).toBeNull();
  });

  it("manages forced breaks from the Layouts tab", async () => {
    const user = userEvent.setup();
    const { onRemoveSelectedBreak, onResetAll } = renderPanel();

    await user.click(await screen.findByRole("tab", { name: "Layouts" }));
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

    await user.click(await screen.findByRole("tab", { name: "Layouts" }));
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
