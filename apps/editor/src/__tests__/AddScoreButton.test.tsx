import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Part, PartDisplayInfo } from "@viritura/core";
import { AddScoreButton } from "../components/parts/AddScoreButton";

afterEach(cleanup);

const parts: Part[] = [
  { id: "p1", name: "Flute", measures: [] },
  { id: "p2", name: "Oboe", measures: [] },
];

const partDisplayMap = new Map<string, PartDisplayInfo>([
  ["p1", { displayName: "Flute 1", shortDisplayName: "Fl. 1" }],
  ["p2", { displayName: "Oboe 1", shortDisplayName: "Ob. 1" }],
]);

describe("AddScoreButton", () => {
  it("presents score types and groups instrumental parts in a submenu", async () => {
    const user = userEvent.setup();
    const onAddScore = vi.fn();
    render(<AddScoreButton parts={parts} partDisplayMap={partDisplayMap} onAddScore={onAddScore} />);

    await user.click(screen.getByRole("button", { name: "Add score" }));

    expect(screen.getByRole("menuitem", { name: "Full score" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Condensed score" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Custom score" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Instrumental part" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Flute 1" })).toBeNull();

    screen.getByRole("menuitem", { name: "Instrumental part" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(await screen.findByRole("menuitem", { name: "Flute 1" })).toBeTruthy();

    await user.click(screen.getByRole("menuitem", { name: "Flute 1" }));
    expect(onAddScore).toHaveBeenCalledWith("part", "p1");
  });

  it("creates a score from a top-level score type", async () => {
    const user = userEvent.setup();
    const onAddScore = vi.fn();
    render(<AddScoreButton parts={parts} partDisplayMap={partDisplayMap} onAddScore={onAddScore} />);

    await user.click(screen.getByRole("button", { name: "Add score" }));
    await user.click(screen.getByRole("menuitem", { name: "Full score" }));

    expect(onAddScore).toHaveBeenCalledWith("full");
  });
});
