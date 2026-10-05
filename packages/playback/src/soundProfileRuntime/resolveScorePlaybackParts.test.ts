import { describe, expect, it } from "vitest";
import { CHORDS_PART_ID, type ChordSymbol, type Score } from "@viritura/core";
import { generateTimeline, getChordPlaybackPart } from "@viritura/midi";
import { createSoundProfileRegistry, type SoundProfile } from "@viritura/sound-profiles";
import { collectSf2Assignments, collectVstAssignments } from "../vstCoordination";
import { requireSf2Sound, resolvePartSounds, resolveScorePlaybackParts } from "./index";

function score(chordSymbols?: ChordSymbol[]): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 }, chordSymbols }] },
    parts: ["a", "b"].map((id) => ({
      id,
      name: "Piano",
      measures: [{ sequences: [{ content: [] }] }],
      _x: { viritura: { instrumentId: "keyboard.piano", midiProgram: 0 } },
    })),
  };
}

const major: ChordSymbol = { position: { fraction: [0, 1] }, root: { step: "C" } };

const vstProfile: SoundProfile = {
  id: "user-orchestra",
  version: 1,
  displayName: "User Orchestra",
  defaultListenerPosition: { x: 0, y: 0 },
  sourceCatalog: () => [],
  resolve(input) {
    return {
      profileId: "user-orchestra",
      profileVersion: 1,
      selectedSourceId: "slot",
      instrumentId: input.instrumentId,
      sources: [{ id: "slot", kind: "vst", hostProfileId: "user-orchestra", instrumentSlot: "slot", midiChannel: 0 }],
      routing: { section: "strings", stagePosition: { x: 0, y: 0 }, projectionRefDistance: 1 },
      capabilities: {
        sourceKinds: ["vst"],
        supportsLayeredSources: false,
        supportsProgramChange: false,
        supportsFixedMidiNote: false,
      },
      resolution: "selected",
    };
  },
};

describe("resolveScorePlaybackParts", () => {
  it("keeps the initial authored assignment but defaults subsequent instrument sounds and layers", () => {
    const input = score();
    input.parts = [input.parts[0]!];
    const part = input.parts[0]!;
    part._x = {
      viritura: {
        initialInstrument: "flute",
        instruments: {
          flute: { instrumentId: "wind.flutes.flute", midiProgram: 73 },
          violin: { instrumentId: "strings.violin", midiProgram: 40 },
        },
      },
    };
    part.measures[0]!.instrumentChanges = [
      { instrument: "violin" },
      {
        instrument: "flute",
        position: { fraction: [1, 2] },
      },
    ];
    input.soundProfile = {
      profileId: "viritura-sounds",
      profileVersion: 1,
      parts: { a: { sourceId: "brass.tuba-primary" } },
    };
    const before = structuredClone(input);
    const resolved = resolveScorePlaybackParts(input)[0]!;
    expect(resolved.instruments!.map(({ key }) => key)).toEqual(["initial", "instrument:violin", "instrument:flute"]);
    const sounds = resolved.instruments!.map(({ resolved: variant }) =>
      requireSf2Sound(variant.part.name, variant.sf2),
    );
    expect(sounds.map((sound) => sound.primary.program)).toEqual([58, 40, 73]);
    expect(sounds[1]!.layers.length).toBeGreaterThan(0);
    expect(input).toEqual(before);
    expect(collectSf2Assignments([resolved])).toEqual([]);
  });

  it("uses the initial instrument definition even with no changes and stale legacy metadata", () => {
    const input = score();
    input.parts[0]!._x = {
      viritura: {
        instrumentId: "keyboard.piano",
        midiProgram: 0,
        initialInstrument: "piccolo",
        instruments: { piccolo: { instrumentId: "wind.flutes.flute.piccolo", midiProgram: 72 } },
      },
    };
    const resolved = resolveScorePlaybackParts(input)[0]!;
    expect(requireSf2Sound(resolved.part.name, resolved.sf2).primary.program).toBe(72);
    expect(resolved.instruments).toBeUndefined();
  });
  it.each([{ symbols: undefined }, { symbols: [] }])(
    "preserves instrument-only resolution for $symbols global symbols",
    ({ symbols }) => {
      const input = score(symbols);
      expect(resolveScorePlaybackParts(input)).toEqual(resolvePartSounds(input.parts));
    },
  );

  it("appends a GM0 piano at the MIDI lane index without changing or spreading authored parts", () => {
    const input = score([major]);
    const before = structuredClone(input);
    const parts = input.parts;
    const resolved = resolveScorePlaybackParts(input);
    const chords = resolved[2]!;

    expect(resolved.slice(0, 2)).toEqual(resolvePartSounds(parts));
    expect(resolved[0]!.part).toBe(parts[0]);
    expect(resolved[1]!.part).toBe(parts[1]);
    expect(chords).toMatchObject({
      index: input.parts.length,
      part: { id: CHORDS_PART_ID, name: "Chords", measures: [] },
      sound: { profileId: "viritura-sounds", instrumentId: "keyboard.piano", routing: { section: "keys" } },
      sf2: { kind: "supported", primary: { kind: "midi", program: 0 }, layers: [] },
    });
    expect(chords.position).toEqual(resolvePartSounds([chords.part])[0]!.position);
    expect(chords.vst).toBeUndefined();
    expect(getChordPlaybackPart(input)?.partIndex).toBe(chords.index);
    const events = generateTimeline(input).events.filter((event) => event.playbackLaneId === CHORDS_PART_ID);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => event.partIndex === chords.index)).toBe(true);
    expect(collectSf2Assignments(resolved)).toContainEqual({ partIndex: 2, program: 0, isDrum: false });
    expect(input).toEqual(before);
    expect(input.parts).toBe(parts);
    expect(resolveScorePlaybackParts(input)).toEqual(resolved);
  });

  it.each(["NC", "C7alt"])("retains the independent piano lane for silent symbol %s", (rawText) => {
    const input = score([{ position: { fraction: [0, 1] }, rawText }]);
    expect(resolveScorePlaybackParts(input)).toHaveLength(3);
    expect(generateTimeline(input).events.filter((event) => event.playbackLaneId === CHORDS_PART_ID)).toEqual([]);
  });

  it("finds harmony after the first measure and removes the lane when the final symbol is removed", () => {
    const input = score();
    input.global.measures.push({ chordSymbols: [major] });
    expect(resolveScorePlaybackParts(input).at(-1)!.part.id).toBe(CHORDS_PART_ID);
    input.global.measures[1]!.chordSymbols = [];
    expect(resolveScorePlaybackParts(input)).toHaveLength(2);
  });

  it("keeps global harmony audible when source parts hide chord symbols", () => {
    const input = score([major]);
    input.parts.forEach((part) => {
      part.chordSymbolVisibility = "hide";
    });
    expect(resolveScorePlaybackParts(input).at(-1)!.part.id).toBe(CHORDS_PART_ID);
  });

  it("resolves a chord-only score at runtime index zero", () => {
    const input = score([major]);
    input.parts = [];
    expect(resolveScorePlaybackParts(input)).toMatchObject([{ index: 0, part: { id: CHORDS_PART_ID } }]);
  });

  it("honors authored sound assignments without applying even a reserved-ID override to global chords", () => {
    const input = score([major]);
    input.soundProfile = {
      profileId: "viritura-sounds",
      profileVersion: 1,
      parts: { a: { sourceId: "brass.tuba-primary" }, [CHORDS_PART_ID]: { sourceId: "brass.tuba-primary" } },
    };
    const resolved = resolveScorePlaybackParts(input);
    expect(resolved.slice(0, 2)).toEqual(resolvePartSounds(input.parts, input.soundProfile));
    expect(requireSf2Sound("Piano", resolved[0]!.sf2).primary.program).toBe(58);
    expect(requireSf2Sound("Chords", resolved[2]!.sf2).primary.program).toBe(0);
  });

  it("preserves VST instruments but never forces global chords into the score-wide VST profile", () => {
    const input = score([major]);
    input.soundProfile = {
      profileId: vstProfile.id,
      profileVersion: 1,
      parts: { a: { sourceId: "slot" }, [CHORDS_PART_ID]: { sourceId: "slot" } },
    };
    // A user-only registry also exercises the existing built-in SF2 fallback.
    const registry = createSoundProfileRegistry([vstProfile]);
    const resolved = resolveScorePlaybackParts(input, registry);
    expect(resolved.slice(0, 2)).toEqual(resolvePartSounds(input.parts, input.soundProfile, registry));
    expect(collectVstAssignments(resolved).map((entry) => entry.partIndex)).toEqual([0]);
    expect(collectSf2Assignments(resolved)).toEqual([
      { partIndex: 1, program: 0, isDrum: false },
      { partIndex: 2, program: 0, isDrum: false },
    ]);
    expect(resolved[2]!.vst).toBeUndefined();
  });

  it("retains existing strict built-in profile version validation", () => {
    const input = score([major]);
    input.soundProfile = { profileId: "viritura-sounds", profileVersion: 2, parts: {} };
    expect(() => resolveScorePlaybackParts(input)).toThrow("version 2 is unavailable");
  });
});
