import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InstrumentPickerDialog } from "../components/parts/InstrumentPickerDialog";

afterEach(cleanup);

describe("InstrumentPickerDialog", () => {
  it("presents the add-instrument catalog as a dialog", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <InstrumentPickerDialog
        mode="add"
        open
        onClose={onClose}
        onSelect={vi.fn()}
        pendingInstrumentId={null}
        pendingInstrumentName={null}
        conductorScores={[]}
        targetLayoutIds={new Set()}
        onToggleTarget={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Add instrument" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Search instruments…" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Add instrument" }) as HTMLButtonElement).disabled).toBe(true);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps score inclusion inside the add dialog", async () => {
    const user = userEvent.setup();
    const onToggleTarget = vi.fn();
    const onConfirm = vi.fn();
    render(
      <InstrumentPickerDialog
        mode="add"
        open
        onClose={vi.fn()}
        onSelect={vi.fn()}
        pendingInstrumentId="piccolo"
        pendingInstrumentName="Piccolo"
        conductorScores={[{ index: 0, name: "Full Score", layoutId: "full", staffCount: 12 }]}
        targetLayoutIds={new Set(["full"])}
        onToggleTarget={onToggleTarget}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByRole("heading", { name: "Add instrument" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Search instruments…" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Full Score" })).toBeTruthy();

    await user.click(screen.getByRole("checkbox", { name: "Full Score" }));
    expect(onToggleTarget).toHaveBeenCalledWith("full");
    await user.click(screen.getByRole("button", { name: "Add instrument" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
