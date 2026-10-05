import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipPrimitives } from "@viritura/ui";
import { InstrumentCatalogPicker } from "../components/parts/InstrumentCatalogPicker";

afterEach(cleanup);

describe("InstrumentCatalogPicker compatibility", () => {
  it("offers one default-first trumpet in family browsing and tuning-name searches", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <TooltipPrimitives.Provider>
        <InstrumentCatalogPicker
          onSelect={onSelect}
          initiallyExpanded={["brass"]}
          selectedInstrumentId="brass.trumpet.c"
        />
      </TooltipPrimitives.Provider>,
    );
    expect(screen.getAllByText("Trumpet")).toHaveLength(1);
    expect(screen.queryByText("Trumpet in C")).toBeNull();
    expect(screen.queryByText("Trumpet in B♭")).toBeNull();
    expect(screen.getByText("Horn")).toBeTruthy();
    expect(screen.getByText("Cornet")).toBeTruthy();
    const trumpet = screen.getByRole("button", { name: /Trumpet/ });
    expect(trumpet.getAttribute("aria-pressed")).toBe("true");
    await user.type(screen.getByPlaceholderText("Search instruments…"), "Trumpet in C");
    expect(screen.getAllByText("Trumpet")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: /Trumpet/ }));
    expect(onSelect.mock.calls[0]![0]).toMatchObject({
      id: "brass.trumpet.bflat",
      transposition: { halfSteps: 2, staffDistance: 1 },
    });
  });

  it("groups clarinet tunings without merging register-distinct instruments", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <TooltipPrimitives.Provider>
        <InstrumentCatalogPicker onSelect={onSelect} />
      </TooltipPrimitives.Provider>,
    );
    const search = screen.getByPlaceholderText("Search instruments…");
    await user.type(search, "clarinet");
    expect(screen.getAllByText("Clarinet")).toHaveLength(1);
    expect(screen.getByText("Piccolo Clarinet")).toBeTruthy();
    expect(screen.getByText("Bass Clarinet")).toBeTruthy();
    expect(screen.queryByText("Clarinet in A")).toBeNull();
    await user.clear(search);
    await user.type(search, "Clarinet in A");
    await user.click(screen.getByRole("button", { name: /^Clarinet$/ }));
    expect(onSelect.mock.calls[0]![0].id).toBe("wind.reed.clarinet.bflat");
  });

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
            instrument.id === "keyboard.piano"
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
