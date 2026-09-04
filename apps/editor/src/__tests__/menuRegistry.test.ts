import { describe, it, expect } from "vitest";
import {
  getMenuItems,
  getMenuTitle,
  getMenuMaxItems,
  getMenuFirstPageMaxItems,
  getMenuStartAlign,
  getMenuRenderExpression,
  getMenuSearchPlaceholder,
} from "../radialMenu/menuRegistry";
import type { RadialMenuCategory } from "../radialMenu/types";

const ALL_CATEGORIES: RadialMenuCategory[] = [
  "clef",
  "barline",
  "time-signature",
  "key-signature",
  "dynamic",
  "ornament",
  "tuplet",
  "breath-fermata",
];

describe("getMenuItems", () => {
  it("returns non-empty items for every category", () => {
    for (const cat of ALL_CATEGORIES) {
      const items = getMenuItems(cat);
      expect(items.length).toBeGreaterThan(0);
    }
  });

  it("breath-fermata returns all 9 items", () => {
    const items = getMenuItems("breath-fermata");
    expect(items).toHaveLength(9);
    const ids = items.map((i) => i.id);
    expect(ids).toContain("caesura");
    expect(ids).toContain("breath-comma");
    expect(ids).toContain("fermata-normal");
  });

  it("includes one-, two-, and four-bar repeats in the repeat menu", () => {
    const ids = getMenuItems("repeat").map((item) => item.id);
    expect(ids).toEqual(expect.arrayContaining(["measure-repeat-1", "measure-repeat-2", "measure-repeat-4"]));
  });
});

describe("getMenuTitle", () => {
  it("returns a non-empty title for every category", () => {
    for (const cat of ALL_CATEGORIES) {
      expect(getMenuTitle(cat).length).toBeGreaterThan(0);
    }
  });

  it("breath-fermata title is 'Breath'", () => {
    expect(getMenuTitle("breath-fermata")).toBe("Breath");
  });
});

describe("getMenuMaxItems", () => {
  it("key-signature returns 9", () => {
    expect(getMenuMaxItems("key-signature")).toBe(9);
  });

  it("other categories return 8", () => {
    for (const cat of ALL_CATEGORIES.filter((c) => c !== "key-signature")) {
      expect(getMenuMaxItems(cat)).toBe(8);
    }
  });
});

describe("getMenuFirstPageMaxItems", () => {
  it("clef returns 5", () => {
    expect(getMenuFirstPageMaxItems("clef")).toBe(5);
  });

  it("other categories return undefined", () => {
    for (const cat of ALL_CATEGORIES.filter((c) => c !== "clef")) {
      expect(getMenuFirstPageMaxItems(cat)).toBeUndefined();
    }
  });
});

describe("getMenuStartAlign", () => {
  it("dynamic returns 'start'", () => {
    expect(getMenuStartAlign("dynamic")).toBe("start");
  });

  it("breath-fermata returns 'center'", () => {
    expect(getMenuStartAlign("breath-fermata")).toBe("center");
  });
});

describe("getMenuRenderExpression", () => {
  it("dynamic returns a renderer function", () => {
    expect(typeof getMenuRenderExpression("dynamic")).toBe("function");
  });

  it("tuplet returns a renderer function", () => {
    expect(typeof getMenuRenderExpression("tuplet")).toBe("function");
  });

  it("time signature returns a renderer function", () => {
    expect(typeof getMenuRenderExpression("time-signature")).toBe("function");
  });

  it("breath-fermata returns undefined (no expression input)", () => {
    expect(getMenuRenderExpression("breath-fermata")).toBeUndefined();
  });
});

describe("getMenuSearchPlaceholder", () => {
  it("uses category-specific expression examples", () => {
    expect(getMenuSearchPlaceholder("barline")).toContain("+4");
    expect(getMenuSearchPlaceholder("tuplet")).toContain("5:3");
    expect(getMenuSearchPlaceholder("dynamic")).toContain("p<f");
    expect(getMenuSearchPlaceholder("time-signature")).toContain("5/8");
  });

  it("uses a plain filter prompt for menus without expressions", () => {
    expect(getMenuSearchPlaceholder("clef")).toBe("Filter…");
  });
});
