import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipPrimitives } from "@viritura/ui";
import { BreakManagement } from "./BreakManagement";

afterEach(cleanup);

describe("BreakManagement", () => {
  it("uses the shared panel-header hierarchy and concise actions", () => {
    render(
      <TooltipPrimitives.Provider>
        <BreakManagement
          selectedBreakKind={null}
          hasLayoutOverrides
          onRemoveSelectedBreak={vi.fn()}
          onResetAll={vi.fn()}
        />
      </TooltipPrimitives.Provider>,
    );

    expect(screen.getByText("Forced breaks")).toBeTruthy();
    expect(screen.getByText("Select a barline or break marker to manage a forced break.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Remove" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Reset all" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
