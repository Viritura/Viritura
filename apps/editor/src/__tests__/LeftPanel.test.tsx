import { useEffect, type ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Score } from "@viritura/core";
import { TooltipPrimitives } from "@viritura/ui";
import { afterEach, describe, expect, it } from "vitest";
import { LeftPanel } from "../components/LeftPanel";
import { DocumentProvider, useDocumentStore } from "../store/DocumentContext";
import { HistoryProvider } from "../store/HistoryContext";
import { resetSelectionStore, useSelectionActions } from "../store/selectionStore";

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
