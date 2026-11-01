// @vitest-environment happy-dom
import { useRef, useState } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Score } from "@viritura/core";
import { useChordTrackNavigation } from "./useChordTrackNavigation";
import type { TrackEditorTarget } from "./useChordTrackEditing";

afterEach(cleanup);

describe("musical beat navigation with note-value grids", () => {
  it("navigates and positions compound beats even when the quarter grid has no tick there", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 6, unit: 8 } }] },
      parts: [],
    };
    const open = vi.fn();
    const commit = vi.fn(() => score);
    const quarterPoints = [0, 1, 2].map((beat) => ({ measureIndex: 0, beat, x: 100 + beat * 100 }));
    const beatPoints = [0, 1.5].map((beat) => ({ measureIndex: 0, beat, x: 100 + beat * 100 }));
    const { result } = renderHook(() => {
      const root = useRef<HTMLDivElement>(null);
      const [editor, setEditor] = useState<TrackEditorTarget | null>({
        point: quarterPoints[1]!,
        position: { x: 200, y: 250 },
      });
      return useChordTrackNavigation({
        root,
        viewport: { zoom: 1, scrollX: 0, scrollY: 0 },
        railY: 200,
        laneZoom: 1,
        points: quarterPoints,
        beatPoints,
        onRevealPoint: vi.fn(),
        editing: {
          score,
          chords: [],
          editor,
          setEditor,
          open,
          commit,
          select: vi.fn(),
          move: vi.fn(),
          remove: vi.fn(),
          selected: undefined,
          initialText: "",
        },
      });
    });
    act(() => {
      expect(result.current.navigate("C", "nextBeat")).toBe(true);
    });
    expect(open).toHaveBeenLastCalledWith(beatPoints[1], new DOMRect(250, 276, 0, 0));
    act(() => {
      expect(result.current.navigate("", "previousBeat")).toBe(true);
    });
    expect(open).toHaveBeenLastCalledWith(beatPoints[0], new DOMRect(100, 276, 0, 0));
    expect(commit).toHaveBeenCalledTimes(2);
  });
});
