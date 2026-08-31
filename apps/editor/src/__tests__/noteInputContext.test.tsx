import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { resetNoteInputStore, useNoteInput } from "../store/noteInputStore";

describe("noteInputStore", () => {
  beforeEach(() => {
    resetNoteInputStore();
  });

  it("starts with note input inactive", () => {
    const { result } = renderHook(() => useNoteInput());
    expect(result.current.state.active).toBe(false);
    expect(result.current.state.currentDuration).toBe("quarter");
    expect(result.current.state.currentAccidental).toBeNull();
    expect(result.current.state.isRest).toBe(false);
    expect(result.current.state.dotCount).toBe(0);
    expect(result.current.state.currentVoice).toBe(1);
  });

  it("toggles note input mode", () => {
    const { result } = renderHook(() => useNoteInput());

    act(() => result.current.toggleNoteInput());
    expect(result.current.state.active).toBe(true);

    act(() => result.current.toggleNoteInput());
    expect(result.current.state.active).toBe(false);
  });

  it("changes duration", () => {
    const { result } = renderHook(() => useNoteInput());

    act(() => result.current.setDuration("eighth"));
    expect(result.current.state.currentDuration).toBe("eighth");

    act(() => result.current.setDuration("whole"));
    expect(result.current.state.currentDuration).toBe("whole");
  });

  it("toggles accidental (same value deselects)", () => {
    const { result } = renderHook(() => useNoteInput());

    act(() => result.current.setAccidental("sharp"));
    expect(result.current.state.currentAccidental).toBe("sharp");

    act(() => result.current.setAccidental("sharp"));
    expect(result.current.state.currentAccidental).toBeNull();

    act(() => result.current.setAccidental("flat"));
    expect(result.current.state.currentAccidental).toBe("flat");
  });

  it("toggles rest mode", () => {
    const { result } = renderHook(() => useNoteInput());

    act(() => result.current.toggleRest());
    expect(result.current.state.isRest).toBe(true);

    act(() => result.current.toggleRest());
    expect(result.current.state.isRest).toBe(false);
  });

  it("toggleDot toggles between 0 and 1, incrementDot cycles 0→4→0", () => {
    const { result } = renderHook(() => useNoteInput());

    act(() => result.current.toggleDot());
    expect(result.current.state.dotCount).toBe(1);

    act(() => result.current.toggleDot());
    expect(result.current.state.dotCount).toBe(0);

    act(() => result.current.incrementDot());
    expect(result.current.state.dotCount).toBe(1);

    act(() => result.current.incrementDot());
    expect(result.current.state.dotCount).toBe(2);

    act(() => result.current.incrementDot());
    expect(result.current.state.dotCount).toBe(3);

    act(() => result.current.incrementDot());
    expect(result.current.state.dotCount).toBe(4);

    act(() => result.current.incrementDot());
    expect(result.current.state.dotCount).toBe(0);

    // Toggle from a non-zero count clears all dots.
    act(() => result.current.incrementDot());
    act(() => result.current.incrementDot());
    expect(result.current.state.dotCount).toBe(2);
    act(() => result.current.toggleDot());
    expect(result.current.state.dotCount).toBe(0);
  });

  it("sets voice", () => {
    const { result } = renderHook(() => useNoteInput());

    act(() => result.current.setVoice(3));
    expect(result.current.state.currentVoice).toBe(3);
  });
});
