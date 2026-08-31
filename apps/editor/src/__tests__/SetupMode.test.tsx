/**
 * Setup-mode panel coverage. Replaces the deleted `NewScoreDialog.test.tsx`:
 * the wizard's ensemble and score-details steps now live in Setup mode, where
 * they mutate the live score instead of a throwaway `Player[]` draft.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseMnx } from "@viritura/format";
import { TooltipPrimitives } from "@viritura/ui";
import { MusicTab } from "../components/modes/setup/MusicTab";
import { EnsemblePicker } from "../components/modes/setup/EnsemblePicker";
import { DocumentProvider, useDocumentActions, useDocumentStore } from "../store/DocumentContext";
import { buildBlankScore, DEFAULT_NEW_SCORE_SETTINGS } from "../score/ScoreBuilder";
import { expandTemplate } from "../score/InstrumentCatalog";
import { useEffect } from "react";
import type { Score } from "@viritura/core";

afterEach(cleanup);

/** Seeds the store with a small blank score, then renders `children`. */
function Harness({ children, onScore }: { children: React.ReactNode; onScore?: (s: Score) => void }) {
  const { loadScore } = useDocumentActions();
  const score = useDocumentStore((s) => s.score);

  useEffect(() => {
    const json = buildBlankScore({
      ...DEFAULT_NEW_SCORE_SETTINGS,
      title: "Test",
      players: expandTemplate("string-quartet"),
      measureCount: 8,
    });
    loadScore(parseMnx(JSON.parse(json)));
  }, [loadScore]);

  useEffect(() => {
    if (score) onScore?.(score);
  }, [score, onScore]);

  return score ? <>{children}</> : null;
}

function renderMusicTab() {
  const seen: Score[] = [];
  render(
    <TooltipPrimitives.Provider delayDuration={0}>
      <DocumentProvider>
        <Harness onScore={(s) => seen.push(s)}>
          <MusicTab />
        </Harness>
      </DocumentProvider>
    </TooltipPrimitives.Provider>,
  );
  return { latest: () => seen[seen.length - 1]! };
}

describe("Setup mode — Music tab", () => {
  it("reflects the live score's opening signatures and bar count", async () => {
    renderMusicTab();
    await waitFor(() => expect(screen.getByTestId("setup-measure-count")).toBeTruthy());

    expect((screen.getByTestId("setup-measure-count") as HTMLInputElement).value).toBe("8");
    expect((screen.getByTestId("setup-time-count") as HTMLInputElement).value).toBe("4");
    expect((screen.getByTestId("setup-tempo") as HTMLInputElement).value).toBe("120");
    expect(screen.queryByText("Time signature appearance")).toBeNull();
  });

  it("appends bars when the count grows", async () => {
    const user = userEvent.setup();
    const { latest } = renderMusicTab();
    await waitFor(() => expect(screen.getByTestId("setup-measure-count")).toBeTruthy());

    const input = screen.getByTestId("setup-measure-count");
    await user.clear(input);
    await user.type(input, "12");
    await user.tab();

    await waitFor(() => expect(latest().global.measures.length).toBe(12));
  });

  it("deletes bars from the end when the count shrinks", async () => {
    const user = userEvent.setup();
    const { latest } = renderMusicTab();
    await waitFor(() => expect(screen.getByTestId("setup-measure-count")).toBeTruthy());

    const input = screen.getByTestId("setup-measure-count");
    await user.clear(input);
    await user.type(input, "3");
    await user.tab();

    await waitFor(() => expect(latest().global.measures.length).toBe(3));
  });

  it("writes the tempo onto the opening bar", async () => {
    const user = userEvent.setup();
    const { latest } = renderMusicTab();
    await waitFor(() => expect(screen.getByTestId("setup-tempo")).toBeTruthy());

    const input = screen.getByTestId("setup-tempo");
    await user.clear(input);
    await user.type(input, "96");
    await user.tab();

    await waitFor(() => expect(latest().global.measures[0]?.tempos?.[0]?.bpm).toBe(96));
  });

  it("rejects out-of-range values rather than corrupting the score", async () => {
    const user = userEvent.setup();
    const { latest } = renderMusicTab();
    await waitFor(() => expect(screen.getByTestId("setup-tempo")).toBeTruthy());

    const before = latest().global.measures[0]?.tempos?.[0]?.bpm;
    const input = screen.getByTestId("setup-tempo");
    await user.clear(input);
    await user.type(input, "5");
    await user.tab();

    // Below MIN_TEMPO: the score is untouched and the field snaps back.
    expect(latest().global.measures[0]?.tempos?.[0]?.bpm).toBe(before);
    expect((input as HTMLInputElement).value).toBe(String(before));
  });

  it("keeps a cleared field editable instead of snapping back mid-edit", async () => {
    const user = userEvent.setup();
    renderMusicTab();
    await waitFor(() => expect(screen.getByTestId("setup-measure-count")).toBeTruthy());

    // Clearing must leave the box empty so the user can retype. A field bound
    // straight to the score would immediately re-render the old value here.
    const input = screen.getByTestId("setup-measure-count") as HTMLInputElement;
    await user.clear(input);
    expect(input.value).toBe("");
  });
});

describe("Setup mode — ensemble picker", () => {
  it("groups templates by ensemble category", () => {
    render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <EnsemblePicker onSelect={vi.fn()} />
      </TooltipPrimitives.Provider>,
    );

    for (const label of ["Solo", "Chamber Ensembles", "Vocal Ensembles", "Jazz", "Orchestras & Bands"]) {
      expect(screen.queryByText(label)).not.toBeNull();
    }
  });

  it("reports the chosen template id so a whole ensemble can be added at once", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <EnsemblePicker onSelect={onSelect} />
      </TooltipPrimitives.Provider>,
    );

    await user.click(screen.getByText("String Quartet"));
    expect(onSelect).toHaveBeenCalledWith("string-quartet");
  });
});
