import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseMnx, serializeMnx, validateRawScore } from "@viritura/format";
import { resolveActiveInstrument, type Score, type Transposition } from "@viritura/core";
import * as TooltipPrimitives from "@radix-ui/react-tooltip";
import { createDocumentStore } from "../store/documentStore";
import { BarInstrumentChangeDialogHost } from "./index";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
afterEach(cleanup);

const selection = {
  kind: "measure",
  startPartIndex: 0,
  endPartIndex: 0,
  startStaffIndex: 0,
  endStaffIndex: 0,
  startMeasure: 1,
  endMeasure: 1,
} as const;

function setup(changes?: unknown[], transposition?: Transposition) {
  const score = parseMnx({
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }, {}] },
    parts: [
      {
        id: "P1",
        name: "Flute",
        ...(transposition ? { transposition } : {}),
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
  it("preserves inherited custom tuning when only printed labels are edited", () => {
    const transposition = { interval: { halfSteps: 3, staffDistance: 2 }, keyFifthsFlipAt: -4 };
    const { updateScore } = setup(undefined, transposition);
    expect(screen.getByRole("button", { name: "Customize tuning" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/Flute: written C4 sounds as A3/)).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Change label text" }), { target: { value: "in A" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply change" }));
    const score = updateScore.mock.calls[0]![0];
    expect(resolveActiveInstrument(score.parts[0]!, 1).transposition).toEqual(transposition);
    expect(score.parts[0]!.measures[1]!.instrumentChanges?.[0]?.instrument).toBeUndefined();
    expect(score.parts[0]!.measures[1]!.clefs).toBeUndefined();
  });

  it("chooses the default trumpet once and moves C tuning into customization", async () => {
    const { updateScore } = setup();
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Search instruments…" }), "trumpet");
    expect(screen.queryByText("Trumpet in C")).toBeNull();
    expect(screen.queryByText("Trumpet in B♭")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Trumpet/ }));
    expect(screen.getByText(/Trumpet: written C4 sounds as B♭3/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Customize tuning" }));
    await user.click(screen.getByRole("combobox", { name: "Transposition preset" }));
    await user.click(screen.getByRole("option", { name: "Trumpet in C — C4" }));
    await user.click(screen.getByRole("button", { name: "Apply change" }));
    expect(updateScore).toHaveBeenCalledOnce();
    const score = updateScore.mock.calls[0]![0];
    const active = resolveActiveInstrument(score.parts[0]!, 1);
    expect(active.instrument?.instrumentId).toBe("brass.trumpet.bflat");
    expect(active.transposition?.interval).toEqual({ halfSteps: 0, staffDistance: 0 });
    expect(validateRawScore(serializeMnx(score)).ok).toBe(true);
  });

  it("starts with the instrument default and lets tuning be customized in the same save", () => {
    const { updateScore } = setup();
    expect(screen.getByRole("button", { name: "Customize tuning" }).getAttribute("aria-expanded")).toBe("false");
    fireEvent.change(screen.getByRole("textbox", { name: "Search instruments…" }), { target: { value: "Piccolo" } });
    fireEvent.click(screen.getByText("Piccolo"));
    expect(screen.getByText(/Piccolo: written C4 sounds as C5/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Customize tuning" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Sounding octave" }), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply change" }));
    expect(updateScore).toHaveBeenCalledOnce();
    const score = updateScore.mock.calls[0]![0];
    const change = score.parts[0]!.measures[1]!.instrumentChanges?.[0];
    expect(change?.instrument).toBe("wind.flutes.flute.piccolo");
    expect(change?.transposition).toEqual({
      interval: { halfSteps: -24, staffDistance: -14 },
      prefersWrittenPitches: true,
    });
    expect(resolveActiveInstrument(score.parts[0]!, 1).instrument?.instrumentId).toBe("wind.flutes.flute.piccolo");
    expect(validateRawScore(serializeMnx(score)).ok).toBe(true);
  });

  it("resets custom tuning when a different instrument is selected", () => {
    const { updateScore } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Customize tuning" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Sounding octave" }), { target: { value: "2" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Search instruments…" }), { target: { value: "Piccolo" } });
    fireEvent.click(screen.getByText("Piccolo"));
    fireEvent.click(screen.getByRole("button", { name: "Apply change" }));
    const score = updateScore.mock.calls[0]![0];
    expect(score.parts[0]!.measures[1]!.instrumentChanges?.[0]?.transposition).toBeUndefined();
    expect(resolveActiveInstrument(score.parts[0]!, 1).transposition).toEqual({
      interval: { halfSteps: -12, staffDistance: -7 },
      prefersWrittenPitches: true,
    });
  });

  it("preserves an existing tuning override when reopened through Change instrument", () => {
    const { updateScore } = setup([{ transposition: { interval: { halfSteps: 3, staffDistance: 2 } } }]);
    expect(screen.getByRole("button", { name: "Customize tuning" }).getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Apply change" }));
    expect(updateScore.mock.calls[0]![0].parts[0]!.measures[1]!.instrumentChanges?.[0]?.transposition).toEqual({
      interval: { halfSteps: 3, staffDistance: 2 },
    });
  });

  it("allows returning to the instrument default without retaining a previous override", () => {
    const { updateScore } = setup([{ transposition: { interval: { halfSteps: 3, staffDistance: 2 } } }]);
    fireEvent.click(screen.getByRole("button", { name: "Use instrument default" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply change" }));
    expect(updateScore.mock.calls[0]![0].parts[0]!.measures[1]!.instrumentChanges?.[0]?.transposition).toBeUndefined();
  });

  it("opens one wide dialog with the instrument choice and optional tuning", () => {
    setup();
    const dialog = screen.getByRole("dialog", { name: "Change instrument or tuning" });
    expect(dialog.className).toContain("contentWide");
    expect(screen.getByRole("button", { name: "Customize tuning" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: "Instrument" }).getAttribute("aria-expanded")).toBe("true");
  });
  it("inserts an instrument change in the selected bar, not a whole-part replacement", () => {
    const { updateScore, onClose } = setup();
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
    const { updateScore } = setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Customize tuning" }));
    await user.click(screen.getByRole("combobox", { name: "Sounding pitch" }));
    await user.click(screen.getByRole("option", { name: "A", exact: true }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Sounding octave" }), { target: { value: "3" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Change label text" }), { target: { value: "in A" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply change" }));
    expect(updateScore.mock.calls[0]![0].parts[0]!.measures[1]!.instrumentChanges).toEqual([
      {
        transposition: { interval: { halfSteps: 3, staffDistance: 2 } },
        instruction: { text: "in A" },
        reminder: {},
      },
    ]);
  });

  it("saves an independent advance reminder with the change-point label hidden", () => {
    const { updateScore } = setup();
    fireEvent.click(screen.getByRole("checkbox", { name: "Show label at change" }));
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
    const { updateScore } = setup([
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

  it("defaults to an automatic reminder without overriding the automatic change label", () => {
    const { updateScore } = setup();
    expect(screen.getByRole("checkbox", { name: "Show advance reminder" })).toHaveProperty("checked", true);
    fireEvent.click(screen.getByRole("button", { name: "Apply change" }));
    expect(updateScore.mock.calls[0]![0].parts[0]!.measures[1]!.instrumentChanges?.[0]).toMatchObject({
      reminder: {},
    });

    expect(updateScore.mock.calls[0]![0].parts[0]!.measures[1]!.instrumentChanges?.[0]?.instruction).toBeUndefined();
  });

  it("persists explicit hiding of the default reminder on a new declaration", () => {
    const { updateScore } = setup();
    fireEvent.click(screen.getByRole("checkbox", { name: "Show advance reminder" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply change" }));
    expect(updateScore.mock.calls[0]![0].parts[0]!.measures[1]!.instrumentChanges?.[0]?.reminder).toEqual({
      hidden: true,
    });
  });

  it("removes an existing change in one score update", () => {
    const { updateScore, onClose } = setup([{ transposition: { interval: { halfSteps: 2, staffDistance: 1 } } }]);
    fireEvent.click(screen.getByRole("button", { name: "Remove change" }));
    expect(updateScore.mock.calls[0]![0].parts[0]!.measures[1]!.instrumentChanges).toBeUndefined();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("cancels without changing the score", () => {
    const { updateScore, onClose } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(updateScore).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("reports a blocked percussion-map choice without applying it", () => {
    const { updateScore } = setup();
    fireEvent.change(screen.getByRole("textbox", { name: "Search instruments…" }), { target: { value: "Snare Drum" } });
    fireEvent.click(screen.getByText("Snare Drum"));
    expect(screen.getByRole("alert").textContent).toContain("Percussion-map changes");
    expect(updateScore).not.toHaveBeenCalled();
  });
});
