import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { SystemText } from "@viritura/core";
import { TooltipPrimitives } from "@viritura/ui";
import { SystemInstructionDialog } from "./SystemInstructionDialog";

afterEach(cleanup);

it("shares tempo controls with system text without inferring BPM or losing presentation", async () => {
  const user = userEvent.setup();
  const submit = vi.fn();
  const instruction: SystemText = {
    id: "shared",
    text: [{ text: "Allegro", style: { weight: "bold" } }],
    position: { fraction: [1, 2] },
    placement: "below",
    manualOffset: [2, -1],
    avoidCollisions: false,
    frame: { border: "solid", padding: 0.5 },
  };
  render(
    <TooltipPrimitives.Provider>
      <SystemInstructionDialog initialInstruction={instruction} onSubmit={submit} onClose={vi.fn()} />
    </TooltipPrimitives.Provider>,
  );
  expect(screen.queryByRole("spinbutton", { name: "BPM" })).toBeNull();
  await user.click(screen.getByRole("checkbox", { name: "Set tempo" }));
  expect((screen.getByRole("spinbutton", { name: "BPM" }) as HTMLInputElement).value).toBe("120");
  await user.click(screen.getByRole("checkbox", { name: "Set tempo" }));
  expect(screen.queryByRole("spinbutton", { name: "BPM" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "OK", exact: true }));
  expect(submit).toHaveBeenCalledWith(instruction);
});
