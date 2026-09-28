import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseMnx } from "../mnx/parser";
import { recoverInvalidSequences } from "../mnx/sequenceRecovery";
import { validateRawScore } from "../mnx/validator";

interface TestSequence {
  staff?: number;
  voice?: string;
  content: Array<Record<string, unknown>>;
}
interface TestScore {
  mnx: { version: number };
  global: { measures: Array<{ id?: string; time?: { count: number; unit: number } }> };
  parts: Array<{
    id?: string;
    measures: Array<{
      beams?: Array<{ events: string[] }>;
      sequences: TestSequence[];
      _x?: { viritura?: { expressions?: Array<Record<string, unknown>> } };
    }>;
  }>;
}

const malformedTuplet = (id: string): Record<string, unknown> => ({
  type: "tuplet",
  inner: { duration: { base: "eighth" }, multiple: 3 },
  outer: { duration: { base: "eighth" }, multiple: 2 },
  content: [{ id, duration: { base: "quarter" }, rest: {} }],
});

function twoVoiceScore(): TestScore {
  return {
    mnx: { version: 1 },
    global: { measures: [{ id: "m1", time: { count: 2, unit: 4 } }, { id: "m2" }] },
    parts: [
      {
        id: "P1",
        measures: [
          {
            beams: [{ events: ["bad1", "good1"] }],
            sequences: [
              {
                voice: "v1",
                content: [malformedTuplet("bad1"), { id: "bad2", duration: { base: "quarter" }, rest: {} }],
              },
              {
                voice: "v2",
                content: [
                  {
                    id: "good1",
                    duration: { base: "half" },
                    notes: [{ id: "good1n", pitch: { step: "C", octave: 4 }, ties: [{ target: "bad2" }] }],
                  },
                ],
              },
            ],
          },
          { sequences: [{ content: [{ id: "good2", duration: { base: "half" }, rest: {} }] }] },
        ],
      },
    ],
  };
}

describe("recoverInvalidSequences", () => {
  it("returns a valid document unchanged", () => {
    const score = twoVoiceScore();
    score.parts[0]!.measures[0]!.sequences[0]!.content = [{ id: "ok", duration: { base: "half" }, rest: {} }];
    score.parts[0]!.measures[0]!.beams = [];
    score.parts[0]!.measures[0]!.sequences[1]!.content = [{ id: "ok2", duration: { base: "half" }, rest: {} }];

    const result = recoverInvalidSequences(score);

    expect(result.recovered).toEqual([]);
    expect(result.document).toBe(score);
    expect(result.validation.ok).toBe(true);
  });

  it("empties only the failing sequence and marks it with the log id", () => {
    const score = twoVoiceScore();
    const original = structuredClone(score);

    const result = recoverInvalidSequences(score);
    const recovered = result.document as TestScore;

    expect(score).toEqual(original);
    expect(result.validation.ok).toBe(true);
    expect(result.recovered).toEqual([
      expect.objectContaining({
        logId: "E1",
        partIndex: 0,
        partId: "P1",
        measureIndex: 0,
        measureId: "m1",
        sequenceIndex: 0,
        staff: 1,
        voice: "v1",
        discardedIds: ["bad1", "bad2"],
        errors: [expect.objectContaining({ keyword: "tupletDuration" })],
      }),
    ]);
    const measure = recovered.parts[0]!.measures[0]!;
    expect(measure.sequences[0]!.content).toEqual([]);
    expect(measure.sequences[1]!.content[0]!["id"]).toBe("good1");
    expect(recovered.parts[0]!.measures[1]).toEqual(original.parts[0]!.measures[1]);
    expect(measure._x?.viritura?.expressions).toEqual([
      {
        text: [{ text: "Import error E1" }],
        position: { fraction: [0, 1] },
        placement: "above",
        staff: 1,
        voice: "v1",
      },
    ]);
  });

  it("removes beams and ties that reference discarded events", () => {
    const result = recoverInvalidSequences(twoVoiceScore());
    const measure = (result.document as TestScore).parts[0]!.measures[0]!;
    const note = (measure.sequences[1]!.content[0]!["notes"] as Array<Record<string, unknown>>)[0]!;

    expect(measure.beams).toEqual([]);
    expect(note["ties"]).toEqual([]);
  });

  it("can skip in-score markers", () => {
    const result = recoverInvalidSequences(twoVoiceScore(), { annotate: false });

    expect((result.document as TestScore).parts[0]!.measures[0]!._x).toBeUndefined();
  });

  it("recovers schema errors inside a sequence", () => {
    const score = twoVoiceScore();
    score.parts[0]!.measures[1]!.sequences[0]!.content[0]!["duration"] = { base: "not-a-duration" };

    const result = recoverInvalidSequences(score);

    expect(result.validation.ok).toBe(true);
    expect(result.recovered.map((entry) => [entry.logId, entry.measureIndex])).toEqual([
      ["E1", 1],
      ["E2", 0],
    ]);
  });

  it("leaves errors outside sequences unrecovered", () => {
    const score = twoVoiceScore() as unknown as Record<string, unknown>;
    delete score["mnx"];

    const result = recoverInvalidSequences(score);

    expect(result.validation.ok).toBe(false);
    expect(result.recovered).toEqual([]);
  });

  it("loads the rest of a Finale export containing a malformed tuplet", () => {
    const source: unknown = JSON.parse(
      readFileSync(resolve(__dirname, "../../fixtures/recovery/malformed-tuplet-sequence.mnx"), "utf8"),
    );
    expect(validateRawScore(source).ok).toBe(false);

    const result = recoverInvalidSequences(source);
    const score = parseMnx(result.document);

    expect(result.recovered).toHaveLength(1);
    expect(result.recovered[0]).toMatchObject({ measureIndex: 1, voice: "s1layer1", discardedIds: ["ev16", "ev16n1"] });
    const [measure1, measure2] = score.parts[0]!.measures;
    expect(measure1!.sequences[0]!.content).toHaveLength(5);
    expect(measure2!.sequences[0]!.content).toEqual([]);
    expect(measure2!.sequences[1]!.content).toHaveLength(7);
    expect(measure2!.expressions?.[0]?.text).toEqual([{ text: "Import error E1" }]);
  });
});
