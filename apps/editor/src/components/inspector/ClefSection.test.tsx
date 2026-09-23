// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClefSection } from "./ClefSection";

afterEach(() => {
  cleanup();
});

describe("ClefSection", () => {
  it("renders the hide-clef toggle and reports checked changes", async () => {
    const user = userEvent.setup();
    const onHiddenChange = vi.fn();

    render(<ClefSection focusedSection={null} hidden={false} onHiddenChange={onHiddenChange} />);

    const checkbox = screen.getByRole("checkbox", { name: "Hide clef" }) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    await user.click(checkbox);

    expect(onHiddenChange).toHaveBeenCalledWith(true);
  });

  it("reflects the current hidden state", () => {
    render(<ClefSection focusedSection={null} hidden onHiddenChange={vi.fn()} />);

    expect((screen.getByRole("checkbox", { name: "Hide clef" }) as HTMLInputElement).checked).toBe(true);
  });
});
