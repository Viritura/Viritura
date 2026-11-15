import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { HelpDialog } from "../components/HelpDialog";

afterEach(cleanup);

describe("HelpDialog", () => {
  it("renders shortcut groups for every documented context", () => {
    render(<HelpDialog open onClose={() => {}} />);

    expect(screen.getByText("Global")).toBeTruthy();
    expect(screen.getAllByText("Normal Mode").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Note Input Mode").length).toBeGreaterThan(0);

    // All tables are rendered without dimming
    expect(screen.getByTestId("shortcuts-global")).toBeTruthy();
    expect(screen.getByTestId("shortcuts-normal")).toBeTruthy();
    expect(screen.getByTestId("shortcuts-noteInput")).toBeTruthy();
    expect(screen.getByTestId("shortcuts-engrave")).toBeTruthy();
    expect(screen.getByTestId("shortcuts-picture")).toBeTruthy();
    expect(screen.getByText("Force a system break after the clicked barline")).toBeTruthy();
    expect(screen.getByText("Force a page break after the clicked barline")).toBeTruthy();
    const engraveShortcuts = within(screen.getByTestId("shortcuts-engrave"));
    expect(engraveShortcuts.getByText(/Mac/.test(navigator.userAgent) ? "⌘+Click" : "Ctrl+Click")).toBeTruthy();
  });

  it("documents keyboard-first commands in discoverability tables", () => {
    render(<HelpDialog open onClose={() => {}} />);

    expect(screen.getAllByText(/staccato/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/toggle tie/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/toggle slur/i).length).toBeGreaterThan(0);
  });

  it("links to task guides and exact shortcut sections", () => {
    render(<HelpDialog open onClose={() => {}} />);

    expect(screen.getByRole("link", { name: "Enter notes" }).getAttribute("href")).toContain("/docs/note-entry");
    expect(screen.getByRole("link", { name: "Scores, parts, and layouts" }).getAttribute("href")).toContain(
      "/docs/instruments-and-scores",
    );
    expect(screen.getByRole("link", { name: "Edit percussion maps" }).getAttribute("href")).toContain(
      "/docs/percussion-maps",
    );
    expect(screen.getByRole("link", { name: "Collaborate live" }).getAttribute("href")).toContain(
      "/docs/collaboration",
    );
    expect(screen.getByRole("link", { name: "Connect MCP" }).getAttribute("href")).toContain("/docs/mcp");
    expect(screen.getByRole("link", { name: "Open engrave activity reference" }).getAttribute("href")).toContain(
      "/docs/keyboard-shortcuts#engrave",
    );
    expect(screen.getByRole("link", { name: "Open picture activity reference" }).getAttribute("href")).toContain(
      "/docs/keyboard-shortcuts#picture",
    );
  });
});
