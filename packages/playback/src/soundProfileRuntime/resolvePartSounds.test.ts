import { describe, expect, it } from "vitest";
import type { Part } from "@viritura/core";
import { createSoundProfileRegistry, virituraSoundsProfile, type SoundProfile } from "@viritura/sound-profiles";
import { requireSf2Sound, resolvePartSounds, UnsupportedSf2SoundError, type UnsupportedSf2Sound } from "./index";

function part(name: string, viritura?: NonNullable<Part["_x"]>["viritura"]): Part {
  return { name, measures: [], _x: viritura ? { viritura } : undefined };
}

const VST_SLOT = "slot-x";

/** A minimal user VST profile with one configured strings slot. */
const vstProfile: SoundProfile = {
  id: "user-1",
  version: 1,
  displayName: "My Orchestra",
  defaultListenerPosition: { x: 0, y: 0 },
  resolve(input) {
    if (input.selectedSourceId !== VST_SLOT) return null;
    return {
      profileId: "user-1",
      profileVersion: 1,
      selectedSourceId: VST_SLOT,
      instrumentId: input.instrumentId,
      sources: [{ id: VST_SLOT, kind: "vst", hostProfileId: "user-1", instrumentSlot: VST_SLOT, midiChannel: 0 }],
      routing: { section: "strings", stagePosition: { x: -2, y: 1 }, projectionRefDistance: 1 },
      capabilities: {
        sourceKinds: ["vst"],
        supportsLayeredSources: false,
        supportsProgramChange: true,
        supportsFixedMidiNote: false,
      },
      resolution: "selected",
    };
  },
  sourceCatalog: () => [{ sourceId: VST_SLOT, section: "strings", label: "Custom Violin", configured: true }],
};

const vstRegistry = createSoundProfileRegistry([virituraSoundsProfile, vstProfile]);

function violinPart(): Part {
  return { ...part("Violin", { instrumentId: "violin" }), id: "vln-1" };
}

describe("resolvePartSounds", () => {
  it("uses canonical clarinet routing while preserving an existing explicit MIDI program", () => {
    const [resolved] = resolvePartSounds([part("Tuba 1", { instrumentId: "bflat-clarinet", midiProgram: 58 })]);

    expect(resolved!.sf2).toMatchObject({
      kind: "supported",
      primary: { kind: "midi", program: 58 },
    });

    expect(resolved!.sound.routing).toMatchObject({ section: "woodwinds", projectionRefDistance: 3 });
    expect(resolved!.position).toEqual({ x: -0.5, y: 7 });
  });

  it("routes a clarinet notation part through its part-ID-keyed tuba source assignment", () => {
    const clarinet = {
      ...part("Clarinet", { instrumentId: "bflat-clarinet", midiProgram: 71 }),
      id: "clarinet-1",
    };
    const [resolved] = resolvePartSounds([clarinet], {
      profileId: "viritura-sounds",
      profileVersion: 1,
      parts: { "clarinet-1": { sourceId: "tuba-primary" } },
    });

    expect(resolved!.part._x?.viritura?.instrumentId).toBe("bflat-clarinet");
    expect(resolved!.sound).toMatchObject({
      instrumentId: "bflat-clarinet",
      selectedSourceId: "tuba-primary",
      routing: { section: "brass", stagePosition: { x: 6.5, y: 8 } },
    });
    expect(resolved!.sf2).toMatchObject({ kind: "supported", primary: { program: 58 } });
    expect(resolved!.position).toEqual({ x: 6.5, y: 8 });
  });

  it("rejects assignments authored against an unsupported profile version", () => {
    expect(() =>
      resolvePartSounds([part("Clarinet")], {
        profileId: "viritura-sounds",
        profileVersion: 2,
        parts: {},
      }),
    ).toThrow('Sound profile "viritura-sounds" version 2 is unavailable; this runtime supports version 1.');
  });

  it("uses the profile stage default unless a user-authored spatial override is present", () => {
    const [defaultPosition] = resolvePartSounds([part("Unrecognized label", { instrumentId: "bflat-clarinet" })]);
    const [overriddenPosition] = resolvePartSounds([
      part("Unrecognized label", { instrumentId: "bflat-clarinet", spatial: { x: 8, y: 4 } }),
    ]);

    expect(defaultPosition!.position).toEqual({ x: -0.5, y: 7 });
    expect(overriddenPosition!.position).toEqual({ x: 8, y: 4 });
  });

  it("preserves legacy duplicate-player spread around profile routing defaults", () => {
    const resolved = resolvePartSounds([
      part("Violin", { instrumentId: "violin" }),
      part("Violin", { instrumentId: "violin" }),
    ]);

    expect(resolved.map((entry) => entry.position)).toEqual([
      { x: -2, y: 1 },
      { x: -1, y: 3 },
    ]);
  });

  it("keeps fixed percussion on its resolved standard kit source and legacy crash percussion on Orchestra", () => {
    const [snare, crash] = resolvePartSounds([
      part("Snare Drum", { instrumentId: "snare-drum" }),
      part("Crash Cymbal"),
    ]);

    expect(snare!.sf2).toMatchObject({
      kind: "supported",
      primary: { bankMsb: 128, drumKitProgram: 0, fixedMidiNote: 38 },
    });
    expect(crash!.sf2).toMatchObject({
      kind: "supported",
      primary: { bankMsb: 128, drumKitProgram: 48, fixedMidiNote: 49 },
    });
  });

  it("creates profile-defined string layers exactly once", () => {
    const [violin] = resolvePartSounds([part("Violin", { instrumentId: "violin" })]);
    const sf2 = requireSf2Sound(violin!.part.name, violin!.sf2);
    const sourceIds = [sf2.primary.id, ...sf2.layers.map((layer) => layer.source.id)];

    expect(sourceIds).toEqual(["violin-primary", "violin-layer-1", "violin-layer-2"]);
    expect(new Set(sourceIds).size).toBe(sourceIds.length);
  });

  it("throws a typed error rather than routing a non-SF2 profile source", () => {
    const unsupported: UnsupportedSf2Sound = {
      kind: "unsupported",
      reason: "unsupported-source-kind",
      sources: [
        {
          id: "future-vst",
          kind: "vst",
          hostProfileId: "future",
          instrumentSlot: "clarinet",
          midiChannel: 1,
        },
      ],
    };

    expect(() => requireSf2Sound("Clarinet", unsupported)).toThrow(UnsupportedSf2SoundError);
  });

  it("flags a VST-assigned part with its slot source while retaining a SoundFont fallback", () => {
    const [resolved] = resolvePartSounds(
      [violinPart()],
      { profileId: "user-1", profileVersion: 1, parts: { "vln-1": { sourceId: VST_SLOT } } },
      vstRegistry,
    );

    expect(resolved!.vst).toMatchObject({ kind: "vst", id: VST_SLOT, hostProfileId: "user-1", midiChannel: 0 });
    // The fallback still resolves the part's notation identity (violin) through SF2.
    expect(resolved!.sound.instrumentId).toBe("violin");
    expect(requireSf2Sound(resolved!.part.name, resolved!.sf2).primary).toMatchObject({ program: 40 });
  });

  it("falls back to VirituraSounds when the assigned VST profile version is stale", () => {
    const [resolved] = resolvePartSounds(
      [violinPart()],
      { profileId: "user-1", profileVersion: 2, parts: { "vln-1": { sourceId: VST_SLOT } } },
      vstRegistry,
    );

    expect(resolved!.vst).toBeUndefined();
    expect(requireSf2Sound(resolved!.part.name, resolved!.sf2).primary).toMatchObject({ program: 40 });
  });

  it("falls back to VirituraSounds for an unconfigured/unknown VST slot without throwing", () => {
    const [resolved] = resolvePartSounds(
      [violinPart()],
      { profileId: "user-1", profileVersion: 1, parts: { "vln-1": { sourceId: "missing-slot" } } },
      vstRegistry,
    );

    expect(resolved!.vst).toBeUndefined();
    expect(requireSf2Sound(resolved!.part.name, resolved!.sf2).primary).toMatchObject({ program: 40 });
  });
});
