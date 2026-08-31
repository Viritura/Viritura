import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Score } from "@viritura/core";
import { OrchestralStaffSplitDialog } from ".";

afterEach(cleanup);

describe("OrchestralStaffSplitDialog", () => {
  it("blocks the operation and explains incompatible targets", () => {
    const score = makeScore();
    score.parts = score.parts.filter((part) => part.id !== "P7");

    render(<OrchestralStaffSplitDialog open score={score} onClose={vi.fn()} onUpdateScore={vi.fn()} />);

    expect(screen.getByRole("alert").textContent).toMatch(/P7.*missing/);
    expect((screen.getByTestId("orchestral-staff-split-apply") as HTMLButtonElement).disabled).toBe(true);
  });

  it("previews named Parts and applies the shared transform", async () => {
    const onClose = vi.fn();
    const onUpdateScore = vi.fn();
    const user = userEvent.setup();
    render(<OrchestralStaffSplitDialog open score={makeScore()} onClose={onClose} onUpdateScore={onUpdateScore} />);

    expect(screen.getByRole("heading", { name: "Split Combined Orchestral Parts" })).toBeTruthy();
    expect(screen.getByText("Oboe 1, Oboe 2")).toBeTruthy();
    expect(screen.getByText("Clarinet in B♭ 1, Clarinet in B♭ 2")).toBeTruthy();
    expect(screen.getByText("Bassoon 1, Bassoon 2")).toBeTruthy();
    expect(screen.getByText("Trombone 1, Trombone 2, Trombone 3")).toBeTruthy();
    expect(screen.getByText(/separate Condensed Score will be created/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Split Parts" })).toBeTruthy();
    await user.click(screen.getByTestId("orchestral-staff-split-apply"));

    expect(onUpdateScore).toHaveBeenCalledOnce();
    const updated = onUpdateScore.mock.calls[0]![0] as Score;
    expect(updated.parts.find((part) => part.id === "P2")).toBeUndefined();
    expect(updated.parts.find((part) => part.id === "P2-1")?.name).toBe("Oboe 1");
    expect(updated.parts.find((part) => part.id === "P7-3")?.name).toBe("Trombone 3");
    expect(updated.scores?.[1]?.name).toBe("Condensed Score");
    expect(onClose).toHaveBeenCalledOnce();
  });
});

function makeScore(): Score {
  const targets = [
    ["P2", "Oboi", 1],
    ["P3", "Clarinetti in Bb", 2],
    ["P4", "Fagotti", 2],
    ["P5", "Corni in F", 1],
    ["P6", "Trombe in Bb", 1],
    ["P7", "Tromboni", 2],
  ] as const;
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: targets.map(([id, name, staves]) => ({
      id,
      name,
      staves,
      measures: [
        {
          sequences: Array.from({ length: staves }, (_, index) => ({
            staff: index + 1,
            content: [{ type: "event" as const, duration: { base: "whole" as const }, rest: {} }],
          })),
        },
      ],
    })),
  };
}
