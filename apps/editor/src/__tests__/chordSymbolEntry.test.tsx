// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseChordSymbolText, type ChordSymbol, type Score } from "@viritura/core";
import { TooltipPrimitives } from "@viritura/ui";
import { ChordSymbolEntryPopover } from "../app/chordSymbolEntry";
import { resolveChordSymbolTarget } from "../app/useAppKeyboardWiring";
import { ChordSymbolEntryAction } from "../components/inspector/ChordSymbolEntryAction";
import { resolveNotationSelectionTarget } from "../commands/notationInspectorCommands";
import { createDocumentStore } from "../store/documentStore";
import { setChordSymbolPopover, useOverlayStore, type ChordSymbolPopoverState } from "../store/overlayStore";
import { resetSelectionStore, useSelectionStore } from "../store/selectionStore";
import { useViewStateStore } from "../store/viewStateStore";

const { previewChord } = vi.hoisted(() => ({ previewChord: vi.fn(async (_chord: ChordSymbol, _score: Score) => {}) }));
vi.mock("@viritura/playback", () => ({ usePlaybackActions: () => ({ previewChord }) }));

const target: ChordSymbolPopoverState = {
  position: { x: 100, y: 100 },
  partIndex: 0,
  measureIndex: 0,
  sequenceIndex: 0,
  eventIndex: 0,
  anchorElementId: "p0/m0/s0/e0",
};

function buildScore(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }, {}] },
    parts: [
      {
        id: "clarinet",
        name: "Clarinet",
        chordSymbolVisibility: "hide",
        transposition: { interval: { halfSteps: 2, staffDistance: 1 } },
        measures: [
          { sequences: [{ content: [], fullMeasure: {} }] },
          { sequences: [{ content: [], fullMeasure: {} }] },
        ],
      },
    ],
    scores: [{ name: "Written", useWritten: true }],
  };
}

function setup(score = buildScore(), initialTarget = target) {
  const store = createDocumentStore();
  store.setState({ score, workingScore: score });
  const updateScore = vi.fn((next: Score) => store.setState({ workingScore: next }));
  setChordSymbolPopover(initialTarget);
  function Harness() {
    const popover = useOverlayStore((state) => state.chordSymbolPopover);
    return <ChordSymbolEntryPopover store={store} popover={popover} updateScore={updateScore} selectedScoreIndex={0} />;
  }
  const rendered = render(<Harness />);
  return { store, updateScore, ...rendered };
}

beforeEach(() => {
  previewChord.mockReset();
  previewChord.mockResolvedValue(undefined);
  resetSelectionStore();
  useViewStateStore.setState({ selectedScoreIndex: 0, selectedPartIds: [] });
});
afterEach(() => {
  cleanup();
  setChordSymbolPopover(null);
  resetSelectionStore();
});

describe("chord entry commits", () => {
  it("previews concert root and slash bass only after a successful atomic commit", () => {
    const { store, updateScore, rerender } = setup();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "C/E" } });
    expect(previewChord).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(updateScore).toHaveBeenCalledTimes(1);
    const chord = store.getState().workingScore!.global.measures[0]!.chordSymbols![0]!;
    expect(chord).toMatchObject({ root: { step: "B", alter: -1 }, bass: { step: "D" }, rawText: "Bb/D" });
    expect(store.getState().workingScore!.parts[0]!.chordSymbolVisibility).toBe("show");
    const expected = buildScore();
    expected.global.measures[0]!.chordSymbols = [parseChordSymbolText("Bb/D", { fraction: [0, 1] })];
    expected.parts[0]!.chordSymbolVisibility = "show";
    expect(previewChord).toHaveBeenCalledExactlyOnceWith(chord, expected);
    rerender(<div />);
    expect(previewChord).toHaveBeenCalledTimes(1);
  });

  it("shows unsupported status without rejecting authored text or guessing harmony", () => {
    const { store } = setup();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "mystery harmony" } });
    expect(screen.getByRole("status").textContent).toBe("Unsupported chord: cannot play this symbol.");
    expect(previewChord).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(store.getState().workingScore!.global.measures[0]!.chordSymbols![0]).toEqual({
      position: { fraction: [0, 1] },
      rawText: "mystery harmony",
    });
    expect(previewChord).toHaveBeenCalledTimes(1);
  });

  it("never previews empty typing, failed insertion, or cancellation", () => {
    const { updateScore } = setup(buildScore(), { ...target, measureIndex: 99 });
    fireEvent.keyDown(window, { key: "Enter" });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "C" } });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(updateScore).not.toHaveBeenCalled();
    expect(previewChord).not.toHaveBeenCalled();
  });

  it("loads written spelling at an equivalent onset and changes only the canonical chord", () => {
    const score = buildScore();
    score.global.measures[0]!.chordSymbols = [
      parseChordSymbolText("Bb/D", { fraction: [2, 8] }),
      parseChordSymbolText("F", { fraction: [3, 4] }),
    ];
    const { store } = setup(score, { ...target, rhythmicPosition: { fraction: [1, 4] } });
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("C/E");
    expect(previewChord).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "D/F#" } });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(store.getState().workingScore!.global.measures[0]!.chordSymbols?.map((chord) => chord.rawText)).toEqual([
      "C/E",
      "F",
    ]);
  });

  it("commits then beat-navigates full rests and loads the next existing chord", () => {
    const score = buildScore();
    score.global.measures[0]!.chordSymbols = [parseChordSymbolText("F/A", { fraction: [1, 4] })];
    const { store } = setup(score);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "C" } });
    fireEvent.keyDown(window, { key: ";" });
    expect(previewChord).toHaveBeenCalledTimes(1);
    expect(useOverlayStore.getState().chordSymbolPopover?.rhythmicPosition).toEqual({ fraction: [1, 4] });
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("G/B");
    expect(store.getState().workingScore!.global.measures[0]!.chordSymbols).toHaveLength(2);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
    fireEvent.keyDown(window, { key: "ArrowRight", ctrlKey: true });
    expect(useOverlayStore.getState().chordSymbolPopover?.measureIndex).toBe(1);
    expect(previewChord).toHaveBeenCalledTimes(1);
  });

  it("does not audition when the document is republished or layout changes", () => {
    const score = buildScore();
    score.global.measures[0]!.chordSymbols = [parseChordSymbolText("C", { fraction: [0, 1] })];
    const { store } = setup(score);
    act(() => store.setState({ score: { ...score }, workingScore: { ...score, layouts: [] } }));
    expect(previewChord).not.toHaveBeenCalled();
  });

  it("never promotes display overrides to canonical harmony on an unchanged submission", () => {
    const score = buildScore();
    score.scores![0]!.useWritten = false;
    score.global.measures[0]!.chordSymbols = [
      {
        ...parseChordSymbolText("Cmaj7", { fraction: [0, 1] }),
        textOverride: "D",
      },
    ];
    const { store } = setup(score);
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("Cmaj7");
    fireEvent.keyDown(window, { key: "Enter" });
    expect(store.getState().workingScore!.global.measures[0]!.chordSymbols![0]).toEqual(
      score.global.measures[0]!.chordSymbols![0],
    );
  });
});

describe("full-measure inspector entry", () => {
  it("resolves full rests and opens chord entry from the inspector action", () => {
    const score = buildScore();
    useSelectionStore.setState({ selection: { kind: "single", elementId: "p0/m0/s0/e0", elementType: "rest" } });
    expect(resolveNotationSelectionTarget(useSelectionStore.getState().selection, score)).toMatchObject({
      partIndex: 0,
      measureIndex: 0,
      sequenceIndex: 0,
      eventIndex: 0,
      elementType: "rest",
    });
    render(
      <TooltipPrimitives.Provider>
        <ChordSymbolEntryAction score={score} />
      </TooltipPrimitives.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add chord symbol" }));
    expect(useOverlayStore.getState().chordSymbolPopover).toMatchObject({
      partIndex: 0,
      measureIndex: 0,
      sequenceIndex: 0,
      eventIndex: 0,
    });
    expect(previewChord).not.toHaveBeenCalled();
  });
});

describe("keyboard chord source mapping", () => {
  function sourceScore(): Score {
    const score = buildScore();
    score.parts.unshift({
      id: "piano",
      measures: [{ sequences: [{ content: [], fullMeasure: {} }] }],
    });
    score.global.measures[0]!.chordSymbols = [parseChordSymbolText("C/E", { fraction: [2, 8] })];
    score.parts[1]!.chordSymbolVisibility = "show";
    score.parts[1]!.measures[0]!.sequences = [
      {
        content: [{ type: "event", id: "written-anchor", duration: { base: "whole" }, rest: {} }],
      },
    ];
    score.layouts = [
      {
        id: "written-part",
        content: [{ type: "staff", sources: [{ part: "clarinet" }] }],
      },
    ];
    score.scores![0]!.layout = "written-part";
    return score;
  }

  it.each(["m0/chord0", "m0/chord0/p0/staff8"])(
    "resolves %s from source measure bounds, not copy indices",
    (elementId) => {
      const score = sourceScore();
      const resolved = resolveChordSymbolTarget(
        score,
        {
          kind: "single",
          elementId,
          elementType: "chord-symbol",
          measureAnchor: { partIndex: 1, measureIndex: 0, staffIndex: 7, localStaffIndex: 0 },
        },
        0,
        target.position,
      );
      expect(resolved).toMatchObject({
        partIndex: 1,
        measureIndex: 0,
        sequenceIndex: 0,
        eventIndex: 0,
        anchorStaff: 1,
        anchorElementId: "p1/m0/s0/written-anchor",
        rhythmicPosition: { fraction: [2, 8] },
      });
    },
  );

  it("opens written entry on the mapped source and commits only canonical concert harmony", () => {
    const score = sourceScore();
    const resolved = resolveChordSymbolTarget(
      score,
      {
        kind: "single",
        elementId: "m0/chord0/p0/staff8",
        elementType: "chord-symbol",
        measureAnchor: { partIndex: 1, measureIndex: 0, staffIndex: 7, localStaffIndex: 0 },
      },
      0,
      target.position,
    )!;
    const { store } = setup(score, resolved);
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("D/F#");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Em/G" } });
    fireEvent.keyDown(window, { key: "Enter" });
    const next = store.getState().workingScore!;
    expect(next.global.measures[0]!.chordSymbols).toEqual([parseChordSymbolText("Dm/F", { fraction: [2, 8] })]);
    expect(next.parts[0]).toBe(score.parts[0]);
    expect(next.parts[1]!.measures).toBe(score.parts[1]!.measures);
    const expected = structuredClone(score);
    expected.global.measures[0]!.chordSymbols = [parseChordSymbolText("Dm/F", { fraction: [2, 8] })];
    expect(previewChord).toHaveBeenCalledExactlyOnceWith(next.global.measures[0]!.chordSymbols![0], expected);
  });

  it("uses layout source order and local staff rather than document part order", () => {
    const score = sourceScore();
    score.parts[1]!.staves = 2;
    score.parts[1]!.measures[0]!.sequences[0]!.staff = 2;
    score.layouts![0]!.content = [
      {
        type: "group",
        content: [
          { type: "staff", sources: [{ part: "clarinet", staff: 2 }] },
          { type: "staff", sources: [{ part: "piano" }] },
        ],
      },
    ];
    expect(
      resolveChordSymbolTarget(
        score,
        {
          kind: "single",
          elementId: "m0/chord0",
          elementType: "chord-symbol",
        },
        0,
        target.position,
      ),
    ).toMatchObject({ partIndex: 1, anchorStaff: 2 });
  });

  it("retains the canonical event ID and container index when anchoring inside a tuplet", () => {
    const score = sourceScore();
    score.parts[1]!.measures[0]!.sequences[0]!.content = [
      {
        type: "tuplet",
        inner: { multiple: 3, duration: { base: "eighth" } },
        outer: { multiple: 2, duration: { base: "eighth" } },
        content: [
          { type: "event", id: "first-tuplet", duration: { base: "eighth" }, rest: {} },
          { type: "event", id: "second-tuplet", duration: { base: "eighth" }, rest: {} },
          { type: "event", id: "third-tuplet", duration: { base: "eighth" }, rest: {} },
        ],
      },
    ];
    score.global.measures[0]!.chordSymbols![0]!.position = { fraction: [1, 12] };
    expect(
      resolveChordSymbolTarget(
        score,
        {
          kind: "single",
          elementId: "m0/chord0",
          elementType: "chord-symbol",
        },
        0,
        target.position,
      ),
    ).toMatchObject({
      partIndex: 1,
      eventIndex: 1,
      tupletIndex: 0,
      anchorElementId: "p1/m0/s0/second-tuplet",
      rhythmicPosition: { fraction: [1, 12] },
    });
  });

  it("maps a staff-2-only pointer anchor to its authored source staff", () => {
    const score = sourceScore();
    score.parts[1]!.staves = 2;
    score.parts[1]!.measures[0]!.sequences[0]!.staff = 2;
    score.layouts![0]!.content = [{ type: "staff", sources: [{ part: "clarinet", staff: 2 }] }];
    useSelectionStore.setState({
      renderedStaffSources: [{ staffIndex: 0, measureIndex: 0, partIds: ["clarinet"] }],
    });
    expect(
      resolveChordSymbolTarget(
        score,
        {
          kind: "single",
          elementId: "m0/chord0",
          elementType: "chord-symbol",
          measureAnchor: { partIndex: 1, measureIndex: 0, staffIndex: 0, localStaffIndex: 0 },
        },
        0,
        target.position,
      ),
    ).toMatchObject({ partIndex: 1, anchorStaff: 2 });
    expect(
      resolveChordSymbolTarget(
        score,
        {
          kind: "measure",
          startPartIndex: 1,
          endPartIndex: 1,
          startStaffIndex: 0,
          endStaffIndex: 0,
          startMeasure: 0,
          endMeasure: 0,
          startLocalStaffIndex: 0,
        },
        0,
        target.position,
      ),
    ).toMatchObject({ partIndex: 1, anchorStaff: 2 });
  });

  it("resolves a condensed harmony source rather than the bounds' primary part", () => {
    const score = sourceScore();
    score.parts[0]!.chordSymbolVisibility = "hide";
    score.parts[1]!.chordSymbolVisibility = "show";
    score.layouts![0]!.content = [
      {
        type: "staff",
        sources: [{ part: "piano" }, { part: "clarinet" }],
      },
    ];
    useSelectionStore.setState({
      renderedStaffSources: [{ staffIndex: 7, measureIndex: 0, partIds: ["piano", "clarinet"] }],
    });
    expect(
      resolveChordSymbolTarget(
        score,
        {
          kind: "single",
          elementId: "m0/chord0",
          elementType: "chord-symbol",
          measureAnchor: { partIndex: 0, measureIndex: 0, staffIndex: 7, localStaffIndex: 0 },
        },
        0,
        target.position,
      ),
    ).toMatchObject({ partIndex: 1, anchorStaff: 1 });
  });

  it.each(["hidden first staff", "previously seen condensed source"])(
    "edits canonical concert harmony from the renderer's source with %s",
    (scenario) => {
      const score = sourceScore();
      const condensed = scenario === "previously seen condensed source";
      score.parts[0]!.chordSymbolVisibility = condensed ? "show" : "hide";
      score.layouts![0]!.content = [
        { type: "staff", sources: [{ part: "piano" }] },
        { type: "staff", sources: condensed ? [{ part: "piano" }, { part: "clarinet" }] : [{ part: "clarinet" }] },
      ];
      if (condensed) {
        useSelectionStore.setState({
          renderedStaffSources: [
            { staffIndex: 0, measureIndex: 0, partIds: ["piano"] },
            { staffIndex: 1, measureIndex: 0, partIds: ["piano", "clarinet"] },
          ],
        });
      }
      const resolved = resolveChordSymbolTarget(
        score,
        {
          kind: "single",
          elementId: "m0/chord0",
          elementType: "chord-symbol",
          ...(condensed && {
            measureAnchor: { partIndex: 0, measureIndex: 0, staffIndex: 1, localStaffIndex: 1 },
          }),
        },
        0,
        target.position,
      );
      expect(resolved).toMatchObject({ partIndex: 1, anchorStaff: 1 });
      const { store, updateScore } = setup(score, resolved!);
      expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("D/F#");
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "Em/G" } });
      fireEvent.keyDown(window, { key: "Enter" });
      const canonical = parseChordSymbolText("Dm/F", { fraction: [2, 8] });
      const expected = structuredClone(score);
      expected.global.measures[0]!.chordSymbols![0] = canonical;
      expect(store.getState().workingScore).toEqual(expected);
      expect(updateScore).toHaveBeenCalledTimes(1);
      expect(previewChord).toHaveBeenCalledExactlyOnceWith(canonical, expected);
    },
  );

  it.each(["hide", "auto"] as const)("does not assign keyboard harmony to a later %s part", (visibility) => {
    const score = sourceScore();
    score.parts[0]!.chordSymbolVisibility = "hide";
    score.parts[1]!.chordSymbolVisibility = visibility;
    score.layouts![0]!.content = [
      { type: "staff", sources: [{ part: "piano" }] },
      { type: "staff", sources: [{ part: "clarinet" }] },
    ];
    expect(
      resolveChordSymbolTarget(
        score,
        { kind: "single", elementId: "m0/chord0", elementType: "chord-symbol" },
        0,
        target.position,
      ),
    ).toBeNull();
  });

  it("retains independent harmony owners when a condensed staff is rendered as split sources", () => {
    const score = sourceScore();
    score.parts[0]!.chordSymbolVisibility = "show";
    score.layouts![0]!.content = [{ type: "staff", sources: [{ part: "piano" }, { part: "clarinet" }] }];
    useSelectionStore.setState({
      renderedStaffSources: [
        { staffIndex: 0, measureIndex: 0, partIds: ["piano"] },
        { staffIndex: 1, measureIndex: 0, partIds: ["clarinet"] },
      ],
    });
    const resolved = resolveChordSymbolTarget(
      score,
      {
        kind: "single",
        elementId: "m0/chord0",
        elementType: "chord-symbol",
        measureAnchor: { partIndex: 1, measureIndex: 0, staffIndex: 1, localStaffIndex: 0 },
      },
      0,
      target.position,
    );
    expect(resolved).toMatchObject({ partIndex: 1, anchorStaff: 1 });
    setup(score, resolved!);
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("D/F#");
  });

  it("consumes every first occurrence even when another part supplies that staff's harmony", () => {
    const score = sourceScore();
    score.parts[0]!.chordSymbolVisibility = "show";
    score.layouts![0]!.content = [
      { type: "staff", sources: [{ part: "piano" }, { part: "clarinet" }] },
      { type: "staff", sources: [{ part: "clarinet" }] },
    ];
    const measureAnchor = { partIndex: 1, measureIndex: 0, staffIndex: 1, localStaffIndex: 1 };
    expect(
      resolveChordSymbolTarget(
        score,
        { kind: "single", elementId: "m0/chord0", elementType: "chord-symbol", measureAnchor },
        0,
        target.position,
      ),
    ).toBeNull();
  });

  it.each(["hide", "show"] as const)(
    "allows new harmony on a chosen %s source even after its first staff occurrence",
    (visibility) => {
      const score = sourceScore();
      score.parts[0]!.chordSymbolVisibility = visibility;
      score.layouts![0]!.content = [
        { type: "staff", sources: [{ part: "piano" }] },
        { type: "staff", sources: [{ part: "piano" }, { part: "clarinet" }] },
      ];
      expect(
        resolveChordSymbolTarget(
          score,
          {
            kind: "measure",
            startPartIndex: 0,
            endPartIndex: 0,
            startStaffIndex: 1,
            endStaffIndex: 1,
            startLocalStaffIndex: 1,
            startMeasure: 0,
            endMeasure: 0,
          },
          0,
          target.position,
        ),
      ).toMatchObject({ partIndex: 0, anchorStaff: 1 });
    },
  );

  it("preserves authored source staff order when both grand staves are rendered", () => {
    const score = sourceScore();
    score.parts[1]!.staves = 2;
    score.parts[1]!.measures[0]!.sequences.push({ staff: 2, content: [], fullMeasure: {} });
    score.layouts![0]!.content = [
      { type: "staff", sources: [{ part: "clarinet", staff: 2 }] },
      { type: "staff", sources: [{ part: "clarinet", staff: 1 }] },
    ];
    useSelectionStore.setState({
      renderedStaffSources: [
        { staffIndex: 0, measureIndex: 0, partIds: ["clarinet"] },
        { staffIndex: 1, measureIndex: 0, partIds: ["clarinet"] },
      ],
    });
    expect(
      resolveChordSymbolTarget(
        score,
        {
          kind: "single",
          elementId: "m0/chord0",
          elementType: "chord-symbol",
          measureAnchor: { partIndex: 1, measureIndex: 0, staffIndex: 0, localStaffIndex: 0 },
        },
        0,
        target.position,
      ),
    ).toMatchObject({ partIndex: 1, anchorStaff: 2, sequenceIndex: 1 });
  });

  it("does not reinterpret an unmapped rendered staff against an authored layout", () => {
    useSelectionStore.setState({ renderedStaffSources: [] });
    expect(
      resolveChordSymbolTarget(
        sourceScore(),
        {
          kind: "single",
          elementId: "m0/chord0",
          elementType: "chord-symbol",
          measureAnchor: { partIndex: 1, measureIndex: 0, staffIndex: 7 },
        },
        0,
        target.position,
      ),
    ).toBeNull();
  });

  it("honors a measure-local layout change in the active score", () => {
    const score = sourceScore();
    score.global.measures[0]!.id = "first";
    score.global.measures[1]!.id = "second";
    score.global.measures[1]!.chordSymbols = [parseChordSymbolText("F", { fraction: [0, 1] })];
    score.layouts!.push({ id: "piano-only", content: [{ type: "staff", sources: [{ part: "piano" }] }] });
    score.scores![0]!.layout = "piano-only";
    score.scores![0]!.pages = [
      {
        systems: [
          {
            measure: "first",
            layoutChanges: [{ location: { measure: "second" }, layout: "written-part" }],
          },
        ],
      },
    ];
    expect(
      resolveChordSymbolTarget(
        score,
        {
          kind: "single",
          elementId: "m1/chord0",
          elementType: "chord-symbol",
        },
        0,
        target.position,
      ),
    ).toMatchObject({ partIndex: 1, measureIndex: 1 });
  });

  it("honors the filtered active view instead of falling back to the first document part", () => {
    const score = sourceScore();
    delete score.layouts;
    useViewStateStore.setState({ selectedPartIds: ["clarinet"] });
    expect(
      resolveChordSymbolTarget(
        score,
        {
          kind: "single",
          elementId: "m0/chord0",
          elementType: "chord-symbol",
        },
        0,
        target.position,
      ),
    ).toMatchObject({ partIndex: 1 });
  });

  it.each(["m0/chord0", "m0/chord0/p0/staff1"])("does not guess a source for %s without context", (elementId) => {
    const score = sourceScore();
    delete score.layouts;
    expect(
      resolveChordSymbolTarget(
        score,
        {
          kind: "single",
          elementId,
          elementType: "chord-symbol",
        },
        0,
        target.position,
      ),
    ).toBeNull();
  });

  it.each([
    { partIndex: 99, measureIndex: 0, staffIndex: 0 },
    { partIndex: 1, measureIndex: 1, staffIndex: 0 },
  ])("does not redirect an invalid anchor to a different source: %j", (measureAnchor) => {
    expect(
      resolveChordSymbolTarget(
        sourceScore(),
        {
          kind: "single",
          elementId: "m0/chord0",
          elementType: "chord-symbol",
          measureAnchor,
        },
        0,
        target.position,
      ),
    ).toBeNull();
  });
});
describe("inspector chord identity", () => {
  it("normalizes inspector copy types without losing source-part context", () => {
    const score = buildScore();
    score.global.measures[0]!.chordSymbols = [parseChordSymbolText("C", { fraction: [0, 1] })];
    expect(
      resolveNotationSelectionTarget(
        {
          kind: "single",
          elementId: "m0/chord0/p0/staff1",
          elementType: "chord-symbol",
        },
        score,
      ),
    ).toEqual({
      elementId: "m0/chord0/p0/staff1",
      partIndex: 0,
      measureIndex: 0,
      elementType: "chord0",
    });
  });
});
