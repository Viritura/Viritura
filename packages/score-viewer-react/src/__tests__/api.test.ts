/**
 * Public API smoke test.
 *
 * Verifies the package exports the documented surface. We don't render
 * the component here — JSDOM + WASM is a separate concern; the engine
 * has its own tests. We only assert the type-level + module-level
 * contract that downstream consumers rely on.
 */

import { describe, it, expect } from "vitest";
import * as api from "../index";

describe("@viritura/score-viewer-react public API", () => {
  it("exports ScoreView component", () => {
    expect(typeof api.ScoreView).toBe("function");
    expect(typeof api.ScoreView.Page).toBe("function");
    expect(typeof api.ScoreView.Playhead).toBe("function");
  });

  it("exports useScoreEngine hook", () => {
    expect(typeof api.useScoreEngine).toBe("function");
  });

  it("exports ScoreViewer components", () => {
    expect(typeof api.ScoreViewer).toBe("function");
    expect(typeof api.ScoreViewerControls).toBe("function");
  });

  it("re-exports the engine surface", () => {
    expect(typeof api.loadEngine).toBe("function");
    expect(typeof api.Engine).toBe("function");
    expect(typeof api.EngineLoadError).toBe("function");
    expect(typeof api.ParseError).toBe("function");
    expect(typeof api.LayoutError).toBe("function");
  });
});
