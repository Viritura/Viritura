import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LayoutContent } from "@viritura/core";
import { InstrumentNameDisplayControl } from "../components/parts/InstrumentNameDisplayControl";

afterEach(cleanup);

describe("InstrumentNameDisplayControl", () => {
  it("distinguishes label display policy from label content editing", () => {
    const content: LayoutContent[] = [{ type: "staff", sources: [{ part: "fl", labelref: "name" }] }];
    render(<InstrumentNameDisplayControl content={content} onChange={vi.fn()} />);

    expect(screen.getByRole("combobox", { name: "Instrument label display" }).textContent).toContain(
      "First full, then short",
    );
    expect(screen.getByText("Full and short label text is edited in Instruments.")).toBeTruthy();
  });

  it("reports a selected standard-MNX display policy", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const content: LayoutContent[] = [{ type: "staff", sources: [{ part: "fl", labelref: "name" }] }];
    render(<InstrumentNameDisplayControl content={content} onChange={onChange} />);

    await user.click(screen.getByRole("combobox", { name: "Instrument label display" }));
    await user.click(screen.getByRole("option", { name: "Hidden" }));

    expect(onChange).toHaveBeenCalledWith("hidden");
  });
});
