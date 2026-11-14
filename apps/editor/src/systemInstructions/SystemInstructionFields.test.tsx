import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { SystemText } from "@viritura/core";
import { TooltipPrimitives } from "@viritura/ui";
import { SystemInstructionFields } from "./SystemInstructionFields";

afterEach(cleanup);

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
