import { describe, it, expect } from "vitest";
import type { Score } from "@viritura/core";
import { generateTimeline, GM_DRUM_CHANNEL } from "../timeline";

function pitchedNote(step: "C" | "D" | "E" | "F" | "G" | "A" | "B", octave: number) {
  return { pitch: { step, octave } };
}

function buildDrumKitScore(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [
        {
          time: { count: 4, unit: 4 },
          tempos: [{ bpm: 120, value: { base: "quarter" } } as never],
        },
      ],
      sounds: {
        kick: { midiNumber: 36, name: "Bass Drum" },
        snare: { midiNumber: 38, name: "Snare" },
        hhc: { midiNumber: 42, name: "Closed Hi-Hat" },
      },
    },
    parts: [
      {
        id: "p1",
        kit: {
          "kc-kick": { sound: "kick", staffPosition: -3 },
          "kc-snare": { sound: "snare", staffPosition: 1 },
          "kc-hhc": { sound: "hhc", staffPosition: 5, notehead: "x" },
        },
        measures: [
          {
            sequences: [
              {
                content: [
                  {
                    type: "event",
                    duration: { base: "quarter" },
                    kitNotes: [{ kitComponent: "kc-kick" }, { kitComponent: "kc-hhc" }],
                  },
                  {
                    type: "event",
                    duration: { base: "quarter" },
                    kitNotes: [{ kitComponent: "kc-snare" }, { kitComponent: "kc-hhc" }],
                  },
                  {
                    type: "event",
                    duration: { base: "quarter" },
                    kitNotes: [{ kitComponent: "kc-kick" }, { kitComponent: "kc-hhc" }],
                  },
                  {
                    type: "event",
                    duration: { base: "quarter" },
                    kitNotes: [{ kitComponent: "kc-snare" }, { kitComponent: "kc-hhc" }],
                  },
                ],
              },
            ],
          },
        ],
      } as never,
    ],
  };
}

function buildPitchedScore(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [
        {
          time: { count: 4, unit: 4 },
          tempos: [{ bpm: 120, value: { base: "quarter" } } as never],
        },
      ],
    },
    parts: [
      {
        id: "p1",
        measures: [
          {
            sequences: [
              {
                content: [{ type: "event", duration: { base: "whole" }, notes: [pitchedNote("C", 4)] }],
              },
            ],
          },
        ],
      } as never,
    ],
  };
}

describe("generateTimeline — drum kit (percussion)", () => {
  it("routes kit-note events to GM percussion channel 9", () => {
    const tl = generateTimeline(buildDrumKitScore());
    const noteOns = tl.events.filter((e) => e.type === "noteOn");
    expect(noteOns.length).toBeGreaterThan(0);
    for (const ev of noteOns) {
      expect(ev.channel).toBe(GM_DRUM_CHANNEL);
    }
  });

  it("uses the kit-component's mapped MIDI number, not the placeholder pitch", () => {
    const tl = generateTimeline(buildDrumKitScore());
    const noteOns = tl.events.filter((e) => e.type === "noteOn");
    const midis = new Set(noteOns.map((e) => e.midiNote));
    // 36 = kick, 38 = snare, 42 = closed hi-hat — all should appear; 60 (C4) should NOT.
    expect(midis.has(36)).toBe(true);
    expect(midis.has(38)).toBe(true);
    expect(midis.has(42)).toBe(true);
    expect(midis.has(60)).toBe(false);
  });

  it("emits a noteOff for every noteOn on the percussion channel", () => {
    const tl = generateTimeline(buildDrumKitScore());
    const ons = tl.events.filter((e) => e.type === "noteOn");
    const offs = tl.events.filter((e) => e.type === "noteOff");
    expect(offs.length).toBe(ons.length);
    for (const ev of offs) {
      expect(ev.channel).toBe(GM_DRUM_CHANNEL);
    }
  });

  it("skips kit-notes whose component has no resolved sound (graceful)", () => {
    const score = buildDrumKitScore();
    score.parts[0]!.measures[0]!.sequences[0]!.content = [
      {
        type: "event",
        duration: { base: "quarter" },
        kitNotes: [{ kitComponent: "nonexistent" }],
      },
    ];
    const tl = generateTimeline(score);
    expect(tl.events.filter((e) => e.type === "noteOn").length).toBe(0);
  });

  it("does NOT route pitched (non-percussion) parts to channel 9", () => {
    const tl = generateTimeline(buildPitchedScore());
    const noteOns = tl.events.filter((e) => e.type === "noteOn");
    expect(noteOns.length).toBeGreaterThan(0);
    for (const ev of noteOns) {
      expect(ev.channel).not.toBe(GM_DRUM_CHANNEL);
    }
    expect(noteOns[0]!.midiNote).toBe(60); // C4
  });
});

describe("generateTimeline — percussion roll (tremolo on kit-note)", () => {
  function buildRollScore(component: "kc-snare" | "kc-hhc"): Score {
    return {
      mnx: { version: 1 },
      global: {
        measures: [{ time: { count: 4, unit: 4 }, tempos: [{ bpm: 120, value: { base: "quarter" } } as never] }],
        sounds: {
          snare: { midiNumber: 38, name: "Snare" },
          hhc: { midiNumber: 42, name: "Closed Hi-Hat" },
        },
      },
      parts: [
        {
          id: "p1",
          kit: {
            "kc-snare": { sound: "snare", staffPosition: 1 },
            "kc-hhc": { sound: "hhc", staffPosition: 5, notehead: "x" },
          },
          measures: [
            {
              sequences: [
                {
                  content: [
                    {
                      type: "event",
                      duration: { base: "whole" },
                      markings: { tremolo: { marks: 3 } },
                      kitNotes: [{ kitComponent: component }],
                    },
                  ],
                },
              ],
            },
          ],
        } as never,
      ],
    };
  }

  it("sustains a snare roll as ONE long note, not repeated hits", () => {
    const tl = generateTimeline(buildRollScore("kc-snare"));
    const noteOns = tl.events.filter((e) => e.type === "noteOn");
    // A subdivided tremolo would emit many noteOns; a roll emits exactly one.
    expect(noteOns.length).toBe(1);
  });

  it("swaps the snare (38) to the Snare Roll sample (25)", () => {
    const tl = generateTimeline(buildRollScore("kc-snare"));
    const noteOns = tl.events.filter((e) => e.type === "noteOn");
    expect(noteOns[0]!.midiNote).toBe(25);
    expect(noteOns[0]!.channel).toBe(GM_DRUM_CHANNEL);
  });

  it("spans the full written duration (one whole note = 2s at 120bpm)", () => {
    const tl = generateTimeline(buildRollScore("kc-snare"));
    const on = tl.events.find((e) => e.type === "noteOn")!;
    const off = tl.events.find((e) => e.type === "noteOff")!;
    expect(off.time - on.time).toBeCloseTo(2, 1);
  });

  it("sustains a drum without a dedicated roll sample on its own sound", () => {
    const tl = generateTimeline(buildRollScore("kc-hhc"));
    const noteOns = tl.events.filter((e) => e.type === "noteOn");
    expect(noteOns.length).toBe(1);
    expect(noteOns[0]!.midiNote).toBe(42); // no roll sample → base sound, sustained
  });
});

describe("generateTimeline — kit-component drum-kit override (e.g. Tam-tam)", () => {
  function buildOverrideScore(): Score {
    return {
      mnx: { version: 1 },
      global: {
        measures: [{ time: { count: 4, unit: 4 }, tempos: [{ bpm: 120, value: { base: "quarter" } } as never] }],
        sounds: {
          snare: { midiNumber: 38, name: "Snare" },
          gong: { midiNumber: 45, name: "Tam-tam" },
        },
      },
      parts: [
        {
          id: "p1",
          kit: {
            "kc-snare": { sound: "snare", staffPosition: 1 },
            // Borrows the Big Gong from the Ethnic kit (program 49).
            "kc-gong": { sound: "gong", staffPosition: -3, drumKit: 49 },
          },
          measures: [
            {
              sequences: [
                {
                  content: [
                    { type: "event", duration: { base: "quarter" }, kitNotes: [{ kitComponent: "kc-snare" }] },
                    { type: "event", duration: { base: "half" }, kitNotes: [{ kitComponent: "kc-gong" }] },
                  ],
                },
              ],
            },
          ],
        } as never,
      ],
    };
  }

  it("tags the gong's events with the override drum-kit program (49)", () => {
    const tl = generateTimeline(buildOverrideScore());
    const gongOn = tl.events.find((e) => e.type === "noteOn" && e.midiNote === 45);
    expect(gongOn).toBeDefined();
    expect(gongOn!.drumKitProgram).toBe(49);
    const gongOff = tl.events.find((e) => e.type === "noteOff" && e.midiNote === 45);
    expect(gongOff!.drumKitProgram).toBe(49);
  });

  it("leaves non-override kit notes without a drum-kit program", () => {
    const tl = generateTimeline(buildOverrideScore());
    const snareOn = tl.events.find((e) => e.type === "noteOn" && e.midiNote === 38);
    expect(snareOn).toBeDefined();
    expect(snareOn!.drumKitProgram).toBeUndefined();
  });
});
