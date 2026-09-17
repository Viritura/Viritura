// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getPlaybackSnapshot, initialPlaybackState } from "@viritura/playback";
import { keyboardRegistry } from "../../keyboard/KeyboardRegistry";
import { shouldHandlePlayPauseShortcut, usePlayPauseShortcut } from "./usePlayPauseShortcut";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function spaceFrom(target: HTMLElement): KeyboardEvent {
  let captured: KeyboardEvent | undefined;
  target.addEventListener(
    "keydown",
    (event) => {
      captured = event;
    },
    { once: true },
  );
  target.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
  if (!captured) throw new Error("Expected keyboard event");
  return captured;
}

describe("play/pause shortcut", () => {
  it.each(["input", "textarea", "select", "button"])("does not consume Space from a %s", (tagName) => {
    const target = document.createElement(tagName);
    expect(shouldHandlePlayPauseShortcut(spaceFrom(target), false)).toBe(false);
  });

  it("does not consume Space from editable content", () => {
    const target = document.createElement("div");
    target.contentEditable = "true";
    expect(shouldHandlePlayPauseShortcut(spaceFrom(target), false)).toBe(false);
  });

  it("handles Space from the score surface when note input is inactive", () => {
    expect(shouldHandlePlayPauseShortcut(spaceFrom(document.createElement("div")), false)).toBe(true);
    expect(shouldHandlePlayPauseShortcut(spaceFrom(document.createElement("div")), true)).toBe(false);
  });

  it.each(["stopped", "paused"] as const)("uses the stored transport start when %s", (status) => {
    const register = vi.spyOn(keyboardRegistry, "register");
    const play = vi.fn().mockResolvedValue(undefined);
    renderHook(() =>
      usePlayPauseShortcut({
        playback: { ...initialPlaybackState(), status },
        playbackActions: { ...getPlaybackSnapshot().actions, play },
        noteInputActiveRef: { current: false },
      }),
    );
    act(() => register.mock.calls.at(-1)?.[0].handler(new KeyboardEvent("keydown", { key: " " })));
    expect(play).toHaveBeenCalledExactlyOnceWith();
  });
});
