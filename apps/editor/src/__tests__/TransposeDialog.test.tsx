import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Score } from "@viritura/core";
import { TooltipPrimitives } from "@viritura/ui";
import {
  TransposeDialog,
  buildTransposeIntervalOptions,
  getTransposeSelectionInfo,
} from "../components/TransposeDialog";

afterEach(cleanup);

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
                  id: "chord",
                  duration: { base: "quarter" },
                  notes: [
                    { id: "c", pitch: { step: "C", octave: 4 } },
                    { id: "e", pitch: { step: "E", octave: 4 } },
                  ],
                },
                { type: "event", id: "rest", duration: { base: "quarter" }, rest: {} },
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe("TransposeDialog", () => {
  it("adds signed semitone counts to chromatic interval labels", () => {
    expect(buildTransposeIntervalOptions("chromatic", "up").slice(0, 3)).toEqual([
      { value: "Minor 2nd", label: "Minor 2nd (+1)" },
      { value: "Major 2nd", label: "Major 2nd (+2)" },
      { value: "Minor 3rd", label: "Minor 3rd (+3)" },
    ]);
    expect(buildTransposeIntervalOptions("chromatic", "down")[2]).toEqual({
      value: "Minor 3rd",
      label: "Minor 3rd (-3)",
    });
  });

  it("uses staff-step counts for diatonic intervals whose semitone distance varies", () => {
    expect(buildTransposeIntervalOptions("diatonic", "down")[0]).toEqual({
      value: "2nd",
      label: "2nd (-1 staff step)",
    });
  });

  it("summarizes only pitched notes in the selection", () => {
    expect(
      getTransposeSelectionInfo(SCORE, {
        kind: "measure",
        startPartIndex: 0,
        endPartIndex: 0,
        startStaffIndex: 0,
        endStaffIndex: 0,
        startMeasure: 0,
        endMeasure: 0,
      }),
    ).toEqual({ eventCount: 1, noteCount: 2, description: "2 selected notes" });
  });

  it("makes selection scope and musical method explicit", async () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <TransposeDialog
          open
          onClose={onClose}
          onApply={onApply}
          selection={{ eventCount: 1, noteCount: 2, description: "2 selected notes" }}
        />
      </TooltipPrimitives.Provider>,
    );

    expect(screen.getByRole("heading", { name: "Transpose Selection" })).toBeTruthy();
    expect(screen.getByText("2 selected notes")).toBeTruthy();
    expect(screen.getByText("Rests, rhythm, and key signatures are unchanged.")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Interval" }).textContent).toContain("Minor 2nd (+1)");

    await user.click(screen.getByRole("radio", { name: "Down" }));
    expect(screen.getByRole("combobox", { name: "Interval" }).textContent).toContain("Minor 2nd (-1)");
    await user.click(screen.getByRole("radio", { name: "Diatonic" }));
    expect(screen.getByText("Move by staff steps in the active key signature.")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Interval" }).textContent).toContain("2nd (-1 staff step)");
    await user.click(screen.getByRole("button", { name: "Transpose Selection" }));

    expect(onApply).toHaveBeenCalledWith({ direction: "down", mode: "diatonic", interval: "2nd" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
