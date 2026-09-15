import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlayheadOverlay } from "@viritura/playback";
import { paintPlayheadAtPosition, type DisplayList, type PlayheadPosition } from "@viritura/renderer";

vi.mock("@viritura/renderer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@viritura/renderer")>()),
  paintPlayheadAtPosition: vi.fn(() => ({ x: 120, yTop: 40, yBottom: 100 })),
}));

const DISPLAY_LIST: DisplayList = { commands: [], width: 1000, height: 600 };
const POSITION: PlayheadPosition = { measureIndex: 0, beat: 1 };
const RECT = { x: 120, yTop: 40, yBottom: 100 };
const CONTAINER_STYLE = { width: 1000, height: 600 };
const context = { setTransform: vi.fn(), clearRect: vi.fn() };
const frames = new Map<number, FrameRequestCallback>();
let nextFrame: number;
let width: number;
let height: number;

interface SceneProps {
  position?: PlayheadPosition | null;
  displayList?: DisplayList | null;
  scoreVisible?: boolean;
  scoreTestId?: string;
  onRect?: ReturnType<typeof vi.fn>;
}

function Scene({
  position = POSITION,
  displayList = DISPLAY_LIST,
  scoreVisible = true,
  scoreTestId,
  onRect,
}: SceneProps) {
  return (
    <div style={CONTAINER_STYLE}>
      {scoreVisible && (
        <canvas
          data-testid={scoreTestId}
          ref={(canvas) => {
            if (!canvas) return;
            Object.defineProperties(canvas, {
              clientWidth: { configurable: true, get: () => width },
              clientHeight: { configurable: true, get: () => height },
            });
          }}
        />
      )}
      <PlayheadOverlay
        playheadPosition={position}
        displayList={displayList}
        scrollX={10}
        scrollY={20}
        zoom={1}
        onPlayheadRect={onRect}
      />
    </div>
  );
}

function paintFrame() {
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback(16);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  frames.clear();
  nextFrame = 0;
  width = 800;
  height = 500;
  vi.stubGlobal("devicePixelRatio", 2);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      const id = ++nextFrame;
      frames.set(id, callback);
      return id;
    }),
  );
  vi.stubGlobal(
    "cancelAnimationFrame",
    vi.fn((id: number) => frames.delete(id)),
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PlayheadOverlay lifecycle", () => {
  it("paints again when an actively playing score remounts with the same position and layout", () => {
    const onRect = vi.fn();
    const first = render(<Scene onRect={onRect} />);
    paintFrame();
    expect(onRect).toHaveBeenLastCalledWith(RECT);
    const abandonedFrame = [...frames.values()][0]!;
    first.unmount();
    expect(frames.size).toBe(0);

    const second = render(<Scene onRect={onRect} />);
    const overlay = second.getByTestId<HTMLCanvasElement>("playhead-overlay");
    act(() => abandonedFrame(32));
    expect(frames.size).toBe(1);
    paintFrame();
    expect(overlay.width).toBe(1600);
    expect(overlay.height).toBe(1000);
    expect(onRect).toHaveBeenLastCalledWith(RECT);
    expect(context.setTransform).toHaveBeenLastCalledWith(2, 0, 0, 2, -20, -40);
    expect(paintPlayheadAtPosition).toHaveBeenCalledTimes(2);
  });

  it("recovers from zero geometry and hidden-to-shown sizing without prop or parent-size changes", () => {
    width = 0;
    height = 0;
    const onRect = vi.fn();
    const { getByTestId } = render(<Scene onRect={onRect} />);
    const overlay = getByTestId<HTMLCanvasElement>("playhead-overlay");
    paintFrame();
    expect(paintPlayheadAtPosition).not.toHaveBeenCalled();
    expect(onRect).toHaveBeenLastCalledWith(null);

    width = 800;
    height = 500;
    paintFrame();
    expect(overlay.width).toBe(1600);
    expect(overlay.height).toBe(1000);
    expect(overlay.style.width).toBe("800px");
    expect(overlay.style.height).toBe("500px");
    expect(onRect).toHaveBeenLastCalledWith(RECT);

    width = 0;
    height = 0;
    paintFrame();
    expect(overlay.width).toBe(0);
    expect(onRect).toHaveBeenLastCalledWith(null);
    expect(paintPlayheadAtPosition).toHaveBeenCalledTimes(1);

    width = 640;
    height = 480;
    paintFrame();
    expect(overlay.width).toBe(1280);
    expect(overlay.height).toBe(960);
    expect(onRect).toHaveBeenLastCalledWith(RECT);
  });

  it("finds a late or replaced score canvas even if it carries a test id", () => {
    const onRect = vi.fn();
    const { rerender, getByTestId } = render(<Scene scoreVisible={false} onRect={onRect} />);
    paintFrame();
    expect(paintPlayheadAtPosition).not.toHaveBeenCalled();
    expect(onRect).toHaveBeenLastCalledWith(null);

    rerender(<Scene scoreTestId="score-canvas" onRect={onRect} />);
    paintFrame();
    expect(getByTestId<HTMLCanvasElement>("playhead-overlay").width).toBe(1600);
    expect(onRect).toHaveBeenLastCalledWith(RECT);

    rerender(<Scene scoreVisible={false} onRect={onRect} />);
    paintFrame();
    expect(onRect).toHaveBeenLastCalledWith(null);
    width = 600;
    rerender(<Scene onRect={onRect} />);
    paintFrame();
    expect(getByTestId<HTMLCanvasElement>("playhead-overlay").width).toBe(1200);
    expect(onRect).toHaveBeenLastCalledWith(RECT);
  });

  it("does not reset unchanged backing dimensions and picks up device pixel ratio changes", () => {
    const { getByTestId } = render(<Scene />);
    const overlay = getByTestId<HTMLCanvasElement>("playhead-overlay");
    paintFrame();
    const setWidth = vi.spyOn(overlay, "width", "set");
    const setHeight = vi.spyOn(overlay, "height", "set");
    paintFrame();
    expect(setWidth).not.toHaveBeenCalled();
    expect(setHeight).not.toHaveBeenCalled();

    vi.stubGlobal("devicePixelRatio", 1.5);
    paintFrame();
    expect(overlay.width).toBe(1200);
    expect(overlay.height).toBe(750);
    expect(context.setTransform).toHaveBeenLastCalledWith(1.5, 0, 0, 1.5, -15, -30);
  });

  it("clears and reports null immediately, cancels animation, and resumes without reviving an old loop", () => {
    const onRect = vi.fn();
    const { rerender } = render(<Scene onRect={onRect} />);
    paintFrame();
    const [pendingId, pendingCallback] = [...frames.entries()][0]!;
    context.clearRect.mockClear();
    vi.mocked(paintPlayheadAtPosition).mockClear();
    rerender(<Scene position={null} onRect={onRect} />);
    expect(context.setTransform).toHaveBeenLastCalledWith(1, 0, 0, 1, 0, 0);
    expect(context.clearRect).toHaveBeenLastCalledWith(0, 0, 1600, 1000);
    expect(onRect).toHaveBeenLastCalledWith(null);
    expect(cancelAnimationFrame).toHaveBeenCalledWith(pendingId);
    expect(frames.size).toBe(0);
    paintFrame();
    expect(paintPlayheadAtPosition).not.toHaveBeenCalled();

    const resumedPosition = { measureIndex: 2, beat: 3 };
    rerender(<Scene position={resumedPosition} onRect={onRect} />);
    act(() => pendingCallback(48));
    expect(frames.size).toBe(1);
    expect(paintPlayheadAtPosition).not.toHaveBeenCalled();
    paintFrame();
    expect(paintPlayheadAtPosition).toHaveBeenCalledWith(context, resumedPosition, DISPLAY_LIST, [], undefined);
    expect(onRect).toHaveBeenLastCalledWith(RECT);
  });

  it("reports null with no animation or drawing when mounted inactive, even without a context", () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    const onRect = vi.fn();
    render(<Scene position={null} onRect={onRect} />);
    expect(onRect).toHaveBeenLastCalledWith(null);
    expect(frames.size).toBe(0);
    expect(paintPlayheadAtPosition).not.toHaveBeenCalled();
  });

  it("clears an unavailable display list and resumes when layout returns during playback", () => {
    const onRect = vi.fn();
    const { rerender } = render(<Scene onRect={onRect} />);
    paintFrame();
    rerender(<Scene displayList={null} onRect={onRect} />);
    paintFrame();
    expect(onRect).toHaveBeenLastCalledWith(null);
    expect(paintPlayheadAtPosition).toHaveBeenCalledTimes(1);
    expect(context.clearRect).toHaveBeenLastCalledWith(0, 0, 1600, 1000);
    rerender(<Scene onRect={onRect} />);
    paintFrame();
    expect(onRect).toHaveBeenLastCalledWith(RECT);
    expect(paintPlayheadAtPosition).toHaveBeenCalledTimes(2);
  });
});
