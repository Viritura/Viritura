import { describe, expect, it } from "vitest";
import type { NoteEvent, Score } from "@viritura/core";
import { projectGlobalFermata } from "@viritura/core";
import { parseMnx, parseMnxWithDiagnostics, serializeMnx, validateRawScore } from "../index";
import { DeltaSerializer } from "../mnx/deltaSerializer";

function note(base: NoteEvent["duration"]["base"], fermata?: NoteEvent["fermata"]): NoteEvent {
  return { type: "event", duration: { base }, notes: [{ pitch: { step: "C", octave: 4 } }], fermata };
}

function score(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [
        {
          time: { count: 4, unit: 4 },
          fermatas: [{ id: "shared", position: { fraction: [3, 4] }, multiplier: 2.75, clickBehavior: "keepClicking" }],
        },
      ],
    },
    parts: [
      { id: "long", measures: [{ sequences: [{ content: [note("whole")] }] }] },
      {
        id: "short",
        measures: [{ sequences: [{ content: [note("half"), note("quarter"), note("eighth"), note("eighth")] }] }],
      },
      { id: "rests", measures: [{ sequences: [{ content: [], fullMeasure: { visualDuration: { base: "whole" } } }] }] },
    ],
  };
}

describe("global fermata interchange", () => {
  it("materializes overlapping notes and full-measure rests without moving the anchor on re-import", () => {
    const input = score();
    const raw = serializeMnx(input);
    expect(validateRawScore(raw).ok).toBe(true);
    const decoded = parseMnx(raw);
    expect(decoded.global.measures[0]!.fermatas).toEqual(input.global.measures[0]!.fermatas);
    const projections = projectGlobalFermata(decoded, 0, decoded.global.measures[0]!.fermatas![0]!);
    expect(projections.map((span) => span.onset)).toEqual([0, 3, 0]);
    expect(projections.every((span) => !(span.event ?? span.sequence.fullMeasure)?.fermata)).toBe(true);
    expect(input.parts[0]!.measures[0]!.sequences[0]!.content[0]).not.toHaveProperty("fermata._x");
    const delta = new DeltaSerializer();
    expect(JSON.parse(delta.serialize(input).json)).toEqual(raw);
    const edited: Score = {
      ...input,
      global: {
        measures: [{ ...input.global.measures[0], fermatas: [{ id: "moved", position: { fraction: [1, 2] } }] }],
      },
    };
    expect(JSON.parse(delta.serialize(edited).json)).toEqual(serializeMnx(edited));
  });

  it("retains an intentional local shape override and keeps standalone locals local", () => {
    const input = score();
    const event = input.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    if (event.type !== "event") throw new Error("Expected a note.");
    event.fermata = { symbol: "angled", placement: "below" };
    const decoded = parseMnx(serializeMnx(input));
    const local = decoded.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    expect(local).toMatchObject({
      fermata: { symbol: "angled", placement: "below", _x: { viritura: { localOnly: true } } },
    });
    delete input.global.measures[0]!.fermatas;
    expect(parseMnx(serializeMnx(input)).global.measures[0]!.fermatas).toBeUndefined();
  });

  it("strictly merges matching instants, not overlapping unaligned annotations", () => {
    const input = score();
    delete input.global.measures[0]!.fermatas;
    const long = input.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    const short = input.parts[1]!.measures[0]!.sequences[0]!.content[2]!;
    if (long.type !== "event" || short.type !== "event") throw new Error("Expected notes.");
    // Legacy input has no localOnly metadata.
    const raw = serializeMnx(input);
    const validated = validateRawScore(raw);
    if (!validated.ok) throw new Error("Expected valid MNX.");
    const rawLong = validated.value.parts[0]!.measures[0]!.sequences![0]!.content![0]!;
    const rawShort = validated.value.parts[1]!.measures[0]!.sequences![0]!.content![2]!;
    if ("duration" in rawLong && "notes" in rawLong) rawLong.fermata = { duration: "long" };
    if ("duration" in rawShort && "notes" in rawShort) rawShort.fermata = {};
    const imported = parseMnxWithDiagnostics(validated.value);
    expect(imported.score.global.measures[0]!.fermatas).toBeUndefined();
    expect(imported.diagnostics.filter((d) => d.code === "unmerged-local-fermata")).toHaveLength(2);
    if ("duration" in rawShort && "notes" in rawShort) delete rawShort.fermata;
    const aligned = validated.value.parts[1]!.measures[0]!.sequences![0]!.content![0]!;
    if ("duration" in aligned && "notes" in aligned) aligned.fermata = {};
    const merged = parseMnx(validated.value);
    expect(merged.global.measures[0]!.fermatas).toMatchObject([{ position: { fraction: [0, 1] }, multiplier: 2 }]);
  });

  it("promotes a lone legacy fermata when every other staff rests", () => {
    const raw = {
      mnx: { version: 1 },
      global: { measures: [{}] },
      parts: [
        {
          measures: [
            {
              sequences: [
                {
                  content: [
                    {
                      duration: { base: "whole" },
                      notes: [{ pitch: { step: "C", octave: 4 } }],
                      fermata: { duration: "veryShort", placement: "below" },
                    },
                  ],
                },
                {
                  content: [{ duration: { base: "whole" }, notes: [{ pitch: { step: "E", octave: 4 } }] }],
                },
              ],
            },
          ],
        },
        { measures: [{ sequences: [{ content: [], fullMeasure: { visualDuration: { base: "whole" } } }] }] },
      ],
    };
    const parsed = parseMnx(raw);
    expect(parsed.global.measures[0]!.fermatas).toMatchObject([{ multiplier: 1.25 }]);
    expect(parsed.parts[0]!.measures[0]!.sequences[0]!.content[0]).toMatchObject({
      fermata: { placement: "below", _x: { viritura: { localOnly: true } } },
    });
  });

  it.each([0, -1, Infinity, NaN])("rejects invalid global multipliers %s", (multiplier) => {
    const input = score();
    input.global.measures[0]!.fermatas![0]!.multiplier = multiplier;
    expect(() => serializeMnx(input)).toThrow();
  });
});
