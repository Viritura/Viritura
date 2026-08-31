import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MenuBar, type MenuBarCallbacks, type MenuBarState } from "../components/MenuBar";

afterEach(cleanup);

const SAMPLE_SCORES = [
  { name: "Hello World", file: "scores/hello-world.mnx" },
  { name: "Accidentals", file: "scores/accidentals.mnx" },
];

function renderMenuBar(overrides: Partial<MenuBarCallbacks> = {}, state: MenuBarState = {}) {
  const callbacks: MenuBarCallbacks = {
    onNewScore: vi.fn(),
    onOpenProject: vi.fn(),
    onOpenFile: vi.fn(),
    onSave: vi.fn(),
    onSaveAs: vi.fn(),
    onSelectSampleScore: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onCut: vi.fn(),
    onCopy: vi.fn(),
    onPaste: vi.fn(),
    onDelete: vi.fn(),
    onSelectAll: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onResetZoom: vi.fn(),
    onSplitOrchestralStaves: vi.fn(),
    ...overrides,
  };
  const user = userEvent.setup();
  render(<MenuBar callbacks={callbacks} state={state} sampleScores={SAMPLE_SCORES} />);
  return { callbacks, user };
}

describe("MenuBar", () => {
  it("renders File, Edit, View, and Help menus", () => {
    renderMenuBar();
    expect(screen.getByText("File")).toBeTruthy();
    expect(screen.getByText("Edit")).toBeTruthy();
    expect(screen.getByText("View")).toBeTruthy();
    expect(screen.getByText("Help")).toBeTruthy();
  });

  it("opens File menu on click", async () => {
    const { user } = renderMenuBar();
    await user.click(screen.getByText("File"));
    expect(screen.getByText("New Project…")).toBeTruthy();
    expect(screen.getByText("Open Project Folder…")).toBeTruthy();
    expect(screen.getByText("Open MNX Score…")).toBeTruthy();
    expect(screen.getByText("Save")).toBeTruthy();
    expect(screen.getByText("Save As…")).toBeTruthy();
    expect(screen.getByText("Example Scores")).toBeTruthy();
  });

  it("opens Edit menu on click", async () => {
    const { user } = renderMenuBar();
    await user.click(screen.getByText("Edit"));
    expect(screen.getByText("Undo")).toBeTruthy();
    expect(screen.getByText("Redo")).toBeTruthy();
    expect(screen.getByText("Cut")).toBeTruthy();
    expect(screen.getByText("Copy")).toBeTruthy();
    expect(screen.getByText("Paste")).toBeTruthy();
    expect(screen.getByText("Delete")).toBeTruthy();
    expect(screen.getByText("Transpose Selection…")).toBeTruthy();
    expect(screen.getByText("Split Combined Orchestral Parts…")).toBeTruthy();
    expect(screen.getByText("Select All")).toBeTruthy();
  });

  it("describes transpose as a selection dialog without an unrelated keyboard hint", async () => {
    const { user } = renderMenuBar({}, { canTranspose: true });
    await user.click(screen.getByText("Edit"));

    const transposeItem = screen.getByText("Transpose Selection…").closest('[role="menuitem"]');
    expect(transposeItem?.textContent).toBe("Transpose Selection…");
    expect(transposeItem?.getAttribute("data-disabled")).toBeNull();
  });

  it("disables transpose when the selection contains no pitched notes", async () => {
    const { user } = renderMenuBar({}, { hasSelection: true, canTranspose: false });
    await user.click(screen.getByText("Edit"));

    expect(
      screen.getByText("Transpose Selection…").closest('[role="menuitem"]')?.getAttribute("data-disabled"),
    ).not.toBeNull();
  });

  it("dispatches orchestral staff split only when a document is open", async () => {
    const onSplitOrchestralStaves = vi.fn();
    const { user } = renderMenuBar({ onSplitOrchestralStaves }, { hasDocument: true });
    await user.click(screen.getByText("Edit"));
    const item = screen.getByText("Split Combined Orchestral Parts…").closest('[role="menuitem"]');
    expect(item?.getAttribute("data-disabled")).toBeNull();
    await user.click(screen.getByText("Split Combined Orchestral Parts…"));
    expect(onSplitOrchestralStaves).toHaveBeenCalledOnce();

    cleanup();
    const disabled = renderMenuBar({ onSplitOrchestralStaves }, { hasDocument: false });
    await disabled.user.click(screen.getByText("Edit"));
    expect(
      screen.getByText("Split Combined Orchestral Parts…").closest('[role="menuitem"]')?.getAttribute("data-disabled"),
    ).not.toBeNull();
  });

  it("opens View menu on click", async () => {
    const { user } = renderMenuBar();
    await user.click(screen.getByText("View"));
    expect(screen.getByText("Zoom In")).toBeTruthy();
    expect(screen.getByText("Zoom Out")).toBeTruthy();
    expect(screen.getByText("Reset Zoom")).toBeTruthy();
    expect(screen.queryByText("Calibrate Display…")).toBeNull();
    expect(screen.queryByText("AI Assistant")).toBeNull();
  });

  it("keeps score examples out of the Help menu", async () => {
    const { user } = renderMenuBar();
    await user.click(screen.getByText("Help"));

    expect(screen.getByText("Keyboard Shortcuts")).toBeTruthy();
    expect(screen.getByText("Documentation")).toBeTruthy();
    expect(screen.queryByText("Audio Credits")).toBeNull();
    expect(screen.queryByText("Score Examples")).toBeNull();
  });

  it("keeps Documentation separate from the Keyboard Shortcuts dialog", async () => {
    const onShowHelp = vi.fn();
    const onOpenDocs = vi.fn();
    const { user } = renderMenuBar({ onShowHelp, onOpenDocs });
    await user.click(screen.getByText("Help"));

    expect(screen.getByText("Documentation")).toBeTruthy();
    await user.click(screen.getByText("Documentation"));
    expect(onOpenDocs).toHaveBeenCalledOnce();
    expect(onShowHelp).not.toHaveBeenCalled();
  });

  it("dispatches onOpenFile when Open MNX Score is clicked", async () => {
    const { callbacks, user } = renderMenuBar();
    await user.click(screen.getByText("File"));
    await user.click(screen.getByText("Open MNX Score…"));
    expect(callbacks.onOpenFile).toHaveBeenCalledOnce();
  });

  it("dispatches onOpenProject when Open Project Folder is clicked", async () => {
    const { callbacks, user } = renderMenuBar();
    await user.click(screen.getByText("File"));
    await user.click(screen.getByText("Open Project Folder…"));
    expect(callbacks.onOpenProject).toHaveBeenCalledOnce();
  });

  it("dispatches onNewScore when New Project is clicked", async () => {
    const { callbacks, user } = renderMenuBar();
    await user.click(screen.getByText("File"));
    await user.click(screen.getByText("New Project…"));
    expect(callbacks.onNewScore).toHaveBeenCalledOnce();
  });

  it("dispatches onZoomIn when Zoom In is clicked", async () => {
    const { callbacks, user } = renderMenuBar();
    await user.click(screen.getByText("View"));
    await user.click(screen.getByText("Zoom In"));
    expect(callbacks.onZoomIn).toHaveBeenCalledOnce();
  });

  it("dispatches onUndo when Undo is clicked and enabled", async () => {
    const { callbacks, user } = renderMenuBar({}, { canUndo: true });
    await user.click(screen.getByText("Edit"));
    await user.click(screen.getByText("Undo"));
    expect(callbacks.onUndo).toHaveBeenCalledOnce();
  });

  it("disables Undo when canUndo is false", async () => {
    const { user } = renderMenuBar({}, { canUndo: false });
    await user.click(screen.getByText("Edit"));
    const undoItem = screen.getByText("Undo").closest('[role="menuitem"]');
    expect(undoItem?.getAttribute("data-disabled")).not.toBeNull();
  });

  it("disables Undo and Redo when the active activity does not provide editing callbacks", async () => {
    const { user } = renderMenuBar({ onUndo: undefined, onRedo: undefined }, { canUndo: true, canRedo: true });
    await user.click(screen.getByText("Edit"));

    expect(screen.getByText("Undo").closest('[role="menuitem"]')?.getAttribute("data-disabled")).not.toBeNull();
    expect(screen.getByText("Redo").closest('[role="menuitem"]')?.getAttribute("data-disabled")).not.toBeNull();
  });

  it("disables Cut/Copy/Delete when hasSelection is false", async () => {
    const { user } = renderMenuBar({}, { hasSelection: false });
    await user.click(screen.getByText("Edit"));
    expect(screen.getByText("Cut").closest('[role="menuitem"]')?.getAttribute("data-disabled")).not.toBeNull();
    expect(screen.getByText("Copy").closest('[role="menuitem"]')?.getAttribute("data-disabled")).not.toBeNull();
    expect(screen.getByText("Delete").closest('[role="menuitem"]')?.getAttribute("data-disabled")).not.toBeNull();
  });

  it("closes menu after clicking an item", async () => {
    const { user } = renderMenuBar();
    await user.click(screen.getByText("File"));
    await user.click(screen.getByText("New Project…"));
    // After clicking, the dropdown should be closed (items not visible)
    expect(screen.queryByText("Open MNX Score…")).toBeNull();
  });

  it("shows keyboard shortcuts", async () => {
    const { user } = renderMenuBar();
    await user.click(screen.getByText("Edit"));
    // Look for shortcut hints (Ctrl+Z or ⌘Z)
    const undoItem = screen.getByText("Undo").closest('[role="menuitem"]');
    expect(undoItem?.textContent).toMatch(/Ctrl\+Z|⌘Z/);
  });

  it("has menubar role", () => {
    renderMenuBar();
    expect(screen.getByRole("menubar")).toBeTruthy();
  });

  it("disables Save when hasDocument is false", async () => {
    const { user } = renderMenuBar({}, { hasDocument: false });
    await user.click(screen.getByText("File"));
    expect(screen.getByText("Save").closest('[role="menuitem"]')?.getAttribute("data-disabled")).not.toBeNull();
    expect(screen.getByText("Save As…").closest('[role="menuitem"]')?.getAttribute("data-disabled")).not.toBeNull();
  });

  it("disables activity commands when the active activity does not provide them", async () => {
    const { user } = renderMenuBar({
      onPaste: undefined,
      onSelectAll: undefined,
      onZoomIn: undefined,
      onZoomOut: undefined,
      onResetZoom: undefined,
      onToggleSource: undefined,
    });

    await user.click(screen.getByText("Edit"));
    expect(screen.getByText("Paste").closest('[role="menuitem"]')?.getAttribute("data-disabled")).not.toBeNull();
    expect(screen.getByText("Select All").closest('[role="menuitem"]')?.getAttribute("data-disabled")).not.toBeNull();

    await user.keyboard("{Escape}");
    await user.click(screen.getByText("View"));
    expect(screen.getByText("Zoom In").closest('[role="menuitem"]')?.getAttribute("data-disabled")).not.toBeNull();
    expect(screen.getByText("Zoom Out").closest('[role="menuitem"]')?.getAttribute("data-disabled")).not.toBeNull();
    expect(screen.getByText("Reset Zoom").closest('[role="menuitem"]')?.getAttribute("data-disabled")).not.toBeNull();
    expect(screen.getByText("MNX Source").closest('[role="menuitem"]')?.getAttribute("data-disabled")).not.toBeNull();
  });
});
