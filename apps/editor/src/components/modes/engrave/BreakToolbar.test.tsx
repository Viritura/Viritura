import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TooltipPrimitives } from "@viritura/ui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BreakToolbar } from "./BreakToolbar";

function renderToolbar(kind: "system" | "page" | null, selected = true) {
  const onSetKind = vi.fn();
  render(
    <TooltipPrimitives.Provider delayDuration={0}>
      <BreakToolbar selected={selected} kind={kind} onSetKind={onSetKind} />
    </TooltipPrimitives.Provider>,
  );
  return { onSetKind };
}

afterEach(cleanup);

describe("BreakToolbar", () => {
  it("disables all actions until a barline is selected", () => {
    renderToolbar(null, false);

    expect((screen.getByRole("button", { name: "System break" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Page break" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("sets and reflects the selected break kind", () => {
    const { onSetKind } = renderToolbar("system");
    const system = screen.getByRole("button", { name: "System break" });
    const page = screen.getByRole("button", { name: "Page break" });

    expect(system.getAttribute("aria-pressed")).toBe("true");
    expect(page.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(page);
    expect(onSetKind).toHaveBeenCalledWith("page");
  });
});
