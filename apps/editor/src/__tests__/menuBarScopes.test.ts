import { describe, expect, it, vi } from "vitest";
import type { MenuBarCallbacks } from "../components/MenuBar";
import { activityMenuCallbacks, globalMenuCallbacks } from "../app/useMenuBarWiring";

describe("menu bar callback scopes", () => {
  it("keeps document commands global and leaves viewport/editing commands to the activity", () => {
    const callbacks: MenuBarCallbacks = {
      onOpenFile: vi.fn(),
      onSave: vi.fn(),
      onUndo: vi.fn(),
      onShowHelp: vi.fn(),
      onOpenDocs: vi.fn(),
      onToggleSource: vi.fn(),
      onZoomIn: vi.fn(),
      onDelete: vi.fn(),
      onSelectAll: vi.fn(),
    };

    const global = globalMenuCallbacks(callbacks);

    expect(global.onOpenFile).toBe(callbacks.onOpenFile);
    expect(global.onSave).toBe(callbacks.onSave);
    expect(global.onUndo).toBeUndefined();
    expect(global.onShowHelp).toBe(callbacks.onShowHelp);
    expect(global.onOpenDocs).toBe(callbacks.onOpenDocs);
    expect(global.onToggleSource).toBeUndefined();
    expect(global.onZoomIn).toBeUndefined();
    expect(global.onDelete).toBeUndefined();
    expect(global.onSelectAll).toBeUndefined();
  });

  it("exposes Write panels only when the active workspace renders them", () => {
    const callbacks: MenuBarCallbacks = {
      onZoomIn: vi.fn(),
      onToggleSource: vi.fn(),
    };

    const setup = activityMenuCallbacks(callbacks, false);
    expect(setup.onZoomIn).toBe(callbacks.onZoomIn);
    expect(setup.onToggleSource).toBeUndefined();

    expect(activityMenuCallbacks(callbacks, true)).toBe(callbacks);
  });
});
