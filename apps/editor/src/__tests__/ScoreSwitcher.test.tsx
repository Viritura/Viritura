import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const scoreEntries = vi.hoisted(() => [
  { index: 0, name: "Chamber Score", isScore: true },
  { index: 1, name: "Flute 1", isScore: false },
]);

vi.mock("../store/DocumentContext", () => ({
  useDocumentStore: (selector: (state: { score: object }) => unknown) => selector({ score: {} }),
}));

vi.mock("../scoreSwitcher/scoreEntries", () => ({
  buildScoreEntries: () => scoreEntries,
}));

import { ScoreSwitcher } from "../scoreSwitcher";

const COACHMARK_KEY = "viritura.scoreSwitcher.coachmark.v1";

afterEach(cleanup);

function Harness() {
  const [selected, setSelected] = useState(0);
  return <ScoreSwitcher selectedScoreIndex={selected} onSelectScore={setSelected} />;
}

describe("ScoreSwitcher", () => {
  beforeEach(() => {
    localStorage.removeItem(COACHMARK_KEY);
    scoreEntries.splice(
      0,
      scoreEntries.length,
      { index: 0, name: "Chamber Score", isScore: true },
      { index: 1, name: "Flute 1", isScore: false },
    );
  });

  it("keeps the closed selector focused on the current score name", () => {
    render(<Harness />);

    const trigger = screen.getByRole("button", { name: "Select score or part: Chamber Score" });
    expect(trigger).toBeTruthy();
    expect(trigger.textContent).toBe("Chamber Score");
  });

  it("shows and permanently dismisses the multi-view coachmark", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness />);

    expect(screen.getByText("Scores and parts are separate views.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Got it" }));
    expect(localStorage.getItem(COACHMARK_KEY)).toBe("1");
    expect(screen.queryByText("Scores and parts are separate views.")).toBeNull();

    unmount();
    render(<Harness />);
    expect(screen.queryByText("Scores and parts are separate views.")).toBeNull();
  });

  it("updates the closed-state type badge after choosing a part", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Select score or part: Chamber Score" }));
    expect(localStorage.getItem(COACHMARK_KEY)).toBe("1");
    await user.click(screen.getByText("Flute 1"));

    expect(screen.getByRole("button", { name: "Select score or part: Flute 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Select score or part: Flute 1" }).textContent).toBe("Flute 1");
  });

  it("does not show onboarding when the document has only one view", () => {
    scoreEntries.splice(1);
    render(<Harness />);

    expect(screen.queryByText("Scores and parts are separate views.")).toBeNull();
  });
});
