import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import * as TooltipPrimitives from "@radix-ui/react-tooltip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MnxYjsBridge } from "@viritura/crdt";
import { parseMnx, serializeMnx, validateRawScore } from "@viritura/format";
import { calculateHarpPedalSolutions, type HarpPedalCalculation, type Score } from "@viritura/core";
import { toast } from "sonner";
import { useMnxChangeReporter } from "../app/useMnxChangeReporter";
import { produce } from "../score/scoreClone";
import { createDocumentStore } from "../store/documentStore";
import { createHistoryStore } from "../store/historyStore";
import { HarpPedalPopover } from "./index";
import { NATURAL_PEDALS } from "./harpPedalText";
import { calculateHarpPedals } from "./calculationRunner";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("./calculationRunner", async () => {
  const { calculateHarpPedalSolutions } = await import("@viritura/core");
  return {
    calculateHarpPedals: vi.fn(async (score: Score, partIndex: number) =>
      calculateHarpPedalSolutions(score, partIndex),
    ),
  };
});
afterEach(cleanup);

function fixture(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ id: "m1", time: { count: 4, unit: 4 } }] },
    parts: [
      {
        id: "harp",
        name: "Harp",
        staves: 2,
        _x: { viritura: { instrumentId: "pluck.harp" } },
        measures: [
          {
            sequences: [
              {
                staff: 1,
                content: [
                  {
                    type: "event",
                    id: "note",
                    duration: { base: "whole" },
                    notes: [{ id: "note-head", pitch: { step: "C", octave: 4 } }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

const selection = { kind: "single", elementId: "p0/m0/s0/note", elementType: "event" } as const;

function setup(initial = fixture()) {
  const store = createDocumentStore();
  store.getState().loadScore(initial);
  const onClose = vi.fn();
  const updateScore = vi.fn((score: Score) => store.getState().updateScore(score));
  render(
    <TooltipPrimitives.Provider>
      <HarpPedalPopover
        open
        store={store}
        selection={selection}
        onClose={onClose}
        position={{ x: 300, y: 200 }}
        updateScore={updateScore}
      />
    </TooltipPrimitives.Provider>,
  );
  return { store, onClose, updateScore };
}

describe("harp pedal popover", () => {
  it("overwrites one pedal at a time and advances past the divider without growing the input", () => {
    setup();
    const input = screen.getByRole<HTMLInputElement>("textbox", { name: "Harp pedals" });
    input.setSelectionRange(0, input.value.length);
    fireEvent.keyDown(input, { key: "^" });
    expect(input.value).toBe("^--|----");
    expect(input.selectionStart).toBe(1);
    fireEvent.keyDown(input, { key: "-" });
    expect(input.selectionStart).toBe(2);
    fireEvent.keyDown(input, { key: "V" });
    expect(input.value).toBe("^-v|----");
    expect(input.selectionStart).toBe(4);
    fireEvent.keyDown(input, { key: "^" });
    expect(input.value).toBe("^-v|^---");
    expect(input.selectionStart).toBe(5);
    input.setSelectionRange(3, 3);
    fireEvent.keyDown(input, { key: "v" });
    expect(input.value).toBe("^-v|v---");
    expect(input.selectionStart).toBe(5);
    input.setSelectionRange(7, 7);
    fireEvent.keyDown(input, { key: "^" });
    expect(input.value).toBe("^-v|v--^");
    expect(input.selectionStart).toBe(8);
    fireEvent.keyDown(input, { key: "v" });
    expect(input.value).toBe("^-v|v--^");
    expect(input.selectionStart).toBe(8);
  });

  it("adjusts the pedal at the cursor with arrows without advancing or wrapping", () => {
    const { store } = setup();
    const input = screen.getByRole<HTMLInputElement>("textbox", { name: "Harp pedals" });
    input.setSelectionRange(0, input.value.length);
    expect(fireEvent.keyDown(input, { key: "ArrowUp" })).toBe(false);
    expect(input.value).toBe("^--|----");
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(0);
    expect(screen.getByLabelText("D flat")).toBeTruthy();
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.value).toBe("^--|----");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.value).toBe("---|----");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.value).toBe("v--|----");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.value).toBe("v--|----");
    expect(input.selectionStart).toBe(0);
    expect(screen.getByLabelText("D sharp")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(store.getState().workingScore!.parts[0]!.measures[0]!.harpPedals![0]!.tuning.D).toBe(1);
  });

  it("adjusts the next pedal at a divider and the last pedal at the end", () => {
    setup();
    const input = screen.getByRole<HTMLInputElement>("textbox", { name: "Harp pedals" });
    input.setSelectionRange(3, 3);
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.value).toBe("---|^---");
    expect(input.selectionStart).toBe(4);
    expect(screen.getByLabelText("E flat")).toBeTruthy();
    input.setSelectionRange(input.value.length, input.value.length);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.value).toBe("---|^--v");
    expect(input.selectionStart).toBe(7);
    expect(screen.getByLabelText("A sharp")).toBeTruthy();
  });

  it("supports arrows in other valid text formats without intercepting modified or invalid input", () => {
    setup();
    const input = screen.getByRole<HTMLInputElement>("textbox", { name: "Harp pedals" });
    fireEvent.change(input, { target: { value: " - - - | --V- " } });
    input.setSelectionRange(10, 10);
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.value).toBe(" - - - | -^V- ");
    expect(input.selectionStart).toBe(10);
    expect(fireEvent.keyDown(input, { key: "ArrowDown", shiftKey: true })).toBe(true);
    expect(fireEvent.keyDown(input, { key: "ArrowDown", ctrlKey: true })).toBe(true);
    expect(input.value).toBe(" - - - | -^V- ");
    fireEvent.change(input, { target: { value: "^--|--" } });
    expect(fireEvent.keyDown(input, { key: "ArrowDown" })).toBe(true);
    expect(input.value).toBe("^--|--");
  });

  it("keeps typed positions and the up/down controls synchronized and applies all seven", () => {
    const { store, updateScore } = setup();
    const input = screen.getByRole<HTMLInputElement>("textbox", { name: "Harp pedals" });
    expect(input.value).toBe("---|----");
    expect((screen.getByRole("button", { name: "Auto" }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Raise D pedal" }));
    expect(input.value).toBe("^--|----");
    expect(screen.getByLabelText("D flat")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Raise D pedal" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(input, { target: { value: "^--|--v^" } });
    expect(screen.getByLabelText("G sharp")).toBeTruthy();
    expect(screen.getByLabelText("A flat")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Lower G pedal" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Lower D pedal" }));
    expect(input.value).toBe("---|--v^");
    fireEvent.click(screen.getByRole("button", { name: "Lower D pedal" }));
    expect(input.value).toBe("v--|--v^");
    expect((screen.getByRole("button", { name: "Lower D pedal" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(updateScore).toHaveBeenCalledOnce();
    const [created] = store.getState().workingScore!.parts[0]!.measures[0]!.harpPedals!;
    expect(created).toMatchObject({ tuning: { D: 1, C: 0, B: 0, E: 0, F: 0, G: 1, A: -1 }, source: "manual" });
    expect(created).not.toHaveProperty("display");
    expect(created).not.toHaveProperty("placement");
  });

  it("auto-applies the sole no-respelling solution", async () => {
    const { store, updateScore, onClose } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Auto" }));

    await waitFor(() => expect(updateScore).toHaveBeenCalledOnce());
    expect(store.getState().workingScore!.parts[0]!.measures[0]!.harpPedals).toEqual([
      expect.objectContaining({ source: "calculated", position: { fraction: [0, 1] } }),
    ]);
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("applies calculated settings to their corresponding measures", async () => {
    const score = fixture();
    score.global.measures.push({ id: "m2", time: { count: 4, unit: 4 } });
    score.parts[0]!.measures[0]!.sequences[0]!.content = [
      {
        type: "event",
        id: "note",
        duration: { base: "quarter" },
        notes: [{ id: "c-natural-head", pitch: { step: "C", octave: 4 } }],
      },
    ];
    score.parts[0]!.measures.push({
      sequences: [
        {
          staff: 1,
          content: [
            {
              type: "event",
              id: "c-sharp",
              duration: { base: "quarter" },
              notes: [{ id: "c-sharp-head", pitch: { step: "C", alter: 1, octave: 4 } }],
            },
          ],
        },
      ],
    });
    const { store, updateScore } = setup(score);
    fireEvent.click(screen.getByRole("button", { name: "Auto" }));
    expect(await screen.findByRole("dialog", { name: "Calculate harp pedals" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Apply solution" }));

    expect(updateScore).toHaveBeenCalledOnce();
    expect(store.getState().workingScore!.parts[0]!.measures.map((measure) => measure.harpPedals)).toEqual([
      [expect.objectContaining({ position: { fraction: [0, 1] }, tuning: expect.objectContaining({ C: 0 }) })],
      [expect.objectContaining({ position: { fraction: [0, 1] }, tuning: expect.objectContaining({ C: 1 }) })],
    ]);
  });

  it("offers and applies a respelling alternative only when it reduces pedal changes", async () => {
    const score = fixture();
    score.parts[0]!.measures[0]!.sequences[0]!.content = [
      {
        type: "event",
        id: "note",
        duration: { base: "quarter" },
        notes: [{ id: "c-natural-head", pitch: { step: "C", octave: 4 } }],
      },
      {
        type: "event",
        id: "c-sharp",
        duration: { base: "quarter" },
        notes: [{ id: "c-sharp-head", pitch: { step: "C", alter: 1, octave: 4 } }],
      },
    ];
    const { store, onClose, updateScore } = setup(score);
    fireEvent.click(screen.getByRole("button", { name: "Auto" }));

    expect(updateScore).not.toHaveBeenCalled();
    expect(await screen.findByRole("dialog", { name: "Calculate harp pedals" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "No respelling" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Suggest respelling" }));
    expect(screen.getByRole("radio", { name: "Suggest respelling" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText(/respelled note/).textContent).toContain("1 respelled note");
    expect(screen.getByText("C4 -> B#3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Apply solution" }));

    expect(updateScore).toHaveBeenCalledOnce();
    expect(updateScore.mock.calls[0]![0]!.parts[0]!.measures[0]!.sequences[0]!.content[0]).toMatchObject({
      id: "note",
      notes: [{ pitch: { step: "B", alter: 1, octave: 3 } }],
    });
    expect(store.getState().workingScore!.parts[0]!.measures[0]!.sequences[0]!.content[0]).toMatchObject({
      id: "note",
      notes: [{ pitch: { step: "B", alter: 1, octave: 3 } }],
    });
    expect(store.getState().workingScore!.parts[0]!.measures[0]!.harpPedals).toHaveLength(1);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("recalculates instead of applying dialog choices from an older revision", async () => {
    const score = fixture();
    score.parts[0]!.measures[0]!.sequences[0]!.content = [
      {
        type: "event",
        id: "note",
        duration: { base: "quarter" },
        notes: [{ id: "c-natural-head", pitch: { step: "C", octave: 4 } }],
      },
      {
        type: "event",
        id: "c-sharp",
        duration: { base: "quarter" },
        notes: [{ id: "c-sharp-head", pitch: { step: "C", alter: 1, octave: 4 } }],
      },
    ];
    const { store, updateScore } = setup(score);
    fireEvent.click(screen.getByRole("button", { name: "Auto" }));
    expect(await screen.findByRole("dialog", { name: "Calculate harp pedals" })).toBeTruthy();

    const changed = produce(store.getState().workingScore!, (draft) => {
      const event = draft.parts[0]!.measures[0]!.sequences[0]!.content[1]!;
      if (event.type !== "event") throw new Error("Expected event");
      event.notes![0]!.pitch = { step: "D", octave: 4 };
    });
    act(() => store.getState().updateScore(changed));
    fireEvent.click(screen.getByRole("button", { name: "Apply solution" }));

    await waitFor(() => expect(updateScore).toHaveBeenCalledOnce());
    expect(store.getState().workingScore!.parts[0]!.measures[0]!.sequences[0]!.content[1]).toMatchObject({
      id: "c-sharp",
      notes: [{ pitch: { step: "D", octave: 4 } }],
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers all three ranked choices and leaves the score unchanged on Cancel", async () => {
    const score = fixture();
    score.parts[0]!.measures[0]!.sequences[0]!.content = [
      {
        type: "event",
        id: "note",
        duration: { base: "quarter" },
        notes: [{ id: "c", pitch: { step: "C", octave: 4 } }],
      },
      {
        type: "event",
        id: "sharp-c",
        duration: { base: "quarter" },
        notes: [{ id: "cs", pitch: { step: "C", alter: 1, octave: 4 } }],
      },
      {
        type: "event",
        id: "natural-f",
        duration: { base: "quarter" },
        notes: [{ id: "f", pitch: { step: "F", octave: 4 } }],
      },
      {
        type: "event",
        id: "sharp-f",
        duration: { base: "quarter" },
        notes: [{ id: "fs", pitch: { step: "F", alter: 1, octave: 4 } }],
      },
    ];
    const { store, updateScore } = setup(score);
    const original = store.getState().mnxJson;
    fireEvent.click(screen.getByRole("button", { name: "Auto" }));
    await screen.findByRole("dialog", { name: "Calculate harp pedals" });
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByRole("radio", { name: "No respelling" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Maximum respell" }));
    expect(screen.getByText(/pedal setting changes/).textContent).toContain("0 pedal setting changes");
    expect(screen.getByText(/respelled notes/).textContent).toContain("2 respelled notes");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(updateScore).not.toHaveBeenCalled();
    expect(store.getState().mnxJson).toBe(original);
  });

  it("auto-applies coherent tie respellings and pedal settings in one undoable edit", async () => {
    const score = fixture();
    score.parts[0]!.measures[0]!.sequences[0]!.content = [
      {
        type: "event",
        id: "note",
        duration: { base: "quarter" },
        notes: [{ id: "tie-start-head", pitch: { step: "C", octave: 4 }, ties: [{ target: "tie-end-head" }] }],
      },
      {
        type: "event",
        id: "tie-end",
        duration: { base: "quarter" },
        notes: [
          { id: "tie-end-head", pitch: { step: "C", octave: 4 } },
          { id: "sharp-head", pitch: { step: "C", alter: 1, octave: 4 } },
          { id: "d-head", pitch: { step: "D", octave: 4 } },
        ],
      },
      { type: "event", id: "rest", duration: { base: "half" }, rest: {} },
    ];
    const { store, updateScore, onClose } = setup(score);
    const original = store.getState().mnxJson;
    const history = createHistoryStore(original, {
      current: (json) => store.getState().loadScore(parseMnx(JSON.parse(json)), undefined, json, true),
    });
    renderHook(() => useMnxChangeReporter({ store, pushState: history.getState().pushState }));
    fireEvent.click(screen.getByRole("button", { name: "Auto" }));
    await waitFor(() => expect(history.getState().canUndo).toBe(true));

    expect(updateScore).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(history.getState().entries).toHaveLength(2);
    const edited = store.getState().mnxJson;
    expect(validateRawScore(JSON.parse(edited)).ok).toBe(true);
    const content = store.getState().workingScore!.parts[0]!.measures[0]!.sequences[0]!.content;
    expect(content[0]).toMatchObject({
      id: "note",
      notes: [{ id: "tie-start-head", pitch: { step: "B", alter: 1, octave: 3 }, ties: [{ target: "tie-end-head" }] }],
    });
    expect(content[1]).toMatchObject({
      id: "tie-end",
      notes: [
        { id: "tie-end-head", pitch: { step: "B", alter: 1, octave: 3 } },
        { id: "sharp-head", pitch: { step: "C", alter: 1, octave: 4 } },
        { id: "d-head", pitch: { step: "D", octave: 4 } },
      ],
    });
    act(() => history.getState().undo());
    expect(JSON.parse(store.getState().mnxJson)).toEqual(JSON.parse(original));
    act(() => history.getState().redo());
    expect(JSON.parse(store.getState().mnxJson)).toEqual(JSON.parse(edited));
  });

  it("cancels a running calculation without applying a late provisional result", async () => {
    let complete!: (result: HarpPedalCalculation) => void;
    let signal: AbortSignal | undefined;
    vi.mocked(calculateHarpPedals).mockImplementationOnce((_score, _part, requestedSignal) => {
      signal = requestedSignal;
      return new Promise((resolve) => {
        complete = resolve;
      });
    });
    const { updateScore, onClose } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Auto" }));
    expect(screen.getByRole("button", { name: "Auto" }).getAttribute("aria-busy")).toBe("true");
    expect((screen.getByRole("button", { name: "Auto" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Harp pedals" }), { key: "Escape" });
    expect(signal?.aborted).toBe(true);
    await act(async () => complete(calculateHarpPedalSolutions(fixture(), 0)));
    expect(updateScore).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("recomputes before auto-applying if the score changes while the worker runs", async () => {
    let complete!: (result: HarpPedalCalculation) => void;
    vi.mocked(calculateHarpPedals).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const callsBefore = vi.mocked(calculateHarpPedals).mock.calls.length;
    const { store, updateScore } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Auto" }));
    const changed = produce(store.getState().workingScore!, (draft) => {
      const event = draft.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
      if (event.type !== "event") throw new Error("Expected event");
      event.notes![0]!.pitch = { step: "B", alter: 2, octave: 3 };
    });
    act(() => store.getState().updateScore(changed));
    await act(async () => complete(calculateHarpPedalSolutions(fixture(), 0)));
    await waitFor(() => expect(updateScore).toHaveBeenCalledOnce());

    expect(vi.mocked(calculateHarpPedals).mock.calls.length).toBe(callsBefore + 2);
    expect(store.getState().workingScore!.parts[0]!.measures[0]!.sequences[0]!.content[0]).toMatchObject({
      notes: [{ pitch: { step: "C", alter: 1, octave: 4 } }],
    });
    expect(store.getState().workingScore!.parts[0]!.measures[0]!.harpPedals![0]!.tuning.C).toBe(1);
  });

  it("reports worker failure and leaves the document unchanged", async () => {
    vi.mocked(calculateHarpPedals).mockRejectedValueOnce(new Error("Search worker failed"));
    const { store, updateScore } = setup();
    const original = store.getState().mnxJson;
    fireEvent.click(screen.getByRole("button", { name: "Auto" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Search worker failed"));
    expect(store.getState().mnxJson).toBe(original);
    expect(updateScore).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Auto" }).getAttribute("aria-busy")).toBe("false");
  });

  it("rejects incomplete text without changing the score", () => {
    const { updateScore } = setup();
    fireEvent.change(screen.getByRole("textbox", { name: "Harp pedals" }), { target: { value: "^--|--" } });
    expect(screen.getByRole("status").textContent).toContain("seven pedal positions");
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Raise D pedal" }) as HTMLButtonElement).disabled).toBe(true);
    expect(updateScore).not.toHaveBeenCalled();
  });

  it("cancels the initial natural draft without creating a setting", () => {
    const { store, updateScore, onClose } = setup();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Harp pedals" }), { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    expect(updateScore).not.toHaveBeenCalled();
    expect(store.getState().workingScore!.parts[0]!.measures[0]!.harpPedals).toBeUndefined();
  });

  it("loads an existing setting and preserves its other presentation when edited", () => {
    const score = fixture();
    score.parts[0]!.measures[0]!.harpPedals = [
      {
        id: "original",
        position: { fraction: [0, 1] },
        tuning: { ...NATURAL_PEDALS, C: -1 },
        source: "calculated",
        display: "changes",
        placement: "between",
        staff: 2,
        manualOffset: [1, -2],
      },
    ];
    const { store } = setup(score);
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Harp pedals" }).value).toBe("-^-|----");
    fireEvent.click(screen.getByRole("button", { name: "Lower C pedal" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Harp pedals" }), { key: "Enter" });
    expect(store.getState().workingScore!.parts[0]!.measures[0]!.harpPedals).toEqual([
      expect.objectContaining({
        id: "original",
        tuning: NATURAL_PEDALS,
        source: "manual",
        display: "changes",
        placement: "between",
        staff: 2,
        manualOffset: [1, -2],
      }),
    ]);
  });

  it("removes an existing setting without deleting music", () => {
    const score = fixture();
    score.parts[0]!.measures[0]!.harpPedals = [
      { id: "original", position: { fraction: [0, 1] }, tuning: NATURAL_PEDALS },
    ];
    const { store, onClose } = setup(score);
    fireEvent.click(screen.getByRole("button", { name: "Remove setting" }));
    expect(store.getState().workingScore!.parts[0]!.measures[0]!.harpPedals).toBeUndefined();
    expect(store.getState().workingScore!.parts[0]!.measures[0]!.sequences[0]!.content[0]).toMatchObject({
      type: "event",
      id: "note",
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not overwrite a pedal setting added while the popover is open", () => {
    const { store, updateScore } = setup();
    const current = store.getState().workingScore!;
    const changed = produce(current, (draft) => {
      draft.parts[0]!.measures[0]!.harpPedals = [
        { id: "remote", position: { fraction: [0, 3] }, tuning: NATURAL_PEDALS },
      ];
    });
    act(() => store.setState({ score: changed, workingScore: changed }));
    expect(screen.getByRole("status").textContent).toContain("changed");
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true);
    expect(updateScore).not.toHaveBeenCalled();
  });

  it("keeps the draft open if a conflicting edit arrives just before submission", () => {
    const { store, updateScore, onClose } = setup();
    const apply = screen.getByRole("button", { name: "Apply" });
    const changed = produce(store.getState().workingScore!, (draft) => {
      draft.parts[0]!.measures[0]!.harpPedals = [
        { id: "remote", position: { fraction: [0, 1] }, tuning: NATURAL_PEDALS },
      ];
    });
    act(() => {
      store.setState({ score: changed, workingScore: changed });
      fireEvent.click(apply);
    });
    expect(toast.error).toHaveBeenCalledWith("This pedal setting has changed. Close and reopen it.");
    expect(onClose).not.toHaveBeenCalled();
    expect(updateScore).not.toHaveBeenCalled();
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Harp pedals" }).value).toBe("---|----");
  });

  it("serializes and synchronizes one edit with undo and redo", async () => {
    const { store } = setup();
    const original = store.getState().mnxJson;
    const bridge = new MnxYjsBridge();
    bridge.setMnxJson(original);
    const history = createHistoryStore(original, {
      current: (json) => store.getState().loadScore(parseMnx(JSON.parse(json)), undefined, json, true),
    });
    const unsubscribe = store.subscribe((state, previous) => {
      if (state.mnxJson !== previous.mnxJson) bridge.setMnxJson(state.mnxJson);
    });
    renderHook(() => useMnxChangeReporter({ store, pushState: history.getState().pushState }));
    try {
      fireEvent.change(screen.getByRole("textbox", { name: "Harp pedals" }), { target: { value: "^--|--v^" } });
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));
      await waitFor(() => expect(history.getState().canUndo).toBe(true));

      const edited = store.getState().mnxJson;
      expect(validateRawScore(JSON.parse(edited)).ok).toBe(true);
      expect(parseMnx(JSON.parse(bridge.getMnxJson())).parts[0]!.measures[0]!.harpPedals).toEqual(
        parseMnx(JSON.parse(edited)).parts[0]!.measures[0]!.harpPedals,
      );
      expect(history.getState().entries).toHaveLength(2);
      act(() => history.getState().undo());
      expect(store.getState().workingScore!.parts[0]!.measures[0]!.harpPedals).toBeUndefined();
      expect(JSON.parse(bridge.getMnxJson())).toEqual(JSON.parse(original));
      act(() => history.getState().redo());
      expect(serializeMnx(store.getState().workingScore!)).toEqual(JSON.parse(edited));
      expect(JSON.parse(bridge.getMnxJson())).toEqual(JSON.parse(edited));
    } finally {
      unsubscribe();
      bridge.doc.destroy();
    }
  });
});
