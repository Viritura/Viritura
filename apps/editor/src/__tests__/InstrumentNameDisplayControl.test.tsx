import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LayoutContent, ScoreDefinition } from "@viritura/core";
import { InstrumentNameDisplayControl } from "../components/parts/InstrumentNameDisplayControl";

afterEach(cleanup);

describe("InstrumentNameDisplayControl", () => {
  const score: ScoreDefinition = { name: "Full Score" };

  it("distinguishes label display policy from label content editing", () => {
    const content: LayoutContent[] = [{ type: "staff", sources: [{ part: "fl", labelref: "name" }] }];
    render(<InstrumentNameDisplayControl content={content} score={score} onChange={vi.fn()} />);

    expect(screen.getByRole("combobox", { name: "First system instrument labels" }).textContent).toContain("Full");
    expect(screen.getByRole("combobox", { name: "Subsequent systems instrument labels" }).textContent).toContain(
      "Short",
    );
    expect(screen.getByText("Full and short label text is edited in Instruments.")).toBeTruthy();
  });

  it("reports independent first-system changes while retaining the subsequent-system policy", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const content: LayoutContent[] = [{ type: "staff", sources: [{ part: "fl", labelref: "name" }] }];
    render(<InstrumentNameDisplayControl content={content} score={score} onChange={onChange} />);

    await user.click(screen.getByRole("combobox", { name: "First system instrument labels" }));
    await user.click(screen.getByRole("option", { name: "Hidden" }));

    expect(onChange).toHaveBeenCalledWith({ firstSystem: "hidden", subsequentSystems: "short" });
  });
});
