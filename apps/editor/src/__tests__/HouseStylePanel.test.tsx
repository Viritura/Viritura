import { useEffect, type ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import { TooltipPrimitives } from "@viritura/ui";

import { HouseStylePanel } from "../components/modes/engrave/HouseStylePanel";
import { availableCategories } from "../components/SettingsDialog/settingsCategories";
import { DocumentProvider, useDocumentStore } from "../store/DocumentContext";

afterEach(cleanup);

const SCORE: Score = {
  mnx: { version: 1 },
  global: { measures: [{ time: { count: 4, unit: 4 } }] },
  parts: [{ id: "flute", name: "Flute", measures: [{ sequences: [{ content: [] }] }] }],
  layouts: [{ id: "flute-layout", content: [{ type: "staff", sources: [{ part: "flute" }] }] }],
  scores: [{ name: "Flute", layout: "flute-layout" }],
};

function WithScore({ children }: { readonly children: ReactNode }) {
  const loadScore = useDocumentStore((state) => state.loadScore);
  const loaded = useDocumentStore((state) => state.score !== null);
  const pageTurns = useDocumentStore((state) => state.score?.scores?.[0]?.pageSetup?.pageTurns);
  const chordSymbols = useDocumentStore((state) => state.score?.chordSymbolStyle);
  useEffect(() => loadScore(SCORE, "house-style-test.mnx"), [loadScore]);
  return loaded ? (
    <>
      {children}
      <output hidden data-testid="stored-page-turns">
        {JSON.stringify(pageTurns)}
      </output>
      <output hidden data-testid="stored-chord-symbols">
        {JSON.stringify(chordSymbols)}
      </output>
    </>
  ) : null;
}

function renderPanel() {
  return render(
    <TooltipPrimitives.Provider delayDuration={0}>
      <DocumentProvider>
        <WithScore>
          <HouseStylePanel />
        </WithScore>
      </DocumentProvider>
    </TooltipPrimitives.Provider>,
  );
}

describe("HouseStylePanel", () => {
  it("is the only navigation home for score text styles", () => {
    expect(availableCategories().some((category) => category.id === "text-styles")).toBe(false);
  });

  it("opens score-wide time-signature appearance by default", async () => {
    renderPanel();

    expect(await screen.findByLabelText("Search house style")).toBeTruthy();
    expect(screen.queryByText("House Style")).toBeNull();
    expect(screen.getByLabelText("Time signature appearance scope")).toBeTruthy();
    expect(screen.queryByText("Time signature appearance")).toBeNull();
  });

  it("switches to score-persisted text styles", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByRole("button", { name: /Text Styles/ }));

    expect((await screen.findAllByText("Title")).length).toBeGreaterThan(0);
    expect(screen.getByText(/Sizes are in staff spaces/)).toBeTruthy();
  });

  it("filters and expands matching categories while searching", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.type(await screen.findByLabelText("Search house style"), "font");

    expect(screen.queryByRole("button", { name: /Time Signatures/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Text Styles/ }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/Sizes are in staff spaces/)).toBeTruthy();
  });

  it("persists chord-symbol house style choices", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByRole("button", { name: /Chord Symbols/ }));
    await user.click(screen.getByRole("radio", { name: "Plain text" }));

    const stored = screen.getByTestId("stored-chord-symbols").textContent ?? "";
    expect(stored).toContain('"majorSeventh":"maj"');
    expect(stored).toContain('"extensions":"baseline"');

    await user.click(screen.getAllByRole("button", { name: "Advanced" })[0]!);
    await user.click(screen.getByRole("radio", { name: "Minor lowercase" }));
    await user.click(screen.getByRole("radio", { name: "No suffix" }));

    const updated = screen.getByTestId("stored-chord-symbols").textContent ?? "";
    expect(updated).toContain('"rootCase":"lowercaseMinor"');
    expect(updated).toContain('"minor":"none"');
    expect(updated).toContain('"extensions":"baseline"');
  });

  it("shows and persists every page-turn control group", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByRole("button", { name: /Page Turns/ }));

    expect(screen.getByRole("spinbutton", { name: "Comfortable" })).toBeTruthy();
    expect(screen.getByRole("spinbutton", { name: "V.S. threshold" })).toBeTruthy();
    expect(screen.getByRole("spinbutton", { name: "Minimum acceptable" })).toBeTruthy();
    expect(screen.getByRole("spinbutton", { name: "Fallback tempo" })).toBeTruthy();
    expect(screen.getByRole("spinbutton", { name: "Target fill" })).toBeTruthy();
    expect(screen.getByRole("spinbutton", { name: "Minimum fill" })).toBeTruthy();
    expect(screen.getByRole("spinbutton", { name: "Vertical justification" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Title page" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "First-page binding" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Allow partial music pages" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Allow intentional blank pages" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Emit V.S. and time marks" })).toBeTruthy();
    expect(screen.getByRole("spinbutton", { name: "Density" })).toBeTruthy();
    expect(screen.getByRole("spinbutton", { name: "Turn quality" })).toBeTruthy();
    expect(screen.getByRole("spinbutton", { name: "Sparse page" })).toBeTruthy();
    expect(screen.getByRole("spinbutton", { name: "Title page" })).toBeTruthy();
    expect(screen.getByRole("spinbutton", { name: "Blank page" })).toBeTruthy();
    expect(screen.getByRole("spinbutton", { name: "Time marking" })).toBeTruthy();

    await user.click(screen.getByLabelText("Enable page-turn optimization"));
    const minimumFill = screen.getByRole("spinbutton", { name: "Minimum fill" });
    await user.clear(minimumFill);
    await user.type(minimumFill, "80");
    await user.tab();

    const stored = screen.getByTestId("stored-page-turns").textContent ?? "";
    expect(stored).toContain('"enabled":true');
    expect(stored).toContain('"minFillFraction":0.8');
    expect(stored).toContain('"verticalJustifyThreshold":0.65');
    expect(stored).toContain('"titlePage":"auto"');
    expect(stored).toContain('"timeMarking":1');
  });
});
