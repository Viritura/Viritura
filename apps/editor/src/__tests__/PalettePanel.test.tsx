import { useEffect, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Score } from "@viritura/core";
import { TooltipPrimitives } from "@viritura/ui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { PalettePanel } from "../components/PalettePanel";
import { DocumentProvider, useDocumentStore } from "../store/DocumentContext";
import { resetSelectionStore, useSelectionStore, type Selection } from "../store/selectionStore";
import { setChordSymbolPopover, useOverlayStore } from "../store/overlayStore";

const SCORE: Score = {
  mnx: { version: 1 },
  global: { measures: [{}, {}] },
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
                  id: "cross-bar-start",
                  duration: { base: "half" },
                  notes: [{ pitch: { step: "B", octave: 3 } }],
                },
              ],
            },
          ],
        },
        {
          sequences: [
            {
              content: [
                {
                  type: "event",
                  id: "first-note",
                  duration: { base: "half" },
                  notes: [
                    { id: "first-note-low", pitch: { step: "C", octave: 4 } },
                    { id: "first-note-high", pitch: { step: "E", octave: 4 } },
                  ],
                },
                {
                  type: "event",
                  id: "second-note",
                  duration: { base: "quarter" },
                  notes: [{ id: "second-note-id", pitch: { step: "G", octave: 4 } }],
                },
              ],
            },
            {
              content: [{ type: "event", id: "first-rest", duration: { base: "whole" }, rest: {} }],
            },
          ],
        },
      ],
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetSelectionStore();
  setChordSymbolPopover(null);
  localStorage.removeItem("viritura.palettes.order.v1");
  localStorage.removeItem("viritura.palettes.open.v1");
});

function WithScore({
  children,
  initialScore = SCORE,
}: {
  readonly children: ReactNode;
  readonly initialScore?: Score;
}) {
  const loadScore = useDocumentStore((state) => state.loadScore);
  const score = useDocumentStore((state) => state.score);
  useEffect(() => loadScore(initialScore, "palette-test.mnx"), [initialScore, loadScore]);
  return score ? (
    <>
      {children}
      <output data-testid="score">{JSON.stringify(score)}</output>
      <output data-testid="rehearsal-mark-0">
        {(score.global.measures[0] as Record<string, unknown>).rehearsalMark
          ? JSON.stringify((score.global.measures[0] as Record<string, unknown>).rehearsalMark)
          : ""}
      </output>
      <output data-testid="rehearsal-mark">
        {(score.global.measures[1] as Record<string, unknown>).rehearsalMark
          ? JSON.stringify((score.global.measures[1] as Record<string, unknown>).rehearsalMark)
          : ""}
      </output>
      <output data-testid="time-0">{JSON.stringify(score.global.measures[0]?.time ?? null)}</output>
      <output data-testid="time-1">{JSON.stringify(score.global.measures[1]?.time ?? null)}</output>
      <output data-testid="barline-1">{JSON.stringify(score.global.measures[1]?.barline ?? null)}</output>
      <output data-testid="arpeggios-1">{JSON.stringify(score.parts[0]?.measures[1]?.arpeggios ?? null)}</output>
      <output data-testid="tuplet-spans">
        {JSON.stringify(
          score.parts[0]?.measures.flatMap(
            (measure) =>
              measure.sequences[0]?.content
                .filter((item) => item.type === "tuplet")
                .map((item) => (item.type === "tuplet" ? item.span : null)) ?? [],
          ),
        )}
      </output>
      <output data-testid="glissandos-1">
        {JSON.stringify(
          (score.parts[0]?.measures[1]?.sequences[0]?.content[0] as { glissandos?: unknown[] })?.glissandos ?? null,
        )}
      </output>
      <output data-testid="first-note-markings">
        {JSON.stringify(
          (score.parts[0]?.measures[1]?.sequences[0]?.content[0] as { markings?: unknown })?.markings ?? null,
        )}
      </output>
    </>
  ) : null;
}

describe("PalettePanel", () => {
  it.each([
    "Tie (T)",
    "Laissez vibrer tie (T)",
    "Slur (S)",
    "Expression text (Shift+D)",
    "System text / tempo (Shift+T)",
    "Lyrics (Shift+W)",
    "Mezzo forte",
  ])("shows the concise hover label %s without duplicate shortcuts", async (name) => {
    const user = userEvent.setup();
    render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <DocumentProvider>
          <WithScore>
            <PalettePanel />
          </WithScore>
        </DocumentProvider>
      </TooltipPrimitives.Provider>,
    );

    await user.hover(await screen.findByRole("button", { name, exact: true }));

    expect((await screen.findByRole("tooltip")).textContent).toBe(name);
  });

  it("uses the grouped default section order", async () => {
    render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <DocumentProvider>
          <WithScore>
            <PalettePanel />
          </WithScore>
        </DocumentProvider>
      </TooltipPrimitives.Provider>,
    );

    await screen.findByRole("button", { name: "Clef Shift+C", expanded: true });
    expect(
      screen.getAllByRole("button", { expanded: true }).map((button) => button.textContent?.replace(/Shift\+\w+$/, "")),
    ).toEqual([
      "Clef",
      "Key signature",
      "Time signature",
      "Tuplets",
      "Bars",
      "Tremolos",
      "Repeats & navigation",
      "Articulations",
      "Notehead markings",
      "Connections",
      "Ornaments & arpeggios",
      "Breath & fermata",
      "Dynamics",
      "Text & tempo",
      "Fingering",
      "Octaves & pedals",
    ]);
  });

  it("preserves custom ordering while dropping merged section IDs", async () => {
    localStorage.setItem(
      "viritura.palettes.order.v1",
      JSON.stringify([
        "text",
        "tempo",
        "arpeggios",
        "ornaments",
        "note-markings",
        "articulations",
        "lines",
        "ties-slurs",
      ]),
    );
    render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <DocumentProvider>
          <WithScore>
            <PalettePanel />
          </WithScore>
        </DocumentProvider>
      </TooltipPrimitives.Provider>,
    );

    await screen.findByRole("button", { name: "Text & tempo", expanded: true });
    const headings = screen.getAllByRole("button", { expanded: true });
    expect(headings).toHaveLength(16);
    expect(headings.slice(0, 6).map((button) => button.textContent?.replace(/Shift\+\w+$/, ""))).toEqual([
      "Text & tempo",
      "Ornaments & arpeggios",
      "Notehead markings",
      "Articulations",
      "Octaves & pedals",
      "Connections",
    ]);
  });

  it("keeps the six tremolo choices without a dedicated removal button", async () => {
    render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <DocumentProvider>
          <WithScore>
            <PalettePanel />
          </WithScore>
        </DocumentProvider>
      </TooltipPrimitives.Provider>,
    );

    expect(await screen.findAllByRole("button", { name: /^(Single-note|Two-note) tremolo,/ })).toHaveLength(6);
    expect(screen.queryByRole("button", { name: "Remove tremolo" })).toBeNull();
    const headings = screen.getAllByRole("button", { expanded: true });
    const tremolos = headings.indexOf(screen.getByRole("button", { name: "Tremolos Shift+R", expanded: true }));
    expect(tremolos).toBeGreaterThanOrEqual(0);
    expect(headings[tremolos + 1]).toBe(
      screen.getByRole("button", { name: "Repeats & navigation Shift+R", expanded: true }),
    );
  });

  const endingSelections: { name: string; selection: Selection; duration: number }[] = [
    {
      name: "forward note range",
      selection: { kind: "range", startElementId: "p0/m1/s0/first-note", endElementId: "p0/m2/s0/ending-note" },
      duration: 2,
    },
    {
      name: "backward note range",
      selection: { kind: "range", startElementId: "p0/m2/s0/ending-note", endElementId: "p0/m1/s0/first-note/n0" },
      duration: 2,
    },
    {
      name: "backward measure range",
      selection: {
        kind: "measure",
        startPartIndex: 0,
        endPartIndex: 0,
        startStaffIndex: 0,
        endStaffIndex: 0,
        startMeasure: 2,
        endMeasure: 1,
      },
      duration: 2,
    },
    {
      name: "multiple notes",
      selection: { kind: "multi", elementIds: ["p0/m2/s0/ending-note", "p0/m1/s0/first-note"] },
      duration: 2,
    },
    {
      name: "single note",
      selection: { kind: "single", elementId: "p0/m1/s0/first-note/n0", elementType: "note" },
      duration: 1,
    },
    {
      name: "single barline",
      selection: { kind: "single", elementId: "m2/barline", elementType: "barline" },
      duration: 1,
    },
  ];

  describe.each([
    { button: "1st ending", numbers: [1] },
    { button: "2nd ending", numbers: [2], open: true },
    { button: "1st+2nd ending", numbers: [1, 2] },
  ])("$button", ({ button, numbers, open }) => {
    it.each(endingSelections)("applies to the $name without changing earlier bars", async ({ selection, duration }) => {
      const initialScore = structuredClone(SCORE);
      initialScore.global.measures.push({});
      initialScore.parts[0]!.measures.push({
        sequences: [
          {
            content: [{ type: "event", id: "ending-note", duration: { base: "whole" }, rest: {} }],
          },
        ],
      });
      useSelectionStore.setState({ selection });
      const user = userEvent.setup();
      render(
        <TooltipPrimitives.Provider delayDuration={0}>
          <DocumentProvider>
            <WithScore initialScore={initialScore}>
              <PalettePanel />
            </WithScore>
          </DocumentProvider>
        </TooltipPrimitives.Provider>,
      );

      await user.click(await screen.findByRole("button", { name: button, exact: true }));

      const updated = JSON.parse(screen.getByTestId("score").textContent ?? "{}") as Score;
      expect(updated.global.measures[1]!.ending).toEqual({
        duration,
        numbers,
        ...(open ? { open: true } : {}),
      });
      expect(updated.global.measures[0]!.ending).toBeUndefined();
      expect(updated.global.measures[2]!.ending).toBeUndefined();
      expect(initialScore.global.measures[1]!.ending).toBeUndefined();
      expect(useSelectionStore.getState().selection).toEqual(selection);
    });
  });

  it("reports a missing ending selection instead of applying to the first bar", async () => {
    const warning = vi.spyOn(toast, "warning").mockImplementation(() => "warning");
    const user = userEvent.setup();
    render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <DocumentProvider>
          <WithScore>
            <PalettePanel />
          </WithScore>
        </DocumentProvider>
      </TooltipPrimitives.Provider>,
    );

    await user.click(await screen.findByRole("button", { name: "1st ending", exact: true }));

    expect(warning).toHaveBeenCalledWith("Select a note, rest, or measure range to apply an ending.");
    expect(JSON.parse(screen.getByTestId("score").textContent ?? "{}")).toEqual(SCORE);
  });

  it.each<{ name: string; selection: Selection; fraction: [number, number]; tuplet?: boolean }>([
    {
      name: "note",
      selection: { kind: "single", elementId: "p0/m1/s0/second-note/n0", elementType: "note" },
      fraction: [1, 2],
    },
    {
      name: "rest",
      selection: { kind: "single", elementId: "p0/m1/s1/first-rest", elementType: "rest" },
      fraction: [0, 1],
    },
    {
      name: "bar",
      selection: {
        kind: "measure",
        startPartIndex: 0,
        endPartIndex: 0,
        startStaffIndex: 0,
        endStaffIndex: 0,
        startMeasure: 1,
        endMeasure: 1,
      },
      fraction: [0, 1],
    },
    {
      name: "tuplet note",
      selection: { kind: "single", elementId: "p0/m1/s0/triplet-1/n0", elementType: "note" },
      fraction: [1, 3],
      tuplet: true,
    },
  ])(
    "creates system text at the selected $name without duplicating staff expressions",
    async ({ selection, fraction, tuplet }) => {
      const initialScore = structuredClone(SCORE);
      initialScore.global.measures[1]!.systemText = [
        { id: "existing", text: [{ text: "Existing instruction" }], position: { fraction: [0, 1] } },
      ];
      if (tuplet) {
        initialScore.parts[0]!.measures[1]!.sequences[0]!.content = [
          { type: "event", duration: { base: "quarter" }, rest: {} },
          {
            type: "tuplet",
            inner: { duration: { base: "eighth" }, multiple: 3 },
            outer: { duration: { base: "eighth" }, multiple: 2 },
            content: [0, 1, 2].map((index) => ({
              type: "event",
              id: `triplet-${index}`,
              duration: { base: "eighth" },
              notes: [{ pitch: { step: "C", octave: 4 } }],
            })),
          },
          { type: "event", duration: { base: "half" }, rest: {} },
        ];
      }
      useSelectionStore.setState({ selection });
      const user = userEvent.setup();
      render(
        <TooltipPrimitives.Provider delayDuration={0}>
          <DocumentProvider>
            <WithScore initialScore={initialScore}>
              <PalettePanel />
            </WithScore>
          </DocumentProvider>
        </TooltipPrimitives.Provider>,
      );

      await user.click(await screen.findByRole("button", { name: "System text / tempo (Shift+T)", exact: true }));
      const input = screen.getByPlaceholderText("Freely, Allegro q=180, or q=180");
      expect(document.activeElement).toBe(input);
      expect(screen.queryByRole("dialog")).toBeNull();
      act(() => useSelectionStore.setState({ selection: { kind: "none" } }));
      await user.type(input, "Freely{Enter}");

      const updated = JSON.parse(screen.getByTestId("score").textContent ?? "{}") as Score;
      expect(updated.global.measures[1]!.systemText).toEqual([
        initialScore.global.measures[1]!.systemText![0],
        {
          id: expect.any(String),
          text: [{ text: "Freely" }],
          position: { fraction },
          placement: "above",
        },
      ]);
      expect(updated.global.measures[1]!.systemText![1]!.id).not.toBe("existing");
      expect(updated.global.measures[0]).toEqual(initialScore.global.measures[0]);
      expect(updated.parts).toEqual(initialScore.parts);
      expect(initialScore.global.measures[1]!.systemText).toHaveLength(1);
    },
  );

  it.each([
    { input: "q=180", text: "", tempo: { bpm: 180, value: { base: "quarter" } } },
    { input: "Allegro (q.=90)", text: "Allegro", tempo: { bpm: 90, value: { base: "quarter", dots: 1 } } },
  ])("creates playback from $input through the merged palette entry", async ({ input, text, tempo }) => {
    useSelectionStore.setState({
      selection: { kind: "single", elementId: "p0/m1/s0/second-note", elementType: "event" },
    });
    const user = userEvent.setup();
    render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <DocumentProvider>
          <WithScore>
            <PalettePanel />
          </WithScore>
        </DocumentProvider>
      </TooltipPrimitives.Provider>,
    );

    await user.click(await screen.findByRole("button", { name: "System text / tempo (Shift+T)", exact: true }));
    const textbox = screen.getByPlaceholderText("Freely, Allegro q=180, or q=180");
    expect(textbox).toHaveProperty("value", "");
    await user.type(textbox, `${input}{Enter}`);

    const updated = JSON.parse(screen.getByTestId("score").textContent ?? "{}") as Score;
    expect(updated.global.measures[1]!.systemText).toEqual([
      { id: expect.any(String), text: [{ text }], tempo, position: { fraction: [1, 2] }, placement: "above" },
    ]);
    expect(updated.parts).toEqual(SCORE.parts);
    expect(screen.queryByPlaceholderText("Freely, Allegro q=180, or q=180")).toBeNull();
  });

  it("cancels the merged palette popover without creating an instruction", async () => {
    useSelectionStore.setState({
      selection: { kind: "single", elementId: "p0/m1", elementType: "measure" },
    });
    const user = userEvent.setup();
    render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <DocumentProvider>
          <WithScore>
            <PalettePanel />
          </WithScore>
        </DocumentProvider>
      </TooltipPrimitives.Provider>,
    );

    await user.click(await screen.findByRole("button", { name: "System text / tempo (Shift+T)", exact: true }));
    await user.keyboard("Allegro q=180{Escape}");
    expect(screen.queryByPlaceholderText("Freely, Allegro q=180, or q=180")).toBeNull();
    expect(JSON.parse(screen.getByTestId("score").textContent ?? "{}")).toEqual(SCORE);
  });

  it("reports a missing system-text selection without creating text", async () => {
    const warning = vi.spyOn(toast, "warning").mockImplementation(() => "warning");
    const user = userEvent.setup();
    render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <DocumentProvider>
          <WithScore>
            <PalettePanel />
          </WithScore>
        </DocumentProvider>
      </TooltipPrimitives.Provider>,
    );

    await user.click(await screen.findByRole("button", { name: "System text / tempo (Shift+T)", exact: true }));

    expect(warning).toHaveBeenCalledWith("Select a note, rest, or bar before adding system text.");
    expect(screen.queryByPlaceholderText("Freely, Allegro q=180, or q=180")).toBeNull();
    expect(JSON.parse(screen.getByTestId("score").textContent ?? "{}")).toEqual(SCORE);
  });

  it.each([
    { range: false, button: "8vb below", field: "ottavas" as const },
    { range: true, button: "8vb below", field: "ottavas" as const },
    { range: true, button: "Sustain pedal", field: "pedals" as const },
  ])("persists the endpoint measure ID for $button (range: $range)", async ({ range, button, field }) => {
    const initialScore = structuredClone(SCORE);
    initialScore.parts[0]!.staves = 2;
    for (const measure of initialScore.parts[0]!.measures) {
      measure.sequences[0]!.staff = 2;
    }
    initialScore.global.measures[0]!.id = "m1";
    useSelectionStore.setState({
      selection: range
        ? { kind: "range", startElementId: "p0/m0/s0/cross-bar-start", endElementId: "p0/m1/s0/first-note" }
        : { kind: "single", elementId: "p0/m1/s0/first-note" },
    });
    const user = userEvent.setup();
    render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <DocumentProvider>
          <WithScore initialScore={initialScore}>
            <PalettePanel />
          </WithScore>
        </DocumentProvider>
      </TooltipPrimitives.Provider>,
    );

    await user.click(await screen.findByRole("button", { name: button }));

    const updated = JSON.parse(screen.getByTestId("score").textContent ?? "{}") as Score;
    const spanner = updated.parts[0]!.measures[range ? 0 : 1]![field]![0]!;
    expect(spanner.staff).toBe(2);
    expect(updated.global.measures[1]!.id).toBeTruthy();
    expect(spanner.end.measure).toBe(updated.global.measures[1]!.id);
    expect(spanner.end.measure).not.toBe("m1");
    expect(updated.global.measures[0]!.id).toBe("m1");
    expect(initialScore.global.measures[1]!.id).toBeUndefined();
    if (field === "ottavas") {
      expect(updated.parts[0]!.measures[range ? 0 : 1]!.ottavas![0]!.value).toBe(-1);
    }
  });

  it("creates one linked tuplet from a range crossing a barline", async () => {
    useSelectionStore.setState({
      selection: {
        kind: "range",
        startElementId: "p0/m0/s0/cross-bar-start",
        endElementId: "p0/m1/s0/first-note",
      },
    });
    const user = userEvent.setup();
    render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <DocumentProvider>
          <WithScore>
            <PalettePanel />
          </WithScore>
        </DocumentProvider>
      </TooltipPrimitives.Provider>,
    );

    await user.click(await screen.findByRole("button", { name: /^Triplet/ }));

    const spans = JSON.parse(screen.getByTestId("tuplet-spans").textContent ?? "[]") as Array<{
      id: string;
      type: string;
    }>;
    expect(spans).toHaveLength(2);
    expect(spans.map((span) => span.type)).toEqual(["start", "stop"]);
    expect(spans[0]!.id).toBe(spans[1]!.id);
  });

  it("authors a semantic portamento between two selected notes", async () => {
    useSelectionStore.setState({
      selection: {
        kind: "multi",
        elementIds: ["p0/m1/s0/first-note", "p0/m1/s0/second-note"],
      },
    });
    const user = userEvent.setup();
    render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <DocumentProvider>
          <WithScore>
            <PalettePanel />
          </WithScore>
        </DocumentProvider>
      </TooltipPrimitives.Provider>,
    );

    await user.click(await screen.findByRole("button", { name: "Portamento" }));

    expect(screen.getByTestId("glissandos-1").textContent).toBe(
      '[{"target":"second-note","kind":"portamento","style":"straight","text":"port."}]',
    );
  });

  it("opens chord-symbol entry from the Text palette", async () => {
    useSelectionStore.setState({
      selection: { kind: "single", elementId: "p0/m1/s0/first-note/n0", elementType: "note" },
    });
    render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <DocumentProvider>
          <WithScore>
            <PalettePanel />
          </WithScore>
        </DocumentProvider>
      </TooltipPrimitives.Provider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Chord symbol/ }));

    expect(useOverlayStore.getState().chordSymbolPopover).toMatchObject({
      partIndex: 0,
      measureIndex: 1,
      sequenceIndex: 0,
      eventIndex: 0,
      anchorElementId: "p0/m1/s0/first-note",
    });
  });

  it("offers the same standard and Henze fermata variants as the radial menu", async () => {
    render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <DocumentProvider>
          <WithScore>
            <PalettePanel />
          </WithScore>
        </DocumentProvider>
      </TooltipPrimitives.Provider>,
    );

    for (const name of [
      "Normal fermata",
      "Very short fermata",
      "Short fermata",
      "Long fermata",
      "Very long fermata",
      "Long Henze fermata",
    ]) {
      expect(await screen.findByRole("button", { name })).toBeTruthy();
    }
  });

  it("applies an arpeggio to a selected chord", async () => {
    useSelectionStore.setState({
      selection: { kind: "single", elementId: "p0/m1/s0/first-note", elementType: "event" },
    });
    const user = userEvent.setup();
    render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <DocumentProvider>
          <WithScore>
            <PalettePanel />
          </WithScore>
        </DocumentProvider>
      </TooltipPrimitives.Provider>,
    );

    const arpeggio = await screen.findByRole("button", { name: "Upward arpeggio" });
    const ornaments = screen.getByRole("button", { name: "Ornaments & arpeggios Shift+E", expanded: true });
    const content = document.getElementById(ornaments.getAttribute("aria-controls")!);
    expect(content).not.toBeNull();
    for (const button of within(content!).getAllByRole("button")) {
      expect(button.parentElement).toBe(arpeggio.parentElement);
    }
    await user.click(arpeggio);

    expect(screen.getByTestId("arpeggios-1").textContent).toBe(
      '[{"position":{"fraction":[0,1]},"span":{"start":"first-note-low","end":"first-note-high"},"direction":"up","arrow":true}]',
    );
  });

  it("keeps notehead markings separate and applies a scoop only to the selected chord note", async () => {
    useSelectionStore.setState({
      selection: { kind: "single", elementId: "p0/m1/s0/first-note/n0", elementType: "note" },
    });
    const user = userEvent.setup();
    render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <DocumentProvider>
          <WithScore>
            <PalettePanel />
          </WithScore>
        </DocumentProvider>
      </TooltipPrimitives.Provider>,
    );

    const heading = await screen.findByRole("button", { name: "Notehead markings", expanded: true });
    const content = document.getElementById(heading.getAttribute("aria-controls")!);
    expect(content).not.toBeNull();
    const scoop = within(content!).getByRole("button", { name: "Scoop", exact: true });
    expect(
      within(content!)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual(["Scoop", "Plop", "Falloff", "Doit"]);
    const articulations = screen.getByRole("button", { name: "Articulations Shift+A", expanded: true });
    const articulationContent = document.getElementById(articulations.getAttribute("aria-controls")!);
    expect(articulationContent).not.toBeNull();
    expect(within(articulationContent!).queryByRole("button", { name: "Scoop", exact: true })).toBeNull();

    await user.click(scoop);

    const updated = JSON.parse(screen.getByTestId("score").textContent ?? "{}") as Score;
    const chord = updated.parts[0]?.measures[1]?.sequences[0]?.content[0];
    if (chord?.type !== "event") throw new Error("Expected the selected chord event");
    expect(chord.notes?.[0]?.markings?.slideIn).toEqual({ type: "scoop" });
    expect(chord.notes?.[1]?.markings).toBeUndefined();
    expect(chord.markings).toBeUndefined();
  });

  it("keeps Tie and l.v. as explicit overrides for only the selected notehead", async () => {
    const initialScore = structuredClone(SCORE);
    const content = initialScore.parts[0]!.measures[1]!.sequences[0]!.content;
    const source = content[0];
    const target = content[1];
    if (source?.type !== "event" || target?.type !== "event") throw new Error("Expected note events");
    source.notes![0]!.ties = [{ lv: true }];
    target.notes![0]!.pitch = { step: "C", octave: 4 };
    useSelectionStore.setState({
      selection: { kind: "single", elementId: "p0/m1/s0/first-note/n0", elementType: "note" },
    });
    const user = userEvent.setup();
    render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <DocumentProvider>
          <WithScore initialScore={initialScore}>
            <PalettePanel />
          </WithScore>
        </DocumentProvider>
      </TooltipPrimitives.Provider>,
    );
    const selectedNotes = () => {
      const score = JSON.parse(screen.getByTestId("score").textContent ?? "{}") as Score;
      const event = score.parts[0]!.measures[1]!.sequences[0]!.content[0];
      if (event?.type !== "event") throw new Error("Expected the selected chord");
      return event.notes!;
    };

    await user.click(await screen.findByRole("button", { name: "Tie (T)", exact: true }));
    expect(selectedNotes()[0]!.ties).toEqual([{ target: "second-note-id" }]);
    expect(selectedNotes()[1]!.ties).toBeUndefined();

    const lv = screen.getByRole("button", { name: "Laissez vibrer tie (T)", exact: true });
    await user.click(lv);
    expect(selectedNotes()[0]!.ties).toEqual([{ lv: true }]);
    expect(selectedNotes()[1]!.ties).toBeUndefined();

    await user.click(lv);
    expect(selectedNotes()[0]!.ties).toBeUndefined();
  });

  it("does not fall back to l.v. from the explicit Tie palette button", async () => {
    useSelectionStore.setState({
      selection: { kind: "single", elementId: "p0/m1/s0/first-note/n0", elementType: "note" },
    });
    const user = userEvent.setup();
    render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <DocumentProvider>
          <WithScore>
            <PalettePanel />
          </WithScore>
        </DocumentProvider>
      </TooltipPrimitives.Provider>,
    );

    await user.click(await screen.findByRole("button", { name: "Tie (T)", exact: true }));

    expect(JSON.parse(screen.getByTestId("score").textContent ?? "{}")).toEqual(SCORE);
  });

  it("authors and clears the selected bow direction", async () => {
    useSelectionStore.setState({
      selection: { kind: "single", elementId: "p0/m1/s0/first-note", elementType: "event" },
    });
    const user = userEvent.setup();
    render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <DocumentProvider>
          <WithScore>
            <PalettePanel />
          </WithScore>
        </DocumentProvider>
      </TooltipPrimitives.Provider>,
    );

    const downBow = await screen.findByRole("button", { name: "Down-bow" });
    const articulations = screen.getByRole("button", { name: /^Articulations/, expanded: true });
    const content = document.getElementById(articulations.getAttribute("aria-controls")!);
    expect(content).not.toBeNull();
    expect(within(content!).getByRole("button", { name: "Down-bow" })).toBe(downBow);
    const upBow = within(content!).getByRole("button", { name: "Up-bow" });
    expect(downBow.parentElement).toBe(upBow.parentElement);
    for (const button of within(content!).getAllByRole("button")) {
      expect(button.parentElement).toBe(downBow.parentElement);
    }
    expect(screen.queryByRole("button", { name: "Bowing", exact: true })).toBeNull();
    await user.click(downBow);
    expect(screen.getByTestId("first-note-markings").textContent).toBe('{"bowDirection":{"direction":"down"}}');

    await user.click(downBow);
    expect(screen.getByTestId("first-note-markings").textContent).toBe("null");
  });

  it("finds bowing choices under Articulations when searching", async () => {
    const user = userEvent.setup();
    render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <DocumentProvider>
          <WithScore>
            <PalettePanel />
          </WithScore>
        </DocumentProvider>
      </TooltipPrimitives.Provider>,
    );

    await user.type(await screen.findByRole("textbox", { name: "Search palettes" }), "down-bow");

    expect(screen.getByRole("button", { name: /^Articulations/, expanded: true })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Down-bow" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Up-bow" })).toBeNull();
  });

  it.each([
    ["scoop", "Notehead markings", "Scoop"],
    ["arpeggio", "Ornaments & arpeggios Shift+E", "Upward arpeggio"],
    ["glissando", "Connections", "Glissando"],
    ["octaves", "Octaves & pedals", "8va above"],
    ["system", "Text & tempo", "System text / tempo (Shift+T)"],
    ["tempo", "Text & tempo", "System text / tempo (Shift+T)"],
    ["bpm", "Text & tempo", "System text / tempo (Shift+T)"],
    ["lyrics", "Text & tempo", "Lyrics (Shift+W)"],
    ["staff", "Text & tempo", "Staff text (Shift+X)"],
  ])("finds %s in its regrouped section", async (query, section, label) => {
    render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <DocumentProvider>
          <WithScore>
            <PalettePanel />
          </WithScore>
        </DocumentProvider>
      </TooltipPrimitives.Provider>,
    );

    fireEvent.change(await screen.findByRole("textbox", { name: "Search palettes" }), { target: { value: query } });

    const heading = screen.getByRole("button", { name: section, expanded: true });
    const content = document.getElementById(heading.getAttribute("aria-controls")!);
    expect(content).not.toBeNull();
    expect(within(content!).getByRole("button", { name: label, exact: true })).toBeTruthy();
  });

  it("applies a custom time signature to a selected measure", async () => {
    useSelectionStore.setState({
      selection: {
        kind: "measure",
        startPartIndex: 0,
        endPartIndex: 0,
        startStaffIndex: 0,
        endStaffIndex: 0,
        startMeasure: 1,
        endMeasure: 1,
      },
    });
    const user = userEvent.setup();
    render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <DocumentProvider>
          <WithScore>
            <PalettePanel />
          </WithScore>
        </DocumentProvider>
      </TooltipPrimitives.Provider>,
    );

    await user.click(await screen.findByRole("button", { name: "Custom time signature" }));
    const input = screen.getByRole("textbox", { name: "Custom time signature" });
    await user.clear(input);
    await user.type(input, "5/4");
    await user.click(screen.getByRole("button", { name: "OK" }));

    expect(screen.getByTestId("time-0").textContent).toBe("null");
    expect(screen.getByTestId("time-1").textContent).toBe('{"count":5,"unit":4}');
  });

  it.each([
    {
      name: "measure",
      selection: {
        kind: "measure",
        startPartIndex: 0,
        endPartIndex: 0,
        startStaffIndex: 0,
        endStaffIndex: 0,
        startMeasure: 1,
        endMeasure: 1,
      },
    },
    { name: "barline", selection: { kind: "single", elementId: "m1/barline", elementType: "barline" } },
    { name: "note", selection: { kind: "single", elementId: "p0/m1/s0/first-note", elementType: "event" } },
  ] satisfies { name: string; selection: Selection }[])(
    "adds a key change and double barline for a selected $name",
    async ({ selection }) => {
      useSelectionStore.setState({ selection });
      const user = userEvent.setup();
      render(
        <TooltipPrimitives.Provider delayDuration={0}>
          <DocumentProvider>
            <WithScore initialScore={structuredClone(SCORE)}>
              <PalettePanel />
            </WithScore>
          </DocumentProvider>
        </TooltipPrimitives.Provider>,
      );

      await user.click(await screen.findByRole("button", { name: "G major / E minor" }));

      const updated = JSON.parse(screen.getByTestId("score").textContent ?? "{}") as Score;
      expect(updated.global.measures[0]!.barline).toEqual({ type: "double" });
      expect(updated.global.measures[0]!.key).toBeUndefined();
      expect(updated.global.measures[1]!.key).toEqual({ fifths: 1 });
    },
  );

  it("authors open meter without offering the note-value engraving preference", async () => {
    useSelectionStore.setState({
      selection: {
        kind: "measure",
        startPartIndex: 0,
        endPartIndex: 0,
        startStaffIndex: 0,
        endStaffIndex: 0,
        startMeasure: 1,
        endMeasure: 1,
      },
    });
    const user = userEvent.setup();
    render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <DocumentProvider>
          <WithScore>
            <PalettePanel />
          </WithScore>
        </DocumentProvider>
      </TooltipPrimitives.Provider>,
    );

    await user.click(await screen.findByRole("button", { name: "Open meter" }));

    expect(screen.getByTestId("time-1").textContent).toBe('{"count":4,"unit":4,"display":"senzaMisura"}');
    expect(screen.queryByRole("button", { name: "Note-value denominator" })).toBeNull();
  });

  it.each([
    ["Heavy-light", "heavyLight"],
    ["Heavy-heavy", "heavyHeavy"],
    ["No barline", "noBarline"],
  ] as const)("authors a %s barline from the palette", async (label, type) => {
    useSelectionStore.setState({
      selection: {
        kind: "measure",
        startPartIndex: 0,
        endPartIndex: 0,
        startStaffIndex: 0,
        endStaffIndex: 0,
        startMeasure: 1,
        endMeasure: 1,
      },
    });
    const user = userEvent.setup();
    render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <DocumentProvider>
          <WithScore>
            <PalettePanel />
          </WithScore>
        </DocumentProvider>
      </TooltipPrimitives.Provider>,
    );

    await user.click(await screen.findByRole("button", { name: label }));

    expect(screen.getByTestId("barline-1").textContent).toBe(`{"type":"${type}"}`);
  });

  it.each([
    ["barline", "m1/barline", "barline"],
    ["first note", "p0/m1/s0/first-note", "note"],
    ["first rest", "p0/m1/s1/first-rest", "rest"],
  ])(
    "keeps the target captured from a selected %s while the custom dialog is open",
    async (_name, elementId, elementType) => {
      useSelectionStore.setState({
        selection: { kind: "single", elementId, elementType } as never,
      });
      const user = userEvent.setup();
      render(
        <TooltipPrimitives.Provider delayDuration={0}>
          <DocumentProvider>
            <WithScore>
              <PalettePanel />
            </WithScore>
          </DocumentProvider>
        </TooltipPrimitives.Provider>,
      );

      await user.click(await screen.findByRole("button", { name: "Custom time signature" }));
      act(() => useSelectionStore.setState({ selection: { kind: "none" } }));
      const input = screen.getByRole("textbox", { name: "Custom time signature" });
      await user.clear(input);
      await user.type(input, "4/4");
      await user.click(screen.getByRole("button", { name: "OK" }));

      expect(screen.getByTestId("time-0").textContent).toBe("null");
      expect(screen.getByTestId("time-1").textContent).toBe('{"count":4,"unit":4}');
    },
    30_000,
  );

  it("adds a rehearsal mark to a selected measure", async () => {
    useSelectionStore.setState({
      selection: {
        kind: "measure",
        startPartIndex: 0,
        endPartIndex: 0,
        startStaffIndex: 0,
        endStaffIndex: 0,
        startMeasure: 1,
        endMeasure: 1,
      },
    });
    const user = userEvent.setup();
    render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <DocumentProvider>
          <WithScore>
            <PalettePanel />
          </WithScore>
        </DocumentProvider>
      </TooltipPrimitives.Provider>,
    );

    await user.click(await screen.findByRole("button", { name: "Rehearsal mark" }));
    await user.type(screen.getByRole("textbox", { name: "Rehearsal mark" }), "B");
    await user.click(screen.getByRole("button", { name: "OK" }));

    expect(screen.getByTestId("rehearsal-mark").textContent).toBe('{"text":[{"text":"B"}]}');
  });

  it("adds a rehearsal mark at a selected barline rather than the preceding measure", async () => {
    useSelectionStore.setState({
      selection: {
        kind: "single",
        elementId: "m1/barline",
        elementType: "barline",
      },
    });
    const user = userEvent.setup();
    render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <DocumentProvider>
          <WithScore>
            <PalettePanel />
          </WithScore>
        </DocumentProvider>
      </TooltipPrimitives.Provider>,
    );

    await user.click(await screen.findByRole("button", { name: "Rehearsal mark" }));
    await user.type(screen.getByRole("textbox", { name: "Rehearsal mark" }), "C");
    await user.click(screen.getByRole("button", { name: "OK" }));

    expect(screen.getByTestId("rehearsal-mark-0").textContent).toBe("");
    expect(screen.getByTestId("rehearsal-mark").textContent).toBe('{"text":[{"text":"C"}]}');
  });
});
