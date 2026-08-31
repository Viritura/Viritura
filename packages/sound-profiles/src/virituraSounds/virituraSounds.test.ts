import { describe, expect, it } from "vitest";
import { defaultSoundProfileRegistry, VIRITURA_SOUNDS_SOURCE_OPTIONS } from "../index";
import { VIRITURA_SOUNDS_INSTRUMENT_RULES } from "./instrumentRules";
import { VIRITURA_SOUNDS_PROFILE_ID, virituraSoundsProfile } from "./index";

describe("VirituraSounds", () => {
  it("is the built-in profile in the default registry", () => {
    expect(defaultSoundProfileRegistry.get(VIRITURA_SOUNDS_PROFILE_ID)).toBe(virituraSoundsProfile);
    expect(defaultSoundProfileRegistry.list()).toEqual([virituraSoundsProfile]);
  });

  it("exposes a selectable source catalog mirroring the canonical options", () => {
    const catalog = virituraSoundsProfile.sourceCatalog!();
    expect(catalog).toHaveLength(VIRITURA_SOUNDS_SOURCE_OPTIONS.length);
    expect(catalog.every((entry) => entry.configured === true)).toBe(true);
    expect(catalog).toContainEqual({ sourceId: "tuba-primary", section: "brass", label: "Tuba", configured: true });
  });

  it("resolves bflat clarinet by canonical ID with current woodwind routing", () => {
    const resolved = virituraSoundsProfile.resolve({
      instrumentId: "bflat-clarinet",
      legacyName: "Tuba 1",
    });

    expect(resolved).not.toBeNull();
    expect(resolved!.sources).toEqual([{ id: "bflat-clarinet-primary", kind: "midi", program: 71 }]);
    expect(resolved!.routing).toEqual({
      section: "woodwinds",
      stagePosition: { x: -0.5, y: 7 },
      projectionRefDistance: 3,
    });
  });

  it("covers the current GM program for every supported canonical catalog ID", () => {
    const expectedPrograms: Readonly<Record<string, number>> = {
      piccolo: 72,
      flute: 73,
      "alto-flute": 73,
      oboe: 68,
      "english-horn": 69,
      "bflat-clarinet": 71,
      "a-clarinet": 71,
      "eflat-clarinet": 71,
      "bass-clarinet": 71,
      bassoon: 70,
      contrabassoon: 70,
      "soprano-sax": 64,
      "alto-sax": 65,
      "tenor-sax": 66,
      "baritone-sax": 67,
      recorder: 74,
      horn: 60,
      trumpet: 56,
      "c-trumpet": 56,
      cornet: 56,
      flugelhorn: 59,
      trombone: 57,
      "bass-trombone": 57,
      euphonium: 58,
      tuba: 58,
      "drum-kit": 0,
      "orchestral-percussion": 0,
      timpani: 47,
      "snare-drum": 0,
      "bass-drum": 0,
      cymbals: 0,
      triangle: 0,
      tambourine: 0,
      glockenspiel: 9,
      xylophone: 13,
      vibraphone: 11,
      marimba: 12,
      "tubular-bells": 14,
      piano: 0,
      harpsichord: 6,
      celesta: 8,
      organ: 19,
      accordion: 21,
      soprano: 52,
      "mezzo-soprano": 52,
      "alto-voice": 52,
      "tenor-voice": 52,
      "baritone-voice": 52,
      "bass-voice": 52,
      harp: 46,
      guitar: 25,
      "electric-guitar": 27,
      "bass-guitar": 33,
      ukulele: 25,
      mandolin: 25,
      violin: 40,
      viola: 41,
      cello: 42,
      "double-bass": 43,
    };

    for (const [instrumentId, program] of Object.entries(expectedPrograms)) {
      expect(virituraSoundsProfile.resolve({ instrumentId })!.sources[0]).toMatchObject({ kind: "midi", program });
    }
  });

  it("lists every canonical selectable source in orchestra-section order", () => {
    const sectionOrder = ["woodwinds", "brass", "percussion", "keys", "strings", "voices", "other"];

    expect(VIRITURA_SOUNDS_SOURCE_OPTIONS.map((option) => option.instrumentId).sort()).toEqual(
      VIRITURA_SOUNDS_INSTRUMENT_RULES.map((rule) => rule.instrumentId).sort(),
    );
    expect(VIRITURA_SOUNDS_SOURCE_OPTIONS.map((option) => sectionOrder.indexOf(option.section))).toEqual(
      [...VIRITURA_SOUNDS_SOURCE_OPTIONS]
        .map((option) => sectionOrder.indexOf(option.section))
        .sort((left, right) => left - right),
    );
    expect(VIRITURA_SOUNDS_SOURCE_OPTIONS).toContainEqual(
      expect.objectContaining({ sourceId: "tuba-primary", section: "brass", label: "Tuba" }),
    );

    for (const section of sectionOrder) {
      const optionOrder = VIRITURA_SOUNDS_SOURCE_OPTIONS.filter((option) => option.section === section).map(
        (option) => option.instrumentId,
      );
      const ruleOrder = VIRITURA_SOUNDS_INSTRUMENT_RULES.filter((rule) => rule.routing.section === section).map(
        (rule) => rule.instrumentId,
      );
      expect(optionOrder).toEqual(ruleOrder);
    }
  });

  it("uses identity rather than a display name for canonical resolution", () => {
    const violin = virituraSoundsProfile.resolve({ instrumentId: "violin", legacyName: "Clarinet in B♭ 1" });

    expect(violin!.sources[0]).toMatchObject({ kind: "midi", program: 40 });
    expect(violin!.routing.section).toBe("strings");
  });

  it("preserves an existing explicit MIDI program for a canonical melodic part", () => {
    const clarinet = virituraSoundsProfile.resolve({
      instrumentId: "bflat-clarinet",
      explicitMidiProgram: 58,
    });

    expect(clarinet).toMatchObject({
      resolution: "explicit",
      sources: [{ kind: "midi", program: 58 }],
      routing: { section: "woodwinds" },
    });
  });

  it("uses a selected source's program, routing, and layers without changing notation identity", () => {
    const selectedTuba = virituraSoundsProfile.resolve({
      instrumentId: "bflat-clarinet",
      selectedSourceId: "tuba-primary",
      explicitMidiProgram: 71,
    });

    expect(selectedTuba).toMatchObject({
      instrumentId: "bflat-clarinet",
      selectedSourceId: "tuba-primary",
      resolution: "selected",
      sources: [{ kind: "midi", program: 58 }],
      routing: { section: "brass", stagePosition: { x: 6.5, y: 8 } },
      layering: undefined,
    });
  });

  it("matches current string-layer behavior when an explicit program changes a string part", () => {
    const mutedViolin = virituraSoundsProfile.resolve({
      instrumentId: "violin",
      explicitMidiProgram: 45,
    });
    const violinClarinet = virituraSoundsProfile.resolve({
      instrumentId: "bflat-clarinet",
      explicitMidiProgram: 40,
    });

    expect(mutedViolin).toMatchObject({
      sources: [{ kind: "midi", program: 45 }],
      layering: undefined,
    });
    expect(violinClarinet!.sources.map((source) => source.id)).toEqual([
      "bflat-clarinet-primary",
      "bflat-clarinet-layer-1",
      "bflat-clarinet-layer-2",
    ]);
  });

  it("resolves a catalog fixed-note percussion instrument on the standard drum bank", () => {
    const snare = virituraSoundsProfile.resolve({ instrumentId: "snare-drum" });
    const orchestralKit = virituraSoundsProfile.resolve({ instrumentId: "orchestral-percussion" });

    expect(snare!.sources).toEqual([
      {
        id: "snare-drum-primary",
        kind: "midi",
        program: 0,
        bankMsb: 128,
        drumKitProgram: 0,
        fixedMidiNote: 38,
      },
    ]);
    expect(snare!.routing.section).toBe("percussion");
    expect(orchestralKit!.sources[0]).toMatchObject({ drumKitProgram: 0 });
  });

  it("adds the current two ensemble layers to solo strings exactly once", () => {
    const violin = virituraSoundsProfile.resolve({ instrumentId: "violin" });

    expect(violin!.sources).toEqual([
      { id: "violin-primary", kind: "midi", program: 40 },
      { id: "violin-layer-1", kind: "midi", program: 48 },
      { id: "violin-layer-2", kind: "midi", program: 49 },
    ]);
    expect(violin!.layering).toEqual({
      primaryVolumeRatio: 1 / Math.SQRT2,
      layers: [
        { sourceId: "violin-layer-1", volumeRatio: 1 / Math.SQRT2, stageOffset: { x: 0, y: 1 } },
        { sourceId: "violin-layer-2", volumeRatio: 1 / Math.SQRT2, stageOffset: { x: -1.5, y: 0.5 } },
      ],
    });
  });

  it("uses ensemble-layered sounds for untagged legacy string parts", () => {
    const cases = [
      ["Violin I", "violin", 40],
      ["Viola.", "viola", 41],
      ["Violoncello.", "cello", 42],
      ["Contrabass", "double-bass", 43],
    ] as const;

    for (const [legacyName, instrumentId, primaryProgram] of cases) {
      const sound = virituraSoundsProfile.resolve({ legacyName });
      expect(sound).toMatchObject({
        resolution: "legacy",
        selectedSourceId: `${instrumentId}-primary`,
        sources: [
          { kind: "midi", program: primaryProgram },
          { kind: "midi", program: 48 },
          { kind: "midi", program: 49 },
        ],
      });
      expect(sound!.layering?.layers).toHaveLength(2);
    }
  });

  it("preserves legacy name matching and the piano fallback for unknown instruments", () => {
    const legacy = virituraSoundsProfile.resolve({ legacyName: "Clarinet 2" });
    const legacyTom = virituraSoundsProfile.resolve({ legacyName: "Tom 1" });
    const legacyTriangle = virituraSoundsProfile.resolve({ legacyName: "Triangle" });
    const unknown = virituraSoundsProfile.resolve({ instrumentId: "future-instrument", legacyName: "Theremin" });

    expect(legacy).toMatchObject({ resolution: "legacy", sources: [{ kind: "midi", program: 71 }] });
    expect(legacyTom!.sources[0]).toMatchObject({ drumKitProgram: 0, fixedMidiNote: 47 });
    expect(legacyTriangle!.sources[0]).toMatchObject({ drumKitProgram: 48, fixedMidiNote: 81 });
    expect(unknown).toMatchObject({
      resolution: "legacy",
      sources: [{ kind: "midi", program: 0 }],
      routing: { section: "other", projectionRefDistance: 1 },
    });
  });
});
