import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RadialMenu, type RadialMenuItem } from "@viritura/ui";
import { renderTimeSignatureExpression } from "../radialMenu/timeSignatureMenu";

const CUSTOM_ITEM: RadialMenuItem = {
  id: "custom",
  icon: "n/d",
  label: "Custom…",
  expressionSeed: "5/8",
};

afterEach(cleanup);

describe("custom time signature radial item", () => {
  it("seeds and selects an editable expression without closing", async () => {
    const onClose = vi.fn();
    const onSelect = vi.fn();
    render(
      <RadialMenu
        open
        onClose={onClose}
        onSelect={onSelect}
        items={[CUSTOM_ITEM]}
        position={{ x: 300, y: 300 }}
        renderExpression={renderTimeSignatureExpression}
        searchPlaceholder="Filter or enter time (5/8)…"
      />,
    );

    fireEvent.click(screen.getByText("Custom…"));

    const input = screen.getByPlaceholderText("Filter or enter time (5/8)…") as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe("5/8"));
    await waitFor(() => expect([input.selectionStart, input.selectionEnd]).toEqual([0, 3]));
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("5/8")).toBeTruthy();
  });
});
