import { describe, expect, it } from "vitest";
import { applyPatchesToScore, CHORDS_PART_ID, patch, pruneMixerSettings, type Score } from "../index";

function scoreWithMixer(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [] },
    parts: [{ id: "flute", name: "Flute", measures: [] }],
    mixer: {
      channels: {
        flute: { volume: 0, muted: true },
        deleted: { solo: true },
        [CHORDS_PART_ID]: { muted: true },
      },
      groups: { Woodwinds: { volume: 0 }, Strings: { muted: true } },
      masterMuted: false,
    },
  };
}

describe("mixer mutation cleanup", () => {
  it("prunes orphan channels and supplied inactive groups without changing surviving settings", () => {
    const score = scoreWithMixer();
    const next = pruneMixerSettings(score, ["Woodwinds"]);
    expect(next.mixer).toEqual({
      channels: { flute: { volume: 0, muted: true }, [CHORDS_PART_ID]: { muted: true } },
      groups: { Woodwinds: { volume: 0 } },
      masterMuted: false,
    });
    expect(score.mixer?.channels?.["deleted"]).toEqual({ solo: true });
    expect(next.parts).toBe(score.parts);
    expect(pruneMixerSettings(next, ["Woodwinds"])).toBe(next);
  });

  it("preserves groups when the caller has no family roster and does not add defaults", () => {
    const score = scoreWithMixer();
    expect(pruneMixerSettings(score).mixer?.groups).toBe(score.mixer?.groups);
    const oldScore = { ...score, mixer: undefined };
    expect(pruneMixerSettings(oldScore)).toBe(oldScore);
  });

  it("removes a deleted part's mixer controls within the patch, including before ID reuse", () => {
    const score = scoreWithMixer();
    const next = applyPatchesToScore(score, [
      patch.removePart("flute"),
      patch.addPart({ id: "flute", name: "New Flute", measures: [] }),
    ]);
    expect(next.mixer?.channels?.["flute"]).toBeUndefined();
    expect(next.mixer?.channels?.["deleted"]).toBeUndefined();
    expect(next.mixer?.channels?.[CHORDS_PART_ID]).toEqual({ muted: true });
    expect(score.mixer?.channels?.["flute"]?.muted).toBe(true);
  });
});
