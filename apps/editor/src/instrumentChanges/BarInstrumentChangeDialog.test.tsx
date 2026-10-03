import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { parseMnx, serializeMnx, validateRawScore } from "@viritura/format";
import type { Score } from "@viritura/core";
import * as TooltipPrimitives from "@radix-ui/react-tooltip";
import { createDocumentStore } from "../store/documentStore";
import { BarInstrumentChangeDialogHost } from "./index";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const selection = {
  kind: "measure",
  startPartIndex: 0,
  endPartIndex: 0,
  startStaffIndex: 0,
  endStaffIndex: 0,
  startMeasure: 1,
  endMeasure: 1,
} as const;

function setup(mode: "instrument" | "transposition", changes?: unknown[]) {
  const score = parseMnx({
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }, {}] },
    parts: [
      {
        id: "P1",
        name: "Flute",
        _x: { viritura: { instrumentId: "wind.flutes.flute", midiProgram: 73 } },
        measures: [
          { clefs: [{ clef: { sign: "G", staffPosition: -2 } }], sequences: [{ content: [] }] },
          { sequences: [{ content: [] }], ...(changes ? { _x: { viritura: { instrumentChanges: changes } } } : {}) },
        ],
      },
    ],
  });
  const store = createDocumentStore();
  store.setState({ score, workingScore: score });
  const onClose = vi.fn();
  const updateScore = vi.fn<(score: Score) => void>();
  render(
    <TooltipPrimitives.Provider>
      <BarInstrumentChangeDialogHost
        open
        mode={mode}
        store={store}
        selection={selection}
        onClose={onClose}
        updateScore={updateScore}
      />
    </TooltipPrimitives.Provider>,
  );
  return { store, onClose, updateScore };
}

describe("bar change dialog", () => {
  it("inserts an instrument change in the selected bar, not a whole-part replacement", () => {
    const { updateScore, onClose } = setup("instrument");
    fireEvent.change(screen.getByRole("textbox", { name: "Search instruments…" }), { target: { value: "Piccolo" } });
    fireEvent.click(screen.getByText("Piccolo"));
    fireEvent.click(screen.getByRole("button", { name: "Apply change" }));
    expect(updateScore).toHaveBeenCalledOnce();
    const score = updateScore.mock.calls[0]![0];
    expect(score.parts[0]!._x?.viritura?.instrumentId).toBe("wind.flutes.flute");
    expect(score.parts[0]!.measures[0]!.instrumentChanges).toBeUndefined();
    expect(score.parts[0]!.measures[1]!.instrumentChanges?.[0]?.instrument).toBe("wind.flutes.flute.piccolo");
    expect(validateRawScore(serializeMnx(score)).ok).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("saves a transposition-only change and explicit instruction", async () => {
    const { updateScore } = setup("transposition");
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "Sounding pitch" }));
    await user.click(screen.getByRole("option", { name: "A", exact: true }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Sounding octave" }), { target: { value: "3" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Change label text" }), { target: { value: "in A" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply change" }));
    expect(updateScore.mock.calls[0]![0].parts[0]!.measures[1]!.instrumentChanges).toEqual([
      {
        transposition: { interval: { halfSteps: 3, staffDistance: 2 } },
        instruction: { text: "in A" },
      },
    ]);
  });

  it("saves an independent advance reminder with the change-point label hidden", () => {
    const { updateScore } = setup("transposition");
    fireEvent.click(screen.getByRole("checkbox", { name: "Show label at change" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Show advance reminder" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Advance reminder text" }), {
      target: { value: "Prepare the A clarinet" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply change" }));
    const score = updateScore.mock.calls[0]![0];
    expect(score.parts[0]!.measures[1]!.instrumentChanges?.[0]).toMatchObject({
      instruction: { hidden: true },
      reminder: { text: "Prepare the A clarinet" },
    });
    expect(validateRawScore(serializeMnx(score)).ok).toBe(true);
  });

  it("keeps reminder customization when hiding and reopening an existing reminder", () => {
    const { updateScore } = setup("transposition", [
      {
        transposition: { interval: { halfSteps: 2, staffDistance: 1 } },
        instruction: { text: "in B-flat" },
        reminder: { text: "Prepare B-flat" },
      },
    ]);
    expect(screen.getByRole("checkbox", { name: "Show advance reminder" })).toHaveProperty("checked", true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Show advance reminder" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply change" }));
    expect(updateScore.mock.calls[0]![0].parts[0]!.measures[1]!.instrumentChanges?.[0]).toMatchObject({
      instruction: { text: "in B-flat" },
      reminder: { text: "Prepare B-flat", hidden: true },
    });
  });

  it("enables an automatic reminder without overriding the automatic change label", () => {
    const { updateScore } = setup("instrument");
    fireEvent.click(screen.getByRole("checkbox", { name: "Show advance reminder" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply change" }));
    expect(updateScore.mock.calls[0]![0].parts[0]!.measures[1]!.instrumentChanges?.[0]).toMatchObject({
      reminder: {},
    });
    expect(updateScore.mock.calls[0]![0].parts[0]!.measures[1]!.instrumentChanges?.[0]?.instruction).toBeUndefined();
  });

  it("removes an existing change in one score update", () => {
    const { updateScore, onClose } = setup("transposition", [
      { transposition: { interval: { halfSteps: 2, staffDistance: 1 } } },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Remove change" }));
    expect(updateScore.mock.calls[0]![0].parts[0]!.measures[1]!.instrumentChanges).toBeUndefined();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("cancels without changing the score", () => {
    const { updateScore, onClose } = setup("instrument");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(updateScore).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("reports a blocked percussion-map choice without applying it", () => {
    const { updateScore } = setup("instrument");
    fireEvent.change(screen.getByRole("textbox", { name: "Search instruments…" }), { target: { value: "Snare Drum" } });
    fireEvent.click(screen.getByText("Snare Drum"));
    expect(screen.getByRole("alert").textContent).toContain("Percussion-map changes");
    expect(updateScore).not.toHaveBeenCalled();
  });
});
