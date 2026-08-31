// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { Score } from "@viritura/core";
import { LyricInput, type LyricInputState } from "../components/LyricInput";
import { DocumentProvider, useDocumentActions } from "../store/DocumentContext";

/**
 * Regression: the lyric re-seed effect must NOT re-run (and clobber the
 * in-progress typed value) when an unrelated score edit lands while the
 * caret target (active / elementId / lineId) is unchanged.
 */

function scoreWithVerses(line1: string, line2: string): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [
      {
        name: "P",
        measures: [
          {
            sequences: [
              {
                content: [
                  {
                    type: "event",
                    id: "ev0",
                    duration: { base: "quarter" },
                    notes: [{ pitch: { step: "C", octave: 4 } }],
                    lyrics: { lines: { "1": { type: "whole", text: line1 }, "2": { type: "whole", text: line2 } } },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  } as unknown as Score;
}

function scoreWithLyric(text: string): Score {
  return scoreWithVerses(text, "");
}

interface Harness {
  loadScore: (score: Score) => void;
  updateScore: (score: Score) => void;
}

function HarnessBridge({ onReady }: { onReady: (h: Harness) => void }) {
  const { loadScore, updateScore } = useDocumentActions();
  useEffect(() => {
    onReady({ loadScore, updateScore });
  }, [onReady, loadScore, updateScore]);
  return null;
}

const STATE: LyricInputState = { elementId: "p0/m0/s0/ev0", lineId: "1" };

function render(): { container: HTMLDivElement; harness: Harness } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let harness: Harness | null = null;
  act(() => {
    root.render(
      createElement(
        DocumentProvider,
        null,
        createElement(HarnessBridge, {
          onReady: (h: Harness) => {
            harness = h;
          },
        }),
        createElement(LyricInput, {
          active: true,
          state: STATE,
          navIndex: null,
          position: { x: 0, y: 0 },
          onCommitSyllable: () => {},
          onNavigate: () => {},
          onExit: () => {},
        }),
      ),
    );
  });
  if (!harness) throw new Error("harness not ready");
  return { container, harness };
}

function getInput(): HTMLInputElement {
  // LyricInput renders through a portal into document.body.
  const input = document.body.querySelector("input");
  if (!input) throw new Error("lyric input not found");
  return input as HTMLInputElement;
}

function typeInto(input: HTMLInputElement, text: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("LyricInput re-seed", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("does not clobber in-progress typing when an unrelated score edit lands", () => {
    const { harness } = render();
    act(() => {
      harness.loadScore(scoreWithLyric(""));
    });

    // Simulate the user typing a syllable.
    typeInto(getInput(), "lo");
    expect(getInput().value).toBe("lo");

    // An unrelated score edit lands (e.g. someone else changes a different
    // measure). The caret target (elementId/lineId) is unchanged.
    act(() => {
      harness.updateScore(scoreWithLyric("ignored-existing-text"));
    });

    // The typed value must survive — the seed effect only fires on target change.
    expect(getInput().value).toBe("lo");
  });

  it("re-seeds from the score when the target verse changes", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let harness: Harness | null = null;

    function renderWith(state: LyricInputState) {
      act(() => {
        root.render(
          createElement(
            DocumentProvider,
            null,
            createElement(HarnessBridge, {
              onReady: (h: Harness) => {
                harness = h;
              },
            }),
            createElement(LyricInput, {
              active: true,
              state,
              navIndex: null,
              position: { x: 0, y: 0 },
              onCommitSyllable: () => {},
              onNavigate: () => {},
              onExit: () => {},
            }),
          ),
        );
      });
    }

    renderWith({ elementId: "p0/m0/s0/ev0", lineId: "1" });
    if (!harness) throw new Error("harness not ready");
    act(() => {
      (harness as Harness).loadScore(scoreWithVerses("hello", "world"));
    });

    // Switching verse is a genuine target change — the effect re-runs and
    // seeds the freshly targeted verse's text from the (now-loaded) score.
    renderWith({ elementId: "p0/m0/s0/ev0", lineId: "2" });
    expect(getInput().value).toBe("world");

    renderWith({ elementId: "p0/m0/s0/ev0", lineId: "1" });
    expect(getInput().value).toBe("hello");
  });
});
