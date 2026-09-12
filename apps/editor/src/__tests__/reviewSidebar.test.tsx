import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HistoryRow } from "../components/modes/review/HistoryRow";
import { getReviewSide } from "../components/modes/review/useReviewSession";

describe("review sidebar selection", () => {
  it("identifies both sides of the active comparison", () => {
    const selection = { from: "older", to: "newer" };

    expect(getReviewSide(selection, "older")).toBe("from");
    expect(getReviewSide(selection, "newer")).toBe("to");
    expect(getReviewSide(selection, "unselected")).toBeNull();
  });

  it("renders history entries as keyboard-accessible selected rows", () => {
    const onToggle = vi.fn();
    render(
      <HistoryRow
        label="Dynamics changed"
        sublabel="Composer · just now"
        sha="abc1234"
        checked
        side="to"
        onToggle={onToggle}
      />,
    );

    const row = screen.getByRole("button", { name: "Dynamics changed, after revision" });
    expect(row.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("After")).toBeTruthy();
    expect(screen.getByText("abc1234").parentElement).toBe(screen.getByText("Composer · just now").parentElement);
    fireEvent.click(row);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("uses the score-diff red for the Before badge", () => {
    render(
      <HistoryRow
        label="Earlier revision"
        sublabel="Composer · yesterday"
        checked
        side="from"
        onToggle={() => undefined}
      />,
    );

    expect(screen.getByText("Before").style.background).toBe("#c62828");
  });
});
