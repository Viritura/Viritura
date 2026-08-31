/**
 * Public-API smoke tests for @viritura/score-engine.
 *
 * These tests intentionally consume the package the same way an external
 * user would — only via the public `index.ts` entry point. If anything in
 * here breaks, the public API surface has changed.
 */

import { describe, it, expect } from "vitest";
import { EngineLoadError, ParseError, LayoutError, isEngineReady } from "../index";

describe("@viritura/score-engine public API", () => {
  describe("error classes", () => {
    it("EngineLoadError carries a typed code", () => {
      const e = new EngineLoadError("nope", "wasm");
      expect(e.name).toBe("EngineLoadError");
      expect(e.code).toBe("wasm");
      expect(e instanceof Error).toBe(true);
    });

    it("ParseError carries a typed code", () => {
      const e = new ParseError("nope", "schema");
      expect(e.name).toBe("ParseError");
      expect(e.code).toBe("schema");
    });

    it("LayoutError carries a typed code", () => {
      const e = new LayoutError("nope", "wasm");
      expect(e.name).toBe("LayoutError");
      expect(e.code).toBe("wasm");
    });

    it("errors preserve a `cause` for debugging", () => {
      const root = new Error("root");
      const e = new ParseError("wrapped", "json", root);
      expect(e.cause).toBe(root);
    });
  });

  describe("isEngineReady", () => {
    it("returns false before loadEngine() has been called in this process", () => {
      // In the node test env WASM is never loaded, so this should always
      // be false. (loadEngine() requires a browser environment.)
      expect(isEngineReady()).toBe(false);
    });
  });
});
