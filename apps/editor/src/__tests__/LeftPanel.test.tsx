import { useEffect, type ReactNode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Score } from "@viritura/core";
import { TooltipPrimitives } from "@viritura/ui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { LeftPanel } from "../components/LeftPanel";
import { DocumentProvider, useDocumentStore } from "../store/DocumentContext";
import { HistoryProvider } from "../store/HistoryContext";
import { resetSelectionStore, useSelectionActions } from "../store/selectionStore";
import { useOverlayStore } from "../store/overlayStore";
import { resetNoteInputStore, toggleNoteInputMode, useNoteInputStore } from "../store/noteInputStore";

const SCORE: Score = {
  mnx: { version: 1 },
  global: { measures: [{ time: { count: 4, unit: 4 } }] },
  parts: [
    {
      name: "Piano",
      measures: [
        {
          sequences: [
            {
              content: [
                {
                  type: "event",
                  id: "event-1",
                  duration: { base: "whole" },
                  notes: [{ id: "note-1", pitch: { step: "C", octave: 4 } }],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

afterEach(() => {
  cleanup();
  resetSelectionStore();
  resetNoteInputStore();
  useOverlayStore.setState({ lyricMode: false, lyricState: null, activeLyricLineId: "1" });
  vi.restoreAllMocks();
});

function WithSelectedNote({ children }: { readonly children: ReactNode }) {
  const loadScore = useDocumentStore((state) => state.loadScore);
  const loaded = useDocumentStore((state) => state.score !== null);
  const { selectElement } = useSelectionActions();
  useEffect(() => {
    loadScore(SCORE, "left-panel-test.mnx");
    selectElement("p0/m0/s0/event-1/n0");
  }, [loadScore, selectElement]);
  return loaded ? children : null;
}

describe("LeftPanel", () => {
  it.each([false, true])(
    "starts lyrics and opens Properties from one palette tile (note input: %s)",
    async (noteInputActive) => {
      const user = userEvent.setup();
      render(
        <TooltipPrimitives.Provider delayDuration={0}>
          <HistoryProvider initialMnxJson="{}">
            <DocumentProvider>
              <WithSelectedNote>
                <LeftPanel />
              </WithSelectedNote>
            </DocumentProvider>
          </HistoryProvider>
        </TooltipPrimitives.Provider>,
      );

      expect(screen.queryByRole("tab", { name: "Lyrics" })).toBeNull();
      const tile = await screen.findByRole("button", { name: "Lyrics (Shift+W)", exact: true });
      expect(screen.queryByRole("button", { name: "Start lyric entry" })).toBeNull();
      expect(screen.queryByRole("combobox", { name: "Active line" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Paste verse" })).toBeNull();
      if (noteInputActive) act(() => toggleNoteInputMode());
      await user.click(tile);

      expect(screen.getByRole("tab", { name: "Properties" }).getAttribute("aria-selected")).toBe("true");
      expect(useOverlayStore.getState().lyricMode).toBe(true);
      expect(useOverlayStore.getState().lyricState).toEqual({ elementId: "p0/m0/s0/event-1", lineId: "1" });
      expect(useNoteInputStore.getState().active).toBe(false);
      expect(screen.getByRole("combobox", { name: "Active line" })).toBeTruthy();
      expect(screen.getByRole("textbox", { name: "Active lyric line label" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Paste verse" })).toBeTruthy();
      await user.click(screen.getByRole("button", { name: "Stop lyric entry" }));
      expect(useOverlayStore.getState().lyricMode).toBe(false);
      await user.click(screen.getByRole("tab", { name: "Palettes" }));
      expect(screen.queryByRole("combobox", { name: "Active line" })).toBeNull();
      expect(screen.queryByRole("textbox", { name: "Active lyric line label" })).toBeNull();
    },
  );

  it("opens lyric settings but reports an invalid entry selection without entering lyric mode", async () => {
    const info = vi.spyOn(toast, "info").mockImplementation(() => "info");
    const user = userEvent.setup();
    render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <HistoryProvider initialMnxJson="{}">
          <DocumentProvider>
            <WithSelectedNote>
              <LeftPanel />
            </WithSelectedNote>
          </DocumentProvider>
        </HistoryProvider>
      </TooltipPrimitives.Provider>,
    );
    const tile = await screen.findByRole("button", { name: "Lyrics (Shift+W)", exact: true });
    act(() => resetSelectionStore());
    await user.click(tile);
    expect(info).toHaveBeenCalledWith("Select a note or chord before starting lyric entry.");
    expect(useOverlayStore.getState().lyricMode).toBe(false);
    expect(useOverlayStore.getState().lyricState).toBeNull();
    expect(screen.getByRole("tab", { name: "Properties" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("button", { name: "Add lyric line" })).toBeTruthy();
  });

  it("renders notation properties as a left-panel tab", async () => {
    const user = userEvent.setup();
    render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <HistoryProvider initialMnxJson="{}">
          <DocumentProvider>
            <WithSelectedNote>
              <LeftPanel />
            </WithSelectedNote>
          </DocumentProvider>
        </HistoryProvider>
      </TooltipPrimitives.Provider>,
    );

    await user.click(await screen.findByRole("tab", { name: "Properties" }));

    expect(await screen.findByTestId("notation-inspector")).toBeTruthy();
    expect(screen.getByText("Notation Properties")).toBeTruthy();
  });
});
