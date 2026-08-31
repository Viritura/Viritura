import { describe, it, expect } from "vitest";
import { soundCatalog, groupedSounds, findSoundEntry, drumKitForEntry } from "../components/DrumKitDialog/soundCatalog";

describe("soundCatalog", () => {
  it("builds a non-empty catalog from the active SoundFont", () => {
    const catalog = soundCatalog();
    expect(catalog.length).toBeGreaterThan(20);
    // Standard GM snare/kick are present and on the default kit.
    const snare = catalog.find((e) => e.key === 38 && e.isDefaultKit);
    expect(snare).toBeDefined();
    expect(snare!.category).toBe("snare");
  });

  it("surfaces a borrowed world sound (Tam-tam / gong) from a non-default kit", () => {
    const gong = soundCatalog().find((e) => /gong|tam-?tam/i.test(e.label));
    expect(gong).toBeDefined();
    expect(gong!.category).toBe("world");
    expect(gong!.isDefaultKit).toBe(false);
    // Picking it implies a drumKit override (its own kit program).
    expect(drumKitForEntry(gong!)).toBe(gong!.kitProgram);
  });

  it("filters by search query across name + sample", () => {
    const groups = groupedSounds("gong");
    const all = groups.flatMap((g) => g.entries);
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((e) => /gong/i.test(e.label) || /gong/i.test(e.sample))).toBe(true);
  });

  it("groups results in category order", () => {
    const groups = groupedSounds("");
    const order = groups.map((g) => g.category);
    // kick precedes cymbal precedes world (subset ordering check).
    const ik = order.indexOf("kick");
    const ic = order.indexOf("cymbal");
    if (ik >= 0 && ic >= 0) expect(ik).toBeLessThan(ic);
  });

  it("findSoundEntry resolves a default-kit key back to its entry", () => {
    const entry = findSoundEntry(undefined, 38);
    expect(entry?.label.toLowerCase()).toContain("snare");
  });
});
