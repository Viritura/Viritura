// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEffect, type ReactNode } from "react";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Score } from "@viritura/core";
import { TooltipPrimitives } from "@viritura/ui";
import { NotationInspector } from "../components/NotationInspector";
import { TempoSection } from "../components/inspector/TempoSection";
import { sectionForElementType } from "../components/inspector/notationInspectorMeta";
import { DocumentProvider, useDocumentActions } from "../store/DocumentContext";
import { useSelectionActions, resetSelectionStore } from "../store/selectionStore";

// Primitives (Button, IconButton, …) wrap their rendered DOM in <Tooltip>
// when a `tooltip` prop is set; the hoisted TooltipPrimitives.Provider that
// runs in AppShell / Storybook doesn't run in tests, so each test that mounts
// a primitive with a tooltip needs to set one up.
function withProviders(children: ReactNode) {
  return (
    <TooltipPrimitives.Provider delayDuration={0}>
      <DocumentProvider>{children}</DocumentProvider>
    </TooltipPrimitives.Provider>
  );
}

function buildScore(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{}] },
    parts: [
      {
        name: "Piano",
        measures: [
          {
            measureRepeat: { number: 2 },
            sequences: [
              {
                content: [
                  {
                    type: "event",
                    id: "ev1",
                    duration: { base: "quarter" },
                    notes: [{ id: "n1", pitch: { step: "C", octave: 4 }, ties: [{ target: "n2" }] }],
                    slurs: [{ target: "ev2", lineType: "solid" }],
                    markings: {
                      breath: { symbol: "comma" },
                      tremolo: { marks: 2 },
                      fermata: { shape: "normal" },
                      trill: { accidental: 1 },
                      ornaments: ["turn"],
                      fingerings: [{ finger: 1 }],
                    },
                  },
                  {
                    type: "event",
                    id: "ev2",
                    duration: { base: "quarter" },
                    notes: [{ id: "n2", pitch: { step: "C", octave: 4 } }],
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

function Harness({ elementId }: { elementId?: string }) {
  const { loadScore } = useDocumentActions();
  const { selectElement } = useSelectionActions();

  useEffect(() => {
    loadScore(buildScore(), "test.mnx");
    if (elementId) {
      selectElement(elementId);
    }
  }, [loadScore, selectElement, elementId]);

  return <NotationInspector />;
}

function buildGraceSlurScore(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{}] },
    parts: [
      {
        name: "Piano",
        measures: [
          {
            sequences: [
              {
                content: [
                  {
                    type: "grace",
                    content: [
                      {
                        type: "event",
                        id: "g1",
                        duration: { base: "eighth" },
                        notes: [{ id: "gn1", pitch: { step: "D", octave: 5 } }],
                        slurs: [{ target: "ev1", lineType: "solid" }],
                      },
                    ],
                  },
                  {
                    type: "event",
                    id: "ev1",
                    duration: { base: "quarter" },
                    notes: [{ id: "n1", pitch: { step: "C", octave: 5 } }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  } as Score;
}

function GraceSlurHarness({ elementId }: { elementId?: string }) {
  const { loadScore } = useDocumentActions();
  const { selectElement } = useSelectionActions();

  useEffect(() => {
    loadScore(buildGraceSlurScore(), "grace.mnx");
    if (elementId) {
      selectElement(elementId);
    }
  }, [loadScore, selectElement, elementId]);

  return <NotationInspector />;
}

describe("NotationInspector", () => {
  afterEach(() => {
    cleanup();
    resetSelectionStore();
  });

  it("renders an empty state when nothing is selected", async () => {
    render(withProviders(<Harness />));

    expect(await screen.findByTestId("notation-inspector")).toBeTruthy();
    expect(screen.getByText("No current selection")).toBeTruthy();
    expect(screen.getByText(/Select a note, marking, barline/)).toBeTruthy();
  });

  it("updates accidental display properties from the notation panel", async () => {
    render(withProviders(<Harness elementId="p0/m0/s0/ev1/n0" />));

    const show = (await screen.findByRole("checkbox", { name: "Show" })) as HTMLInputElement;
    const courtesy = screen.getByRole("checkbox", { name: "Courtesy (A)" }) as HTMLInputElement;
    const parentheses = screen.getByRole("checkbox", { name: "( )" }) as HTMLInputElement;

    expect(show.checked).toBe(false);
    fireEvent.click(show);
    await waitFor(() => expect(show.checked).toBe(true));

    fireEvent.click(courtesy);
    await waitFor(() => expect(courtesy.checked).toBe(true));

    fireEvent.click(parentheses);
    await waitFor(() => expect(parentheses.checked).toBe(true));
  });

  it("edits a selected measure repeat's number display and counter", async () => {
    render(withProviders(<Harness elementId="p0/m0/measurerepeat" />));

    expect(await screen.findByText("Measure Repeat")).toBeTruthy();
    const auto = screen.getByRole("radio", { name: "Auto" });
    const hide = screen.getByRole("radio", { name: "Hide" });
    expect(auto.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(hide);
    await waitFor(() => expect(hide.getAttribute("aria-checked")).toBe("true"));

    const counter = screen.getByRole("checkbox", { name: "Show iteration counter" }) as HTMLInputElement;
    fireEvent.click(counter);
    await waitFor(() => expect(counter.checked).toBe(true));
    expect(screen.getByRole("spinbutton", { name: "Counter" })).toBeTruthy();
  });

  it("keeps tempo text responsive while deferring the expensive score update", () => {
    const onTextChange = vi.fn();
    render(
      <TempoSection
        tempo={{ bpm: 120, value: { base: "quarter" }, text: "" }}
        onBpmChange={vi.fn()}
        onValueBaseChange={vi.fn()}
        onDotsChange={vi.fn()}
        onTextChange={onTextChange}
        onShowTextChange={vi.fn()}
        onShowMetronomeChange={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholderText("e.g. Allegro con brio") as HTMLInputElement;
    for (const value of ["A", "Al", "All", "Alle", "Alleg", "Allegro", "Allegro con brio"]) {
      fireEvent.change(input, { target: { value } });
    }

    expect(input.value).toBe("Allegro con brio");
    expect(onTextChange).not.toHaveBeenCalled();

    fireEvent.blur(input);
    expect(onTextChange).toHaveBeenCalledOnce();
    expect(onTextChange).toHaveBeenCalledWith("Allegro con brio");
  });

  it("allows BPM to be cleared while editing and commits the replacement value", () => {
    const onBpmChange = vi.fn();
    render(
      <TempoSection
        tempo={{ bpm: 120, value: { base: "quarter" } }}
        onBpmChange={onBpmChange}
        onValueBaseChange={vi.fn()}
        onDotsChange={vi.fn()}
        onTextChange={vi.fn()}
        onShowTextChange={vi.fn()}
        onShowMetronomeChange={vi.fn()}
      />,
    );

    const input = screen.getByRole("spinbutton", { name: "BPM" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    expect(input.value).toBe("");
    expect(onBpmChange).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "96" } });
    expect(input.value).toBe("96");
    fireEvent.blur(input);

    expect(onBpmChange).toHaveBeenCalledOnce();
    expect(onBpmChange).toHaveBeenCalledWith(96);
  });

  it("commits a fractional BPM value", () => {
    const onBpmChange = vi.fn();
    render(
      <TempoSection
        tempo={{ bpm: 120, value: { base: "quarter" } }}
        onBpmChange={onBpmChange}
        onValueBaseChange={vi.fn()}
        onDotsChange={vi.fn()}
        onTextChange={vi.fn()}
        onShowTextChange={vi.fn()}
        onShowMetronomeChange={vi.fn()}
      />,
    );

    const input = screen.getByRole("spinbutton", { name: "BPM" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "116.5" } });
    fireEvent.blur(input);

    expect(onBpmChange).toHaveBeenCalledOnce();
    expect(onBpmChange).toHaveBeenCalledWith(116.5);
  });

  it("restores the current BPM when an empty draft loses focus", () => {
    render(
      <TempoSection
        tempo={{ bpm: 120, value: { base: "quarter" } }}
        onBpmChange={vi.fn()}
        onValueBaseChange={vi.fn()}
        onDotsChange={vi.fn()}
        onTextChange={vi.fn()}
        onShowTextChange={vi.fn()}
        onShowMetronomeChange={vi.fn()}
      />,
    );

    const input = screen.getByRole("spinbutton", { name: "BPM" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);

    expect(input.value).toBe("120");
  });

  it("edits advanced tie and slur properties", async () => {
    render(withProviders(<Harness elementId="p0/m0/s0/ev1" />));

    const tieSideInput = (await screen.findByTestId("notation-tie-side")) as HTMLInputElement;
    fireEvent.change(tieSideInput, { target: { value: "up" } });
    await waitFor(() => {
      expect((screen.getByTestId("notation-tie-side") as HTMLInputElement).value).toBe("up");
    });

    const slurLineTypeSelect = screen.getByTestId("notation-slur-line-type") as HTMLSelectElement;
    fireEvent.change(slurLineTypeSelect, { target: { value: "dashed" } });
    await waitFor(() => {
      expect((screen.getByTestId("notation-slur-line-type") as HTMLSelectElement).value).toBe("dashed");
    });
  });

  it("edits layout override properties (stem direction)", async () => {
    render(withProviders(<Harness elementId="p0/m0/s0/ev1" />));

    const stemSelect = (await screen.findByTestId("notation-layout-stem")) as HTMLSelectElement;
    expect(stemSelect.disabled).toBe(false);
    fireEvent.change(stemSelect, { target: { value: "up" } });
    await waitFor(() => {
      expect((screen.getByTestId("notation-layout-stem") as HTMLSelectElement).value).toBe("up");
    });
  });

  it("opens the panel and shows the slur section for a grace-note slur", async () => {
    render(withProviders(<GraceSlurHarness elementId="slur/g1/ev1" />));

    // Regression: a grace-note slur id (`slur/{graceId}/{principalId}`) failed
    // to resolve a selection target, so the inspector rendered nothing.
    expect(await screen.findByTestId("notation-inspector")).toBeTruthy();

    const slurTarget = (await screen.findByTestId("notation-slur-target")) as HTMLInputElement;
    expect(slurTarget.value).toBe("ev1");
  });

  it("edits a grace-note slur's line type", async () => {
    render(withProviders(<GraceSlurHarness elementId="slur/g1/ev1" />));

    const slurLineTypeSelect = (await screen.findByTestId("notation-slur-line-type")) as HTMLSelectElement;
    fireEvent.change(slurLineTypeSelect, { target: { value: "dashed" } });
    await waitFor(() => {
      expect((screen.getByTestId("notation-slur-line-type") as HTMLSelectElement).value).toBe("dashed");
    });
  });

  it("shows the grace note's own slur when the grace note is selected directly", async () => {
    render(withProviders(<GraceSlurHarness elementId="p0/m0/s0/ev1/grace/g1" />));

    // The grace element id must resolve to the grace event, not its principal
    // (which carries no slur), so the slur section reflects the grace's slur.
    const slurTarget = (await screen.findByTestId("notation-slur-target")) as HTMLInputElement;
    expect(slurTarget.value).toBe("ev1");
  });
});

describe("sectionForElementType", () => {
  it("maps event types to event section", () => {
    expect(sectionForElementType("event")).toBe("event");
    expect(sectionForElementType("rest")).toBe("event");
  });

  it("maps markings types to markings section", () => {
    expect(sectionForElementType("articulation")).toBe("markings");
    expect(sectionForElementType("fermata")).toBe("markings");
    expect(sectionForElementType("ornament")).toBe("markings");
    expect(sectionForElementType("trill")).toBe("markings");
    expect(sectionForElementType("fingering")).toBe("markings");
    expect(sectionForElementType("arpeggio")).toBe("markings");
    expect(sectionForElementType("tremolo")).toBe("markings");
    expect(sectionForElementType("breath")).toBe("markings");
  });

  it("maps directions types to directions section", () => {
    expect(sectionForElementType("dynamic")).toBe("directions");
    expect(sectionForElementType("hairpin")).toBe("directions");
    expect(sectionForElementType("pedal")).toBe("directions");
    expect(sectionForElementType("ottava")).toBe("directions");
    expect(sectionForElementType("expression")).toBe("directions");
    expect(sectionForElementType("chord-symbol")).toBe("directions");
  });

  it("maps global directions types to directions section", () => {
    expect(sectionForElementType("tempo")).toBe("directions");
    expect(sectionForElementType("rehearsal")).toBe("directions");
    expect(sectionForElementType("jump")).toBe("directions");
    expect(sectionForElementType("volta")).toBe("directions");
    expect(sectionForElementType("caesura")).toBe("directions");
  });

  it("maps tie and slur to their sections", () => {
    expect(sectionForElementType("tie")).toBe("tie");
    expect(sectionForElementType("slur")).toBe("slur");
  });

  it("maps measure-level types to measure section", () => {
    expect(sectionForElementType("barline")).toBe("measure");
    expect(sectionForElementType("clef")).toBe("measure");
    expect(sectionForElementType("key-signature")).toBe("measure");
    expect(sectionForElementType("time-signature")).toBe("measure");
    expect(sectionForElementType("measure-number")).toBe("measure");
  });

  it("maps structural types to layout section", () => {
    expect(sectionForElementType("beam")).toBe("layout");
    expect(sectionForElementType("tuplet")).toBe("layout");
    expect(sectionForElementType("grace-note")).toBe("layout");
  });

  it("returns null for unknown types", () => {
    expect(sectionForElementType("unknown")).toBeNull();
  });
});
