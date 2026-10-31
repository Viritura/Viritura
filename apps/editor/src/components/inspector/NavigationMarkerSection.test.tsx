import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Score } from "@viritura/core";
import { NavigationMarkerSection } from "./NavigationMarkerSection";

afterEach(cleanup);
const target = { elementId: "m0/coda", elementType: "coda", partIndex: 0, measureIndex: 0 };
function score(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [
        {
          coda: { location: { fraction: [1, 4] }, text: { content: [{ text: "ending" }], placement: "after" } },
          jump: { type: "dc", location: { fraction: [1, 1] } },
        },
      ],
    },
    parts: [],
  };
}

describe("navigation marker inspector", () => {
  it("edits native glyph and fraction without losing authored text", async () => {
    const user = userEvent.setup();
    const updateScore = vi.fn<(score: Score) => void>();
    const source = score();
    render(<NavigationMarkerSection score={source} target={target} updateScore={updateScore} />);
    await user.click(screen.getByRole("combobox", { name: "Marker glyph" }));
    await user.click(screen.getByRole("option", { name: "Square coda" }));
    expect(updateScore.mock.lastCall?.[0].global.measures[0]!.coda).toEqual({
      ...source.global.measures[0]!.coda,
      glyph: "codaSquare",
    });
    const denominator = screen.getByRole("spinbutton", { name: "Marker position denominator" });
    await user.clear(denominator);
    await user.type(denominator, "8");
    await user.tab();
    expect(updateScore.mock.lastCall?.[0].global.measures[0]!.coda?.location.fraction).toEqual([1, 8]);
    expect(updateScore.mock.lastCall?.[0].global.measures[0]!.coda?.text).toEqual(
      source.global.measures[0]!.coda?.text,
    );
  });

  it("offers all seven typed jump instructions and no inapplicable glyph override", async () => {
    const user = userEvent.setup();
    const updateScore = vi.fn<(score: Score) => void>();
    render(
      <NavigationMarkerSection score={score()} target={{ ...target, elementType: "jump" }} updateScore={updateScore} />,
    );
    expect(screen.queryByRole("combobox", { name: "Marker glyph" })).toBeNull();
    await user.click(screen.getByRole("combobox", { name: "Jump instruction" }));
    expect(screen.getAllByRole("option")).toHaveLength(7);
    await user.click(screen.getByRole("option", { name: "To Coda" }));
    expect(updateScore.mock.lastCall?.[0].global.measures[0]!.jump?.type).toBe("toCoda");
  });
});
