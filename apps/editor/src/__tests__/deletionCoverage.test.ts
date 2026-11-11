import { describe, expect, it } from "vitest";
import { parseChordSymbolText, textContentFromPlain, type NoteEvent, type Score } from "@viritura/core";
import { computeDeleteSelection, deletionOperations, resolveDeletionTarget } from "../commands/deletion";
import { lyricElementId } from "../score/ElementPath";

function owner(score: Score): NoteEvent {
  const event = score.parts[0]!.measures[1]!.sequences[0]!.content[0];
  if (event?.type !== "event") throw new Error("Expected owner event");
  return event;
}

function fixture(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [
        { id: "m0", time: { count: 4, unit: 4 }, key: { fifths: 0 } },
        {
          id: "m1",
          time: { count: 3, unit: 4 },
          key: { fifths: 2 },
          tempos: [{ bpm: 90, value: { base: "quarter" } }],
          chordSymbols: [{ ...parseChordSymbolText("C")!, position: { fraction: [0, 1] } }],
          systemText: [{ id: "text", text: textContentFromPlain("Text"), position: { fraction: [0, 1] } }],
          rehearsalMark: { text: textContentFromPlain("A") },
          ending: { numbers: [1] },
          jump: { type: "segno" },
          segno: {},
          coda: {},
          fine: {},
        },
      ],
    },
    parts: [
      {
        id: "part",
        measures: [
          { clefs: [{ clef: { sign: "G", line: 2 } }], sequences: [{ content: [] }] },
          {
            clefs: [{ clef: { sign: "F", line: 4 } }],
            measureRepeat: { number: 1 },
            dynamics: [
              { id: "loud", type: "immediate", position: { fraction: [0, 1] }, value: "f" },
              {
                id: "grow",
                type: "gradual",
                position: { fraction: [0, 1] },
                end: { measure: "m1", position: { fraction: [1, 1] } },
                wedgeType: "increasing",
              },
            ],
            expressions: [{ position: { fraction: [0, 1] }, value: "keep moving" }],
            pedals: [
              {
                type: "sustain",
                position: { fraction: [0, 1] },
                end: { measure: "m1", position: { fraction: [1, 1] } },
              },
            ],
            ottavas: [
              { value: 8, position: { fraction: [0, 1] }, end: { measure: "m1", position: { fraction: [1, 1] } } },
            ],
            arpeggios: [{ span: { start: "c", end: "e" } }],
            sequences: [
              {
                content: [
                  {
                    type: "event",
                    id: "a",
                    duration: { base: "half" },
                    fermata: {},
                    notes: [
                      {
                        id: "c",
                        pitch: { step: "C", octave: 4, alter: 1 },
                        ties: [{ target: "sentinel-note" }],
                        markings: { slideIn: { type: "scoop" } },
                      },
                      { id: "e", pitch: { step: "E", octave: 4 } },
                    ],
                    markings: { accent: {}, caesura: {}, ornaments: ["mordent"], trill: {} },
                    lyrics: { lines: { verse: { text: "Sing" } } },
                    slurs: [{ target: "sentinel" }],
                    glissandos: [{ target: "sentinel" }],
                  },
                  {
                    type: "event",
                    id: "sentinel",
                    duration: { base: "quarter" },
                    notes: [{ id: "sentinel-note", pitch: { step: "G", octave: 4 } }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    scores: [
      {
        textFrames: [
          {
            id: "frame",
            locator: { type: "page", pageIndex: 0 },
            placement: { anchor: "top-left", offset: { x: 0, y: 0 } },
            width: { unit: "staffSpaces", value: 20 },
            content: textContentFromPlain("Text"),
          },
        ],
      },
    ],
  };
}

interface CoverageCase {
  kind: keyof typeof deletionOperations;
  id: string;
  present: (score: Score) => boolean;
  prepare?: (score: Score) => void;
}

const cases: CoverageCase[] = [
  { kind: "event", id: "p0/m1/s0/a", present: (s) => Boolean(owner(s).notes) },
  { kind: "note", id: "p0/m1/s0/a/n0", present: (s) => owner(s).notes?.some((n) => n.id === "c") ?? false },
  {
    kind: "rest",
    id: "p0/m1/s0/a",
    prepare: (s) => {
      s.parts[0]!.measures[1]!.sequences[0]!.content = [
        { type: "event", id: "a", duration: { base: "half" }, rest: {} },
        { type: "event", id: "sentinel", duration: { base: "quarter" }, rest: {} },
      ];
    },
    present: (s) => s.parts[0]!.measures[1]!.sequences[0]!.content.length > 0,
  },
  {
    kind: "grace-note",
    id: "p0/m1/s0/a/grace/g",
    prepare: (s) => {
      s.parts[0]!.measures[1]!.sequences[0]!.content.unshift({
        type: "grace",
        content: [
          {
            type: "event",
            id: "g",
            duration: { base: "eighth" },
            notes: [{ pitch: { step: "D", octave: 4 } }],
          },
        ],
      });
    },
    present: (s) => s.parts[0]!.measures[1]!.sequences[0]!.content.some((event) => event.type === "grace"),
  },
  { kind: "articulation", id: "p0/m1/s0/a/art-accent", present: (s) => owner(s).markings?.accent !== undefined },
  {
    kind: "accidental",
    id: "p0/m1/s0/a/acc0",
    prepare: (s) => {
      owner(s).notes![0]!.pitch.alter = -1;
    },
    present: (s) => owner(s).notes?.[0]?.pitch.alter === -1,
  },
  { kind: "fermata", id: "p0/m1/s0/a/ferm", present: (s) => owner(s).fermata !== undefined },
  { kind: "ornament", id: "p0/m1/s0/a/ornament", present: (s) => owner(s).markings?.ornaments !== undefined },
  { kind: "trill", id: "p0/m1/s0/a/trill", present: (s) => owner(s).markings?.trill !== undefined },
  { kind: "caesura", id: "p0/m1/s0/a/caesura", present: (s) => owner(s).markings?.caesura !== undefined },
  {
    kind: "note-marking",
    id: "p0/m1/s0/a/n0/slideIn",
    present: (s) => owner(s).notes?.[0]?.markings?.slideIn !== undefined,
  },
  {
    kind: "lyric",
    id: lyricElementId("p0/m1/s0/a", "verse"),
    present: (s) => owner(s).lyrics?.lines?.verse !== undefined,
  },
  { kind: "arpeggio", id: "p0/m1/s0/a/arp", present: (s) => Boolean(s.parts[0]!.measures[1]!.arpeggios?.length) },
  { kind: "slur", id: "slur/a/sentinel", present: (s) => owner(s).slurs !== undefined },
  { kind: "tie", id: "tie/c/sentinel-note", present: (s) => owner(s).notes?.[0]?.ties !== undefined },
  { kind: "glissando", id: "gliss/a/sentinel", present: (s) => owner(s).glissandos !== undefined },
  {
    kind: "dynamic",
    id: "p0/m1/dynloud",
    present: (s) => s.parts[0]!.measures[1]!.dynamics?.some((d) => d.id === "loud") ?? false,
  },
  {
    kind: "hairpin",
    id: "p0/m1/hairpingrow",
    present: (s) => s.parts[0]!.measures[1]!.dynamics?.some((d) => d.id === "grow") ?? false,
  },
  { kind: "expression", id: "p0/m1/expr0", present: (s) => Boolean(s.parts[0]!.measures[1]!.expressions?.length) },
  { kind: "pedal", id: "p0/m1/pedal0", present: (s) => Boolean(s.parts[0]!.measures[1]!.pedals?.length) },
  { kind: "ottava", id: "p0/m1/ottava0", present: (s) => Boolean(s.parts[0]!.measures[1]!.ottavas?.length) },
  { kind: "tempo", id: "m1/tempo0", present: (s) => Boolean(s.global.measures[1]!.tempos?.length) },
  { kind: "chord-symbol", id: "m1/chord0", present: (s) => Boolean(s.global.measures[1]!.chordSymbols?.length) },
  { kind: "system-text", id: "m1/systemText/text", present: (s) => Boolean(s.global.measures[1]!.systemText?.length) },
  { kind: "rehearsal", id: "m1/rehearsal", present: (s) => s.global.measures[1]!.rehearsalMark !== undefined },
  { kind: "jump", id: "m1/jump", present: (s) => s.global.measures[1]!.jump !== undefined },
  { kind: "volta", id: "m1/volta", present: (s) => s.global.measures[1]!.ending !== undefined },
  { kind: "segno", id: "m1/segno", present: (s) => s.global.measures[1]!.segno !== undefined },
  { kind: "coda", id: "m1/coda", present: (s) => s.global.measures[1]!.coda !== undefined },
  { kind: "fine", id: "m1/fine", present: (s) => s.global.measures[1]!.fine !== undefined },
  { kind: "clef", id: "p0/m1/clef", present: (s) => Boolean(s.parts[0]!.measures[1]!.clefs?.length) },
  { kind: "key-signature", id: "p0/m1/key", present: (s) => s.global.measures[1]!.key !== undefined },
  { kind: "time-signature", id: "m1/time", present: (s) => s.global.measures[1]!.time !== undefined },
  {
    kind: "measure-repeat",
    id: "p0/m1/measurerepeat",
    present: (s) => s.parts[0]!.measures[1]!.measureRepeat !== undefined,
  },
  { kind: "text-frame", id: "text-frame/frame", present: (s) => Boolean(s.scores?.[0]?.textFrames?.length) },
  {
    kind: "tuplet",
    id: "p0/m1/s0/tuplet0",
    prepare: (s) => {
      s.parts[0]!.measures[1]!.sequences[0]!.content.unshift({
        type: "tuplet",
        inner: { duration: { base: "eighth" }, multiple: 3 },
        outer: { duration: { base: "eighth" }, multiple: 2 },
        content: [
          {
            type: "event",
            id: "t",
            duration: { base: "eighth" },
            rest: {},
          },
        ],
      });
    },
    present: (s) => s.parts[0]!.measures[1]!.sequences[0]!.content.some((event) => event.type === "tuplet"),
  },
];

describe("implemented deletion kind dispatch coverage", () => {
  it("requires runtime mutation fixtures for every implemented registry kind", () => {
    const implemented = Object.entries(deletionOperations)
      .filter(([, operation]) => operation.kind !== "unsupported")
      .map(([kind]) => kind)
      .sort();
    expect(cases.map(({ kind }) => kind).sort()).toEqual(implemented);
  });

  it.each(cases)("$kind deletes through single and multi selection dispatch", ({ kind, id, prepare, present }) => {
    const score = fixture();
    prepare?.(score);
    const original = structuredClone(score);
    expect(present(score)).toBe(true);
    expect(resolveDeletionTarget(id).kind).toBe(kind === "rest" ? "event" : kind);
    for (const multi of [false, true]) {
      const result = computeDeleteSelection(
        score,
        multi ? { kind: "multi", elementIds: [id, id] } : { kind: "single", elementId: id },
      );
      if (result.kind === "noop") throw new Error(`Missing ${kind} runtime deletion`);
      expect(present(result.score)).toBe(false);
      expect(result.score.global.measures[0]).toEqual(original.global.measures[0]);
      expect(result.score.parts[0]!.measures[0]).toEqual(original.parts[0]!.measures[0]);
      const before = original.parts[0]!.measures[1]!.sequences[0]!.content.at(-1);
      const after = result.score.parts[0]!.measures[1]!.sequences[0]!.content.at(-1);
      if (kind !== "rest") expect(after).toEqual(before);
      expect(score).toEqual(original);
    }
  });
});
