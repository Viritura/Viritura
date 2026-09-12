/** Setup-mode ensemble coverage; opening score details now live in New Project. */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipPrimitives } from "@viritura/ui";
import { EnsemblePicker } from "../components/modes/setup/EnsemblePicker";

afterEach(cleanup);

describe("Setup mode — ensemble picker", () => {
  it("groups templates by ensemble category", () => {
    render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <EnsemblePicker onSelect={vi.fn()} />
      </TooltipPrimitives.Provider>,
    );

    for (const label of ["Solo", "Chamber Ensembles", "Vocal Ensembles", "Jazz", "Orchestras & Bands"]) {
      expect(screen.queryByText(label)).not.toBeNull();
    }
  });

  it("reports the chosen template id so a whole ensemble can be added at once", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <EnsemblePicker onSelect={onSelect} />
      </TooltipPrimitives.Provider>,
    );

    await user.click(screen.getByText("String Quartet"));
    expect(onSelect).toHaveBeenCalledWith("string-quartet");
  });
});
