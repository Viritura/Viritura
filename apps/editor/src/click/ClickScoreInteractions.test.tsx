import { cleanup, fireEvent, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScoreCanvasHandle } from "../components/ScoreCanvas";
import { ClickScoreInteractions } from "./ClickScoreInteractions";

let viewport: HTMLDivElement;
let setScroll: ReturnType<typeof vi.fn>;
const canvasRef = createRef<Pick<ScoreCanvasHandle, "getViewportElement" | "getViewport" | "setScroll"> | null>();

beforeEach(() => {
  viewport = document.createElement("div");
  document.body.append(viewport);
  setScroll = vi.fn();
  const captured = new Set<number>();
  viewport.setPointerCapture = vi.fn((id: number) => captured.add(id));
  viewport.hasPointerCapture = vi.fn((id: number) => captured.has(id));
  viewport.releasePointerCapture = vi.fn((id: number) => captured.delete(id));
  canvasRef.current = {
    getViewportElement: () => viewport,
    getViewport: () => ({ scrollX: 100, scrollY: 20, zoom: 2 }),
    setScroll,
  };
});

afterEach(() => {
  cleanup();
  viewport.remove();
  canvasRef.current = null;
});

describe("click score interactions", () => {
  it("pans both axes and releases pointer capture after a drag", () => {
    render(<ClickScoreInteractions canvasRef={canvasRef} enabled />);
    fireEvent.pointerDown(viewport, { pointerId: 1, isPrimary: true, button: 0, clientX: 300, clientY: 200 });
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 200, clientY: 160 });
    expect(setScroll).toHaveBeenCalledWith(150, 40);
    fireEvent.pointerUp(viewport, { pointerId: 1, clientX: 200, clientY: 160 });
    expect(viewport.releasePointerCapture).toHaveBeenCalledWith(1);
  });

  it("ignores cancelled gestures and disables dragging during playback", () => {
    const rendered = render(<ClickScoreInteractions canvasRef={canvasRef} enabled />);
    fireEvent.pointerDown(viewport, { pointerId: 2, isPrimary: true, button: 0, clientX: 250, clientY: 180 });
    fireEvent.pointerCancel(viewport, { pointerId: 2 });
    fireEvent.pointerUp(viewport, { pointerId: 2, clientX: 250, clientY: 180 });

    rendered.rerender(<ClickScoreInteractions canvasRef={canvasRef} enabled={false} />);
    fireEvent.pointerDown(viewport, { pointerId: 3, isPrimary: true, button: 0, clientX: 250, clientY: 180 });
    fireEvent.pointerMove(viewport, { pointerId: 3, clientX: 200, clientY: 160 });
    fireEvent.pointerUp(viewport, { pointerId: 3, clientX: 200, clientY: 160 });
    expect(setScroll).not.toHaveBeenCalled();
    expect(viewport.style.touchAction).toBe("");
  });

  it("suppresses clicks after a drag but allows a normal tap", () => {
    const canvas = document.createElement("canvas");
    viewport.append(canvas);
    const onClick = vi.fn();
    canvas.addEventListener("click", onClick);
    render(<ClickScoreInteractions canvasRef={canvasRef} enabled />);
    fireEvent.pointerDown(canvas, { pointerId: 1, isPrimary: true, button: 0, clientX: 300, clientY: 200 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 200, clientY: 160 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 200, clientY: 160 });
    fireEvent.click(canvas);
    expect(onClick).not.toHaveBeenCalled();
    fireEvent.pointerDown(canvas, { pointerId: 2, isPrimary: true, button: 0, clientX: 200, clientY: 160 });
    fireEvent.pointerUp(canvas, { pointerId: 2, clientX: 200, clientY: 160 });
    fireEvent.click(canvas);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("stops one-finger panning when a second touch starts a pinch", () => {
    render(<ClickScoreInteractions canvasRef={canvasRef} enabled />);
    fireEvent.pointerDown(viewport, {
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      clientX: 300,
      clientY: 200,
    });
    fireEvent.pointerDown(viewport, { pointerId: 2, pointerType: "touch", isPrimary: false, button: 0 });
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 200, clientY: 160 });
    expect(setScroll).not.toHaveBeenCalled();
  });
});
