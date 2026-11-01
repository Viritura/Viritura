// @vitest-environment happy-dom
import { useEffect } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseChordSymbolText, type Score } from "@viritura/core";
import { getGlobalPerfTracker } from "@viritura/renderer";
import { Button, TooltipPrimitives } from "@viritura/ui";
import { NotationInspector } from "../components/NotationInspector";
import { DocumentProvider, useDocumentStore, useDocumentStoreApi } from "../store/DocumentContext";
import { useSelectionActions, resetSelectionStore } from "../store/selectionStore";
import { editChordTrackText } from "../score/chordTrack";

vi.mock("@viritura/playback", () => ({ usePlaybackActions: () => ({ previewChord: vi.fn(async () => {}) }) }));

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
const perf = getGlobalPerfTracker();
let previousFastLayout: typeof perf.fastLayoutCallback;

function Harness() {
  const store = useDocumentStoreApi();
  const working = useDocumentStore((state) => state.workingScore);
  const painted = useDocumentStore((state) => state.score);
  const { selectElement } = useSelectionActions();
  useEffect(() => {
    store.getState().loadScore(initial);
    selectElement("m0/chord0", {
      measureIndex: 0,
      partIndex: 0,
      staffIndex: 0,
      localStaffIndex: 0,
      sourceStaff: 1,
      chordTrack: true,
      chordPosition: { fraction: [0, 1] },
    });
  }, [store, selectElement]);
  return (
    <>
      <Button
        label="Commit lane G7"
        onClick={() => {
          const current = store.getState().workingScore!;
          const next = editChordTrackText(current, { measureIndex: 0, beat: 0, x: 0 }, "G7");
          const shifted = editChordTrackText(
            next,
            {
              measureIndex: 0,
              beat: 0,
              x: 0,
              position: { fraction: [0, 1], graceIndex: 0 },
            },
            "F",
          );
          store.getState().updateScore(shifted);
        }}
      />
      <output data-testid="painted">{painted?.global.measures[0]?.chordSymbols?.[0]?.rawText}</output>
      <output data-testid="working">
        {working?.global.measures[0]?.chordSymbols?.map((chord) => chord.rawText).join(",")}
      </output>
      <NotationInspector />
    </>
  );
}

beforeEach(() => {
  resetSelectionStore();
  previousFastLayout = perf.fastLayoutCallback;
  perf.fastLayoutCallback = () => new Promise<void>(() => {});
});
afterEach(() => {
  cleanup();
  resetSelectionStore();
  perf.fastLayoutCallback = previousFastLayout;
});

describe("Properties during pending chord-track layout", () => {
  it("edits the working harmony at its stable position and preserves intervening chords", async () => {
    const user = userEvent.setup();
    render(
      <TooltipPrimitives.Provider>
        <DocumentProvider>
          <Harness />
        </DocumentProvider>
      </TooltipPrimitives.Provider>,
    );
    await waitFor(() => expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Chord text" }).value).toBe("C"));
    fireEvent.click(screen.getByRole("button", { name: "Commit lane G7" }));
    expect(screen.getByTestId("painted").textContent).toBe("C");
    expect(screen.getByTestId("working").textContent).toBe("F,G7");
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Chord text" }).value).toBe("G7");
    await user.click(screen.getByRole("combobox", { name: /^Bass/ }));
    await user.click(screen.getByRole("option", { name: "E", exact: true }));
    expect(screen.getByTestId("working").textContent).toBe("F,G7/E");
    expect(screen.getByTestId("painted").textContent).toBe("C");
  });
});
