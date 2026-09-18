import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpatialIndex, paintGhostNote, type DisplayList } from "@viritura/renderer";
import type { Score } from "@viritura/core";
import { InputCursor } from "../components/InputCursor";
import { initialNoteInputState, useNoteInputStore } from "../store/noteInputStore";
import { OPTIMISTIC_NOTE_INPUT_EVENT } from "../components/inputCursorHelpers";

vi.mock("../components/useGlyphWarmup", () => ({ useGlyphWarmup: () => {} }));
vi.mock("@viritura/renderer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@viritura/renderer")>()),
  paintGhostNote: vi.fn(),
}));

const displayList: DisplayList = {
  width: 500,
  height: 240,
  commands: Array.from({ length: 5 }, (_, index) => ({
    type: "DrawLine",
    x1: 20,
    x2: 420,
    y1: 100 + index * 12,
    y2: 100 + index * 12,
    width: 1.56,
    color: "#000000",
  })),
  measureBounds: [
    {
      index: 0,
      partIndex: 0,
      staffIndex: 0,
      x: 20,
      y: 100,
      width: 400,
      height: 48,
      prefixWidth: 40,
      totalBeats: 4,
      beatAnchors: [
        [0, 60],
        [4, 420],
      ],
    },
  ],
};
const score: Score = {
  mnx: { version: 1 },
  global: { measures: [{ time: { count: 4, unit: 4 } }] },
  parts: [{ measures: [{ sequences: [{ content: [] }] }] }],
};
const spatialIndex = new SpatialIndex([]);
const context = {
  clearRect: vi.fn(),
  setTransform: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  fill: vi.fn(),
  closePath: vi.fn(),
  fillText: vi.fn(),
  setLineDash: vi.fn(),
  measureText: vi.fn(() => ({ width: 8 })),
} as unknown as CanvasRenderingContext2D;
let frame: FrameRequestCallback | undefined;

function flushFrame(): void {
  act(() => {
    const pending = frame;
    frame = undefined;
    pending?.(0);
  });
}

function mountHoveredCursor(previewScore = score) {
  const onHoverBeat = vi.fn();
  const { container, rerender } = render(
    <InputCursor
      displayList={displayList}
      scrollX={0}
      scrollY={0}
      zoom={1}
      spatialIndex={spatialIndex}
      score={previewScore}
      onHoverBeat={onHoverBeat}
    />,
  );
  const canvas = container.querySelector("canvas")!;
  fireEvent.mouseMove(canvas, { clientX: 185, clientY: 124 });
  flushFrame();
  expect(paintGhostNote).toHaveBeenCalled();
  return { canvas, onHoverBeat, rerender };
}

function lastGhost() {
  return vi.mocked(paintGhostNote).mock.calls.at(-1)![1];
}

beforeEach(() => {
  vi.clearAllMocks();
  frame = undefined;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    }),
  );
  vi.stubGlobal(
    "cancelAnimationFrame",
    vi.fn(() => {
      frame = undefined;
    }),
  );
  useNoteInputStore.setState({ ...initialNoteInputState, active: true });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useNoteInputStore.setState(initialNoteInputState);
});

describe("InputCursor selected rhythm", () => {
  it("repaints live duration and dot changes without another mouse movement", () => {
    mountHoveredCursor();
    expect(lastGhost()).toMatchObject({ duration: "quarter", dots: 0, y: 124, staff: { y: 100, spatium: 12 } });
    const paints = vi.mocked(paintGhostNote).mock.calls.length;

    act(() => useNoteInputStore.setState({ currentDuration: "16th" }));
    expect(vi.mocked(paintGhostNote).mock.calls.length).toBeGreaterThan(paints);
    expect(lastGhost()).toMatchObject({ duration: "16th", dots: 0, y: 124 });
    act(() => useNoteInputStore.setState({ dotCount: 3 }));
    expect(lastGhost()).toMatchObject({ duration: "16th", dots: 3, y: 124 });
    act(() => useNoteInputStore.setState({ currentDuration: "whole", dotCount: 0 }));
    expect(lastGhost()).toMatchObject({ duration: "whole", dots: 0, y: 124 });
  });

  it("uses Alt only for snap spacing, not the selected ghost duration or dots", () => {
    useNoteInputStore.setState({ currentDuration: "half", dotCount: 1 });
    const { onHoverBeat } = mountHoveredCursor();
    const selectedX = lastGhost().x;
    expect(lastGhost()).toMatchObject({ duration: "half", dots: 1 });

    fireEvent.keyDown(window, { key: "Alt", altKey: true });
    flushFrame();
    expect(lastGhost()).toMatchObject({ duration: "half", dots: 1 });
    expect(lastGhost().x).not.toBe(selectedX);
    expect(onHoverBeat).toHaveBeenLastCalledWith({ measureIndex: 0, beat: 1.5, scoreX: 185 });

    fireEvent.keyUp(window, { key: "Alt" });
    flushFrame();
    expect(lastGhost()).toMatchObject({ duration: "half", dots: 1, x: selectedX });
  });

  it("updates rest, accidental and grace options at a stationary pointer", () => {
    mountHoveredCursor();
    act(() =>
      useNoteInputStore.setState({ currentDuration: "eighth", currentAccidental: "sharp", currentGraceType: "grace" }),
    );
    expect(lastGhost()).toMatchObject({
      duration: "eighth",
      accidental: "sharp",
      isGrace: true,
      slash: true,
      isRest: false,
    });
    act(() => useNoteInputStore.setState({ currentGraceType: "appoggiatura" }));
    expect(lastGhost()).toMatchObject({ isGrace: true, slash: false });
    act(() => useNoteInputStore.setState({ isRest: true, currentGraceType: null, dotCount: 2 }));
    expect(lastGhost()).toMatchObject({ isRest: true, isGrace: false, slash: false, dots: 2 });
  });

  it("paints with updated staff scale on the first layout repaint", () => {
    const { rerender } = mountHoveredCursor();
    const scaledDisplayList: DisplayList = {
      ...displayList,
      commands: displayList.commands.map((command) =>
        command.type === "DrawLine"
          ? { ...command, y1: 100 + (command.y1 - 100) * 2, y2: 100 + (command.y2 - 100) * 2, width: 3.12 }
          : command,
      ),
    };
    rerender(
      <InputCursor
        displayList={scaledDisplayList}
        scrollX={0}
        scrollY={0}
        zoom={1}
        spatialIndex={spatialIndex}
        score={score}
      />,
    );
    expect(lastGhost()).toMatchObject({ y: 124, staff: { spatium: 24, height: 96 } });
  });

  it("uses the clicked kit component's position and head without pitched accidentals", () => {
    useNoteInputStore.setState({ currentDuration: "eighth", currentAccidental: "sharp" });
    mountHoveredCursor({
      ...score,
      parts: [{ ...score.parts[0]!, kit: { cymbal: { staffPosition: 5, notehead: "x" } } }],
    });
    expect(lastGhost()).toMatchObject({ y: 94, notehead: "x", accidental: null, duration: "eighth" });
  });

  it("carries selected dots and grace styling into optimistic keyboard previews", () => {
    useNoteInputStore.setState({ currentDuration: "eighth", dotCount: 2, currentGraceType: "grace" });
    mountHoveredCursor();
    act(() =>
      window.dispatchEvent(
        new CustomEvent(OPTIMISTIC_NOTE_INPUT_EVENT, {
          detail: {
            cursor: { partIndex: 0, measureIndex: 0, beatPosition: 0 },
            staffPosition: 6,
            duration: "eighth",
            accidental: null,
            isRest: false,
          },
        }),
      ),
    );
    expect(lastGhost()).toMatchObject({ y: 136, duration: "eighth", dots: 2, isGrace: true, slash: true });
  });
});
