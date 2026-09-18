import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Score } from "@viritura/core";
import { paintGhostNote, SpatialIndex, type DisplayList } from "@viritura/renderer";
import { InputCursor } from "../../InputCursor";
import { initialNoteInputState, useNoteInputStore } from "../../../store/noteInputStore";

vi.mock("../../useGlyphWarmup", () => ({ useGlyphWarmup: () => {} }));
vi.mock("@viritura/renderer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@viritura/renderer")>()),
  paintGhostNote: vi.fn(),
  paintInputCursor: vi.fn(),
  paintBeatRuler: vi.fn(),
}));

const score: Score = {
  mnx: { version: 1 },
  global: { measures: [{ time: { count: 4, unit: 4 } }] },
  parts: [{ measures: [{ sequences: [{ content: [] }] }] }],
};
const displayList: DisplayList = {
  width: 400,
  height: 200,
  commands: Array.from({ length: 5 }, (_, i) => ({
    type: "DrawLine",
    x1: 0,
    x2: 400,
    y1: 100 + i * 10,
    y2: 100 + i * 10,
    width: 1,
    color: "#000",
  })),
  measureBounds: [
    {
      index: 0,
      partIndex: 0,
      staffIndex: 0,
      x: 0,
      y: 100,
      width: 400,
      height: 40,
      prefixWidth: 0,
      totalBeats: 4,
      beatAnchors: [
        [0, 0],
        [4, 400],
      ],
    },
  ],
};
const frames = new Map<number, FrameRequestCallback>();
let frameId = 0;

function paintFrame() {
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback(0);
  });
}

function mountCursor() {
  const onHoverBeat = vi.fn();
  const onClick = vi.fn();
  const view = render(
    <InputCursor
      displayList={displayList}
      score={score}
      spatialIndex={new SpatialIndex([])}
      scrollX={0}
      scrollY={0}
      zoom={1}
      onHoverBeat={onHoverBeat}
      onClick={onClick}
    />,
  );
  const canvas = view.container.querySelector("canvas")!;
  return { ...view, canvas, onHoverBeat, onClick };
}

function expectGhost(onHoverBeat: ReturnType<typeof vi.fn>, beat: number, x: number) {
  expect(onHoverBeat).toHaveBeenLastCalledWith({ measureIndex: 0, beat, scoreX: 135 });
  expect(paintGhostNote).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({ x, duration: "quarter" }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  frames.clear();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    clearRect: vi.fn(),
    setTransform: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  useNoteInputStore.setState({ ...initialNoteInputState, active: true, currentDuration: "quarter" });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useNoteInputStore.setState(initialNoteInputState);
});

describe("ScoreCanvas note-input Alt lifecycle", () => {
  it("repaints the actual fine-grid ghost onto the selected rhythm on release without a click or move", () => {
    const { canvas, onHoverBeat, onClick } = mountCursor();
    fireEvent.mouseMove(canvas, { clientX: 135, clientY: 120, altKey: false });
    paintFrame();
    expectGhost(onHoverBeat, 1, 100);

    for (let cycle = 0; cycle < 4; cycle++) {
      fireEvent.keyDown(window, { key: "Alt", altKey: true });
      paintFrame();
      expectGhost(onHoverBeat, 1.25, 125);
      fireEvent.keyUp(window, { key: "Alt", altKey: false });
      paintFrame();
      expectGhost(onHoverBeat, 1, 100);
    }
    expect(onClick).not.toHaveBeenCalled();
  });

  it.each(["pointerMove", "mouseMove"] as const)(
    "uses %s altKey to recover a lost keyup and continues following rhythmic positions",
    (move) => {
      const { canvas, onHoverBeat } = mountCursor();
      fireEvent.mouseMove(canvas, { clientX: 135, clientY: 120, altKey: true });
      paintFrame();
      expectGhost(onHoverBeat, 1.25, 125);

      fireEvent[move](canvas, { clientX: 135, clientY: 120, altKey: false });
      paintFrame();
      expectGhost(onHoverBeat, 1, 100);
      fireEvent[move](canvas, { clientX: 235, clientY: 120, altKey: false });
      paintFrame();
      expect(onHoverBeat).toHaveBeenLastCalledWith({ measureIndex: 0, beat: 2, scoreX: 235 });
      expect(paintGhostNote).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ x: 200 }));
    },
  );

  it("uses pointer altKey even when keydown was missed", () => {
    const { canvas, onHoverBeat } = mountCursor();
    fireEvent.pointerMove(canvas, { clientX: 135, clientY: 120, altKey: true });
    paintFrame();
    expectGhost(onHoverBeat, 1.25, 125);

    fireEvent.pointerMove(canvas, { clientX: 135, clientY: 120, altKey: false });
    paintFrame();
    expectGhost(onHoverBeat, 1, 100);
  });

  it.each(["blur", "focus", "hidden", "pointerleave", "pointercancel", "deactivate"])(
    "clears transient hover and Alt on %s, then recovers without a click",
    (event) => {
      const { canvas, onHoverBeat } = mountCursor();
      fireEvent.mouseMove(canvas, { clientX: 135, clientY: 120, altKey: true });
      paintFrame();
      expectGhost(onHoverBeat, 1.25, 125);
      vi.mocked(paintGhostNote).mockClear();

      if (event === "hidden") {
        vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
        fireEvent(document, new Event("visibilitychange"));
      } else if (event === "deactivate") {
        act(() => useNoteInputStore.setState({ active: false }));
        act(() => useNoteInputStore.setState({ active: true }));
      } else {
        fireEvent(event.startsWith("pointer") ? canvas : window, new Event(event));
      }
      paintFrame();
      expect(onHoverBeat).toHaveBeenLastCalledWith(null);
      expect(paintGhostNote).not.toHaveBeenCalled();

      if (event === "hidden") {
        vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
        fireEvent(document, new Event("visibilitychange"));
      }
      fireEvent.keyUp(window, { key: "Alt" });
      paintFrame();
      expect(paintGhostNote).not.toHaveBeenCalled();
      fireEvent.pointerMove(canvas, { clientX: 135, clientY: 120, altKey: false });
      paintFrame();
      expectGhost(onHoverBeat, 1, 100);
    },
  );

  it("observes keyup even when another target stops bubbling, without preventing Alt shortcuts", () => {
    const { canvas, onHoverBeat } = mountCursor();
    canvas.addEventListener("keyup", (event) => event.stopPropagation());
    fireEvent.mouseMove(canvas, { clientX: 135, clientY: 120, altKey: true });
    paintFrame();
    expectGhost(onHoverBeat, 1.25, 125);
    expect(fireEvent.keyUp(canvas, { key: "Alt", altKey: false })).toBe(true);
    paintFrame();
    expectGhost(onHoverBeat, 1, 100);

    for (const key of ["Alt", "1", "c", "Tab", " "]) {
      expect(fireEvent.keyDown(canvas, { key, altKey: true })).toBe(true);
      expect(fireEvent.keyUp(canvas, { key, altKey: true })).toBe(true);
    }
  });

  it("reconciles a missing Alt release from another key's modifiers", () => {
    const { canvas, onHoverBeat } = mountCursor();
    fireEvent.mouseMove(canvas, { clientX: 135, clientY: 120, altKey: true });
    paintFrame();
    expectGhost(onHoverBeat, 1.25, 125);
    fireEvent.keyDown(window, { key: "Shift", shiftKey: true, altKey: false });
    paintFrame();
    expectGhost(onHoverBeat, 1, 100);
  });

  it("does not track Alt outside hover or while note input is inactive", () => {
    const { canvas, onHoverBeat } = mountCursor();
    paintFrame();
    expect(fireEvent.keyDown(window, { key: "Alt", altKey: true })).toBe(true);
    expect(frames.size).toBe(0);
    act(() => useNoteInputStore.setState({ active: false }));
    paintFrame();
    fireEvent.pointerMove(canvas, { clientX: 135, clientY: 120, altKey: true });
    expect(fireEvent.keyDown(window, { key: "Alt", altKey: true })).toBe(true);
    expect(frames.size).toBe(0);
    act(() => useNoteInputStore.setState({ active: true }));
    paintFrame();
    expect(onHoverBeat).toHaveBeenLastCalledWith(null);
    expect(paintGhostNote).not.toHaveBeenCalled();
  });

  it("removes listeners and cancels pending repaint on unmount", () => {
    const { canvas, unmount } = mountCursor();
    fireEvent.mouseMove(canvas, { clientX: 135, clientY: 120, altKey: true });
    unmount();
    expect(frames.size).toBe(0);
    fireEvent.keyUp(window, { key: "Alt" });
    fireEvent(window, new Event("focus"));
    fireEvent(document, new Event("visibilitychange"));
    expect(frames.size).toBe(0);
  });
});
