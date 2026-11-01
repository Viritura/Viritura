// @vitest-environment happy-dom
import { useRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseChordSymbolText } from "@viritura/core";
import { Button } from "@viritura/ui";
import { useChordTrackDrag } from "./useChordTrackDrag";
import type { TimedChord, TrackPoint } from "./types";

const source: TimedChord = { measureIndex: 0, symbol: parseChordSymbolText("C", { fraction: [0, 1] }) };
const points: TrackPoint[] = [0, 1, 2].map((beat) => ({ measureIndex: 0, beat, x: 100 + beat * 100 }));
const finePoints: TrackPoint[] = Array.from({ length: 9 }, (_, index) => ({
  measureIndex: 0,
  beat: index / 4,
  x: 100 + index * 25,
}));

function Harness({
  onMove,
  onSelect,
  scrollX = 0,
}: {
  onMove: (source: TimedChord, target: TrackPoint) => void;
  onSelect: () => void;
  scrollX?: number;
}) {
  const root = useRef<HTMLDivElement>(null);
  const drag = useChordTrackDrag({
    root,
    points,
    finePoints,
    viewport: { zoom: 1, scrollX, scrollY: 0 },
    railY: 200,
    height: 76,
    minX: 0,
    onMove,
  });
  return (
    <div ref={root}>
      <Button
        label="Chord"
        onPointerDown={(event) => drag.start(event, source)}
        onClick={() => {
          if (!drag.consumeClick()) onSelect();
        }}
      />
      <output data-testid="preview">{drag.preview?.target?.beat ?? "none"}</output>
      <output data-testid="valid">{String(drag.preview?.valid ?? false)}</output>
      <output data-testid="fine-grid">{String(drag.preview?.fineGrid ?? false)}</output>
    </div>
  );
}

function pointer(type: string, x: number, y: number, altKey = false) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
    buttons: 1,
    altKey,
  });
  Object.defineProperty(event, "pointerId", { value: 1 });
  return event;
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 800, 400));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("snapped chord pointer gestures", () => {
  it("resnaps the preview on Alt press and release without moving or committing", () => {
    const onMove = vi.fn();
    render(<Harness onMove={onMove} onSelect={vi.fn()} />);
    fireEvent(screen.getByRole("button", { name: "Chord" }), pointer("pointerdown", 100, 220));
    fireEvent(window, pointer("pointermove", 235, 220));
    expect(screen.getByTestId("preview").textContent).toBe("1");
    for (let cycle = 0; cycle < 3; cycle++) {
      fireEvent.keyDown(window, { key: "Alt", altKey: true });
      expect(screen.getByTestId("preview").textContent).toBe("1.25");
      expect(screen.getByTestId("fine-grid").textContent).toBe("true");
      fireEvent.keyUp(window, { key: "Alt", altKey: false });
      expect(screen.getByTestId("preview").textContent).toBe("1");
      expect(screen.getByTestId("fine-grid").textContent).toBe("false");
    }
    expect(onMove).not.toHaveBeenCalled();
    fireEvent(window, pointer("pointerup", 235, 220));
    expect(onMove).toHaveBeenCalledExactlyOnceWith(source, points[1]);
  });

  it("commits the sixteenth-note target while Alt is held", () => {
    const onMove = vi.fn();
    render(<Harness onMove={onMove} onSelect={vi.fn()} />);
    fireEvent(screen.getByRole("button", { name: "Chord" }), pointer("pointerdown", 100, 220, true));
    fireEvent(window, pointer("pointermove", 235, 220, true));
    expect(screen.getByTestId("preview").textContent).toBe("1.25");
    fireEvent(window, pointer("pointerup", 235, 220, true));
    expect(onMove).toHaveBeenCalledExactlyOnceWith(source, finePoints[5]);
    expect(screen.getByTestId("fine-grid").textContent).toBe("false");
  });

  it("recovers missed Alt events using the pointer modifiers, including at release", () => {
    const onMove = vi.fn();
    render(<Harness onMove={onMove} onSelect={vi.fn()} />);
    fireEvent(screen.getByRole("button", { name: "Chord" }), pointer("pointerdown", 100, 220));
    fireEvent(window, pointer("pointermove", 235, 220, true));
    expect(screen.getByTestId("preview").textContent).toBe("1.25");
    fireEvent(window, pointer("pointermove", 235, 220));
    expect(screen.getByTestId("preview").textContent).toBe("1");
    fireEvent(window, pointer("pointerup", 235, 220, true));
    expect(onMove).toHaveBeenCalledExactlyOnceWith(source, finePoints[5]);
  });

  it.each(["blur", "pointercancel", "hidden"])("clears the Alt override without moving harmony on %s", (event) => {
    const onMove = vi.fn();
    render(<Harness onMove={onMove} onSelect={vi.fn()} />);
    fireEvent(screen.getByRole("button", { name: "Chord" }), pointer("pointerdown", 100, 220));
    fireEvent(window, pointer("pointermove", 235, 220, true));
    if (event === "hidden") {
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      fireEvent(document, new Event("visibilitychange"));
    } else fireEvent(window, new Event(event));
    expect(screen.getByTestId("fine-grid").textContent).toBe("false");
    fireEvent(window, pointer("pointerup", 235, 220, true));
    expect(onMove).not.toHaveBeenCalled();
  });

  it("selects a click without moving data", () => {
    const onMove = vi.fn();
    const onSelect = vi.fn();
    render(<Harness onMove={onMove} onSelect={onSelect} />);
    fireEvent(screen.getByRole("button", { name: "Chord" }), pointer("pointerdown", 100, 220));
    fireEvent(window, pointer("pointermove", 105, 220));
    expect(screen.getByTestId("preview").textContent).toBe("none");
    fireEvent(window, pointer("pointerup", 105, 220));
    fireEvent.click(screen.getByRole("button", { name: "Chord" }));
    expect(onMove).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("previews the nearest tick and commits one move on release", () => {
    const onMove = vi.fn();
    const onSelect = vi.fn();
    render(<Harness onMove={onMove} onSelect={onSelect} />);
    fireEvent(screen.getByRole("button", { name: "Chord" }), pointer("pointerdown", 100, 220));
    fireEvent(window, pointer("pointermove", 245, 220));
    expect(screen.getByTestId("preview").textContent).toBe("1");
    expect(onMove).not.toHaveBeenCalled();
    fireEvent(window, pointer("pointerup", 245, 220));
    fireEvent.click(screen.getByRole("button", { name: "Chord" }));
    expect(onMove).toHaveBeenCalledExactlyOnceWith(source, points[1]);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("cancels on Escape and suppresses the release click", async () => {
    const onMove = vi.fn();
    const onSelect = vi.fn();
    render(<Harness onMove={onMove} onSelect={onSelect} />);
    fireEvent(screen.getByRole("button", { name: "Chord" }), pointer("pointerdown", 100, 220));
    fireEvent(window, pointer("pointermove", 280, 220));
    fireEvent.keyDown(window, { key: "Escape" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    fireEvent(window, pointer("pointerup", 280, 220));
    fireEvent.click(screen.getByRole("button", { name: "Chord" }));
    expect(onMove).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByTestId("preview").textContent).toBe("none");
  });

  it("uses the latest viewport while dragging after a pan", () => {
    const onMove = vi.fn();
    const onSelect = vi.fn();
    const { rerender } = render(<Harness onMove={onMove} onSelect={onSelect} />);
    fireEvent(screen.getByRole("button", { name: "Chord" }), pointer("pointerdown", 100, 220));
    fireEvent(window, pointer("pointermove", 210, 220));
    expect(screen.getByTestId("preview").textContent).toBe("1");
    rerender(<Harness onMove={onMove} onSelect={onSelect} scrollX={100} />);
    fireEvent(window, pointer("pointermove", 210, 220));
    expect(screen.getByTestId("preview").textContent).toBe("2");
    fireEvent(window, pointer("pointerup", 210, 220));
    expect(onMove).toHaveBeenCalledExactlyOnceWith(source, points[2]);
  });

  it("does not commit a drop outside the track", () => {
    const onMove = vi.fn();
    render(<Harness onMove={onMove} onSelect={vi.fn()} />);
    fireEvent(screen.getByRole("button", { name: "Chord" }), pointer("pointerdown", 100, 220));
    fireEvent(window, pointer("pointermove", 280, 350));
    expect(screen.getByTestId("valid").textContent).toBe("false");
    fireEvent(window, pointer("pointerup", 280, 350));
    expect(onMove).not.toHaveBeenCalled();
  });
});
