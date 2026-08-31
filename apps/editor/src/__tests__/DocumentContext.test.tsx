import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { DocumentProvider, useDocument, useDocumentActions } from "../store/DocumentContext";
import type { Score } from "@viritura/core";

// ═══════════════════════════════════════════
// Test helpers
// ═══════════════════════════════════════════

function wrapper({ children }: { children: ReactNode }) {
  return createElement(DocumentProvider, null, children);
}

function makeMinimalScore(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [{ time: { count: 4, unit: 4 } }],
    },
    parts: [
      {
        name: "Piano",
        measures: [
          {
            sequences: [
              {
                content: [
                  {
                    type: "event",
                    duration: { base: "whole" },
                    notes: [{ pitch: { step: "C", octave: 4 } }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

// ═══════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════

describe("DocumentContext", () => {
  describe("useDocument / useDocumentActions outside provider", () => {
    it("useDocument throws when used outside DocumentProvider", () => {
      expect(() => {
        renderHook(() => useDocument());
      }).toThrow("useDocument must be used within a DocumentProvider");
    });

    it("useDocumentActions throws when used outside DocumentProvider", () => {
      expect(() => {
        renderHook(() => useDocumentActions());
      }).toThrow("useDocumentActions must be used within a DocumentProvider");
    });
  });

  describe("initial state", () => {
    it("has null score, empty mnxJson, not dirty", () => {
      const { result } = renderHook(() => useDocument(), { wrapper });
      expect(result.current.score).toBeNull();
      expect(result.current.mnxJson).toBe("");
      expect(result.current.dirty).toBe(false);
      expect(result.current.fileName).toBe("");
    });
  });

  describe("loadScore", () => {
    it("sets score and serializes MNX JSON", () => {
      const { result: _docResult } = renderHook(() => useDocument(), { wrapper });
      const { result: _actionsResult } = renderHook(() => useDocumentActions(), { wrapper });

      // Need a shared wrapper to share context
      const shared = renderHook(() => ({ doc: useDocument(), actions: useDocumentActions() }), { wrapper });

      const score = makeMinimalScore();
      act(() => {
        shared.result.current.actions.loadScore(score, "test.mnx");
      });

      expect(shared.result.current.doc.score).toBe(score);
      expect(shared.result.current.doc.mnxJson).toBeTruthy();
      expect(shared.result.current.doc.dirty).toBe(false);
      expect(shared.result.current.doc.fileName).toBe("test.mnx");

      // MNX JSON should be valid JSON
      const parsed = JSON.parse(shared.result.current.doc.mnxJson);
      expect(parsed.mnx.version).toBe(1);
      expect(parsed.parts).toHaveLength(1);
    });

    it("uses empty string for fileName when not provided", () => {
      const shared = renderHook(() => ({ doc: useDocument(), actions: useDocumentActions() }), { wrapper });

      act(() => {
        shared.result.current.actions.loadScore(makeMinimalScore());
      });

      expect(shared.result.current.doc.fileName).toBe("");
    });
  });

  describe("updateScore", () => {
    it("marks document as dirty", () => {
      const shared = renderHook(() => ({ doc: useDocument(), actions: useDocumentActions() }), { wrapper });

      const score = makeMinimalScore();
      act(() => {
        shared.result.current.actions.loadScore(score, "test.mnx");
      });
      expect(shared.result.current.doc.dirty).toBe(false);

      const modified = { ...score, mnx: { version: 2 } };
      act(() => {
        shared.result.current.actions.updateScore(modified);
      });

      expect(shared.result.current.doc.dirty).toBe(true);
      expect(shared.result.current.doc.score).toBe(modified);

      // MNX JSON should reflect the update
      const parsed = JSON.parse(shared.result.current.doc.mnxJson);
      expect(parsed.mnx.version).toBe(2);
    });
  });

  describe("newScore", () => {
    it("resets to empty state", () => {
      const shared = renderHook(() => ({ doc: useDocument(), actions: useDocumentActions() }), { wrapper });

      act(() => {
        shared.result.current.actions.loadScore(makeMinimalScore(), "test.mnx");
      });
      expect(shared.result.current.doc.score).not.toBeNull();

      act(() => {
        shared.result.current.actions.newScore();
      });

      expect(shared.result.current.doc.score).toBeNull();
      expect(shared.result.current.doc.mnxJson).toBe("");
      expect(shared.result.current.doc.dirty).toBe(false);
      expect(shared.result.current.doc.fileName).toBe("");
    });
  });

  describe("loadScoreFromUrl", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("fetches, parses, and stores score from URL", async () => {
      const mnxData = {
        mnx: { version: 1 },
        global: { measures: [{ time: { count: 4, unit: 4 } }] },
        parts: [
          {
            name: "Flute",
            measures: [
              {
                sequences: [
                  {
                    content: [
                      {
                        duration: { base: "whole" },
                        rest: {},
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };

      const jsonText = JSON.stringify(mnxData);
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(jsonText),
      } as Response);

      const shared = renderHook(() => ({ doc: useDocument(), actions: useDocumentActions() }), { wrapper });

      await act(async () => {
        await shared.result.current.actions.loadScoreFromUrl("scores/test.mnx");
      });

      expect(shared.result.current.doc.score).not.toBeNull();
      expect(shared.result.current.doc.score!.parts[0]!.name).toBe("Flute");
      // After parsing, IDs are auto-assigned to elements that lacked them,
      // so the serialized JSON won't exactly match the input.
      // Verify structure is preserved and IDs were assigned.
      const roundtripped = JSON.parse(shared.result.current.doc.mnxJson!);
      expect(roundtripped.mnx.version).toBe(1);
      expect(roundtripped.parts).toHaveLength(1);
      expect(roundtripped.parts[0].name).toBe("Flute");
      // Global measure and part should now have auto-assigned IDs
      expect(shared.result.current.doc.score!.global.measures[0]!.id).toBeTruthy();
      expect(shared.result.current.doc.score!.parts[0]!.id).toBeTruthy();
      expect(shared.result.current.doc.dirty).toBe(false);
      expect(shared.result.current.doc.fileName).toBe("scores/test.mnx");
    });

    it("throws on fetch failure", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      } as Response);

      const shared = renderHook(() => ({ doc: useDocument(), actions: useDocumentActions() }), { wrapper });

      await expect(
        act(async () => {
          await shared.result.current.actions.loadScoreFromUrl("scores/bad.mnx");
        }),
      ).rejects.toThrow("Failed to load MNX file: 404 Not Found");
    });
  });
});
