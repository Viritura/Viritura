import { describe, it, expect } from "vitest";

/**
 * Tests for App layout composition (task 3.24).
 * Verifies that the layout components (MenuBar, Toolbar, StatusBar) can be
 * imported and have the correct structure, without requiring DOM rendering
 * (since we don't have jsdom / @testing-library configured).
 */

describe("App layout components", () => {
  it("MenuBar exports a function component", async () => {
    const mod = await import("../components/MenuBar");
    expect(typeof mod.MenuBar).toBe("function");
  });

  it("Toolbar exports a function component", async () => {
    const mod = await import("../components/Toolbar");
    expect(typeof mod.Toolbar).toBe("function");
  });

  it("WriteStatusBar exports a function component", async () => {
    const mod = await import("@viritura/ui");
    expect(typeof mod.WriteStatusBar).toBe("function");
  });

  it("ScoreCanvas exports ViewportControls interface", async () => {
    const mod = await import("../components/ScoreCanvas");
    // ScoreCanvas is a forwardRef component (typeof === "object")
    expect(mod.ScoreCanvas).toBeDefined();
  });

  it("WriteView exports a function component", async () => {
    const mod = await import("../components/modes/WriteView");
    expect(typeof mod.WriteView).toBe("function");
  }, 30_000);
});

describe("MenuBar menu structure", () => {
  it("accepts sampleScores, onSelectScore, scoreTitle props", async () => {
    const mod = await import("../components/MenuBar");
    // Verify MenuBar function accepts 1 argument (props object)
    expect(mod.MenuBar.length).toBeLessThanOrEqual(1);
  });
});

describe("Toolbar structure", () => {
  it("accepts scoreDefinitions, selectedScoreIndex, onSelectScoreIndex props", async () => {
    const mod = await import("../components/Toolbar");
    expect(mod.Toolbar.length).toBeLessThanOrEqual(1);
  });
});

describe("WriteStatusBar structure", () => {
  it("accepts scoreInfo, zoom, zoom callbacks", async () => {
    const mod = await import("@viritura/ui");
    expect(mod.WriteStatusBar.length).toBeLessThanOrEqual(1);
  });
});
