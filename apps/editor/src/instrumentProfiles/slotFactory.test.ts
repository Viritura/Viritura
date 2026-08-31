import { describe, expect, it } from "vitest";
import type { ProfileSlot } from "@viritura/instrument-profiles";
import {
  autoLabel,
  createCustomSlot,
  createEmptyProfile,
  createSlotFromCatalog,
  duplicateProfile,
} from "./slotFactory";
import { getCatalogInstrument } from "../score/InstrumentCatalog";

function slotWithLabel(label: string): ProfileSlot {
  return { slotId: `id-${label}`, section: "strings", label, binding: { baseChannel: 0 } };
}

describe("autoLabel", () => {
  it("numbers from 1 and increments per base name", () => {
    expect(autoLabel([], "Violin")).toBe("Violin 1");
    expect(autoLabel([slotWithLabel("Violin 1")], "Violin")).toBe("Violin 2");
    expect(autoLabel([slotWithLabel("Violin 1"), slotWithLabel("Violin 2")], "Violin")).toBe("Violin 3");
  });

  it("does not collide across different base names", () => {
    expect(autoLabel([slotWithLabel("Violin 1")], "Cello")).toBe("Cello 1");
  });
});

describe("createSlotFromCatalog", () => {
  it("seeds label, section, and catalog id from the catalog instrument", () => {
    const violin = getCatalogInstrument("violin")!;
    const slot = createSlotFromCatalog([], "strings", violin);
    expect(slot.catalogInstrumentId).toBe("violin");
    expect(slot.section).toBe("strings");
    expect(slot.label).toBe(`${violin.name} 1`);
    expect(slot.binding).toEqual({ baseChannel: 0 });
    expect(slot.slotId).toMatch(/^slot-/);
  });
});

describe("createCustomSlot", () => {
  it("omits the catalog id and takes an explicit label", () => {
    const slot = createCustomSlot("woodwinds", "Ondes Martenot");
    expect(slot.catalogInstrumentId).toBeUndefined();
    expect(slot.label).toBe("Ondes Martenot");
    expect(slot.section).toBe("woodwinds");
  });
});

describe("duplicateProfile", () => {
  it("assigns a new id and copies slots", () => {
    const source = createEmptyProfile("Orchestra");
    const withSlot = { ...source, slots: [slotWithLabel("Violin 1")] };
    const copy = duplicateProfile(withSlot, "Orchestra copy");
    expect(copy.id).not.toBe(source.id);
    expect(copy.displayName).toBe("Orchestra copy");
    expect(copy.slots).toHaveLength(1);
    expect(copy.slots[0]).not.toBe(withSlot.slots[0]);
  });
});
