import { describe, expect, it } from "vitest";
import { catalogInstrumentsForSection, orderSlotsByScoreOrder, sectionForFamily } from "./profileSections";

describe("sectionForFamily", () => {
  it("maps catalog families onto the five editor sections", () => {
    expect(sectionForFamily("woodwinds")).toBe("woodwinds");
    expect(sectionForFamily("brass")).toBe("brass");
    expect(sectionForFamily("percussion")).toBe("percussion");
    expect(sectionForFamily("keyboards")).toBe("keys");
    expect(sectionForFamily("plucked")).toBe("strings");
    expect(sectionForFamily("strings")).toBe("strings");
  });
});

describe("catalogInstrumentsForSection", () => {
  it("lists string instruments (e.g. violin) under strings", () => {
    const ids = catalogInstrumentsForSection("strings").map((i) => i.id);
    expect(ids).toContain("violin");
  });

  it("lists keyboards (e.g. piano) under keys", () => {
    const ids = catalogInstrumentsForSection("keys").map((i) => i.id);
    expect(ids).toContain("piano");
  });

  it("only returns instruments belonging to the requested section", () => {
    for (const instrument of catalogInstrumentsForSection("brass")) {
      expect(sectionForFamily(instrument.family)).toBe("brass");
    }
  });
});

describe("orderSlotsByScoreOrder", () => {
  it("sorts slots into orchestra order regardless of insertion order", () => {
    const slots = [
      { slotId: "a", catalogInstrumentId: "tuba" },
      { slotId: "b", catalogInstrumentId: "flute" },
      { slotId: "c", catalogInstrumentId: "trumpet" },
    ];
    expect(orderSlotsByScoreOrder(slots).map((s) => s.slotId)).toEqual(["b", "c", "a"]);
  });

  it("places slots without a catalog instrument id last, preserving their order", () => {
    const slots = [{ slotId: "x" }, { slotId: "b", catalogInstrumentId: "flute" }, { slotId: "y" }];
    expect(orderSlotsByScoreOrder(slots).map((s) => s.slotId)).toEqual(["b", "x", "y"]);
  });
});
