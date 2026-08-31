import { useEffect, type ReactNode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Score } from "@viritura/core";
import { TooltipPrimitives } from "@viritura/ui";
import { afterEach, describe, expect, it } from "vitest";
import { PalettePanel } from "../components/PalettePanel";
import { DocumentProvider, useDocumentStore } from "../store/DocumentContext";
import { resetSelectionStore, useSelectionStore } from "../store/selectionStore";

const SCORE: Score = {
  mnx: { version: 1 },
  global: { measures: [{}, {}] },
  parts: [
    {
      name: "Piano",
      measures: [
        { sequences: [{ content: [] }] },
        {
          sequences: [
            {
              content: [
                {
                  type: "event",
                  id: "first-note",
                  duration: { base: "quarter" },
                  notes: [{ pitch: { step: "C", octave: 4 } }],
                },
              ],
            },
            {
              content: [{ type: "event", id: "first-rest", duration: { base: "whole" }, rest: {} }],
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

function WithScore({ children }: { readonly children: ReactNode }) {
  const loadScore = useDocumentStore((state) => state.loadScore);
  const score = useDocumentStore((state) => state.score);
  useEffect(() => loadScore(SCORE, "palette-test.mnx"), [loadScore]);
  return score ? (
    <>
      {children}
      <output data-testid="rehearsal-mark-0">
        {(score.global.measures[0] as Record<string, unknown>).rehearsalMark
          ? JSON.stringify((score.global.measures[0] as Record<string, unknown>).rehearsalMark)
          : ""}
      </output>
      <output data-testid="rehearsal-mark">
        {(score.global.measures[1] as Record<string, unknown>).rehearsalMark
          ? JSON.stringify((score.global.measures[1] as Record<string, unknown>).rehearsalMark)
          : ""}
      </output>
      <output data-testid="time-0">{JSON.stringify(score.global.measures[0]?.time ?? null)}</output>
      <output data-testid="time-1">{JSON.stringify(score.global.measures[1]?.time ?? null)}</output>
    </>
  ) : null;
}

describe("PalettePanel", () => {
  it("applies a custom time signature to a selected measure", async () => {
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
    const user = userEvent.setup();
    render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <DocumentProvider>
          <WithScore>
            <PalettePanel />
          </WithScore>
        </DocumentProvider>
      </TooltipPrimitives.Provider>,
    );

    await user.click(await screen.findByRole("button", { name: "Custom time signature" }));
    const input = screen.getByRole("textbox", { name: "Custom time signature" });
    await user.clear(input);
    await user.type(input, "5/4");
    await user.click(screen.getByRole("button", { name: "OK" }));

    expect(screen.getByTestId("time-0").textContent).toBe("null");
    expect(screen.getByTestId("time-1").textContent).toBe('{"count":5,"unit":4}');
  });

  it.each([
    ["barline", "m1/barline", "barline"],
    ["first note", "p0/m1/s0/first-note", "note"],
    ["first rest", "p0/m1/s1/first-rest", "rest"],
  ])(
    "keeps the target captured from a selected %s while the custom dialog is open",
    async (_name, elementId, elementType) => {
      useSelectionStore.setState({
        selection: { kind: "single", elementId, elementType } as never,
      });
      const user = userEvent.setup();
      render(
        <TooltipPrimitives.Provider delayDuration={0}>
          <DocumentProvider>
            <WithScore>
              <PalettePanel />
            </WithScore>
          </DocumentProvider>
        </TooltipPrimitives.Provider>,
      );

      await user.click(await screen.findByRole("button", { name: "Custom time signature" }));
      act(() => useSelectionStore.setState({ selection: { kind: "none" } }));
      const input = screen.getByRole("textbox", { name: "Custom time signature" });
      await user.clear(input);
      await user.type(input, "4/4");
      await user.click(screen.getByRole("button", { name: "OK" }));

      expect(screen.getByTestId("time-0").textContent).toBe("null");
      expect(screen.getByTestId("time-1").textContent).toBe('{"count":4,"unit":4}');
    },
    30_000,
  );

  it("adds a rehearsal mark to a selected measure", async () => {
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
    const user = userEvent.setup();
    render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <DocumentProvider>
          <WithScore>
            <PalettePanel />
          </WithScore>
        </DocumentProvider>
      </TooltipPrimitives.Provider>,
    );

    await user.click(await screen.findByRole("button", { name: "Rehearsal mark" }));
    await user.type(screen.getByRole("textbox", { name: "Rehearsal mark" }), "B");
    await user.click(screen.getByRole("button", { name: "OK" }));

    expect(screen.getByTestId("rehearsal-mark").textContent).toBe('{"text":"B"}');
  });

  it("adds a rehearsal mark at a selected barline rather than the preceding measure", async () => {
    useSelectionStore.setState({
      selection: {
        kind: "single",
        elementId: "m1/barline",
        elementType: "barline",
      },
    });
    const user = userEvent.setup();
    render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <DocumentProvider>
          <WithScore>
            <PalettePanel />
          </WithScore>
        </DocumentProvider>
      </TooltipPrimitives.Provider>,
    );

    await user.click(await screen.findByRole("button", { name: "Rehearsal mark" }));
    await user.type(screen.getByRole("textbox", { name: "Rehearsal mark" }), "C");
    await user.click(screen.getByRole("button", { name: "OK" }));

    expect(screen.getByTestId("rehearsal-mark-0").textContent).toBe("");
    expect(screen.getByTestId("rehearsal-mark").textContent).toBe('{"text":"C"}');
  });
});
