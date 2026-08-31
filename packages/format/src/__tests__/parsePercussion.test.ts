import { describe, it, expect } from "vitest";
import { parseMnx } from "../mnx/parser";
import { serializeMnx } from "../mnx/serializer";

// Test fixtures probe loosely-typed runtime shapes parsed from MNX; `any` is
// used deliberately to bypass discriminated unions when asserting structure.
/* eslint-disable @typescript-eslint/no-explicit-any */

const drumKitMnx = {
  mnx: { version: 1 },
  global: {
    measures: [{ time: { count: 4, unit: 4 }, barline: { type: "regular" } }],
    sounds: {
      "snd-kick": { midiNumber: 35, name: "Bass Drum 1" },
      "snd-snare": { midiNumber: 38, name: "Acoustic Snare" },
    },
  },
  parts: [
    {
      id: "p1",
      name: "Drum Kit",
      kit: {
        kick: { name: "Kick", sound: "snd-kick", staffPosition: -4 },
        snare: { name: "Snare", sound: "snd-snare", staffPosition: 0, _x: { viritura: { notehead: "x" } } },
        gong: { name: "Tam-tam", sound: "snd-snare", staffPosition: -3, _x: { viritura: { drumKit: 49 } } },
      },
      measures: [
        {
          clefs: [{ clef: { sign: "G", staffPosition: 0, glyph: "unpitchedPercussionClef1" } }],
          sequences: [
            {
              content: [
                { duration: { base: "quarter" }, kitNotes: [{ kitComponent: "kick" }] },
                { duration: { base: "quarter" }, kitNotes: [{ kitComponent: "snare", perform: {} }] },
                { duration: { base: "quarter" }, kitNotes: [{ kitComponent: "kick" }] },
                { duration: { base: "quarter" }, kitNotes: [{ kitComponent: "snare" }] },
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe("Percussion (drum kit) parsing", () => {
  it("parses global.sounds", () => {
    const score = parseMnx(drumKitMnx);
    expect(score.global.sounds).toBeDefined();
    expect(score.global.sounds!["snd-kick"]).toEqual({
      midiNumber: 35,
      name: "Bass Drum 1",
    });
    expect(score.global.sounds!["snd-snare"].midiNumber).toBe(38);
  });

  it("parses Part.kit as dict with notehead vendor extension", () => {
    const score = parseMnx(drumKitMnx);
    const part = score.parts[0]!;
    expect(part.kit).toBeDefined();
    const kit = part.kit!;
    expect(Object.keys(kit)).toHaveLength(3);
    expect(kit["kick"]).toEqual({ name: "Kick", sound: "snd-kick", staffPosition: -4 });
    expect(kit["snare"]).toEqual({ name: "Snare", sound: "snd-snare", staffPosition: 0, notehead: "x" });
    // drumKit vendor extension hoisted to the top level alongside notehead.
    expect(kit["gong"]).toEqual({ name: "Tam-tam", sound: "snd-snare", staffPosition: -3, drumKit: 49 });
  });

  it("parses kit-notes inside event.kitNotes (separate from notes)", () => {
    const score = parseMnx(drumKitMnx);
    const events = score.parts[0]!.measures[0]!.sequences[0]!.content;
    expect(events).toHaveLength(4);
    const ev0 = events[0] as any;
    expect(ev0.notes).toBeUndefined();
    expect(ev0.kitNotes).toBeDefined();
    expect(ev0.kitNotes[0].kitComponent).toBe("kick");
    const ev1 = events[1] as any;
    expect(ev1.kitNotes[0].kitComponent).toBe("snare");
    expect(ev1.kitNotes[0].perform).toEqual({});
  });

  it("round-trips drum-kit MNX (parse → serialize → parse)", () => {
    const score1 = parseMnx(drumKitMnx);
    const json = serializeMnx(score1);
    const score2 = parseMnx(json);

    expect(score2.global.sounds).toEqual(score1.global.sounds);
    expect(score2.parts[0]!.kit).toEqual(score1.parts[0]!.kit);

    const events1 = score1.parts[0]!.measures[0]!.sequences[0]!.content;
    const events2 = score2.parts[0]!.measures[0]!.sequences[0]!.content;
    for (let i = 0; i < events1.length; i++) {
      const kn1 = (events1[i] as any).kitNotes?.[0];
      const kn2 = (events2[i] as any).kitNotes?.[0];
      expect(kn2?.kitComponent).toBe(kn1?.kitComponent);
    }
  });

  it("notehead vendor extension survives round-trip", () => {
    const score1 = parseMnx(drumKitMnx);
    const json = serializeMnx(score1);
    // Verify the JSON shape carries _x.viritura.notehead on the snare component (dict)
    const kitJson = (json as any).parts[0].kit;
    expect(kitJson["snare"]._x).toEqual({ viritura: { notehead: "x" } });
    expect(kitJson["kick"]._x).toBeUndefined();
    const score2 = parseMnx(json);
    expect(score2.parts[0]!.kit!["snare"].notehead).toBe("x");
  });

  it("serialized kit-notes go in kitNotes array (not notes)", () => {
    const score = parseMnx(drumKitMnx);
    const json: any = serializeMnx(score);
    const ev = json.parts[0].measures[0].sequences[0].content[0];
    expect(ev.notes).toBeUndefined();
    expect(ev.kitNotes).toBeDefined();
    expect(ev.kitNotes[0].kitComponent).toBe("kick");
    expect(ev.kitNotes[0].pitch).toBeUndefined();
  });
});
