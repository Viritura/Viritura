import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "@viritura/ui";
import { FloatingTransport } from "./FloatingTransport";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup() {
  let resize = () => {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  render(
    <main>
      <FloatingTransport busy={false}>
        <span>4 clicks free</span>
        <Button>Start</Button>
        <div role="listbox" aria-label="Start bar" tabIndex={0}>
          <div role="option" aria-selected="true">
            <span>Bar 1</span>
          </div>
        </div>
      </FloatingTransport>
    </main>,
  );
  const transport = screen.getByRole("region", { name: "Click player" });
  const parent = transport.parentElement!;
  Object.defineProperties(parent, {
    clientWidth: { value: 800, configurable: true },
    clientHeight: { value: 600, configurable: true },
  });
  Object.defineProperties(transport, { offsetWidth: { value: 400 }, offsetHeight: { value: 200 } });
  vi.spyOn(parent, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, 60, 800, parent.clientHeight));
  vi.spyOn(transport, "getBoundingClientRect").mockImplementation(
    () =>
      new DOMRect(
        Number.parseFloat(transport.style.left) || 200,
        60 + (Number.parseFloat(transport.style.top) || 380),
        400,
        200,
      ),
  );
  transport.setPointerCapture = vi.fn();
  transport.hasPointerCapture = vi.fn(() => true);
  transport.releasePointerCapture = vi.fn();
  return { transport, parent, resize: () => act(() => resize()) };
}

describe("floating click transport", () => {
  it("moves by touch from panel content, clamps at the score edges, and stops on cancellation", () => {
    const { transport } = setup();
    fireEvent.pointerDown(screen.getByText("4 clicks free"), {
      pointerId: 1,
      pointerType: "touch",
      button: 0,
      clientX: 250,
      clientY: 460,
    });
    fireEvent.pointerMove(transport, { pointerId: 1, clientX: 1000, clientY: 1000 });
    expect(transport.style.left).toBe("392px");
    expect(transport.style.top).toBe("392px");
    fireEvent.pointerCancel(transport, { pointerId: 1 });
    fireEvent.pointerMove(transport, { pointerId: 1, clientX: 10, clientY: 10 });
    expect(transport.style.left).toBe("392px");
    fireEvent.pointerDown(transport, { pointerId: 2, button: 0, clientX: 400, clientY: 470 });
    fireEvent.pointerMove(transport, { pointerId: 2, clientX: -500, clientY: -500 });
    expect(transport.style.left).toBe("8px");
    expect(transport.style.top).toBe("8px");
    fireEvent.pointerUp(transport, { pointerId: 2 });
    expect(transport.releasePointerCapture).toHaveBeenCalledWith(2);
  });

  it("supports keyboard movement and stays reachable after viewport resizing", () => {
    const { transport, parent, resize } = setup();
    fireEvent.keyDown(transport, { key: "ArrowRight" });
    expect(transport.style.left).toBe("210px");
    fireEvent.keyDown(transport, { key: "ArrowUp", shiftKey: true });
    expect(transport.style.top).toBe("340px");
    Object.defineProperty(parent, "clientHeight", { value: 350, configurable: true });
    resize();
    expect(transport.style.top).toBe("142px");
    fireEvent.pointerDown(screen.getByRole("button", { name: "Start" }), { pointerId: 3, button: 0 });
    fireEvent.pointerMove(transport, { pointerId: 3, clientX: 0, clientY: 0 });
    expect(transport.style.top).toBe("142px");
  });

  it("does not drag or consume arrow keys from controls or either dial's contents", () => {
    const { transport } = setup();
    for (const target of [screen.getByRole("button", { name: "Start" }), screen.getByText("Bar 1")]) {
      fireEvent.pointerDown(target, { pointerId: 1, button: 0, clientX: 250, clientY: 460 });
      fireEvent.pointerMove(transport, { pointerId: 1, clientX: 1000, clientY: 1000 });
      expect(fireEvent.keyDown(target, { key: "ArrowRight" })).toBe(true);
      expect(transport.style.left).toBe("");
      expect(transport.setPointerCapture).not.toHaveBeenCalled();
    }
  });
});
