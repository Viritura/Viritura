import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipPrimitives } from "@viritura/ui";
import type { Swing } from "@viritura/core";
import { SwingControls } from "./SwingControls";

afterEach(cleanup);

const SWING: Swing = { mode: "swing", subdivision: "eighth", ratio: [3, 2] };

function controls(swing: Swing | undefined, onChange: (swing: Swing | undefined) => void) {
  return (
    <TooltipPrimitives.Provider delayDuration={0}>
      <SwingControls swing={swing} onChange={onChange} />
    </TooltipPrimitives.Provider>
  );
}

describe("tempo swing controls", () => {
  it("exposes inherit, straight and explicit application swing without inferring source certainty", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(swing: Swing | undefined) => void>();
    render(controls(undefined, onChange));
    expect(screen.getByText(/Inherited: Straight/)).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Ratio" })).toBeNull();
    await user.click(screen.getByRole("radio", { name: "Swing", exact: true }));
    expect(onChange).toHaveBeenLastCalledWith(SWING);
    await user.click(screen.getByRole("radio", { name: "Straight", exact: true }));
    expect(onChange).toHaveBeenLastCalledWith({ mode: "straight" });
    await user.click(screen.getByRole("radio", { name: "Inherit" }));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it("shows inherited setting and source only in Inherit mode and associates the hint with the control", () => {
    render(
      <SwingControls
        effective={{
          swing: { mode: "swing", subdivision: "16th", ratio: [3, 2] },
          source: { measureIndex: 3, tempoIndex: 1 },
        }}
        onChange={vi.fn()}
      />,
    );
    const group = screen.getByRole("radiogroup", { name: "Rhythm" });
    const description = document.getElementById(group.getAttribute("aria-describedby")!);
    expect(description?.textContent).toContain("Inherited: Swing sixteenths 3:2 (bar 4)");
  });

  it("keeps presets compact and exposes exact custom ratio editing only when requested", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(swing: Swing | undefined) => void>();
    render(controls(SWING, onChange));
    expect(screen.queryByText(/Inherited:/)).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Custom ratio" })).toBeNull();
    expect(screen.queryByText(/not an inferred source ratio/)).toBeNull();
    await user.click(screen.getByRole("radio", { name: "Sixteenth" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...SWING, subdivision: "16th" });
    await user.click(screen.getByRole("combobox", { name: "Ratio" }));
    await user.click(screen.getByRole("option", { name: "2:1 (triplet)" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...SWING, ratio: [2, 1] });

    onChange.mockClear();
    await user.click(screen.getByRole("combobox", { name: "Ratio" }));
    await user.click(screen.getByRole("option", { name: "Custom" }));
    expect(onChange).not.toHaveBeenCalled();
    const custom = screen.getByRole("textbox", { name: "Custom ratio" });
    expect((custom as HTMLInputElement).value).toBe("3:2");
    await user.clear(custom);
    await user.type(custom, "7:4");
    await user.tab();
    expect(onChange).toHaveBeenLastCalledWith({ ...SWING, ratio: [7, 4] });
    onChange.mockClear();
    await user.clear(custom);
    await user.type(custom, "0:2");
    await user.tab();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("positive safe integers");
    expect(custom.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(custom.getAttribute("aria-describedby")!)?.contains(alert)).toBe(true);
    expect(onChange).not.toHaveBeenCalled();

    await user.click(screen.getByRole("combobox", { name: "Ratio" }));
    await user.click(screen.getByRole("option", { name: "3:2 (60%)" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Custom ratio" })).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith(SWING);
  });

  it("shows existing non-preset ratios exactly and follows external updates without normalizing them", () => {
    const onChange = vi.fn<(swing: Swing | undefined) => void>();
    const { rerender } = render(controls({ ...SWING, ratio: [6, 4] }, onChange));
    expect((screen.getByRole("textbox", { name: "Custom ratio" }) as HTMLInputElement).value).toBe("6:4");
    expect(onChange).not.toHaveBeenCalled();
    rerender(controls({ ...SWING, ratio: [7, 3] }, onChange));
    expect((screen.getByRole("textbox", { name: "Custom ratio" }) as HTMLInputElement).value).toBe("7:3");
    rerender(controls({ ...SWING, ratio: [2, 1] }, onChange));
    expect(screen.queryByRole("textbox", { name: "Custom ratio" })).toBeNull();
    expect(screen.getByRole("combobox", { name: "Ratio" }).textContent).toContain("2:1");
  });

  it("keeps preset provenance available through the shared contextual help pattern", async () => {
    const user = userEvent.setup();
    render(controls(SWING, vi.fn()));
    await user.hover(screen.getByRole("button", { name: "About swing ratios" }));
    expect((await screen.findByRole("tooltip")).textContent).toContain("not an inferred source ratio");
  });
});
