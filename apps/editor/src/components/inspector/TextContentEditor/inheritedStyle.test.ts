import { describe, expect, it } from "vitest";
import { effectiveStyle, inheritedStyleForExpression, inheritedStyleForRole, toggledStyle } from "./inheritedStyle";

describe("inherited text style", () => {
  it("reads tempo's bold default and honours per-score overrides", () => {
    expect(inheritedStyleForRole("tempo", undefined)).toEqual({ weight: "bold", fontStyle: undefined });
    expect(inheritedStyleForRole("tempo", { tempo: { bold: false, italic: true } })).toEqual({
      weight: undefined,
      fontStyle: "italic",
    });
  });

  it("matches expression slant to placement", () => {
    expect(inheritedStyleForExpression("above")).toEqual({});
    expect(inheritedStyleForExpression("below")).toEqual({ fontStyle: "italic" });
    expect(inheritedStyleForExpression(undefined)).toEqual({ fontStyle: "italic" });
  });

  it("toggles against the effective style and stores only departures", () => {
    const bold = { weight: "bold" } as const;
    expect(effectiveStyle({}, bold).weight).toBe("bold");
    expect(toggledStyle("bold", {}, bold)).toEqual({ weight: "normal" });
    expect(toggledStyle("bold", { weight: "normal" }, bold)).toEqual({ weight: undefined });
    expect(toggledStyle("bold", {}, {})).toEqual({ weight: "bold" });
    expect(toggledStyle("italic", {}, { fontStyle: "italic" })).toEqual({ fontStyle: "normal" });
  });
});
