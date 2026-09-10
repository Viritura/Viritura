import { describe, expect, it } from "vitest";
import { radioNavigationIndex, selectedRadioIndex } from "./useRadioGroupNavigation";

describe("radio group navigation", () => {
  it("wraps arrow navigation and supports Home/End", () => {
    expect(radioNavigationIndex("ArrowRight", 2, 3)).toBe(0);
    expect(radioNavigationIndex("ArrowLeft", 0, 3)).toBe(2);
    expect(radioNavigationIndex("ArrowDown", 0, 3)).toBe(1);
    expect(radioNavigationIndex("ArrowUp", 2, 3)).toBe(1);
    expect(radioNavigationIndex("Home", 2, 3)).toBe(0);
    expect(radioNavigationIndex("End", 0, 3)).toBe(2);
    expect(radioNavigationIndex("Enter", 0, 3)).toBeNull();
  });

  it("uses the selected option as the tab stop and falls back to the first", () => {
    const options = [{ value: "auto" }, { value: "show" }, { value: "hide" }] as const;
    expect(selectedRadioIndex(options, "show")).toBe(1);
    expect(selectedRadioIndex(options, "missing" as "auto")).toBe(0);
  });
});
