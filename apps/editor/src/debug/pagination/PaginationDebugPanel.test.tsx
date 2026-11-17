import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaginationDebugPanel } from "./PaginationDebugPanel";
import { usePaginationDebugStore, type PaginationDiagnostics } from "./store";
import { useLayoutDebugStore } from "../layoutDebugStore";

vi.mock("@viritura/renderer", () => ({ setEmitLayoutDebug: vi.fn() }));

const diagnostic: PaginationDiagnostics = {
  status: "automatic",
  comfortableSecs: 5,
  vsSecs: 3,
  minFillFraction: 0.85,
  targetFillFraction: 0.95,
  firstPageRecto: true,
  titlePage: false,
  measuredRepacking: false,
  pages: [],
  systems: [
    {
      systemIndex: 0,
      firstMeasure: 0,
      lastMeasure: 3,
      naturalWidth: 250,
      availableWidth: 200,
      pageBreakAfter: false,
      physicalTurnAfter: false,
      plannedPageBreakAfter: false,
      boundary: {
        tailSeconds: 1.2,
        headSeconds: 4.8,
        headRestMeasures: 2,
        quality: "comfortable",
        structural: true,
        fermataBlocked: false,
        turnCost: 10.72,
      },
    },
  ],
};

describe("page/system debug controls", () => {
  beforeEach(() => {
    usePaginationDebugStore.setState({
      enabled: false,
      diagnostics: null,
      selectedSystem: null,
    });
    useLayoutDebugStore.setState({ enabled: false });
  });
  afterEach(cleanup);

  it("enables independently of note spacing and persists only overlay preferences", () => {
    render(<PaginationDebugPanel />);
    fireEvent.click(screen.getByRole("switch", { name: "Page and system overlay" }));
    fireEvent.click(screen.getByText("Unselected system-end alternatives"));
    expect(usePaginationDebugStore.getState().enabled).toBe(true);
    expect(useLayoutDebugStore.getState().enabled).toBe(false);
    usePaginationDebugStore.getState().setDiagnostics(diagnostic);
    const stored = JSON.parse(localStorage.getItem("viritura.paginationDebug") ?? "{}");
    expect(stored.state.enabled).toBe(true);
    expect(stored.state.categories.alternatives).toBe(true);
    expect(stored.state).not.toHaveProperty("diagnostics");
    expect(stored.state).not.toHaveProperty("selectedSystem");
  });

  it("explains an inspected alternative without claiming that it is feasible", () => {
    usePaginationDebugStore.setState({ enabled: true, diagnostics: diagnostic, selectedSystem: 0 });
    render(<PaginationDebugPanel />);
    expect(screen.getByText(/1.2s before \+ 4.8s after = 6.0s/).textContent).toContain("repeat / ending / jump hazard");
    expect(screen.getByText(/System density: 125%/)).toBeTruthy();
    expect(screen.getByText(/not proven feasible alternatives/)).toBeTruthy();
  });
});
