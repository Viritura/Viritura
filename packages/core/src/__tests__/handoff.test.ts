import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  encodeHandoff,
  buildHandoffUrl,
  readHandoffFromHash,
  clearHandoffFromUrl,
  MAX_HANDOFF_BYTES,
  type ScoreHandoff,
} from "../handoff";

const sampleHandoff: ScoreHandoff = {
  v: 1,
  ts: "2026-05-14T00:00:00.000Z",
  fileName: "Converted.mnx",
  sourceName: "original.mxl",
  json: JSON.stringify({ mnx: { version: 1 }, parts: [], scores: [] }),
};

describe("handoff", () => {
  describe("encodeHandoff", () => {
    it("encodes to a non-empty fragment with the expected key", () => {
      const frag = encodeHandoff(sampleHandoff);
      expect(frag).toMatch(/^h=/);
      expect(frag!.length).toBeGreaterThan(20);
    });

    it("returns null when payload exceeds MAX_HANDOFF_BYTES", () => {
      const huge: ScoreHandoff = {
        ...sampleHandoff,
        json: "x".repeat(MAX_HANDOFF_BYTES + 100),
      };
      expect(encodeHandoff(huge)).toBeNull();
    });

    it("round-trips through readHandoffFromHash", () => {
      const frag = encodeHandoff(sampleHandoff);
      const decoded = readHandoffFromHash(`#${frag}`);
      expect(decoded).toEqual(sampleHandoff);
    });

    it("survives unicode in fileName", () => {
      const handoff: ScoreHandoff = {
        ...sampleHandoff,
        fileName: "Sonate für Klavier — Allegro.mnx",
        sourceName: "调音.mxl",
      };
      const frag = encodeHandoff(handoff);
      const decoded = readHandoffFromHash(`#${frag}`);
      expect(decoded).toEqual(handoff);
    });
  });

  describe("buildHandoffUrl", () => {
    it("appends fragment with trailing slash", () => {
      const url = buildHandoffUrl("http://localhost:5173", sampleHandoff);
      expect(url).toMatch(/^http:\/\/localhost:5173\/#h=/);
    });

    it("preserves trailing slash if already present", () => {
      const url = buildHandoffUrl("http://localhost:5173/", sampleHandoff);
      expect(url).toMatch(/^http:\/\/localhost:5173\/#h=/);
      // No double slash:
      expect(url).not.toMatch(/\/\/#/);
    });

    it("strips any pre-existing fragment from the editor URL", () => {
      const url = buildHandoffUrl("http://x/#stale", sampleHandoff);
      expect(url).not.toContain("stale");
      expect(url).toMatch(/#h=/);
    });

    it("returns null when payload is too large", () => {
      const huge: ScoreHandoff = {
        ...sampleHandoff,
        json: "x".repeat(MAX_HANDOFF_BYTES + 100),
      };
      expect(buildHandoffUrl("http://x", huge)).toBeNull();
    });
  });

  describe("readHandoffFromHash", () => {
    it("returns null on empty hash", () => {
      expect(readHandoffFromHash("")).toBeNull();
      expect(readHandoffFromHash("#")).toBeNull();
    });

    it("returns null when fragment lacks the handoff key", () => {
      expect(readHandoffFromHash("#other=foo")).toBeNull();
    });

    it("returns null on malformed base64", () => {
      expect(readHandoffFromHash("#h=!!!not-base64!!!")).toBeNull();
    });

    it("returns null on valid base64 of non-JSON", () => {
      expect(readHandoffFromHash("#h=bm9wZQ==")).toBeNull(); // "nope"
    });

    it("rejects payloads with the wrong schema version", () => {
      const fakeOld = { v: 0, ts: "x", fileName: "a", sourceName: "b", json: "{}" };
      const bytes = new TextEncoder().encode(JSON.stringify(fakeOld));
      let bin = "";
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
      const b64 = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      expect(readHandoffFromHash(`#h=${b64}`)).toBeNull();
    });
  });

  describe("clearHandoffFromUrl", () => {
    // These tests need a DOM. core's vitest runs in node by default; gate
    // them on `window` so the suite passes everywhere and gets real coverage
    // when the editor (jsdom) imports it transitively.
    const hasWindow = typeof window !== "undefined";
    const itDom = hasWindow ? it : it.skip;
    let originalHref = "";
    beforeEach(() => {
      if (hasWindow) originalHref = window.location.href;
    });
    afterEach(() => {
      if (hasWindow) window.history.replaceState({}, "", originalHref);
    });

    itDom("removes the handoff fragment but leaves other fragment params intact", () => {
      window.history.replaceState({}, "", "/?#h=abc&other=keep");
      clearHandoffFromUrl();
      expect(window.location.hash).toBe("#other=keep");
    });

    itDom("clears the entire fragment when handoff is the only param", () => {
      window.history.replaceState({}, "", "/?#h=abc");
      clearHandoffFromUrl();
      expect(window.location.hash).toBe("");
    });

    itDom("is a no-op when no fragment is present", () => {
      window.history.replaceState({}, "", "/some/path");
      const before = window.location.href;
      clearHandoffFromUrl();
      expect(window.location.href).toBe(before);
    });
  });
});
