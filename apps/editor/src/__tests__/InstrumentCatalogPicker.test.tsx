import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipPrimitives } from "@viritura/ui";
import { InstrumentCatalogPicker } from "../components/parts/InstrumentCatalogPicker";

afterEach(cleanup);

describe("InstrumentCatalogPicker compatibility", () => {
  it("annotates blocked choices and routes them to the safe alternative handler", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onBlockedSelect = vi.fn();
    render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <InstrumentCatalogPicker
          onSelect={onSelect}
          onBlockedSelect={onBlockedSelect}
          compatibility={(instrument) =>
            instrument.id === "piano"
              ? { status: "blocked", message: "Different staff count" }
              : { status: "compatible", message: "Music is preserved" }
          }
        />
      </TooltipPrimitives.Provider>,
    );

    await user.type(screen.getByPlaceholderText("Search instruments…"), "piano");
    const piano = screen.getByRole("button", { name: /Piano/ });
    expect(piano.getAttribute("aria-disabled")).toBe("true");
    expect(screen.queryByText("Add instead")).not.toBeNull();
    await user.click(piano);
    expect(onBlockedSelect).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
