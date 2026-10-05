import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Part } from "@viritura/core";
import { TooltipPrimitives } from "@viritura/ui";
import { RosterPartRow } from "../components/parts/roster/RosterPartRow";

afterEach(cleanup);

const PART: Part = {
  id: "wind.flutes.flute",
  name: "Flute",
  measures: [],
};

describe("RosterPartRow", () => {
  it("summarizes catalog-default tuning and reveals optional customization", () => {
    render(
      <TooltipPrimitives.Provider>
        <RosterPartRow
          part={{ ...PART, _x: { viritura: { instrumentId: "wind.flutes.flute" } } }}
          expanded
          onToggle={() => {}}
        />
      </TooltipPrimitives.Provider>,
    );
    expect(screen.getByText("Written C4 sounds as C4.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Customize tuning" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("combobox", { name: "Sounding pitch" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Customize tuning" }));
    expect(screen.getByRole("combobox", { name: "Sounding pitch" })).toBeTruthy();
  });

  it("opens customization automatically for a non-default starting tuning", () => {
    render(
      <TooltipPrimitives.Provider>
        <RosterPartRow
          part={{
            ...PART,
            _x: { viritura: { instrumentId: "wind.flutes.flute" } },
            transposition: { interval: { halfSteps: 2, staffDistance: 1 } },
          }}
          expanded
          onToggle={() => {}}
        />
      </TooltipPrimitives.Provider>,
    );
    expect(screen.getByRole("button", { name: "Customize tuning" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("combobox", { name: "Sounding pitch" }).textContent).toBe("B♭");
  });

  it("keeps editable properties in the expanded row without command actions", () => {
    const onContextMenu = vi.fn();
    render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <RosterPartRow
          part={PART}
          expanded
          onToggle={() => {}}
          onContextMenu={onContextMenu}
          onOpenMenu={onContextMenu}
        />
      </TooltipPrimitives.Provider>,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: "Flute" }));
    fireEvent.click(screen.getByRole("button", { name: "Instrument actions for Flute" }));
    expect(screen.getByRole("region", { name: "Transposition" })).toBeTruthy();
    expect(screen.getByText("Written C4 sounds as C4")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Transposition preset" }).textContent).toBe("Concert pitch — C4");
    expect(screen.getByRole("combobox", { name: "Sounding pitch" }).textContent).toBe("C");
    expect((screen.getByRole("spinbutton", { name: "Sounding octave" }) as HTMLInputElement).value).toBe("4");
    expect(screen.queryByLabelText("Chromatic")).toBeNull();
    expect(screen.queryByLabelText("Staff distance")).toBeNull();
    expect(screen.queryByText("Change instrument")).toBeNull();
    expect(screen.queryByText("Remove instrument")).toBeNull();
    expect(onContextMenu).toHaveBeenCalledTimes(2);
  });
});
