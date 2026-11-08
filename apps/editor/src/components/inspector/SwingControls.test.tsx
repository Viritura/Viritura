import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Swing } from "@viritura/core";
import { SwingControls } from "./SwingControls";

afterEach(cleanup);

describe("tempo swing controls", () => {
  it("exposes inherit, straight and explicit application swing without inferring source certainty", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(swing: Swing | undefined) => void>();
    render(<SwingControls onChange={onChange} />);
    expect(screen.getByText(/Effective: Straight/)).toBeTruthy();
    await user.click(screen.getByRole("radio", { name: "Swing", exact: true }));
    expect(onChange).toHaveBeenLastCalledWith({ mode: "swing", subdivision: "eighth", ratio: [3, 2] });
    await user.click(screen.getByRole("radio", { name: "Straight", exact: true }));
    expect(onChange).toHaveBeenLastCalledWith({ mode: "straight" });
    await user.click(screen.getByRole("radio", { name: "Inherit" }));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it("shows inherited setting and source, supports 16ths, exact triplets and custom ratios", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(swing: Swing | undefined) => void>();
    const swing: Swing = { mode: "swing", subdivision: "eighth", ratio: [3, 2] };
    render(
      <SwingControls
        swing={swing}
        effective={{ swing, source: { measureIndex: 3, tempoIndex: 1 } }}
        onChange={onChange}
      />,
    );
    expect(screen.getByText(/measure 4, tempo 2/)).toBeTruthy();
    expect(screen.getByText(/application preset/)).toBeTruthy();
    await user.click(screen.getByRole("radio", { name: "Sixteenth" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...swing, subdivision: "16th" });
    await user.click(screen.getByRole("button", { name: "Triplet (2:1)" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...swing, ratio: [2, 1] });
    const custom = screen.getByRole("textbox", { name: "Custom long:short ratio" });
    await user.clear(custom);
    await user.type(custom, "7:4");
    await user.tab();
    expect(onChange).toHaveBeenLastCalledWith({ ...swing, ratio: [7, 4] });
    onChange.mockClear();
    await user.clear(custom);
    await user.type(custom, "0:2");
    await user.tab();
    expect(screen.getByRole("alert").textContent).toContain("positive safe integers");
    expect(onChange).not.toHaveBeenCalled();
  });
});
