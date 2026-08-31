import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InputCursor } from "../components/InputCursor";
import { initialNoteInputState, useNoteInputStore } from "../store/noteInputStore";

vi.mock("../components/useGlyphWarmup", () => ({ useGlyphWarmup: () => {} }));

const clearRect = vi.fn();
const context = {
  clearRect,
  setTransform: vi.fn(),
} as unknown as CanvasRenderingContext2D;

beforeEach(() => {
  clearRect.mockClear();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
  useNoteInputStore.setState({ ...initialNoteInputState, active: true });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useNoteInputStore.setState(initialNoteInputState);
});

describe("InputCursor lifecycle", () => {
  it("clears painted overlay pixels when note input is deactivated", () => {
    render(<InputCursor displayList={null} scrollX={0} scrollY={0} zoom={1} spatialIndex={null} score={null} />);
    const clearsWhileActive = clearRect.mock.calls.length;
    expect(clearsWhileActive).toBeGreaterThan(0);

    act(() => useNoteInputStore.setState({ active: false }));

    expect(clearRect.mock.calls.length).toBeGreaterThan(clearsWhileActive);
  });
});
