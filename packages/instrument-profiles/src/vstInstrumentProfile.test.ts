import { describe, expect, it } from "vitest";
import { createVstInstrumentProfile, slotSourceOptions } from "./vstInstrumentProfile";
import type { ProfileSlot, VstInstrumentProfile } from "./types";

function slot(overrides: Partial<ProfileSlot> = {}): ProfileSlot {
  return {
    slotId: "slot-violin-1",
    catalogInstrumentId: "violin",
    section: "strings",
    label: "Violin 1",
    binding: {
      baseChannel: 0,
      luaScriptPath: "/scripts/violin.lua",
      pluginPath: "/plugins/Opus.vst3",
      stateRef: "abc123",
    },
    ...overrides,
  };
}

function profile(slots: ProfileSlot[]): VstInstrumentProfile {
  return { id: "user-1", version: 3, displayName: "My Orchestra", slots };
}

describe("createVstInstrumentProfile.resolve", () => {
  it("resolves a fully-configured slot by its selected source id", () => {
    const sp = createVstInstrumentProfile(profile([slot()]));
    const result = sp.resolve({ selectedSourceId: "slot-violin-1", instrumentId: "violin" });
    expect(result).not.toBeNull();
    expect(result!.selectedSourceId).toBe("slot-violin-1");
    expect(result!.instrumentId).toBe("violin");
    expect(result!.profileVersion).toBe(3);
    expect(result!.sources).toHaveLength(1);
    const source = result!.sources[0]!;
    expect(source.kind).toBe("vst");
    if (source.kind === "vst") {
      expect(source.hostProfileId).toBe("user-1");
      expect(source.instrumentSlot).toBe("slot-violin-1");
      expect(source.articulationMapId).toBe("/scripts/violin.lua");
    }
    expect(result!.routing.section).toBe("strings");
    expect(result!.resolution).toBe("selected");
  });

  it("returns null when no source is selected (caller falls back)", () => {
    const sp = createVstInstrumentProfile(profile([slot()]));
    expect(sp.resolve({ instrumentId: "violin" })).toBeNull();
  });

  it("returns null for an unknown slot", () => {
    const sp = createVstInstrumentProfile(profile([slot()]));
    expect(sp.resolve({ selectedSourceId: "nope" })).toBeNull();
  });

  it("returns null when the selected slot is not fully configured", () => {
    const partial = slot({ slotId: "slot-cello", binding: { baseChannel: 0 } });
    const sp = createVstInstrumentProfile(profile([partial]));
    expect(sp.resolve({ selectedSourceId: "slot-cello" })).toBeNull();
  });

  it("keeps two violin slots as independent instances", () => {
    const v1 = slot({ slotId: "v1", label: "Violin 1" });
    const v2 = slot({
      slotId: "v2",
      label: "Violin 2",
      binding: {
        baseChannel: 4,
        luaScriptPath: "/scripts/violin.lua",
        pluginPath: "/plugins/SStage.vst3",
        stateRef: "def456",
      },
    });
    const sp = createVstInstrumentProfile(profile([v1, v2]));
    const r1 = sp.resolve({ selectedSourceId: "v1" })!;
    const r2 = sp.resolve({ selectedSourceId: "v2" })!;
    expect(r1.selectedSourceId).toBe("v1");
    expect(r2.selectedSourceId).toBe("v2");
    const s1 = r1.sources[0]!;
    const s2 = r2.sources[0]!;
    if (s1.kind === "vst" && s2.kind === "vst") {
      expect(s1.midiChannel).toBe(0);
      expect(s2.midiChannel).toBe(4);
    }
  });
});

describe("slotSourceOptions", () => {
  it("reports each slot with its configured state", () => {
    const configured = slot({ slotId: "a", label: "A" });
    const partial = slot({ slotId: "b", label: "B", binding: { baseChannel: 0 } });
    const options = slotSourceOptions(profile([configured, partial]));
    expect(options).toEqual([
      { sourceId: "a", section: "strings", label: "A", catalogInstrumentId: "violin", configured: true },
      { sourceId: "b", section: "strings", label: "B", catalogInstrumentId: "violin", configured: false },
    ]);
  });
});

describe("createVstInstrumentProfile.sourceCatalog", () => {
  it("exposes every slot as a section-grouped picker entry with its configured state", () => {
    const configured = slot({ slotId: "a", label: "A" });
    const partial = slot({ slotId: "b", label: "B", binding: { baseChannel: 0 } });
    const catalog = createVstInstrumentProfile(profile([configured, partial])).sourceCatalog!();
    expect(catalog).toEqual([
      { sourceId: "a", section: "strings", label: "A", configured: true },
      { sourceId: "b", section: "strings", label: "B", configured: false },
    ]);
  });
});
