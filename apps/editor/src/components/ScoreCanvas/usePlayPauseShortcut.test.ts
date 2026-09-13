// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { shouldHandlePlayPauseShortcut } from "./usePlayPauseShortcut";

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
});
