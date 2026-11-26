import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import { usePictureFit } from "./usePictureFit";

afterEach(cleanup);

function pictureWindow(width: number, height: number) {
  const win = {
    innerWidth: width,
    innerHeight: height,
    resizeBy: vi.fn((dx: number, dy: number) => {
      win.innerWidth += dx;
      win.innerHeight += dy;
    }),
  };
  return win;
}

function content(width: number, height: number) {
  const node = document.createElement("div");
  Object.defineProperty(node, "offsetWidth", { get: () => width });
  Object.defineProperty(node, "offsetHeight", { get: () => height });
  return { current: node };
}

describe("usePictureFit", () => {
  it("shrinks the window to compact playback and restores the stopped size", () => {
    const win = pictureWindow(420, 380);
    const ref = content(160, 56);
    const { rerender } = renderHook(({ compact }) => usePictureFit(win as unknown as Window, ref, compact), {
      initialProps: { compact: false },
    });
    expect(win.resizeBy).not.toHaveBeenCalled();

    rerender({ compact: true });
    expect([win.innerWidth, win.innerHeight]).toEqual([184, 80]);

    rerender({ compact: false });
    expect([win.innerWidth, win.innerHeight]).toEqual([420, 380]);
  });

  it("keeps the window when the browser refuses to resize it without activation", () => {
    const win = pictureWindow(420, 380);
    win.resizeBy.mockImplementation(() => {
      throw new DOMException("activation required", "NotAllowedError");
    });
    const { rerender } = renderHook(
      ({ compact }) => usePictureFit(win as unknown as Window, content(160, 56), compact),
      {
        initialProps: { compact: false },
      },
    );

    expect(() => rerender({ compact: true })).not.toThrow();
    expect([win.innerWidth, win.innerHeight]).toEqual([420, 380]);
  });
});
