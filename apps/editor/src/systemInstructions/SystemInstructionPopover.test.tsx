import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { SystemText } from "@viritura/core";
import { SystemInstructionPopover } from "./SystemInstructionPopover";

afterEach(cleanup);

it.each([
  { input: "Freely", text: "Freely", tempo: undefined },
  { input: "Allegro q=180", text: "Allegro", tempo: { bpm: 180, value: { base: "quarter" } } },
])("submits $input from a focused text-only popover", async ({ input, text, tempo }) => {
  const user = userEvent.setup();
  const submit = vi.fn();
  const close = vi.fn();
  const instruction: SystemText = {
    id: "new",
    text: [{ text: "" }],
    position: { fraction: [1, 2] },
    placement: "above",
  };
  render(
    <SystemInstructionPopover
      instruction={instruction}
      position={{ x: 100, y: 100 }}
      onSubmit={submit}
      onClose={close}
    />,
  );
  const textbox = screen.getByRole("textbox");
  expect(document.activeElement).toBe(textbox);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("spinbutton")).toBeNull();
  expect(screen.queryByRole("checkbox")).toBeNull();
  await user.keyboard(`${input}{Enter}`);
  expect(submit).toHaveBeenCalledWith({ ...instruction, text: [{ text }], ...(tempo ? { tempo } : {}) });
  expect(close).toHaveBeenCalledOnce();
});

it("keeps invalid explicit BPM in the popover and shows an error instead of silently treating it as prose", async () => {
  const user = userEvent.setup();
  const submit = vi.fn();
  const close = vi.fn();
  render(
    <SystemInstructionPopover
      instruction={{ id: "new", text: [{ text: "" }], position: { fraction: [0, 1] } }}
      position={{ x: 100, y: 100 }}
      onSubmit={submit}
      onClose={close}
    />,
  );
  await user.keyboard("q=0{Enter}");
  expect(screen.getByRole("alert").textContent).toContain("BPM greater than zero");
  expect(submit).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  await user.keyboard("{Escape}");
  expect(close).toHaveBeenCalledOnce();
});
