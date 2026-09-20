// @vitest-environment happy-dom
import { useState } from "react";
import { act, cleanup, render, renderHook, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseChordSymbolText,
  resolveChordSymbol,
  UNSUPPORTED_CHORD_MESSAGE,
  type ChordSymbol,
  type Score,
} from "@viritura/core";
import { parseMnx, serializeMnx } from "@viritura/format";
import { Button, TooltipPrimitives } from "@viritura/ui";
import { resolveNotationSelectionTarget, type NotationSelectionTarget } from "../commands/notationInspectorCommands";
import { DirectionTextSections } from "../components/inspector/DirectionTextSections";
import { handleAnnotationNavigation } from "../keyboard/navigationHandlers";
import type { KeyboardHandlerContext } from "../keyboard/types";
import { buildNavigationIndex } from "../navigation/NavigationIndex";
import { parseElementType } from "../score/elementTypes";
import { resetSelectionStore, useSelection, useSelectionActions, useSelectionStore } from "../store/selectionStore";
import { useViewStateStore } from "../store/viewStateStore";

const { previewChord } = vi.hoisted(() => ({
  previewChord: vi.fn(async (_chord: ChordSymbol, _score: Score) => {}),
}));

vi.mock("@viritura/playback", () => ({
  usePlaybackActions: () => ({ previewChord }),
}));

const POSITION = { fraction: [1, 4] as [number, number] };
const RENDERED_TARGET: NotationSelectionTarget = {
  elementId: "m0/chord0/p1/staff1",
  elementType: "staff1",
  partIndex: 0,
  measureIndex: 0,
};
const CANONICAL_TARGET: NotationSelectionTarget = {
  ...RENDERED_TARGET,
  elementId: "m0/chord0",
  elementType: "chord-symbol",
};

function buildScore(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [
        {
          time: { count: 4, unit: 4 },
          chordSymbols: [parseChordSymbolText("C/E", POSITION), parseChordSymbolText("G7", { fraction: [3, 4] })],
        },
        { chordSymbols: [parseChordSymbolText("F", { fraction: [0, 1] })] },
      ],
    },
    parts: [
      {
        id: "piano",
        name: "Piano",
        chordSymbolVisibility: "hide",
        measures: [
          {
            sequences: [{ content: [] }],
          },
        ],
      },
      {
        id: "clarinet",
        name: "Clarinet",
        transposition: { interval: { halfSteps: 2, staffDistance: 1 } },
        measures: [
          {
            sequences: [{ content: [] }],
          },
        ],
      },
    ],
    layouts: [
      {
        id: "full",
        content: [{ type: "staff", sources: [{ part: "piano" }] }],
      },
      {
        id: "clarinet-layout",
        content: [
          {
            type: "group",
            content: [{ type: "staff", sources: [{ part: "clarinet" }] }],
          },
        ],
      },
    ],
    scores: [
      { name: "Concert", layout: "full", useWritten: false },
      { name: "Written", layout: "clarinet-layout", useWritten: true },
    ],
  };
}

interface HarnessProps {
  initialScore: Score;
  initialTarget: NotationSelectionTarget | null;
  onUpdate: (score: Score) => void;
  followSelection?: boolean;
}

function Harness({ initialScore, initialTarget, onUpdate, followSelection = false }: HarnessProps) {
  const [score, setScore] = useState(initialScore);
  const [target, setTarget] = useState(initialTarget);
  const selection = useSelection();
  return (
    <TooltipPrimitives.Provider>
      <DirectionTextSections
        score={score}
        target={followSelection ? resolveNotationSelectionTarget(selection, score) : target}
        updateScore={(next) => {
          onUpdate(next);
          setScore(next);
        }}
      />
      <Button onClick={() => setTarget(CANONICAL_TARGET)}>Select canonical chord</Button>
      <Button onClick={() => setTarget(null)}>Clear target</Button>
      <Button
        onClick={() =>
          setScore((previous) => ({
            ...previous,
            layouts: structuredClone(previous.layouts),
          }))
        }
      >
        Recalculate layout
      </Button>
    </TooltipPrimitives.Provider>
  );
}

function renderInspector(
  initialScore = buildScore(),
  initialTarget: NotationSelectionTarget | null = RENDERED_TARGET,
  followSelection = false,
) {
  const onUpdate = vi.fn<(score: Score) => void>();
  const user = userEvent.setup();
  const rendered = render(
    <Harness
      initialScore={initialScore}
      initialTarget={initialTarget}
      onUpdate={onUpdate}
      followSelection={followSelection}
    />,
  );
  return {
    ...rendered,
    user,
    onUpdate,
    initialScore,
    getScore: () => onUpdate.mock.lastCall?.[0] ?? initialScore,
  };
}

function chordInput() {
  return screen.getByRole<HTMLInputElement>("textbox", { name: "Chord text" });
}

async function choose(user: ReturnType<typeof userEvent.setup>, label: RegExp, option: string) {
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(within(screen.getByRole("listbox")).getByRole("option", { name: option, exact: true }));
}

function expectedScoreWithChord(initial: Score, chord: ChordSymbol): Score {
  const expected = structuredClone(initial);
  expected.global.measures[0]!.chordSymbols![0] = chord;
  return expected;
}

function expectOnlyChordChanged(initial: Score, next: Score, chord: ChordSymbol) {
  expect(next).toEqual(expectedScoreWithChord(initial, chord));
  expect(next.parts).toBe(initial.parts);
  expect(next.layouts).toBe(initial.layouts);
  expect(next.global.measures[1]).toBe(initial.global.measures[1]);
  expect(initial.global.measures[0]!.chordSymbols![0]!.rawText).toBe("C/E");
}

beforeEach(() => {
  previewChord.mockReset();
  previewChord.mockResolvedValue(undefined);
  resetSelectionStore();
  useSelectionStore.setState({
    selection: {
      kind: "single",
      elementId: RENDERED_TARGET.elementId,
      elementType: "chord-symbol",
      measureAnchor: { partIndex: 1, staffIndex: 0, localStaffIndex: 0, measureIndex: 0 },
    },
  });
  useViewStateStore.setState({ selectedScoreIndex: 0, selectedPartIds: [], viewMode: "horizon" });
});

afterEach(() => {
  cleanup();
  resetSelectionStore();
  useViewStateStore.setState({ selectedScoreIndex: 0, selectedPartIds: [], viewMode: "horizon" });
});

describe("global chord symbol inspector", () => {
  describe.each(["next", "previous"] as const)("%s annotation navigation", (direction) => {
    it.each([
      { name: "rendered copy with source anchor", suffix: "/p1/staff1", staffIndex: 1 },
      { name: "canonical ID with source anchor", suffix: "", staffIndex: 1 },
      { name: "reordered copy with conflicting part suffix", suffix: "/p0/staff8", staffIndex: 7 },
    ])("retains Bb clarinet harmony from $name with piano visible first", async ({ suffix, staffIndex }) => {
      const initial = buildScore();
      initial.parts[0]!.chordSymbolVisibility = "show";
      initial.parts[1]!.chordSymbolVisibility = "show";
      // Both instruments must be visible: a clarinet-only layout masks lost source context.
      initial.layouts![1]!.content = [
        { type: "staff", sources: [{ part: "piano" }] },
        { type: "staff", sources: [{ part: "clarinet" }] },
      ];
      initial.global.measures[0]!.chordSymbols!.push(parseChordSymbolText("A", { fraction: [7, 8] }));
      useViewStateStore.setState({ selectedScoreIndex: 1, selectedPartIds: [] });
      const sourceAnchor = { partIndex: 1, staffIndex, localStaffIndex: 0, measureIndex: 0 };
      const startIndex = direction === "next" ? 0 : 2;
      const { result } = renderHook(() => useSelectionActions());
      const actions = result.current;
      act(() => actions.selectElement(`m0/chord${startIndex}${suffix}`, sourceAnchor));
      const { user, getScore, onUpdate } = renderInspector(initial, null, true);
      expect(chordInput().value).toBe(direction === "next" ? "D/F#" : "B");
      const navIndex = buildNavigationIndex(initial);
      const ctx = {
        getScore,
        getSelection: () => useSelectionStore.getState().selection,
        getNavIndex: () => navIndex,
        selectElement: actions.selectElement,
      } as KeyboardHandlerContext;

      act(() => handleAnnotationNavigation(direction, ctx));

      expect(chordInput().value).toBe("A7");
      expect(screen.getByRole("combobox", { name: /^Chord visibility — Clarinet/ })).toBeTruthy();
      expect(useSelectionStore.getState().selection).toEqual({
        kind: "single",
        elementId: `m0/chord1${suffix}`,
        elementType: parseElementType(`m0/chord1${suffix}`),
        measureAnchor: sourceAnchor,
      });
      expect(getScore()).toBe(initial);
      expect(onUpdate).not.toHaveBeenCalled();
      expect(previewChord).not.toHaveBeenCalled();

      await user.clear(chordInput());
      await user.type(chordInput(), "F/A{Enter}");

      const canonical = parseChordSymbolText("Eb/G", { fraction: [3, 4] });
      const expected = structuredClone(initial);
      expected.global.measures[0]!.chordSymbols![1] = canonical;
      expect(getScore()).toEqual(expected);
      expect(getScore().parts).toBe(initial.parts);
      expect(getScore().layouts).toBe(initial.layouts);
      expect(getScore().global.measures[1]).toBe(initial.global.measures[1]);
      expect(getScore().global.measures[0]!.chordSymbols![0]).toBe(initial.global.measures[0]!.chordSymbols![0]);
      expect(getScore().global.measures[0]!.chordSymbols![2]).toBe(initial.global.measures[0]!.chordSymbols![2]);
      expect(initial.global.measures[0]!.chordSymbols![1]!.rawText).toBe("G7");
      expect(chordInput().value).toBe("F/A");
      expect(onUpdate).toHaveBeenCalledTimes(1);
      expect(previewChord).toHaveBeenCalledExactlyOnceWith(canonical, expected);
    });
  });

  it.each(["blur", "Enter"])("commits a rendered copy once on %s, never while typing", async (commit) => {
    useViewStateStore.setState({ selectedScoreIndex: 1 });
    const { user, onUpdate, getScore, initialScore } = renderInspector();
    expect(chordInput().value).toBe("D/F#");
    expect(previewChord).not.toHaveBeenCalled();

    await user.clear(chordInput());
    await user.type(chordInput(), "Dm7/F#");
    expect(onUpdate).not.toHaveBeenCalled();
    expect(previewChord).not.toHaveBeenCalled();

    if (commit === "Enter") await user.keyboard("{Enter}");
    else await user.tab();
    const canonical = parseChordSymbolText("Cm7/E", POSITION);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expectOnlyChordChanged(initialScore, getScore(), canonical);
    expect(previewChord).toHaveBeenCalledExactlyOnceWith(canonical, expectedScoreWithChord(initialScore, canonical));
    expect(chordInput().value).toBe("Dm7/F#");

    await user.click(chordInput());
    await user.tab();
    await user.click(screen.getByRole("button", { name: "Select canonical chord" }));
    expect(chordInput().value).toBe("Dm7/F#");
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(previewChord).toHaveBeenCalledTimes(1);
  });

  it("cancels draft text with Escape and leaves later blur inert", async () => {
    const { user, onUpdate, getScore, initialScore } = renderInspector();
    await user.clear(chordInput());
    await user.type(chordInput(), "F#maj7/A#");
    act(() => screen.getByRole("button", { name: "Recalculate layout" }).click());
    expect(chordInput().value).toBe("F#maj7/A#");
    expect(onUpdate).not.toHaveBeenCalled();
    expect(previewChord).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(chordInput().value).toBe("C/E");
    await user.click(chordInput());
    await user.tab();
    expect(getScore()).toBe(initialScore);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(previewChord).not.toHaveBeenCalled();
  });

  it("does not commit unchanged input, rerenders, layout changes, or view switches", async () => {
    const { user, onUpdate, rerender, initialScore } = renderInspector();
    await user.click(chordInput());
    await user.keyboard("{Enter}");
    rerender(<Harness initialScore={initialScore} initialTarget={RENDERED_TARGET} onUpdate={onUpdate} />);
    await user.click(screen.getByRole("button", { name: "Recalculate layout" }));
    act(() => useViewStateStore.setState({ selectedScoreIndex: 1, viewMode: "page" }));
    expect(chordInput().value).toBe("D/F#");
    act(() => useViewStateStore.setState({ selectedScoreIndex: 0 }));
    expect(chordInput().value).toBe("C/E");
    expect(onUpdate).not.toHaveBeenCalled();
    expect(previewChord).not.toHaveBeenCalled();
  });

  it("commits concert spelling without transposing after switching out of written view", async () => {
    useViewStateStore.setState({ selectedScoreIndex: 1 });
    const { user, getScore, onUpdate, initialScore } = renderInspector();
    expect(chordInput().value).toBe("D/F#");
    act(() => useViewStateStore.setState({ selectedScoreIndex: 0 }));
    expect(chordInput().value).toBe("C/E");
    await user.clear(chordInput());
    await user.type(chordInput(), "Dm7/F#{Enter}");
    const canonical = parseChordSymbolText("Dm7/F#", POSITION);
    expect(getScore().global.measures[0]!.chordSymbols![0]).toEqual(canonical);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(previewChord).toHaveBeenCalledExactlyOnceWith(canonical, expectedScoreWithChord(initialScore, canonical));
  });

  it("honors the source part's prefersWrittenPitches even in a concert score view", async () => {
    const initial = buildScore();
    initial.parts[1]!.transposition!.prefersWrittenPitches = true;
    const { user, getScore } = renderInspector(initial);
    expect(chordInput().value).toBe("D/F#");
    await user.clear(chordInput());
    await user.type(chordInput(), "Dm7/F#{Enter}");
    const canonical = parseChordSymbolText("Cm7/E", POSITION);
    expectOnlyChordChanged(initial, getScore(), canonical);
    expect(previewChord).toHaveBeenCalledExactlyOnceWith(canonical, expectedScoreWithChord(initial, canonical));
  });

  it("uses selectedPartIds as source context for a canonical root ID", async () => {
    const initial = buildScore();
    initial.scores![1]!.layout = "full";
    useViewStateStore.setState({ selectedScoreIndex: 1, selectedPartIds: ["clarinet"] });
    const { user, getScore } = renderInspector(initial, CANONICAL_TARGET);
    expect(chordInput().value).toBe("D/F#");
    await user.clear(chordInput());
    await user.type(chordInput(), "Dm7/F#{Enter}");
    expectOnlyChordChanged(initial, getScore(), parseChordSymbolText("Cm7/E", POSITION));
    expect(previewChord).toHaveBeenCalledExactlyOnceWith(
      parseChordSymbolText("Cm7/E", POSITION),
      expectedScoreWithChord(initial, parseChordSymbolText("Cm7/E", POSITION)),
    );
  });

  it("uses the selected measure anchor ahead of the active view's part context", () => {
    useViewStateStore.setState({ selectedScoreIndex: 1, selectedPartIds: ["piano"] });
    useSelectionStore.setState({
      selection: {
        kind: "single",
        elementId: CANONICAL_TARGET.elementId,
        elementType: parseElementType(CANONICAL_TARGET.elementId),
        measureAnchor: { partIndex: 1, staffIndex: 0, measureIndex: 0 },
      },
    });
    renderInspector(buildScore(), CANONICAL_TARGET);
    expect(chordInput().value).toBe("D/F#");
    expect(screen.getByRole("combobox", { name: /^Chord visibility — Clarinet/ })).toBeTruthy();
    expect(previewChord).not.toHaveBeenCalled();
  });

  it("uses the mapped source anchor rather than a conflicting render-copy suffix", () => {
    useViewStateStore.setState({ selectedScoreIndex: 1, selectedPartIds: ["piano"] });
    useSelectionStore.setState({
      selection: {
        kind: "single",
        elementId: RENDERED_TARGET.elementId,
        elementType: parseElementType(RENDERED_TARGET.elementId),
        measureAnchor: { partIndex: 0, staffIndex: 0, measureIndex: 0 },
      },
    });
    const initial = buildScore();
    initial.parts[0]!.chordSymbolVisibility = "show";
    renderInspector(initial);
    expect(chordInput().value).toBe("C/E");
    expect(screen.getByRole("combobox", { name: /^Chord visibility — Piano/ })).toBeTruthy();
    expect(previewChord).not.toHaveBeenCalled();
  });

  it("writes concert harmony and visibility to the mapped source, not a layout-local copy index", async () => {
    useViewStateStore.setState({ selectedScoreIndex: 1 });
    const renderedTarget = { ...RENDERED_TARGET, elementId: "m0/chord0/p0/staff8" };
    useSelectionStore.setState({
      selection: {
        kind: "single",
        elementId: renderedTarget.elementId,
        elementType: "chord-symbol",
        measureAnchor: { partIndex: 1, staffIndex: 7, localStaffIndex: 0, measureIndex: 0 },
      },
    });
    const { user, getScore, initialScore } = renderInspector(buildScore(), renderedTarget);
    expect(chordInput().value).toBe("D/F#");
    await user.clear(chordInput());
    await user.type(chordInput(), "Em/G{Enter}");
    expectOnlyChordChanged(initialScore, getScore(), parseChordSymbolText("Dm/F", POSITION));
    await choose(user, /^Chord visibility — Clarinet/, "Hide");
    expect(getScore().parts[1]!.chordSymbolVisibility).toBe("hide");
    expect(getScore().parts[0]).toBe(initialScore.parts[0]);
    expect(previewChord).toHaveBeenCalledExactlyOnceWith(
      parseChordSymbolText("Dm/F", POSITION),
      expectedScoreWithChord(initialScore, parseChordSymbolText("Dm/F", POSITION)),
    );
  });

  it("ignores another element's stale anchor and the inspector target's default part index", () => {
    useViewStateStore.setState({ selectedScoreIndex: 1 });
    useSelectionStore.setState({
      selection: {
        kind: "single",
        elementId: "m1/chord0",
        elementType: "chord-symbol",
        measureAnchor: { partIndex: 0, staffIndex: 0, measureIndex: 1 },
      },
    });
    renderInspector(buildScore(), CANONICAL_TARGET);
    expect(chordInput().value).toBe("D/F#");
    expect(screen.getByRole("combobox", { name: /^Chord visibility — Clarinet/ })).toBeTruthy();
  });

  it("uses the visible harmony source on a condensed rendered staff", async () => {
    const initial = buildScore();
    initial.parts[1]!.chordSymbolVisibility = "show";
    initial.layouts![1]!.content = [
      {
        type: "staff",
        sources: [{ part: "piano" }, { part: "clarinet" }],
      },
    ];
    useViewStateStore.setState({ selectedScoreIndex: 1 });
    useSelectionStore.setState({
      selection: {
        kind: "single",
        elementId: CANONICAL_TARGET.elementId,
        elementType: "chord-symbol",
        measureAnchor: { partIndex: 0, staffIndex: 7, measureIndex: 0, localStaffIndex: 0 },
      },
      renderedStaffSources: [{ staffIndex: 7, measureIndex: 0, partIds: ["piano", "clarinet"] }],
    });
    const { user, getScore } = renderInspector(initial, CANONICAL_TARGET);
    expect(chordInput().value).toBe("D/F#");
    await choose(user, /^Chord visibility — Clarinet/, "Hide");
    expect(getScore().parts[0]).toBe(initial.parts[0]);
    expect(getScore().parts[1]!.chordSymbolVisibility).toBe("hide");
    expect(previewChord).not.toHaveBeenCalled();
  });

  it.each(["hidden first staff", "previously seen condensed source"])(
    "uses renderer harmony ownership for written canonical edits with %s",
    async (scenario) => {
      const initial = buildScore();
      const condensed = scenario === "previously seen condensed source";
      initial.parts[0]!.chordSymbolVisibility = condensed ? "show" : "hide";
      initial.parts[1]!.chordSymbolVisibility = "show";
      initial.layouts![1]!.content = [
        { type: "staff", sources: [{ part: "piano" }] },
        { type: "staff", sources: condensed ? [{ part: "piano" }, { part: "clarinet" }] : [{ part: "clarinet" }] },
      ];
      useViewStateStore.setState({ selectedScoreIndex: 1 });
      useSelectionStore.setState({
        selection: {
          kind: "single",
          elementId: CANONICAL_TARGET.elementId,
          elementType: "chord-symbol",
          ...(condensed && {
            measureAnchor: { partIndex: 0, staffIndex: 1, measureIndex: 0, localStaffIndex: 1 },
          }),
        },
        renderedStaffSources: [
          { staffIndex: 0, measureIndex: 0, partIds: ["piano"] },
          { staffIndex: 1, measureIndex: 0, partIds: condensed ? ["piano", "clarinet"] : ["clarinet"] },
        ],
      });
      const { user, getScore, onUpdate } = renderInspector(initial, CANONICAL_TARGET);
      expect(chordInput().value).toBe("D/F#");
      expect(screen.getByRole("combobox", { name: /^Chord visibility — Clarinet/ })).toBeTruthy();
      await user.clear(chordInput());
      await user.type(chordInput(), "Em/G{Enter}");
      const canonical = parseChordSymbolText("Dm/F", POSITION);
      expectOnlyChordChanged(initial, getScore(), canonical);
      expect(onUpdate).toHaveBeenCalledTimes(1);
      expect(previewChord).toHaveBeenCalledExactlyOnceWith(canonical, expectedScoreWithChord(initial, canonical));
    },
  );

  it("does not offer edits when neither selection nor active view identifies a source", () => {
    resetSelectionStore();
    const initial = buildScore();
    delete initial.layouts;
    initial.scores = [{ useWritten: true }];
    const { onUpdate } = renderInspector(initial);
    expect(screen.queryByRole("textbox", { name: "Chord text" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: /^Chord visibility/ })).toBeNull();
    expect(onUpdate).not.toHaveBeenCalled();
    expect(previewChord).not.toHaveBeenCalled();
  });

  it.each(["H7", "C/E/G", "?", "  unrecognized harmony  "])(
    "retains unsupported text %j without inventing a root or major quality",
    async (text) => {
      useViewStateStore.setState({ selectedScoreIndex: 1 });
      const { user, onUpdate, getScore, initialScore } = renderInspector();
      await user.clear(chordInput());
      await user.type(chordInput(), text);
      expect(onUpdate).not.toHaveBeenCalled();
      await user.keyboard("{Enter}");
      const chord = getScore().global.measures[0]!.chordSymbols![0]!;
      expect(chord).toEqual({ position: POSITION, rawText: text });
      expect(chordInput().value).toBe(text);
      expect(screen.getByRole("status").textContent).toBe(UNSUPPORTED_CHORD_MESSAGE);
      expect(screen.queryByRole("combobox", { name: /^Root/ })).toBeNull();
      expect(screen.queryByRole("combobox", { name: /^Quality/ })).toBeNull();
      expect(resolveChordSymbol(chord)).toEqual({ status: "unsupported", message: UNSUPPORTED_CHORD_MESSAGE });
      expectOnlyChordChanged(initialScore, getScore(), chord);
      expect(onUpdate).toHaveBeenCalledTimes(1);
      expect(previewChord).toHaveBeenCalledExactlyOnceWith(
        chord,
        expectedScoreWithChord(initialScore, { position: POSITION, rawText: text }),
      );
    },
  );

  it("retains an unsupported suffix as Other instead of guessing a major chord", async () => {
    const { user, getScore } = renderInspector();
    await user.clear(chordInput());
    await user.type(chordInput(), "Cadd#9{Enter}");
    expect(getScore().global.measures[0]!.chordSymbols![0]).toMatchObject({
      rawText: "Cadd#9",
      root: { step: "C" },
      quality: "other",
      kindText: "add#9",
    });
    expect(screen.getByRole("status").textContent).toBe(UNSUPPORTED_CHORD_MESSAGE);
    expect(screen.getByRole("combobox", { name: "Quality" }).textContent).toContain("Other");
  });

  it.each([
    ["Cadd9", [0, 2, 4, 7], 0],
    ["Cadd79omit5/E", [0, 2, 4, 10], 4],
  ] as const)("commits %s through the central resolver without an unsupported warning", async (text, pitches, bass) => {
    const { user, getScore } = renderInspector();
    await user.clear(chordInput());
    await user.type(chordInput(), `${text}{Enter}`);
    const chord = getScore().global.measures[0]!.chordSymbols![0]!;
    expect(chord.rawText).toBe(text);
    expect(resolveChordSymbol(chord)).toEqual({
      status: "supported",
      rootPitchClass: 0,
      bassPitchClass: bass,
      pitchClasses: pitches,
    });
    expect(screen.queryByText(UNSUPPORTED_CHORD_MESSAGE)).toBeNull();
  });

  it.each(["NC", "N.C."])("commits %s as silent rather than a guessed harmony", async (text) => {
    const { user, getScore, onUpdate, initialScore } = renderInspector();
    await user.clear(chordInput());
    await user.type(chordInput(), `${text}{Enter}`);
    const chord = getScore().global.measures[0]!.chordSymbols![0]!;
    expect(chord).toEqual({ position: POSITION, rawText: text });
    expect(resolveChordSymbol(chord).status).toBe("silent");
    expect(screen.getByRole("status").textContent).toBe("No chord: silent.");
    expect(screen.queryByRole("combobox", { name: /^Root/ })).toBeNull();
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(previewChord).toHaveBeenCalledExactlyOnceWith(
      chord,
      expectedScoreWithChord(initialScore, { position: POSITION, rawText: text }),
    );
  });

  it("regenerates authored text after real root and bass Select edits", async () => {
    const { user, getScore, onUpdate, initialScore } = renderInspector();
    await choose(user, /^Root$/, "D");
    expect(chordInput().value).toBe("D/E");
    expectOnlyChordChanged(initialScore, getScore(), parseChordSymbolText("D/E", POSITION));
    await choose(user, /^Root accidental/, "Sharp");
    expect(chordInput().value).toBe("D#/E");
    await choose(user, /^Bass$/, "F");
    expect(chordInput().value).toBe("D#/F");
    await choose(user, /^Bass accidental/, "Sharp");
    expect(chordInput().value).toBe("D#/F#");
    expectOnlyChordChanged(initialScore, getScore(), parseChordSymbolText("D#/F#", POSITION));
    expect(onUpdate).toHaveBeenCalledTimes(4);
    expect(previewChord).toHaveBeenCalledTimes(4);
    expect(previewChord.mock.calls.map(([chord]) => chord.rawText)).toEqual(["D/E", "D#/E", "D#/F", "D#/F#"]);
    await choose(user, /^Bass$/, "None");
    expect(chordInput().value).toBe("D#");
    expect(getScore().global.measures[0]!.chordSymbols![0]!.bass).toBeUndefined();
    expect(onUpdate).toHaveBeenCalledTimes(5);
    expect(previewChord).toHaveBeenCalledTimes(5);
    expect(previewChord).toHaveBeenLastCalledWith(
      parseChordSymbolText("D#", POSITION),
      expectedScoreWithChord(initialScore, parseChordSymbolText("D#", POSITION)),
    );
  });

  it("clears stale imported quality spelling when its extension changes", async () => {
    const initial = buildScore();
    initial.global.measures[0]!.chordSymbols![0] = {
      position: POSITION,
      root: { step: "C" },
      quality: "major",
      kindText: "M7",
      extension: 7,
    };
    const { user, getScore } = renderInspector(initial);
    await choose(user, /^Extension$/, "9");
    const chord = getScore().global.measures[0]!.chordSymbols![0]!;
    expect(chord.kindText).toBeUndefined();
    expect(chord.rawText).toBe("Cmaj9");
    expect(resolveChordSymbol(chord).status).toBe("supported");
    expect(previewChord).toHaveBeenCalledExactlyOnceWith(
      chord,
      expectedScoreWithChord(initial, parseChordSymbolText("Cmaj9", POSITION)),
    );
  });

  describe.each([0, 1])("modifier-preserving base edits in score view %i", (scoreIndex) => {
    it.each([
      { control: "Quality", option: "Minor", suffix: "madd7add9omit5", pitches: [0, 2, 3, 10] },
      { control: "Extension", option: "7", suffix: "maj7add7add9omit5", pitches: [0, 2, 4, 10, 11] },
    ])("preserves explicit degrees when changing $control", async ({ control, option, suffix, pitches }) => {
      useViewStateStore.setState({ selectedScoreIndex: scoreIndex });
      const initial = buildScore();
      initial.global.measures[0]!.chordSymbols![0] = parseChordSymbolText("Cadd79omit5/E", POSITION);
      const { user, getScore, onUpdate } = renderInspector(initial);
      await choose(user, new RegExp(`^${control}$`), option);
      const chord = getScore().global.measures[0]!.chordSymbols![0]!;
      expect(chord).toEqual(parseChordSymbolText(`C${suffix}/E`, POSITION));
      expect(chord.kindText).toBe(suffix);
      expect(chordInput().value).toBe(scoreIndex === 1 ? `D${suffix}/F#` : `C${suffix}/E`);
      expect(resolveChordSymbol(chord)).toEqual({
        status: "supported",
        rootPitchClass: 0,
        bassPitchClass: 4,
        pitchClasses: pitches,
      });
      const restored = parseMnx(serializeMnx(getScore())).global.measures[0]!.chordSymbols![0]!;
      expect(restored).toEqual(chord);
      expect(resolveChordSymbol(restored)).toEqual(resolveChordSymbol(chord));
      expect(onUpdate).toHaveBeenCalledTimes(1);
      expect(previewChord).toHaveBeenCalledExactlyOnceWith(chord, getScore());
      expect(screen.queryByText(UNSUPPORTED_CHORD_MESSAGE)).toBeNull();
      expect(initial.global.measures[0]!.chordSymbols![0]!.rawText).toBe("Cadd79omit5/E");
    });
  });

  it("retains imported additions and omissions across successive base edits", async () => {
    const initial = buildScore();
    initial.global.measures[0]!.chordSymbols![0] = {
      position: POSITION,
      root: { step: "C" },
      quality: "major",
      extension: 7,
      kindText: "M7(add9,no5,no7)",
    };
    const { user, getScore } = renderInspector(initial);
    await choose(user, /^Quality$/, "Minor");
    await choose(user, /^Extension$/, "None");
    const chord = getScore().global.measures[0]!.chordSymbols![0]!;
    expect(chord).toEqual(parseChordSymbolText("Cmadd9omit5omit7", POSITION));
    expect(resolveChordSymbol(chord)).toMatchObject({ status: "supported", pitchClasses: [0, 2, 3] });
    await choose(user, /^Extension$/, "9");
    expect(getScore().global.measures[0]!.chordSymbols![0]).toEqual(
      parseChordSymbolText("Cm9add9omit5omit7", POSITION),
    );
    expect(resolveChordSymbol(getScore().global.measures[0]!.chordSymbols![0]!)).toMatchObject({
      status: "supported",
      pitchClasses: [0, 2, 3],
    });
  });

  it.each(["Cadd#9/E", "C79/E"])("does not erase unknown degree intent in %s with base controls", async (text) => {
    const initial = buildScore();
    initial.global.measures[0]!.chordSymbols![0] = parseChordSymbolText(text, POSITION);
    const { user, getScore, onUpdate } = renderInspector(initial);
    await choose(user, /^Quality$/, "Minor");
    await choose(user, /^Extension$/, "7");
    expect(getScore()).toEqual(initial);
    expect(chordInput().value).toBe(text);
    expect(screen.getByRole("status").textContent).toBe(UNSUPPORTED_CHORD_MESSAGE);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(previewChord).not.toHaveBeenCalled();
  });

  it("retains explicit additions in equivalent imported raw text", async () => {
    const initial = buildScore();
    initial.global.measures[0]!.chordSymbols![0] = {
      position: POSITION,
      root: { step: "C" },
      quality: "dominant",
      extension: 9,
      rawText: "C7add9",
    };
    const { user, getScore } = renderInspector(initial);
    await choose(user, /^Extension$/, "7");
    const chord = getScore().global.measures[0]!.chordSymbols![0]!;
    expect(chord).toEqual(parseChordSymbolText("C7add9", POSITION));
    expect(resolveChordSymbol(chord)).toMatchObject({ status: "supported", pitchClasses: [0, 2, 4, 7, 10] });
  });

  it("keeps recognized modifiers when switching through Other", async () => {
    const initial = buildScore();
    initial.global.measures[0]!.chordSymbols![0] = parseChordSymbolText("Cadd79omit5/E", POSITION);
    const { user, getScore } = renderInspector(initial);
    await choose(user, /^Quality$/, "Other");
    expect(getScore().global.measures[0]!.chordSymbols![0]).toMatchObject({
      quality: "other",
      kindText: "add7add9omit5",
      rawText: "Cadd7add9omit5/E",
    });
    await choose(user, /^Quality$/, "Minor");
    expect(getScore().global.measures[0]!.chordSymbols![0]).toEqual(
      parseChordSymbolText("Cmadd7add9omit5/E", POSITION),
    );
  });

  describe.each([
    { modifiers: "", pitches: [0, 3, 7] },
    { modifiers: "add9omit5", pitches: [0, 2, 3] },
  ])("recognized custom quality with '$modifiers'", ({ modifiers, pitches }) => {
    it.each([
      { control: "Quality", option: "Minor" },
      { control: "Extension", option: "None" },
    ])("reconciles a stale seventh through $control", async ({ control, option }) => {
      const initial = buildScore();
      initial.global.measures[0]!.chordSymbols![0] = parseChordSymbolText(`Cmaj7${modifiers}`, POSITION);
      const { user, getScore, onUpdate } = renderInspector(initial);
      await choose(user, /^Quality$/, "Other");
      const qualityText = screen.getByRole<HTMLInputElement>("textbox", { name: "Quality text" });
      await user.clear(qualityText);
      await user.type(qualityText, `m${modifiers}{Enter}`);
      expect(getScore().global.measures[0]!.chordSymbols![0]).toMatchObject({
        quality: "other",
        extension: 7,
        kindText: `m${modifiers}`,
        rawText: `Cm${modifiers}`,
      });

      await choose(user, new RegExp(`^${control}$`), option);
      const corrected = getScore().global.measures[0]!.chordSymbols![0]!;
      expect(corrected.extension).toBeUndefined();
      expect(corrected.rawText).toBe(`Cm${modifiers}`);
      expect(screen.getByRole("combobox", { name: "Extension" }).textContent).toContain("None");
      expect(onUpdate).toHaveBeenCalledTimes(3);
      expect(previewChord).toHaveBeenLastCalledWith(corrected, getScore());

      if (control === "Extension") {
        expect(corrected.quality).toBe("other");
        expect(corrected.kindText).toBe(`m${modifiers}`);
        await choose(user, /^Quality$/, "Minor");
      }
      const chord = getScore().global.measures[0]!.chordSymbols![0]!;
      expect(chord).toEqual(parseChordSymbolText(`Cm${modifiers}`, POSITION));
      expect(resolveChordSymbol(chord)).toMatchObject({ status: "supported", pitchClasses: pitches });
      expect(screen.queryByText(UNSUPPORTED_CHORD_MESSAGE)).toBeNull();
      expect(parseMnx(serializeMnx(getScore())).global.measures[0]!.chordSymbols![0]).toEqual(chord);

      await choose(user, /^Extension$/, "9");
      expect(getScore().global.measures[0]!.chordSymbols![0]).toEqual(
        parseChordSymbolText(`Cm9${modifiers}`, POSITION),
      );
    });
  });

  it.each([
    { quality: "other", kindText: "mystery", rawText: "Cmystery" },
    { quality: "other", kindText: "madd#9", rawText: "Cmadd#9" },
    { quality: "other", kindText: "madd9omit5", rawText: "Cmaj7add9omit5" },
    { quality: "major", kindText: "madd9omit5", rawText: "Cmadd9omit5" },
  ] as const)("does not guess base corrections for $quality/$kindText/$rawText", async (source) => {
    const initial = buildScore();
    initial.global.measures[0]!.chordSymbols![0] = {
      position: POSITION,
      root: { step: "C" },
      extension: 7,
      ...source,
    };
    const { user, getScore, onUpdate } = renderInspector(initial);
    await choose(user, /^Quality$/, "Minor");
    await choose(user, /^Extension$/, "None");
    expect(getScore()).toEqual(initial);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(previewChord).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe(UNSUPPORTED_CHORD_MESSAGE);
  });

  it("does not lock base controls into an incompatible power extension", async () => {
    const initial = buildScore();
    initial.global.measures[0]!.chordSymbols![0] = parseChordSymbolText("Cmaj7add9", POSITION);
    const { user, getScore, onUpdate } = renderInspector(initial);
    await choose(user, /^Quality$/, "Power");
    expect(onUpdate).not.toHaveBeenCalled();
    await choose(user, /^Extension$/, "None");
    await choose(user, /^Quality$/, "Power");
    const chord = getScore().global.measures[0]!.chordSymbols![0]!;
    expect(chord).toEqual(parseChordSymbolText("C5add9", POSITION));
    expect(resolveChordSymbol(chord)).toMatchObject({ status: "supported", pitchClasses: [0, 2, 7] });
  });

  it("preserves a conflicting display override while rewriting the base and degrees", async () => {
    const initial = buildScore();
    initial.global.measures[0]!.chordSymbols![0] = {
      ...parseChordSymbolText("Cadd79omit5/E", POSITION),
      textOverride: "custom display",
    };
    const { user, getScore } = renderInspector(initial);
    await choose(user, /^Quality$/, "Minor");
    const chord = getScore().global.measures[0]!.chordSymbols![0]!;
    expect(chord).toEqual({
      ...parseChordSymbolText("Cmadd7add9omit5/E", POSITION),
      textOverride: "custom display",
    });
    expect(resolveChordSymbol(chord).status).toBe("unsupported");
    expect(resolveChordSymbol({ ...chord, textOverride: undefined })).toMatchObject({
      status: "supported",
      pitchClasses: [0, 2, 3, 10],
    });
  });

  it("preserves independently authored display text and reports conflicting harmony", async () => {
    useViewStateStore.setState({ selectedScoreIndex: 1 });
    const initial = buildScore();
    initial.global.measures[0]!.chordSymbols![0]!.textOverride = "C/E";
    const { user, getScore, onUpdate } = renderInspector(initial);
    const override = screen.getByRole<HTMLInputElement>("textbox", { name: "Display override" });
    expect(override.value).toBe("D/F#");
    await user.clear(chordInput());
    await user.type(chordInput(), "Dm7/F#{Enter}");
    expect(getScore().global.measures[0]!.chordSymbols![0]).toEqual({
      ...parseChordSymbolText("Cm7/E", POSITION),
      textOverride: "C/E",
    });
    expect(override.value).toBe("D/F#");
    expect(screen.getByRole("status").textContent).toBe(UNSUPPORTED_CHORD_MESSAGE);
    await user.clear(override);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(previewChord).toHaveBeenCalledTimes(1);
    await user.keyboard("{Enter}");
    expect(getScore().global.measures[0]!.chordSymbols![0]!.textOverride).toBeUndefined();
    expect(screen.queryByRole("status")).toBeNull();
    expect(previewChord).toHaveBeenCalledTimes(2);
  });

  it("keeps a successful edit when audio preview rejects", async () => {
    previewChord.mockRejectedValueOnce(new Error("Audio unavailable"));
    const { user, getScore, onUpdate } = renderInspector();
    await user.clear(chordInput());
    await user.type(chordInput(), "Fm7{Enter}");
    expect(getScore().global.measures[0]!.chordSymbols![0]).toEqual(parseChordSymbolText("Fm7", POSITION));
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(previewChord).toHaveBeenCalledTimes(1);
  });

  it("converts written root and bass controls back to canonical concert harmony", async () => {
    useViewStateStore.setState({ selectedScoreIndex: 1 });
    const { user, getScore, onUpdate, initialScore } = renderInspector();
    await choose(user, /^Root$/, "E");
    expect(chordInput().value).toBe("E/F#");
    expectOnlyChordChanged(initialScore, getScore(), parseChordSymbolText("D/E", POSITION));
    await choose(user, /^Bass$/, "A");
    expect(chordInput().value).toBe("E/A#");
    await choose(user, /^Bass accidental$/, "Natural");
    expect(chordInput().value).toBe("E/A");
    expectOnlyChordChanged(initialScore, getScore(), parseChordSymbolText("D/G", POSITION));
    expect(onUpdate).toHaveBeenCalledTimes(3);
    expect(previewChord.mock.calls.map(([chord]) => chord.rawText)).toEqual(["D/E", "D/G#", "D/G"]);
  });

  it("changes only the source Part visibility for show, hide, and auto, without auditioning", async () => {
    const { user, getScore, onUpdate, initialScore } = renderInspector();
    expect(screen.getByRole("combobox", { name: /^Chord visibility — Clarinet/ }).textContent).toContain("Auto");
    for (const [label, value] of [
      ["Show", "show"],
      ["Hide", "hide"],
      ["Auto", "auto"],
    ] as const) {
      await choose(user, /^Chord visibility — Clarinet/, label);
      const expected = structuredClone(initialScore);
      expected.parts[1]!.chordSymbolVisibility = value;
      expect(getScore()).toEqual(expected);
      expect(getScore().parts[0]).toBe(initialScore.parts[0]);
      expect(getScore().parts[1]!.measures).toBe(initialScore.parts[1]!.measures);
      expect(getScore().layouts).toBe(initialScore.layouts);
      expect(getScore().global).toBe(initialScore.global);
    }
    expect(onUpdate).toHaveBeenCalledTimes(3);
    expect(previewChord).not.toHaveBeenCalled();
  });

  it("discards an uncommitted draft when its selection is cleared", async () => {
    const { user, onUpdate } = renderInspector();
    await user.clear(chordInput());
    await user.type(chordInput(), "Dm7");
    // A canvas selection change replaces the target without blurring the input first.
    act(() => screen.getByRole("button", { name: "Clear target" }).click());
    expect(screen.queryByRole("textbox", { name: "Chord text" })).toBeNull();
    expect(onUpdate).not.toHaveBeenCalled();
    expect(previewChord).not.toHaveBeenCalled();
  });

  it.each(["m99/chord0", "m0/chord99", "m0/chord0/p1/staffx", "p1/m0/chord0", "not-a-chord"])(
    "ignores invalid or legacy local target %s",
    (elementId) => {
      const { onUpdate } = renderInspector(buildScore(), {
        ...RENDERED_TARGET,
        elementId,
        elementType: "chord-symbol",
      });
      expect(screen.queryByRole("group", { name: "Chord Symbol" })).toBeNull();
      expect(screen.queryByRole("textbox", { name: "Chord text" })).toBeNull();
      expect(onUpdate).not.toHaveBeenCalled();
      expect(previewChord).not.toHaveBeenCalled();
    },
  );
});
