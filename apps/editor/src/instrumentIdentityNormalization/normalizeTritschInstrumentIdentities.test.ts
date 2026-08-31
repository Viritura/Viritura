import { describe, expect, it } from "vitest";
import type { Part, Score } from "@viritura/core";
import { parseMnx, serializeMnx } from "@viritura/format";
import { normalizeTritschInstrumentIdentities } from ".";

const PARTS = [
  ["P1", "Flauto"],
  ["P2-1", "Oboe 1"],
  ["P2-2", "Oboe 2"],
  ["P3-1", "Clarinet in B♭ 1"],
  ["P3-2", "Clarinet in B♭ 2"],
  ["P4-1", "Bassoon 1"],
  ["P4-2", "Bassoon 2"],
  ["P5-1", "Horn in F 1"],
  ["P5-2", "Horn in F 2"],
  ["P6-1", "Trumpet in Bb 1"],
  ["P6-2", "Trumpet in Bb 2"],
  ["P7-1", "Trombone 1"],
  ["P7-2", "Trombone 2"],
  ["P7-3", "Trombone 3"],
  ["P8", "Timpani in E.A."],
  ["P9", "Grancassa"],
  ["P10", "Triangolo"],
  ["P11", "Piatti"],
  ["P12", "Violino I"],
  ["P13", "Violino II"],
  ["P14", "Viola"],
  ["P15", "Violoncello"],
  ["P16", "Basso"],
] as const;

describe("normalizeTritschInstrumentIdentities", () => {
  it("normalizes identities, playback, percussion, and extracted score names without structural loss", () => {
    const source = makeScore();
    const originalKitNotes = structuredClone(source.parts.slice(15, 18).map((part) => part.measures[0]));
    const result = normalizeTritschInstrumentIdentities(source);

    expect(source.parts[0]!.name).toBe("Flauto");
    expect(result.parts.map((part) => [part.name, part.shortName])).toEqual([
      ["Flute", "Fl."],
      ["Oboe 1", "Ob. 1"],
      ["Oboe 2", "Ob. 2"],
      ["Clarinet in B♭ 1", "Cl. 1"],
      ["Clarinet in B♭ 2", "Cl. 2"],
      ["Bassoon 1", "Bsn. 1"],
      ["Bassoon 2", "Bsn. 2"],
      ["Horn in F 1", "Hn. 1"],
      ["Horn in F 2", "Hn. 2"],
      ["Trumpet in B♭ 1", "Tpt. 1"],
      ["Trumpet in B♭ 2", "Tpt. 2"],
      ["Trombone 1", "Tbn. 1"],
      ["Trombone 2", "Tbn. 2"],
      ["Trombone 3", "Tbn. 3"],
      ["Timpani", "Timp."],
      ["Bass Drum", "B.Dr."],
      ["Triangle", "Tri."],
      ["Cymbals", "Cym."],
      ["Violin 1", "Vln. 1"],
      ["Violin 2", "Vln. 2"],
      ["Viola", "Vla."],
      ["Cello", "Vc."],
      ["Double Bass", "D.B."],
    ]);
    expect(result.parts.map((part) => part._x?.viritura)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          instrumentId: "flute",
          midiProgram: 73,
          family: "woodwinds",
          spatial: { x: 1, y: 2 },
        }),
        expect.objectContaining({ instrumentId: "bass-drum", midiProgram: 0, family: "percussion" }),
        expect.objectContaining({ instrumentId: "double-bass", midiProgram: 43, family: "strings" }),
      ]),
    );
    expect(
      result.parts.map((part) => [
        part._x?.viritura?.instrumentId,
        part._x?.viritura?.midiProgram,
        part._x?.viritura?.family,
      ]),
    ).toEqual([
      ["flute", 73, "woodwinds"],
      ["oboe", 68, "woodwinds"],
      ["oboe", 68, "woodwinds"],
      ["bflat-clarinet", 71, "woodwinds"],
      ["bflat-clarinet", 71, "woodwinds"],
      ["bassoon", 70, "woodwinds"],
      ["bassoon", 70, "woodwinds"],
      ["horn", 60, "brass"],
      ["horn", 60, "brass"],
      ["trumpet", 56, "brass"],
      ["trumpet", 56, "brass"],
      ["trombone", 57, "brass"],
      ["trombone", 57, "brass"],
      ["trombone", 57, "brass"],
      ["timpani", 47, "percussion"],
      ["bass-drum", 0, "percussion"],
      ["triangle", 0, "percussion"],
      ["cymbals", 0, "percussion"],
      ["violin", 40, "strings"],
      ["violin", 40, "strings"],
      ["viola", 41, "strings"],
      ["cello", 42, "strings"],
      ["double-bass", 43, "strings"],
    ]);
    expect(part(result, "P3-1")).toMatchObject({ transposition: { interval: { halfSteps: 2 } } });
    expect(part(result, "P3-2")).toMatchObject({ transposition: { interval: { halfSteps: 2 } } });
    expect(part(result, "P4-1").staves).toBeUndefined();
    expect(part(result, "P4-2").staves).toBeUndefined();
    expect(part(result, "P16").transposition).toMatchObject({
      interval: { halfSteps: 12 },
      prefersWrittenPitches: true,
    });

    expect(result.soundProfile).toEqual({
      profileId: "viritura-sounds",
      profileVersion: 1,
      parts: Object.fromEntries(
        result.parts.map((candidate) => [
          candidate.id,
          { sourceId: `${candidate._x!.viritura!.instrumentId!}-primary` },
        ]),
      ),
    });
    expect(part(result, "P8").kit).toBeUndefined();
    expect(part(result, "P8").measures).toEqual(source.parts[14]!.measures);
    expect(result.parts.slice(15, 18).map((candidate) => candidate.measures[0])).toEqual(originalKitNotes);

    expectKit(result, "P9", "P9-kit-0", "snd-bass-drum-36", "Bass Drum", "Bass Drum", 36, "normal");
    expectKit(result, "P10", "P10-kit-0", "snd-triangle-81", "Triangle", "Open Triangle", 81, "x");
    expectKit(result, "P11", "P11-kit-0", "snd-cymbals-49", "Cymbals", "Crash Cymbal 1", 49, "x");
    expect(result.global.sounds?.["snd-perc-45"]).toBeUndefined();
    expect(result.scores?.map((definition) => definition.name)).toEqual([
      "Full Score",
      "Condensed Score",
      "Flute",
      "Double Bass",
    ]);

    const reparsed = parseMnx(serializeMnx(result));
    expect(part(reparsed, "P10").kit?.["P10-kit-0"]?.notehead).toBe("x");
    expect(normalizeTritschInstrumentIdentities(result)).toEqual(result);
  });

  it("rejects a different score before changing it", () => {
    const score = makeScore();
    score.parts[0]!.name = "Piccolo";
    expect(() => normalizeTritschInstrumentIdentities(score)).toThrow("unexpected name");
  });

  it("allocates a stable suffixed sound ID when the preferred ID is occupied", () => {
    const score = makeScore();
    score.global.sounds!["snd-triangle-81"] = { name: "Reserved", midiNumber: 1 };
    part(score, "P9").kit!["reserved"] = {
      name: "Reserved",
      sound: "snd-triangle-81",
      staffPosition: 0,
    };

    const result = normalizeTritschInstrumentIdentities(score);

    expect(part(result, "P10").kit?.["P10-kit-0"]?.sound).toBe("snd-triangle-81-2");
    expect(result.global.sounds?.["snd-triangle-81-2"]).toEqual({ name: "Open Triangle", midiNumber: 81 });
    expect(result.global.sounds?.["snd-triangle-81"]).toEqual({ name: "Reserved", midiNumber: 1 });
    expect(normalizeTritschInstrumentIdentities(result)).toEqual(result);
  });
});

function makeScore(): Score {
  const parts: Part[] = PARTS.map(([id, name]) => ({ id, name, measures: [{ sequences: [] }] }));
  parts[0]!._x = { viritura: { spatial: { x: 1, y: 2 } } };
  parts[1]!._x = { viritura: { instrumentId: "oboe" } };
  parts[2]!._x = { viritura: { instrumentId: "oboe" } };
  for (const index of [3, 4]) parts[index]!.transposition = { interval: { halfSteps: 2, staffDistance: 1 } };
  parts[7]!._x = { viritura: { instrumentId: "horn" } };
  parts[8]!._x = { viritura: { instrumentId: "horn" } };
  for (const index of [9, 10]) parts[index]!.transposition = { interval: { halfSteps: 2, staffDistance: 1 } };
  for (const index of [11, 12, 13]) parts[index]!._x = { viritura: { instrumentId: "trombone" } };
  parts[14]!.measures = [
    { sequences: [{ content: [{ duration: { base: "quarter" }, notes: [{ pitch: { step: "E", octave: 3 } }] }] }] },
  ];
  for (const index of [15, 16, 17]) {
    const componentId = `P${String(index - 6)}-kit-0`;
    parts[index]!.kit = { [componentId]: { name: "Low Tom", sound: "snd-perc-45", staffPosition: index - 14 } };
    parts[index]!.measures = [
      { sequences: [{ content: [{ duration: { base: "quarter" }, kitNotes: [{ kitComponent: componentId }] }] }] },
    ];
  }
  parts[20]!._x = { viritura: { instrumentId: "viola" } };
  parts[22]!.transposition = {
    interval: { halfSteps: 12, staffDistance: 7 },
    prefersWrittenPitches: true,
  };
  return {
    mnx: { version: 1 },
    global: { measures: [{}], sounds: { "snd-perc-45": { name: "Low Tom", midiNumber: 45 } } },
    parts,
    layouts: [
      { id: "full", content: parts.map((candidate) => ({ type: "staff", sources: [{ part: candidate.id! }] })) },
      { id: "condensed", content: [{ type: "staff", sources: [{ part: "P1" }, { part: "P2-1" }] }] },
      { id: "part-P1", content: [{ type: "staff", sources: [{ part: "P1" }] }] },
      { id: "part-P16", content: [{ type: "staff", sources: [{ part: "P16" }] }] },
    ],
    scores: [
      { name: "Full Score", layout: "full" },
      { name: "Condensed Score", layout: "condensed" },
      { name: "Flauto", layout: "part-P1" },
      { name: "Basso", layout: "part-P16" },
    ],
  };
}

function part(score: Score, partId: string): Part {
  return score.parts.find((candidate) => candidate.id === partId)!;
}

function expectKit(
  score: Score,
  partId: string,
  componentId: string,
  soundId: string,
  componentName: string,
  soundName: string,
  midiNumber: number,
  notehead: "normal" | "x",
): void {
  expect(part(score, partId).kit).toEqual({
    [componentId]: expect.objectContaining({ name: componentName, sound: soundId, notehead }),
  });
  expect(score.global.sounds?.[soundId]).toEqual({ name: soundName, midiNumber });
}
