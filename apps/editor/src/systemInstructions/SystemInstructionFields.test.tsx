import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { SystemText } from "@viritura/core";
import { TooltipPrimitives } from "@viritura/ui";
import { SystemInstructionFields } from "./SystemInstructionFields";

afterEach(cleanup);

it("applies a validated denominator-based grouping atomically and can switch it to no clicks", async () => {
  const user = userEvent.setup();
  const instruction: SystemText = {
    id: "group",
    text: [{ text: "2+3" }],
    position: { fraction: [0, 1] },
  };
  const change = vi.fn<(instruction: SystemText) => void>();
  const { rerender } = render(
    <TooltipPrimitives.Provider>
      <SystemInstructionFields instruction={instruction} timeSignature={{ count: 6, unit: 8 }} onChange={change} />
    </TooltipPrimitives.Provider>,
  );
  await user.type(screen.getByRole("textbox", { name: "Click grouping" }), "3+3+2+2+2");
  await user.click(screen.getByRole("button", { name: "Apply click grouping" }));
  expect(screen.getByRole("alert").textContent).toContain("sum to 6");
  expect(change).not.toHaveBeenCalled();
  await user.click(screen.getByRole("combobox", { name: "Click grid division" }));
  await user.click(screen.getByRole("option", { name: "2", exact: true }));
  expect(change).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Apply click grouping" }));
  const grouped = { ...instruction, tempo: { clickSubdivision: 2 as const, clickGrouping: [3, 3, 2, 2, 2] } };
  expect(change).toHaveBeenLastCalledWith(grouped);
  rerender(
    <TooltipPrimitives.Provider>
      <SystemInstructionFields instruction={grouped} timeSignature={{ count: 6, unit: 8 }} onChange={change} />
    </TooltipPrimitives.Provider>,
  );
  await user.click(screen.getByRole("combobox", { name: "Click grid division" }));
  await user.click(screen.getByRole("option", { name: "No clicks (free time)" }));
  expect(change).toHaveBeenLastCalledWith({ ...instruction, tempo: { clickSubdivision: 0 } });
  rerender(
    <TooltipPrimitives.Provider>
      <SystemInstructionFields instruction={{ ...instruction, tempo: { clickSubdivision: 0 } }} onChange={change} />
    </TooltipPrimitives.Provider>,
  );
  expect(screen.getByRole("combobox", { name: "Clicks per beat" }).textContent).toContain("No clicks");
});

it("sets and clears click-only subdivisions without fabricating BPM", async () => {
  const user = userEvent.setup();
  const instruction: SystemText = {
    id: "click",
    text: [{ text: "Click triplets" }],
    position: { fraction: [1, 8] },
  };
  const change = vi.fn<(instruction: SystemText) => void>();
  const { rerender } = render(
    <TooltipPrimitives.Provider>
      <SystemInstructionFields instruction={instruction} onChange={change} />
    </TooltipPrimitives.Provider>,
  );
  await user.click(screen.getByRole("combobox", { name: "Clicks per beat" }));
  await user.click(screen.getByRole("option", { name: "3", exact: true }));
  expect(change).toHaveBeenLastCalledWith({ ...instruction, tempo: { clickSubdivision: 3 } });
  rerender(
    <TooltipPrimitives.Provider>
      <SystemInstructionFields instruction={{ ...instruction, tempo: { clickSubdivision: 3 } }} onChange={change} />
    </TooltipPrimitives.Provider>,
  );
  expect(screen.queryByRole("spinbutton", { name: "BPM" })).toBeNull();
  await user.click(screen.getByRole("combobox", { name: "Clicks per beat" }));
  await user.click(screen.getByRole("option", { name: "1", exact: true }));
  expect(change).toHaveBeenLastCalledWith({ ...instruction, tempo: { clickSubdivision: 1 } });
  await user.click(screen.getByRole("combobox", { name: "Clicks per beat" }));
  await user.click(screen.getByRole("option", { name: "Follow tempo" }));
  expect(change).toHaveBeenLastCalledWith({ ...instruction, tempo: undefined });
});

it("stores one click per beat on a tempo by omission and offers no follow option", async () => {
  const user = userEvent.setup();
  const instruction: SystemText = {
    id: "tempo",
    text: [{ text: "Allegro" }],
    position: { fraction: [0, 1] },
    tempo: { bpm: 120, value: { base: "quarter" }, clickSubdivision: 3 },
  };
  const change = vi.fn<(instruction: SystemText) => void>();
  render(
    <TooltipPrimitives.Provider>
      <SystemInstructionFields instruction={instruction} onChange={change} />
    </TooltipPrimitives.Provider>,
  );
  await user.click(screen.getByRole("combobox", { name: "Clicks per beat" }));
  expect(screen.queryByRole("option", { name: "Follow tempo" })).toBeNull();
  await user.click(screen.getByRole("option", { name: "1", exact: true }));
  expect(change).toHaveBeenLastCalledWith({
    ...instruction,
    tempo: { bpm: 120, value: { base: "quarter" }, clickSubdivision: undefined },
  });
});

it("shares tempo controls with system text without inferring BPM or losing presentation", async () => {
  const user = userEvent.setup();
  const change = vi.fn<(instruction: SystemText) => void>();
  const instruction: SystemText = {
    id: "shared",
    text: [{ text: "Allegro", style: { weight: "bold" } }],
    position: { fraction: [1, 2] },
    placement: "below",
    manualOffset: [2, -1],
    avoidCollisions: false,
    frame: { border: "solid", padding: 0.5 },
  };
  const { rerender } = render(
    <TooltipPrimitives.Provider>
      <SystemInstructionFields instruction={instruction} onChange={change} />
    </TooltipPrimitives.Provider>,
  );
  expect(screen.queryByRole("spinbutton", { name: "BPM" })).toBeNull();
  await user.click(screen.getByRole("checkbox", { name: "Set tempo" }));
  const withTempo = change.mock.calls[0]![0];
  expect(withTempo).toEqual({ ...instruction, tempo: { bpm: 120, value: { base: "quarter" } } });
  rerender(
    <TooltipPrimitives.Provider>
      <SystemInstructionFields instruction={withTempo} onChange={change} />
    </TooltipPrimitives.Provider>,
  );
  expect((screen.getByRole("spinbutton", { name: "BPM" }) as HTMLInputElement).value).toBe("120");
  await user.click(screen.getByRole("checkbox", { name: "Set tempo" }));
  expect(change).toHaveBeenLastCalledWith(instruction);
});
