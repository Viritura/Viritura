// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { Toolbar } from "../components/Toolbar";
import { resetNoteInputStore } from "../store/noteInputStore";
import { DocumentProvider, useDocument, useDocumentActions } from "../store/DocumentContext";
import { useSelectionActions, resetSelectionStore } from "../store/selectionStore";
import { TooltipPrimitives } from "@viritura/ui";
import type { Score } from "@viritura/core";

function renderToolbar(): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      createElement(TooltipPrimitives.Provider, null, createElement(DocumentProvider, null, createElement(Toolbar))),
    );
  });
  return container;
}

interface ToolbarHarness {
  loadScore: (score: Score) => void;
  selectElement: (elementId: string) => void;
  getScore: () => Score | null;
}

function HarnessBridge({ onReady }: { onReady: (h: ToolbarHarness) => void }) {
  const { loadScore } = useDocumentActions();
  const { score } = useDocument();
  const { selectElement } = useSelectionActions();

  useEffect(() => {
    onReady({ loadScore, selectElement, getScore: () => score });
  }, [onReady, loadScore, selectElement, score]);

  return null;
}

function renderToolbarWithHarness(): { container: HTMLDivElement; harness: ToolbarHarness } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let harness: ToolbarHarness | null = null;

  act(() => {
    root.render(
      createElement(
        TooltipPrimitives.Provider,
        null,
        createElement(
          DocumentProvider,
          null,
          createElement(HarnessBridge, {
            onReady: (h: ToolbarHarness) => {
              harness = h;
            },
          }),
          createElement(Toolbar),
        ),
      ),
    );
  });

  if (!harness) throw new Error("Harness not initialized");
  return {
    container,
    harness: {
      loadScore: (score) => harness!.loadScore(score),
      selectElement: (elementId) => harness!.selectElement(elementId),
      getScore: () => harness!.getScore(),
    },
  };
}

function getByTestId(container: HTMLElement, testId: string): HTMLElement {
  const el = container.querySelector(`[data-testid="${testId}"]`);
  if (!el) throw new Error(`Element with testid "${testId}" not found`);
  return el as HTMLElement;
}

function click(el: HTMLElement): void {
  act(() => {
    el.click();
  });
}

describe("Toolbar", () => {
  beforeEach(() => {
    resetNoteInputStore();
    resetSelectionStore();
  });

  it("renders the toolbar with correct role", () => {
    const c = renderToolbar();
    expect(c.querySelector('[role="toolbar"]')).not.toBeNull();
  });

  it("renders note input toggle button", () => {
    const c = renderToolbar();
    const btn = getByTestId(c, "toolbar-note-input");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
  });

  it("toggles note input active state on click", () => {
    const c = renderToolbar();
    const btn = getByTestId(c, "toolbar-note-input");
    click(btn);
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    click(btn);
    expect(btn.getAttribute("aria-pressed")).toBe("false");
  });

  it("renders all 5 default duration buttons", () => {
    const c = renderToolbar();
    for (const id of ["1", "2", "4", "8", "16"]) {
      expect(getByTestId(c, `toolbar-duration-${id}`)).toBeDefined();
    }
  });

  it("quarter note is active by default", () => {
    const c = renderToolbar();
    expect(getByTestId(c, "toolbar-duration-4").getAttribute("aria-pressed")).toBe("true");
  });

  it("shows both mode-specific natural shortcuts in the button label", () => {
    const c = renderToolbar();
    const natural = getByTestId(c, "toolbar-accidental-natural");

    expect(natural.getAttribute("aria-label")).toBe("Natural (\\ note input; 0 normal mode)");
  });

  it("clicking duration button changes active duration", () => {
    const c = renderToolbar();
    const halfBtn = getByTestId(c, "toolbar-duration-2");
    const quarterBtn = getByTestId(c, "toolbar-duration-4");
    click(halfBtn);
    expect(halfBtn.getAttribute("aria-pressed")).toBe("true");
    expect(quarterBtn.getAttribute("aria-pressed")).toBe("false");
  });

  it("renders rest button", () => {
    const c = renderToolbar();
    expect(getByTestId(c, "toolbar-rest")).toBeDefined();
  });

  it("renders a disabled beam-break button without a note selection", () => {
    const c = renderToolbar();
    expect(getByTestId(c, "toolbar-beam-break").hasAttribute("disabled")).toBe(true);
  });

  it("renders a disabled beam-together button without a note range", () => {
    const c = renderToolbar();
    expect(getByTestId(c, "toolbar-beam-together").hasAttribute("disabled")).toBe(true);
  });

  it("toggles rest on click", () => {
    const c = renderToolbar();
    const btn = getByTestId(c, "toolbar-rest");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    click(btn);
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    click(btn);
    expect(btn.getAttribute("aria-pressed")).toBe("false");
  });

  it("renders dot long-press button", () => {
    const c = renderToolbar();
    expect(getByTestId(c, "toolbar-dot")).toBeDefined();
  });

  it("renders 3 default accidental buttons", () => {
    const c = renderToolbar();
    for (const acc of ["flat", "natural", "sharp"]) {
      expect(getByTestId(c, `toolbar-accidental-${acc}`)).toBeDefined();
    }
  });

  it("clicking accidental button activates it", () => {
    const c = renderToolbar();
    const sharp = getByTestId(c, "toolbar-accidental-sharp");
    expect(sharp.getAttribute("aria-pressed")).toBe("false");
    click(sharp);
    expect(sharp.getAttribute("aria-pressed")).toBe("true");
  });

  it("clicking same accidental toggles it off", () => {
    const c = renderToolbar();
    const sharp = getByTestId(c, "toolbar-accidental-sharp");
    click(sharp);
    click(sharp);
    expect(sharp.getAttribute("aria-pressed")).toBe("false");
  });

  it("clicking different accidental switches selection", () => {
    const c = renderToolbar();
    const sharp = getByTestId(c, "toolbar-accidental-sharp");
    const flat = getByTestId(c, "toolbar-accidental-flat");
    click(sharp);
    expect(sharp.getAttribute("aria-pressed")).toBe("true");
    click(flat);
    expect(flat.getAttribute("aria-pressed")).toBe("true");
    expect(sharp.getAttribute("aria-pressed")).toBe("false");
  });

  it("applies a toolbar accidental only to the selected chord notehead", () => {
    const { container, harness } = renderToolbarWithHarness();
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        {
          name: "Harp",
          measures: [
            {
              sequences: [
                {
                  content: [
                    {
                      type: "event",
                      id: "chord",
                      duration: { base: "whole" },
                      notes: [
                        { id: "c", pitch: { step: "C", octave: 4 } },
                        { id: "e", pitch: { step: "E", octave: 4 } },
                        { id: "g", pitch: { step: "G", octave: 4 } },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    act(() => {
      harness.loadScore(score);
      harness.selectElement("p0/m0/s0/chord/n1");
    });

    click(getByTestId(container, "toolbar-accidental-flat"));

    const chord = harness.getScore()!.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    expect(chord.type).toBe("event");
    if (chord.type !== "event") return;
    expect(chord.notes!.map((note) => note.pitch.alter)).toEqual([undefined, -1, undefined]);
  });

  it("has correct aria roles for button groups", () => {
    const c = renderToolbar();
    const groups = c.querySelectorAll('[role="group"]');
    expect(groups.length).toBeGreaterThanOrEqual(2);
  });

  it("renders separators between groups", () => {
    const c = renderToolbar();
    const separators = c.querySelectorAll('[role="separator"]');
    expect(separators.length).toBeGreaterThanOrEqual(4);
  });
});
