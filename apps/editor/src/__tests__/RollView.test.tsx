import type { ReactNode } from "react";
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Score } from "@viritura/core";
import type { PianoRollNote } from "@viritura/piano-roll";
import { RollView } from "../components/modes/RollView";
import { useMixerActions, useMixerPartSync } from "../store/mixerStore";

const boundary = vi.hoisted(() => ({
  canvas: vi.fn<(props: { notes: PianoRollNote[] }) => void>(),
  keyboard: vi.fn<(props: { activeNotes: ReadonlySet<number> }) => void>(),
  time: 0.1,
}));

vi.mock("@viritura/playback", () => ({
  TransportBar: () => null,
  usePlaybackState: () => ({ playheadPosition: { timeSeconds: boundary.time } }),
}));
vi.mock("../components/AppShell", () => ({
  ToolbarPortal: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@viritura/piano-roll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@viritura/piano-roll")>()),
  PianoRollProvider: ({ children }: { children: ReactNode }) => children,
  PianoRollCanvas: (props: { notes: PianoRollNote[] }) => {
    boundary.canvas(props);
    return null;
  },
  PianoKeyboard: (props: { activeNotes: ReadonlySet<number> }) => {
    boundary.keyboard(props);
    return null;
  },
  FpsCounter: () => null,
  usePianoRollViewport: () => ({ secondsAhead: 5 }),
}));

function makeScore(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [
        {
          time: { count: 4, unit: 4 },
          tempos: [{ bpm: 120, value: { base: "quarter" } }],
          chordSymbols: [{ rawText: "C", position: { fraction: [0, 1] } }],
        },
        {},
        {},
      ],
    },
    parts: ["C", "D"].map((step, index) => ({
      id: `part-${index}`,
      name: index === 0 ? "Flute" : "Violin",
      measures: [
        {
          sequences: [
            {
              content: [
                {
                  type: "event",
                  duration: { base: "whole" },
                  notes: [{ pitch: { step, octave: 5 } }],
                },
              ],
            },
          ],
        },
        { sequences: [] },
        { sequences: [] },
      ],
    })),
  };
}

function notes(): PianoRollNote[] {
  return boundary.canvas.mock.calls.at(-1)![0].notes;
}

function visibleParts(): number[] {
  return [...new Set(notes().map((note) => note.partIndex))].sort();
}

function activeNotes(): ReadonlySet<number> {
  return boundary.keyboard.mock.calls.at(-1)![0].activeNotes;
}

beforeEach(() => {
  const { result, unmount } = renderHook(useMixerActions);
  act(() => result.current.reset());
  unmount();
  vi.clearAllMocks();
  boundary.time = 0.1;
});

afterEach(cleanup);

describe("RollView playback mixer integration", () => {
  it("limits the derived chord rectangles to their written bar", () => {
    render(<RollView score={makeScore()} />);
    const chords = notes().filter((note) => note.partIndex === 2);
    expect(chords).toHaveLength(4);
    expect(chords.every((note) => note.startSeconds === 0 && note.endSeconds === 2)).toBe(true);
  });

  it("hides and restores muted instrument and Chords notes and keyboard highlights live", () => {
    const { result } = renderHook(() => {
      useMixerPartSync(2, true);
      return useMixerActions();
    });
    const score = makeScore();
    const original = structuredClone(score);
    render(<RollView score={score} />);
    expect(visibleParts()).toEqual([0, 1, 2]);
    expect(activeNotes().has(72)).toBe(true);
    expect(activeNotes().has(36)).toBe(true);

    act(() => result.current.toggleMute(0));
    expect(visibleParts()).toEqual([1, 2]);
    expect(activeNotes().has(72)).toBe(false);
    act(() => result.current.toggleMute(2));
    expect(visibleParts()).toEqual([1]);
    expect(activeNotes().has(36)).toBe(false);
    act(() => {
      result.current.toggleMute(0);
      result.current.toggleMute(2);
    });
    expect(visibleParts()).toEqual([0, 1, 2]);
    expect(activeNotes().has(72)).toBe(true);
    expect(activeNotes().has(36)).toBe(true);
    expect(score).toEqual(original);
  });

  it("follows group mute, channel/group solo, and master mute without hiding zero faders", () => {
    const { result } = renderHook(() => {
      useMixerPartSync(2, true);
      return useMixerActions();
    });
    render(<RollView score={makeScore()} />);
    act(() => result.current.syncGroups(["Winds"], ["Winds", "", "Winds"]));
    act(() => result.current.toggleGroupMute("Winds"));
    expect(visibleParts()).toEqual([1, 2]);
    act(() => {
      result.current.toggleGroupMute("Winds");
      result.current.toggleGroupSolo("Winds");
    });
    expect(visibleParts()).toEqual([0]);
    act(() => {
      result.current.toggleGroupSolo("Winds");
      result.current.toggleSolo(2);
    });
    expect(visibleParts()).toEqual([2]);
    act(() => result.current.toggleSolo(2));
    act(() => result.current.toggleMasterMute());
    expect(visibleParts()).toEqual([]);
    expect(activeNotes().size).toBe(0);
    expect(screen.queryByText(/No notes to visualize/)).toBeNull();
    act(() => {
      result.current.toggleMasterMute();
      result.current.setVolume(0, 0);
    });
    expect(visibleParts()).toEqual([0, 1, 2]);
  });

  it("keeps projected notes stable across playhead-only updates", () => {
    const score = makeScore();
    const view = render(<RollView score={score} />);
    const original = notes();
    boundary.time = 0.2;
    view.rerender(<RollView score={score} />);
    expect(notes()).toBe(original);
  });
});
