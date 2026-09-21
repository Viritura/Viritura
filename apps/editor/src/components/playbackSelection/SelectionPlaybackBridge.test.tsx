import { act, cleanup, render, renderHook } from "@testing-library/react";
import type { Score } from "@viritura/core";
import type { PlaybackState } from "@viritura/playback";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDocumentStoreApi } from "../../store/DocumentContext";
import { resetSelectionStore, useSelectionStore, type SelectionState } from "../../store/selectionStore";
import { useViewStateStore } from "../../store/viewStateStore";
import { SelectionPlaybackBridge } from "./SelectionPlaybackBridge";

const playback = vi.hoisted(() => ({
  state: { status: "stopped" as PlaybackState["status"] },
  actions: {
    setSelectionPartIds: vi.fn<(partIds: readonly string[] | null) => void>(),
    setSelectionStaffCount: vi.fn<(staffCount: number | null) => void>(),
    measureBeatToSeconds: vi.fn<(measure: number, beat: number) => number | null>(),
    seek: vi.fn<(seconds: number) => void>(),
  },
}));

vi.mock("@viritura/playback", () => ({
  getPlaybackSnapshot: () => playback,
  usePlaybackActions: () => playback.actions,
}));

vi.mock("../../store/DocumentContext", async () => {
  const { createStore } = await import("zustand");
  const store = createStore<{ score: Score | null; dirty: boolean }>(() => ({ score: null, dirty: false }));
  return { useDocumentStoreApi: () => store };
});

function makeScore(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{}, {}, {}] },
    parts: ["flute-source", "piano-source", "cello-source"].map((id) => ({
      id,
      staves: id === "piano-source" ? 2 : 1,
      measures: Array.from({ length: 3 }, () => ({
        sequences: [
          {
            content: [
              {
                type: "event",
                id: "first",
                duration: { base: "quarter" },
                notes: [{ pitch: { step: "C", octave: 4 } }],
              },
              {
                type: "event",
                id: "second",
                duration: { base: "quarter" },
                notes: [{ pitch: { step: "D", octave: 4 } }],
              },
            ],
          },
        ],
      })),
    })),
  };
}

const measure: Extract<SelectionState, { kind: "measure" }> = {
  kind: "measure",
  startPartIndex: 1,
  endPartIndex: 1,
  startStaffIndex: 2,
  endStaffIndex: 2,
  startLocalStaffIndex: 1,
  endLocalStaffIndex: 1,
  startMeasure: 1,
  endMeasure: 2,
};

function select(selection: SelectionState) {
  act(() => useSelectionStore.setState({ selection }));
}

describe("SelectionPlaybackBridge part filtering", () => {
  // The mocked hook returns a real Zustand store so subscriptions and cleanup
  // have the same synchronous notification behavior as the document store.
  let documentStore: ReturnType<typeof useDocumentStoreApi>;

  beforeEach(() => {
    documentStore = renderHook(() => useDocumentStoreApi()).result.current;
    vi.clearAllMocks();
    playback.state.status = "stopped";
    playback.actions.measureBeatToSeconds.mockImplementation((index, beat) => index * 2 + beat * 0.5);
    resetSelectionStore();
    useViewStateStore.setState({ selectedScoreIndex: 0, selectedPartIds: [] });
    documentStore.setState({ score: makeScore(), dirty: false });
  });

  afterEach(() => cleanup());

  it("initializes a pre-existing whole-measure filter without seeking on mount", () => {
    select(measure);
    render(<SelectionPlaybackBridge />);
    expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(["piano-source"]);
    expect(playback.actions.setSelectionStaffCount).toHaveBeenLastCalledWith(1);
    expect(playback.actions.seek).not.toHaveBeenCalled();
    expect(playback.actions.measureBeatToSeconds).not.toHaveBeenCalled();
  });

  it("initializes no filter for an empty selection", () => {
    render(<SelectionPlaybackBridge />);
    expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(null);
    expect(playback.actions.setSelectionStaffCount).toHaveBeenLastCalledWith(null);
    expect(playback.actions.setSelectionPartIds.mock.calls.every(([partIds]) => partIds === null)).toBe(true);
    expect(playback.actions.seek).not.toHaveBeenCalled();
  });

  it("updates live multi-part bounds, includes whole instruments, and preserves measure seeking", () => {
    render(<SelectionPlaybackBridge />);
    select({ ...measure, startPartIndex: 2, endPartIndex: 0, startStaffIndex: 3, endStaffIndex: 0 });
    expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith([
      "flute-source",
      "piano-source",
      "cello-source",
    ]);
    expect(playback.actions.setSelectionStaffCount).toHaveBeenLastCalledWith(4);
    expect(playback.actions.seek).toHaveBeenCalledExactlyOnceWith(2);
    select(measure);
    expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(["piano-source"]);
    expect(playback.actions.setSelectionStaffCount).toHaveBeenLastCalledWith(1);
  });

  it("clears the filter without seeking or resetting the retained start position", () => {
    render(<SelectionPlaybackBridge />);
    select(measure);
    playback.actions.seek.mockClear();
    playback.actions.measureBeatToSeconds.mockClear();
    select({ kind: "none" });
    expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(null);
    expect(playback.actions.setSelectionStaffCount).toHaveBeenLastCalledWith(null);
    expect(playback.actions.seek).not.toHaveBeenCalled();
    expect(playback.actions.measureBeatToSeconds).not.toHaveBeenCalled();
  });

  it.each<SelectionState>([
    { kind: "multi", elementIds: ["p0/m0/s0/first", "p2/m2/s0/second"] },
    { kind: "range", startElementId: "p0/m0/s0/first", endElementId: "p2/m2/s0/second" },
    { kind: "single", elementId: "unrelated", elementType: "unknown" },
  ])("removes the filter for $kind selections without adding a seek", (selection) => {
    select(measure);
    render(<SelectionPlaybackBridge />);
    select(selection);
    expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(null);
    expect(playback.actions.setSelectionStaffCount).toHaveBeenLastCalledWith(null);
    expect(playback.actions.seek).not.toHaveBeenCalled();
  });

  it("clears whole-measure filtering for a single note while preserving its beat-offset seek", () => {
    select(measure);
    render(<SelectionPlaybackBridge />);
    select({ kind: "single", elementId: "p1/m1/s0/second/n0", elementType: "note" });
    expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(null);
    expect(playback.actions.setSelectionStaffCount).toHaveBeenLastCalledWith(null);
    expect(playback.actions.measureBeatToSeconds).toHaveBeenCalledExactlyOnceWith(1, 1);
    expect(playback.actions.seek).toHaveBeenCalledExactlyOnceWith(2.5);
  });

  it("initializes, updates, and clears filters while loading without seeking", () => {
    playback.state.status = "loading";
    select(measure);
    render(<SelectionPlaybackBridge />);
    expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(["piano-source"]);
    select({ ...measure, startPartIndex: 2, endPartIndex: 2 });
    expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(["cello-source"]);
    select({ kind: "none" });
    expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(null);
    expect(playback.actions.seek).not.toHaveBeenCalled();
    expect(playback.actions.measureBeatToSeconds).not.toHaveBeenCalled();
  });

  it("refreshes source IDs on score changes during preparation without seeking", () => {
    playback.state.status = "loading";
    select(measure);
    render(<SelectionPlaybackBridge />);
    const changed = makeScore();
    changed.parts[1] = { ...changed.parts[1]!, id: "replacement-source" };
    act(() => documentStore.setState({ score: changed }));
    expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(["replacement-source"]);
    act(() => documentStore.setState({ score: null }));
    expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(null);
    act(() => documentStore.setState({ score: makeScore() }));
    expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(["piano-source"]);
    expect(playback.actions.seek).not.toHaveBeenCalled();
  });

  it("ignores unchanged selections and unrelated document updates", () => {
    select(measure);
    render(<SelectionPlaybackBridge />);
    playback.actions.setSelectionPartIds.mockClear();
    select(measure);
    act(() => documentStore.setState({ dirty: true }));
    expect(playback.actions.setSelectionPartIds).not.toHaveBeenCalled();
    expect(playback.actions.seek).not.toHaveBeenCalled();
  });

  it("resolves live measure actions using the active layout and refreshes on layout/view changes without seeking", () => {
    const score: Score = {
      ...makeScore(),
      scores: [
        { name: "Reordered", layout: "reordered" },
        { name: "Condensed", layout: "condensed" },
      ],
      layouts: [
        {
          id: "reordered",
          content: [
            { type: "staff", sources: [{ part: "piano-source", staff: 2 }] },
            { type: "staff", sources: [{ part: "flute-source" }] },
            { type: "staff", sources: [{ part: "cello-source" }] },
          ],
        },
        {
          id: "condensed",
          content: [
            { type: "staff", sources: [{ part: "cello-source" }, { part: "flute-source" }] },
            { type: "staff", sources: [{ part: "piano-source", staff: 1 }] },
            { type: "staff", sources: [{ part: "piano-source", staff: 2 }] },
          ],
        },
      ],
    };
    documentStore.setState({ score });
    const bridge = render(<SelectionPlaybackBridge />);
    const { _dispatch } = useSelectionStore.getState();
    act(() => _dispatch({ type: "SELECT_MEASURE", partIndex: 1, staffIndex: 0, measureIndex: 0 }));
    expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(["piano-source"]);
    act(() => _dispatch({ type: "EXTEND_MEASURE", partIndex: 2, staffIndex: 2, measureIndex: 2 }));
    expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith([
      "flute-source",
      "piano-source",
      "cello-source",
    ]);
    act(() => _dispatch({ type: "SELECT_MEASURE", partIndex: 1, staffIndex: 0, measureIndex: 0 }));
    playback.actions.seek.mockClear();
    act(() => useViewStateStore.getState().setSelectedPartIds(["flute-source", "cello-source"]));
    expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(["flute-source"]);
    act(() => useViewStateStore.getState().setSelectedPartIds([]));
    expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(["piano-source"]);
    act(() => useViewStateStore.getState().setSelectedScoreIndex(1));
    expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(["flute-source", "cello-source"]);
    act(() =>
      documentStore.setState({
        score: {
          ...score,
          layouts: [
            score.layouts![0]!,
            { id: "condensed", content: [{ type: "staff", sources: [{ part: "flute-source" }] }] },
          ],
        },
      }),
    );
    expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(["flute-source"]);
    expect(playback.actions.seek).not.toHaveBeenCalled();
    bridge.unmount();
    playback.actions.setSelectionPartIds.mockClear();
    act(() => useViewStateStore.getState().setSelectedScoreIndex(0));
    expect(playback.actions.setSelectionPartIds).not.toHaveBeenCalled();
  });

  it("reapplies the initial selection when the provider publishes its live action", () => {
    select(measure);
    const bridge = render(<SelectionPlaybackBridge />);
    const initialAction = playback.actions.setSelectionPartIds;
    const publishedAction = vi.fn<(partIds: readonly string[] | null) => void>();
    playback.actions.setSelectionPartIds = publishedAction;
    bridge.rerender(<SelectionPlaybackBridge />);
    expect(publishedAction).toHaveBeenCalledExactlyOnceWith(["piano-source"]);
    expect(playback.actions.seek).not.toHaveBeenCalled();
    bridge.unmount();
    expect(publishedAction).toHaveBeenLastCalledWith(null);
    expect(playback.actions.setSelectionStaffCount).toHaveBeenLastCalledWith(null);
    playback.actions.setSelectionPartIds = initialAction;
  });

  it("clears on unmount and removes both subscriptions", () => {
    select(measure);
    const bridge = render(<SelectionPlaybackBridge />);
    playback.actions.setSelectionPartIds.mockClear();
    bridge.unmount();
    expect(playback.actions.setSelectionPartIds).toHaveBeenCalledExactlyOnceWith(null);
    expect(playback.actions.setSelectionStaffCount).toHaveBeenLastCalledWith(null);
    playback.actions.setSelectionPartIds.mockClear();
    select({ ...measure, endPartIndex: 2 });
    act(() => documentStore.setState({ score: makeScore() }));
    expect(playback.actions.setSelectionPartIds).not.toHaveBeenCalled();
    expect(playback.actions.seek).not.toHaveBeenCalled();
  });
});
