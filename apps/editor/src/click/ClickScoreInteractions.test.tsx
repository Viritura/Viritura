import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClickScoreInteractions } from "./ClickScoreInteractions";

const hitTest = vi.hoisted(() => vi.fn(() => ({ measureIndex: 2, beat: 8, partId: "p0" })));
let viewport: HTMLDivElement;
let surface: HTMLDivElement;

vi.mock("@viritura/score-viewer-react", () => ({
  useScoreView: () => ({
    viewer: { viewport, surface },
    engine: { canvasToBeat: hitTest },
    displayList: {},
    pagePositions: [{ page: 0, x: 40, y: 60, width: 2000, height: 1000 }],
    zoom: 2,
  }),
}));

beforeEach(() => {
  hitTest.mockClear();
  viewport = document.createElement("div");
  surface = document.createElement("div");
  viewport.append(surface);
  document.body.append(viewport);
  viewport.scrollLeft = 100;
  viewport.scrollTop = 20;
  viewport.scrollTo = vi.fn((options?: ScrollToOptions | number, y?: number) => {
    viewport.scrollLeft = typeof options === "number" ? options : (options?.left ?? viewport.scrollLeft);
    viewport.scrollTop = typeof options === "number" ? (y ?? viewport.scrollTop) : (options?.top ?? viewport.scrollTop);
  });
  const captured = new Set<number>();
  viewport.setPointerCapture = vi.fn((id: number) => captured.add(id));
  viewport.hasPointerCapture = vi.fn((id: number) => captured.has(id));
  viewport.releasePointerCapture = vi.fn((id: number) => captured.delete(id));
  vi.spyOn(surface, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(10 - viewport.scrollLeft, 20 - viewport.scrollTop, 2000, 1000),
  );
});

afterEach(() => {
  cleanup();
  viewport.remove();
});

describe("click score interactions", () => {
  it("pans both axes without selecting a bar, even when capture transfers from the surface", () => {
    const select = vi.fn();
    render(<ClickScoreInteractions enabled onSelectMeasure={select} />);
    fireEvent.pointerDown(surface, { pointerId: 1, isPrimary: true, button: 0, clientX: 300, clientY: 200 });
    fireEvent.lostPointerCapture(surface, { pointerId: 1 });
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 200, clientY: 160 });
    expect(viewport.scrollLeft).toBe(200);
    expect(viewport.scrollTop).toBe(60);
    fireEvent.pointerUp(viewport, { pointerId: 1, clientX: 200, clientY: 160 });
    expect(viewport.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(hitTest).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
  });

  it("converts a touch tap through scrolling, page placement, and zoom before selecting its measure", () => {
    const select = vi.fn();
    render(<ClickScoreInteractions enabled onSelectMeasure={select} />);
    fireEvent.pointerDown(viewport, {
      pointerId: 2,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      clientX: 250,
      clientY: 180,
    });
    fireEvent.pointerMove(viewport, { pointerId: 2, clientX: 252, clientY: 180 });
    fireEvent.pointerUp(viewport, { pointerId: 2, clientX: 252, clientY: 180 });
    expect(viewport.scrollLeft).toBe(100);
    expect(hitTest).toHaveBeenCalledWith(expect.any(Object), 0, 151, 60);
    expect(select).toHaveBeenCalledWith(2);
  });

  it("ignores cancelled gestures and disables mouse and native touch dragging during playback", () => {
    const select = vi.fn();
    const rendered = render(<ClickScoreInteractions enabled onSelectMeasure={select} />);
    fireEvent.pointerDown(viewport, { pointerId: 3, isPrimary: true, button: 0, clientX: 250, clientY: 180 });
    fireEvent.pointerCancel(viewport, { pointerId: 3 });
    fireEvent.pointerUp(viewport, { pointerId: 3, clientX: 250, clientY: 180 });
    expect(select).not.toHaveBeenCalled();

    rendered.rerender(<ClickScoreInteractions enabled={false} onSelectMeasure={select} />);
    fireEvent.pointerDown(viewport, { pointerId: 4, isPrimary: true, button: 0, clientX: 250, clientY: 180 });
    fireEvent.pointerMove(viewport, { pointerId: 4, clientX: 200, clientY: 160 });
    fireEvent.pointerUp(viewport, { pointerId: 4, clientX: 200, clientY: 160 });
    expect(viewport.scrollLeft).toBe(100);
    expect(viewport.scrollTop).toBe(20);
    expect(viewport.style.touchAction).toBe("none");
    expect(select).not.toHaveBeenCalled();
  });
});
