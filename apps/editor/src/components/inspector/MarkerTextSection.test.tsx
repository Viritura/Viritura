import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MarkerText } from "@viritura/core";
import { MarkerTextSection } from "./MarkerTextSection";

describe("MarkerTextSection", () => {
  afterEach(cleanup);

  it("moves jump text before the generated label and removes it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(value: MarkerText | null) => void>();
    render(
      <MarkerTextSection
        kind="jump"
        value={{ content: [{ text: "Return to the segno" }], placement: "after" }}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Jump text position" }));
    await user.click(screen.getByRole("option", { name: "Before label" }));
    expect(onChange).toHaveBeenLastCalledWith({
      content: [{ text: "Return to the segno" }],
      placement: "before",
    });

    await user.click(screen.getByRole("button", { name: "Remove text" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("adds jump text after the generated label by default", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(value: MarkerText | null) => void>();
    render(<MarkerTextSection kind="jump" value={null} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Add text" }));
    expect(onChange).toHaveBeenCalledWith({ content: [{ text: "" }], placement: "after" });
  });

  it("adds coda text before the symbol by default", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(value: MarkerText | null) => void>();
    render(<MarkerTextSection kind="coda" value={null} onChange={onChange} />);

    expect(screen.getByText("Coda Text")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Add text" }));
    expect(onChange).toHaveBeenCalledWith({ content: [{ text: "" }], placement: "before" });
  });
});
