import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Part } from "@viritura/core";
import { TooltipPrimitives } from "@viritura/ui";
import { RosterPartRow } from "../components/parts/roster/RosterPartRow";

afterEach(cleanup);

const PART: Part = {
  id: "flute",
  name: "Flute",
  measures: [],
};

describe("RosterPartRow", () => {
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
    expect(screen.getByText("Concert pitch")).toBeTruthy();
    expect(screen.queryByText("Change instrument")).toBeNull();
    expect(screen.queryByText("Remove instrument")).toBeNull();
    expect(onContextMenu).toHaveBeenCalledTimes(2);
  });
});
