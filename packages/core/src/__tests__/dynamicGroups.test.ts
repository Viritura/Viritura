import { describe, expect, it } from "vitest";
import {
  consolidateDynamicGlyphs,
  createDynamicGroup,
  createRelativeDynamicGroup,
  refreshDynamicGlyphs,
  type DynamicGroup,
} from "../index";

const position = { fraction: [0, 1] as [number, number] };

describe("dynamic authoring appearance", () => {
  it.each([
    [["dynamicForte", "dynamicForte", "dynamicForte"], ["dynamicFFF"]],
    [["dynamicMezzo", "dynamicForte"], ["dynamicMF"]],
    [["dynamicPiano", "dynamicPiano"], ["dynamicPP"]],
    [["dynamicSforzando", "dynamicForte", "dynamicZ"], ["dynamicSforzato"]],
    [
      ["dynamicForte", "dynamicPiano", "dynamicForte"],
      ["dynamicForte", "dynamicPiano", "dynamicForte"],
    ],
    [
      ["dynamicMF", "dynamicForte"],
      ["dynamicMF", "dynamicForte"],
    ],
    [[], []],
  ])("consolidates only recognized letter sequences %j", (source, expected) => {
    const original = [...source];
    expect(consolidateDynamicGlyphs(source)).toEqual(expected);
    expect(source).toEqual(original);
  });

  it("allows interchange readers to keep standard markings automatic", () => {
    expect(createDynamicGroup("mf", position, "d", "automatic")).toEqual({
      id: "d",
      type: "immediate",
      position,
      value: "mf",
    });
    expect(createDynamicGroup("sfz", position, "d", "automatic").glyphs).toEqual(["dynamicSforzato"]);
  });

  it.each([
    ["p", "dynamicPiano"],
    ["fff", "dynamicFFF"],
    ["sfz", "dynamicSforzato"],
    ["fp", "dynamicFortePiano"],
  ])("authors %s with explicit appearance and semantic fields", (spelling, glyph) => {
    const group = createDynamicGroup(spelling, position, "d");
    expect(group.glyphs).toEqual([glyph]);
    expect(group.value).toBe(spelling === "sfz" || spelling === "fp" ? "f" : spelling);
  });

  it("stores relative printed value independently of louder/softer intent", () => {
    expect(createRelativeDynamicGroup("p", "louder", position, "più", "d")).toMatchObject({
      type: "relative",
      relativeValue: "louder",
      value: "p",
      glyphs: ["dynamicPiano"],
    });
  });

  it("replaces an imported override after an intentional marking change", () => {
    const group: DynamicGroup = {
      id: "d",
      type: "immediate",
      position,
      value: "p",
      glyphs: ["dynamicForte", "dynamicForte", "dynamicForte"],
    };
    refreshDynamicGlyphs(group);
    expect(group.glyphs).toEqual(["dynamicPiano"]);
  });

  it("refreshes all accent components together", () => {
    const group = createDynamicGroup("sfz", position, "d");
    group.residualValue = "p";
    group.accentSuffix = "";
    refreshDynamicGlyphs(group);
    expect(group.glyphs).toEqual(["dynamicSforzandoPiano"]);
  });

  it("removes a stale override when an optional printed marking is cleared", () => {
    const group = createRelativeDynamicGroup("p", "louder", position);
    delete group.value;
    refreshDynamicGlyphs(group);
    expect(group.glyphs).toBeUndefined();
    expect(group.relativeValue).toBe("louder");
  });
});
