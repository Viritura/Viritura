import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Part } from "@viritura/core";
import { TooltipPrimitives } from "@viritura/ui";
import { RosterPartRow } from "./RosterPartRow";
import type { PartUpdate } from "./transposition";

afterEach(cleanup);

const PART: Part = { id: "piano", name: "Piano", measures: [] };

function row(part: Part, onUpdate?: (partId: string, updates: PartUpdate) => void) {
  return (
    <TooltipPrimitives.Provider>
      <RosterPartRow part={part} expanded canRemove={false} onToggle={() => {}} onUpdate={onUpdate} />
    </TooltipPrimitives.Provider>
  );
}

describe("roster source chord-symbol visibility", () => {
  it.each([
    [undefined, "Automatic"],
    ["auto", "Automatic"],
    ["show", "Show"],
    ["hide", "Hide"],
  ] as const)("displays the %s source policy", (chordSymbolVisibility, label) => {
    render(row({ ...PART, chordSymbolVisibility }, vi.fn()));
    expect(screen.getByRole("combobox", { name: "Chord symbols" }).textContent).toBe(label);
  });

  it.each([
    ["Automatic", "auto"],
    ["Show", "show"],
    ["Hide", "hide"],
  ] as const)("updates only the Part policy to %s", async (label, value) => {
    const onUpdate = vi.fn();
    const user = userEvent.setup();
    const part: Part = { ...PART, chordSymbolVisibility: value === "hide" ? "show" : "hide" };
    render(row(part, onUpdate));
    await user.click(screen.getByRole("combobox", { name: "Chord symbols" }));
    await user.click(screen.getByRole("option", { name: label, exact: true }));
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith("piano", { chordSymbolVisibility: value });
    expect(part.chordSymbolVisibility).toBe(value === "hide" ? "show" : "hide");
  });

  it("follows external policy updates without stale edit buffers", () => {
    const onUpdate = vi.fn();
    const { rerender } = render(row(PART, onUpdate));
    rerender(row({ ...PART, chordSymbolVisibility: "hide" }, onUpdate));
    expect(screen.getByRole("combobox", { name: "Chord symbols" }).textContent).toBe("Hide");
    rerender(row(PART, onUpdate));
    expect(screen.getByRole("combobox", { name: "Chord symbols" }).textContent).toBe("Automatic");
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("disables edits without a callback or stable source ID", () => {
    const { rerender } = render(row(PART));
    expect(screen.getByRole("combobox", { name: "Chord symbols" }).hasAttribute("disabled")).toBe(true);
    rerender(row({ name: "Piano", measures: [] }, vi.fn()));
    expect(screen.getByRole("combobox", { name: "Chord symbols" }).hasAttribute("disabled")).toBe(true);
  });
});
