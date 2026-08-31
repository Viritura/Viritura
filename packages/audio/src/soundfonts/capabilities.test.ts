import { describe, it, expect } from "vitest";
import {
  getActiveCapabilities,
  listDrumKits,
  getDrumKit,
  sampleAt,
  resolveSemantic,
  defaultDrumKitProgram,
} from "../soundfonts";

describe("SF2 capabilities (Shan SGM Pro 15)", () => {
  it("exposes the active manifest", () => {
    const caps = getActiveCapabilities();
    expect(caps.soundfont.id).toBe("shan-sgm-pro-15");
    expect(caps.banks.percussion).toBe(128);
    expect(listDrumKits().length).toBeGreaterThan(10);
  });

  it("has a GM-compliant Standard kit as the default", () => {
    expect(defaultDrumKitProgram()).toBe(0);
    expect(getDrumKit(0)?.name).toBe("Standard");
    // GM acoustic snare = key 38, crash = key 49.
    expect(sampleAt(0, 38)).toBeTruthy();
    expect(sampleAt(0, 49)).toBeTruthy();
  });

  it("resolves crash to a usable cymbal in the Orchestra kit (avoids the timpani zone)", () => {
    // Orchestra kit (48) keys 41–53 are chromatic timpani; the naive GM crash
    // key 49 plays timpani, so the semantic resolution must move it.
    const orchCrash = resolveSemantic("crashCymbal", 48);
    expect(orchCrash).not.toBeNull();
    expect(orchCrash!.key).toBe(57);
    expect(orchCrash!.sample.toLowerCase()).toContain("crash");

    // On the Standard kit, crash stays on the portable GM key 49.
    const stdCrash = resolveSemantic("crashCymbal", 0);
    expect(stdCrash!.key).toBe(49);
  });

  it("resolves Tam-tam by borrowing the Big Gong from the Ethnic kit", () => {
    const gong = resolveSemantic("tamTam", 49);
    expect(gong).not.toBeNull();
    expect(gong!.key).toBe(45);
    expect(gong!.borrowKit).toBe(49);
    expect(gong!.sample.toLowerCase()).toContain("gong");
  });
});
