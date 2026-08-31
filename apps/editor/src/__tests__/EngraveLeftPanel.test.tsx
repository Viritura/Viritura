import { useEffect, type ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Score } from "@viritura/core";
import { TooltipPrimitives } from "@viritura/ui";
import { EngraveLeftPanel } from "../components/modes/engrave/EngraveLeftPanel";
import { PageSetupDialog } from "../components/PageSetupDialog";
import { DocumentProvider, useDocumentStore } from "../store/DocumentContext";

afterEach(cleanup);

const SCORE: Score = {
  mnx: { version: 1 },
  global: { measures: [{ id: "m1", time: { count: 4, unit: 4 } }] },
  parts: [
    { id: "p1", name: "Flute", measures: [{ sequences: [{ content: [] }] }] },
    { id: "p2", name: "Oboe", measures: [{ sequences: [{ content: [] }] }] },
  ],
  layouts: [
    {
      id: "full",
      content: [
        { type: "staff", sources: [{ part: "p1" }] },
        { type: "staff", sources: [{ part: "p2" }] },
      ],
    },
    { id: "flute", content: [{ type: "staff", sources: [{ part: "p1" }] }] },
  ],
  scores: [
    { name: "Full Score", layout: "full", pageSetup: { width: 297, height: 420, spatiumMm: 1.25 } },
    { name: "Flute", layout: "flute" },
  ],
};

function WithScore({ children }: { readonly children: ReactNode }) {
  const loadScore = useDocumentStore((state) => state.loadScore);
  const loaded = useDocumentStore((state) => state.score !== null);
  useEffect(() => loadScore(SCORE, "engrave-tabs-test.mnx"), [loadScore]);
  return loaded ? children : null;
}

function renderPanel(onApplyPageSetup = vi.fn(), onResetPageSetup = vi.fn()) {
  return {
    ...render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <DocumentProvider>
          <WithScore>
            <EngraveLeftPanel
              score={SCORE}
              activeScoreIndex={0}
              onApplyPageSetup={onApplyPageSetup}
              onResetPageSetup={onResetPageSetup}
            />
          </WithScore>
        </DocumentProvider>
      </TooltipPrimitives.Provider>,
    ),
    onApplyPageSetup,
    onResetPageSetup,
  };
}

describe("EngraveLeftPanel", () => {
  it("switches between House Style and Layouts", async () => {
    const user = userEvent.setup();
    renderPanel();

    expect(await screen.findByLabelText("Search house style")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "Layouts" }));

    expect(screen.getByText("Layout settings for the score or part selected in the header.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Apply" })).toBeTruthy();
  });

  it("offers notation properties as a left-panel tab", async () => {
    const user = userEvent.setup();
    renderPanel();

    const propertiesTab = await screen.findByRole("tab", { name: "Properties" });
    await user.click(propertiesTab);
    expect(propertiesTab.getAttribute("aria-selected")).toBe("true");
  });

  it("edits page setup for the globally active score in place", async () => {
    const user = userEvent.setup();
    const { onApplyPageSetup } = renderPanel();

    await user.click(await screen.findByRole("tab", { name: "Layouts" }));
    await user.click(screen.getByRole("button", { name: "Apply" }));

    expect(onApplyPageSetup).toHaveBeenCalledWith(
      expect.objectContaining({ width: 297, height: 420, spatiumMm: 1.25 }),
    );
    expect(screen.queryByRole("button", { name: "Flute" })).toBeNull();
    expect(screen.getByText("297 mm × 420 mm · 5 mm staff")).toBeTruthy();
  });

  it("preserves an embedded draft across equivalent parent rerenders", async () => {
    const user = userEvent.setup();
    const setup = {
      width: 210,
      height: 297,
      orientation: "portrait" as const,
      margins: { top: 15, right: 15, bottom: 15, left: 15 },
      spatiumMm: 1.25,
    };
    const { rerender } = render(
      <PageSetupDialog embedded initialSetup={setup} onApply={() => {}} onResetToDefault={() => {}} />,
    );
    const width = screen.getByRole("textbox", { name: "Width" }) as HTMLInputElement;
    expect(screen.getByRole("radiogroup", { name: "Orientation" })).toBeTruthy();
    await user.clear(width);
    await user.type(width, "250");

    rerender(
      <PageSetupDialog
        embedded
        initialSetup={{ ...setup, margins: { ...setup.margins } }}
        onApply={() => {}}
        onResetToDefault={() => {}}
      />,
    );

    expect(width.value).toBe("250");
  });
});
