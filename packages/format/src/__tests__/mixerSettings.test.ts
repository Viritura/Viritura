import { describe, expect, it } from "vitest";
import { CHORDS_PART_ID, type ScoreMixerSettings } from "@viritura/core";
import { parseMnx } from "../mnx/parser";
import { parseMnxWithDiagnostics } from "../mnx/parserCore";
import { serializeMnx } from "../mnx/serializer";
import { DeltaSerializer } from "../mnx/deltaSerializer";
import { validateRawScore } from "../mnx/validator";

function document(mixer?: unknown) {
  return {
    mnx: { version: 1 },
    global: { measures: [] },
    parts: [{ id: "flute", measures: [] }],
    ...(mixer === undefined ? {} : { _x: { viritura: { mixer } } }),
  };
}

const settings: ScoreMixerSettings = {
  channels: {
    flute: { volume: 0.7, pan: -0.3, muted: false, solo: true, ensembleEnabled: false, spatialMode: "stereo" },
    [CHORDS_PART_ID]: { muted: true },
  },
  groups: { Woodwinds: { volume: 1.2, muted: true, solo: false } },
  masterVolume: 1.4,
  masterMuted: false,
};

describe("saved mixer settings", () => {
  it("validates and round-trips every control without adding a derived Part", () => {
    const raw = document(settings);
    expect(validateRawScore(raw).ok).toBe(true);
    const score = parseMnx(raw);
    expect(score.mixer).toEqual(settings);
    expect(serializeMnx(score)).toEqual(raw);
    expect(score.parts.map((part) => part.id)).toEqual(["flute"]);
  });

  it("keeps old documents and omitted default controls unchanged", () => {
    expect(parseMnx(document()).mixer).toBeUndefined();
    expect(serializeMnx(parseMnx(document()))).toEqual(document());
    expect(serializeMnx(parseMnx(document({ masterMuted: false })))).toEqual(document({ masterMuted: false }));
  });

  it.each([
    { channels: { flute: { volume: -1 } } },
    { channels: { flute: { volume: 2 } } },
    { channels: { flute: { pan: 1.1 } } },
    { channels: { flute: { muted: "true" } } },
    { channels: { flute: { spatialMode: "invalid" } } },
    { groups: { Woodwinds: { solo: 1 } } },
    { masterVolume: -1 },
    { masterMuted: "false" },
    { channels: [] },
    null,
  ])("rejects invalid mixer settings: %j", (mixer) => {
    expect(validateRawScore(document(mixer)).ok).toBe(false);
    expect(() => parseMnx(document(mixer))).toThrow();
    expect(() => parseMnxWithDiagnostics(document(mixer))).toThrow(/Invalid _x\.viritura\.mixer/);
  });

  it("accepts exact gain and pan boundaries", () => {
    expect(
      validateRawScore(
        document({
          channels: { flute: { volume: 10 ** (6 / 20), pan: -1 }, [CHORDS_PART_ID]: { volume: 0, pan: 1 } },
          masterVolume: 10 ** (6 / 20),
        }),
      ).ok,
    ).toBe(true);
  });

  it("invalidates the delta cache for mixer-only edits and removal", () => {
    const score = parseMnx(document());
    const delta = new DeltaSerializer();
    delta.serialize(score);
    const edited = { ...score, mixer: settings };
    const result = delta.serialize(edited);
    expect(result.structuralChange).toBe(true);
    expect(result.json).toBe(JSON.stringify(serializeMnx(edited)));
    expect(delta.serialize(edited).json).toBe(result.json);
    const removed = delta.serialize(score);
    expect(removed.structuralChange).toBe(true);
    expect(removed.json).toBe(JSON.stringify(serializeMnx(score)));
    delta.invalidate();
    expect(delta.serialize(edited).json).toBe(result.json);
  });
});
