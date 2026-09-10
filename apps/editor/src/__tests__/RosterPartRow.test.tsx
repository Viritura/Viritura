import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

describe("RosterPartRow actions", () => {
  it("groups change and remove as explicit instrument actions", async () => {
    const onChangeInstrument = vi.fn();
    const onRemove = vi.fn();
    const user = userEvent.setup();
    render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <RosterPartRow
          part={PART}
          expanded
          canRemove
          onToggle={() => {}}
          onChangeInstrument={onChangeInstrument}
          onRemove={onRemove}
        />
      </TooltipPrimitives.Provider>,
    );

    const actions = screen.getByRole("region", { name: "Actions for Flute" });
    expect(actions).toBeTruthy();
    expect(screen.getByRole("region", { name: "Transposition" })).toBeTruthy();
    expect(screen.getByText("Concert pitch")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Change instrument" }));
    await user.click(screen.getByRole("button", { name: "Remove instrument" }));

    expect(onChangeInstrument).toHaveBeenCalledWith("flute");
    expect(onRemove).toHaveBeenCalledWith("flute");
  });
});
