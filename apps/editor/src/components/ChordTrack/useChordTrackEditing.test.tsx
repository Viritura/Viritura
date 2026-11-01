// @vitest-environment happy-dom
import { useEffect } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseChordSymbolText, type Score } from "@viritura/core";
import { parseMnx } from "@viritura/format";
import { getGlobalPerfTracker, type DisplayList } from "@viritura/renderer";
import { Button } from "@viritura/ui";
import { DocumentProvider, useDocumentStoreApi } from "../../store/DocumentContext";
import { HistoryProvider } from "../../store/HistoryContext";
import { useHistoryStore, useHistoryStoreInstance } from "../../store/historyStore";
import { useMnxChangeReporter } from "../../app/useMnxChangeReporter";
import { useViewStateStore } from "../../store/viewStateStore";
import { resetSelectionStore, useSelection } from "../../store/selectionStore";
import { trackBeatStep, useChordTrackEditing } from "./useChordTrackEditing";
import { editChordTrackText, removeChordTrackChord } from "../../score/chordTrack";

const { previewChord } = vi.hoisted(() => ({ previewChord: vi.fn(async () => {}) }));
vi.mock("@viritura/playback", () => ({
  usePlaybackActions: () => ({ previewChord }),
  usePlaybackState: () => ({ status: "stopped" }),
}));

const initial: Score = {
  mnx: { version: 1 },
  global: {
    measures: [{ time: { count: 4, unit: 4 }, chordSymbols: [parseChordSymbolText("C", { fraction: [0, 1] })] }],
  },
  parts: [
    {
      id: "piano",
      name: "Piano",
      chordSymbolVisibility: "hide",
      measures: [{ sequences: [{ content: [], fullMeasure: { visualDuration: { base: "whole" } } }] }],
    },
  ],
};
const displayList: DisplayList = {
  commands: [],
  width: 400,
  height: 200,
  measureBounds: [
    {
      index: 0,
      partIndex: 0,
      partId: "piano",
      staffIndex: 0,
      systemIndex: 0,
      x: 40,
      y: 100,
      width: 300,
      height: 48,
      prefixWidth: 20,
      totalBeats: 4,
      beatAnchors: [
        [0, 60],
        [4, 340],
      ],
    },
  ],
};
const point = { measureIndex: 0, beat: 0, x: 60 };
const perf = getGlobalPerfTracker();
let previousFastLayout: typeof perf.fastLayoutCallback;

function EditorHarness() {
  const store = useDocumentStoreApi();
  const history = useHistoryStoreInstance();
  const { pushState, reset, undo, redo, historySize } = useHistoryStore((state) => state);
  const selection = useSelection();
  useMnxChangeReporter({ store, pushState, resetHistory: reset });
  useEffect(() => {
    store.getState().loadScore(structuredClone(initial));
  }, [store]);
  const editing = useChordTrackEditing(displayList);
  return (
    <>
      <Button label="Open chord" onClick={() => editing.open(point, new DOMRect(50, 100, 30, 20))} />
      <Button label="Select chord" onClick={() => editing.select(point)} />
      <Button label="Move chord" onClick={() => editing.move(editing.chords[0]!, { ...point, beat: 2 })} />
      <Button label="Commit G7" onClick={() => editing.commit("G7")} />
      <Button label="Commit Dm7" onClick={() => editing.commit("Dm7")} />
      <Button
        label="Insert earlier"
        onClick={() => {
          const current = store.getState().workingScore!;
          store.getState().updateScore(
            editChordTrackText(
              current,
              {
                ...point,
                position: { fraction: [0, 1], graceIndex: 0 },
              },
              "F",
            ),
          );
        }}
      />
      <Button
        label="Insert later"
        onClick={() => {
          const current = store.getState().workingScore!;
          store.getState().updateScore(editChordTrackText(current, { ...point, beat: 2 }, "G7"));
        }}
      />
      <Button
        label="External remove"
        onClick={() => {
          const current = store.getState().workingScore!;
          store.getState().updateScore(removeChordTrackChord(current, point));
        }}
      />
      <Button label="Cancel" onClick={() => editing.setEditor(null)} />
      <Button label="Remove" onClick={() => editing.remove(point)} />
      <Button label="Undo" onClick={() => undo()} />
      <Button label="Redo" onClick={() => redo()} />
      <output data-testid="chord">{editing.chords[0]?.symbol.rawText ?? "empty"}</output>
      <output data-testid="history">{historySize}</output>
      <output data-testid="selection">
        {selection.kind === "single" ? `${selection.elementId}:${selection.measureAnchor?.chordTrack}` : "none"}
      </output>
      <output data-testid="history-index">{history.getState().currentIndex}</output>
      <output data-testid="editor-open">{editing.editor ? "open" : "closed"}</output>
      <output data-testid="position">{JSON.stringify(editing.chords[0]?.symbol.position.fraction)}</output>
    </>
  );
}

function HistoryHarness() {
  const store = useDocumentStoreApi();
  return (
    <HistoryProvider
      onRestore={(json) => store.getState().loadScore(parseMnx(JSON.parse(json)), undefined, json, true)}
    >
      <EditorHarness />
    </HistoryProvider>
  );
}

beforeEach(() => {
  previousFastLayout = perf.fastLayoutCallback;
  perf.fastLayoutCallback = null;
  previewChord.mockClear();
  resetSelectionStore();
  useViewStateStore.setState({ chordTrackAudition: true });
});
afterEach(() => {
  cleanup();
  perf.fastLayoutCallback = previousFastLayout;
});

describe("chord track document/history/audition integration", () => {
  it("selects and auditions without opening the editor; opening text does not audition again", async () => {
    render(
      <DocumentProvider>
        <HistoryHarness />
      </DocumentProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("chord").textContent).toBe("C"));
    fireEvent.click(screen.getByRole("button", { name: "Select chord" }));
    expect(screen.getByTestId("selection").textContent).toBe("m0/chord0:true");
    expect(screen.getByTestId("editor-open").textContent).toBe("closed");
    expect(previewChord).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Open chord" }));
    expect(screen.getByTestId("editor-open").textContent).toBe("open");
    expect(previewChord).toHaveBeenCalledOnce();
  });

  it("records a snapped move as one undo step", async () => {
    render(
      <DocumentProvider>
        <HistoryHarness />
      </DocumentProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("chord").textContent).toBe("C"));
    fireEvent.click(screen.getByRole("button", { name: "Move chord" }));
    await waitFor(() => expect(screen.getByTestId("history").textContent).toBe("2"));
    expect(screen.getByTestId("position").textContent).toBe("[1,2]");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByTestId("chord").textContent).toBe("C");
    expect(screen.getByTestId("position").textContent).toBe("[0,1]");
  });
  it("rebases selection when an earlier harmony shifts canonical indices", async () => {
    render(
      <DocumentProvider>
        <HistoryHarness />
      </DocumentProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("chord").textContent).toBe("C"));
    fireEvent.click(screen.getByRole("button", { name: "Open chord" }));
    fireEvent.click(screen.getByRole("button", { name: "Insert earlier" }));
    expect(screen.getByTestId("selection").textContent).toBe("m0/chord1:true");
    await waitFor(() => expect(screen.getByTestId("history").textContent).toBe("2"));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByTestId("selection").textContent).toBe("m0/chord0:true");
  });

  it("clears a deleted harmony rather than selecting its index's new occupant", async () => {
    render(
      <DocumentProvider>
        <HistoryHarness />
      </DocumentProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("chord").textContent).toBe("C"));
    fireEvent.click(screen.getByRole("button", { name: "Open chord" }));
    fireEvent.click(screen.getByRole("button", { name: "Insert later" }));
    fireEvent.click(screen.getByRole("button", { name: "External remove" }));
    expect(screen.getByTestId("chord").textContent).toBe("G7");
    expect(screen.getByTestId("selection").textContent).toBe("none");
  });

  it("keeps separate undo steps for rapid commits while layout is in flight", async () => {
    const completions: Array<() => void> = [];
    perf.fastLayoutCallback = () => new Promise<void>((resolve) => completions.push(resolve));
    try {
      render(
        <DocumentProvider>
          <HistoryHarness />
        </DocumentProvider>,
      );
      await waitFor(() => expect(screen.getByTestId("chord").textContent).toBe("C"));
      fireEvent.click(screen.getByRole("button", { name: "Open chord" }));
      fireEvent.click(screen.getByRole("button", { name: "Commit G7" }));
      fireEvent.click(screen.getByRole("button", { name: "Commit Dm7" }));
      await waitFor(() => expect(screen.getByTestId("history").textContent).toBe("3"));
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
      expect(screen.getByTestId("chord").textContent).toBe("G7");
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
      expect(screen.getByTestId("chord").textContent).toBe("C");
    } finally {
      for (const complete of completions) complete();
    }
  });

  it("records one commit, undoes/redoes it, and keeps canonical concert selection", async () => {
    render(
      <DocumentProvider>
        <HistoryHarness />
      </DocumentProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("chord").textContent).toBe("C"));
    fireEvent.click(screen.getByRole("button", { name: "Open chord" }));
    expect(screen.getByTestId("selection").textContent).toBe("m0/chord0:true");
    fireEvent.click(screen.getByRole("button", { name: "Commit G7" }));
    await waitFor(() => expect(screen.getByTestId("history").textContent).toBe("2"));
    expect(screen.getByTestId("chord").textContent).toBe("G7");
    expect(previewChord).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByTestId("chord").textContent).toBe("C");
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    expect(screen.getByTestId("chord").textContent).toBe("G7");
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.getByTestId("chord").textContent).toBe("empty"));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByTestId("chord").textContent).toBe("G7");
  });

  it("does not record a canceled entry or audition when disabled", async () => {
    useViewStateStore.setState({ chordTrackAudition: false });
    render(
      <DocumentProvider>
        <HistoryHarness />
      </DocumentProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("chord").textContent).toBe("C"));
    fireEvent.click(screen.getByRole("button", { name: "Open chord" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByTestId("history").textContent).toBe("1");
    expect(previewChord).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Open chord" }));
    fireEvent.click(screen.getByRole("button", { name: "Commit G7" }));
    await waitFor(() => expect(screen.getByTestId("history").textContent).toBe("2"));
    expect(previewChord).not.toHaveBeenCalled();
  });

  it("uses the active meter for beat stepping, including compound beats", () => {
    const score: Score = {
      ...initial,
      global: { measures: [{ time: { count: 6, unit: 8 } }, {}, { time: { count: 3, unit: 8 } }] },
    };
    expect(trackBeatStep(score, 0)).toBe(1.5);
    expect(trackBeatStep(score, 1)).toBe(1.5);
    expect(trackBeatStep(score, 2)).toBe(0.5);
  });
});
