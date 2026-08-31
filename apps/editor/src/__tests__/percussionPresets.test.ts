import { describe, it, expect } from "vitest";
import { PERCUSSION_PRESETS, getPercussionPreset, FULL_DRUM_KIT_COMPONENTS } from "../score/percussionPresets";
import { getCatalogInstrument } from "../score/InstrumentCatalog";

describe("percussionPresets", () => {
  it("ships the expected presets", () => {
    expect(PERCUSSION_PRESETS.map((p) => p.id)).toEqual(["full-drum-kit", "orchestral-percussion", "minimal"]);
  });

  it("every preset component has a unique id, a GM key, and a notehead-compatible shape", () => {
    for (const preset of PERCUSSION_PRESETS) {
      const ids = preset.components.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const c of preset.components) {
        expect(c.midiNumber).toBeGreaterThanOrEqual(27);
        expect(c.midiNumber).toBeLessThanOrEqual(87);
      }
    }
  });

  it("orchestral preset contains snare, bass drum, crash, tambourine, triangle", () => {
    const preset = getPercussionPreset("orchestral-percussion")!;
    expect(preset.components.map((c) => c.id).sort()).toEqual(
      ["bass-drum", "crash", "snare", "tambourine", "triangle"].sort(),
    );
  });

  it("the catalog Drum Kit reuses the shared full-kit components", () => {
    const drumKit = getCatalogInstrument("drum-kit");
    expect(drumKit?.kit).toEqual([...FULL_DRUM_KIT_COMPONENTS]);
  });

  it("the catalog exposes an Orchestral Percussion preset instrument", () => {
    const orch = getCatalogInstrument("orchestral-percussion");
    expect(orch).toBeDefined();
    expect(orch?.family).toBe("percussion");
    expect(orch?.kit?.length).toBe(5);
  });
});
