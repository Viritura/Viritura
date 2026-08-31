import { describe, it, expect } from "vitest";
import type { Score } from "../model/score";
import type { Part } from "../model/part";
import { applyPatchesToScore, patch, patchAffectedMeasures, PatchTargetMissing } from "../patches";

function makeScore(): Score {
  const part: Part = {
    id: "p1",
    name: "Piano",
    measures: [
      {
        sequences: [
          {
            content: [
              {
                type: "event",
                id: "e1",
                duration: { base: "whole" },
                notes: [{ id: "n1", pitch: { step: "C", octave: 4 } }],
              },
            ],
          },
        ],
      },
    ],
  };
  return {
    mnx: { version: 1 },
    global: { measures: [{ id: "m1", time: { count: 4, unit: 4 } }] },
    parts: [part],
  };
}

describe("structural patches — global measures", () => {
  it("setGlobalMeasureField sets and clears meter", () => {
    const score = makeScore();
    const set = applyPatchesToScore(score, [
      patch.setGlobalMeasureField(0, { field: "time", value: { count: 3, unit: 4 } }),
    ]);
    expect(set.global.measures[0]!.time).toEqual({ count: 3, unit: 4 });
    const cleared = applyPatchesToScore(set, [patch.setGlobalMeasureField(0, { field: "time", value: undefined })]);
    expect(cleared.global.measures[0]!.time).toBeUndefined();
  });

  it("setGlobalMeasureField writes tempos", () => {
    const score = makeScore();
    const next = applyPatchesToScore(score, [
      patch.setGlobalMeasureField(0, { field: "tempos", value: [{ bpm: 96, value: { base: "quarter" } }] }),
    ]);
    expect(next.global.measures[0]!.tempos).toEqual([{ bpm: 96, value: { base: "quarter" } }]);
  });

  it("setGlobalMeasureField throws for a missing measure", () => {
    const score = makeScore();
    expect(() =>
      applyPatchesToScore(score, [patch.setGlobalMeasureField(9, { field: "time", value: { count: 2, unit: 4 } })]),
    ).toThrow(PatchTargetMissing);
  });
});

describe("structural patches — insert / remove measures", () => {
  it("insertMeasures keeps global and every part index-parallel", () => {
    const score = makeScore();
    const next = applyPatchesToScore(score, [patch.insertMeasures(1, [{ time: { count: 3, unit: 4 } }, {}])]);
    expect(next.global.measures).toHaveLength(3);
    expect(next.parts[0]!.measures).toHaveLength(3);
    // New measures are blank full-bar rests.
    const inserted = next.parts[0]!.measures[1]!;
    expect(inserted.sequences[0]).toEqual({
      content: [],
      fullMeasure: { visualDuration: { base: "whole" } },
    });
    // Existing bar-1 content untouched.
    expect(next.parts[0]!.measures[0]!.sequences[0]!.content[0]).toMatchObject({ id: "e1" });
  });

  it("insertMeasures can prepend at index 0", () => {
    const score = makeScore();
    const next = applyPatchesToScore(score, [patch.insertMeasures(0, [{ time: { count: 2, unit: 4 } }])]);
    expect(next.global.measures[0]!.time).toEqual({ count: 2, unit: 4 });
    expect(next.global.measures[1]!.id).toBe("m1");
  });

  it("removeMeasures drops from global and all parts", () => {
    const score = applyPatchesToScore(makeScore(), [patch.insertMeasures(1, [{}, {}])]);
    const next = applyPatchesToScore(score, [patch.removeMeasures(1, 1)]);
    expect(next.global.measures).toHaveLength(2);
    expect(next.parts[0]!.measures).toHaveLength(2);
  });

  it("removeMeasures throws for an out-of-range start", () => {
    expect(() => applyPatchesToScore(makeScore(), [patch.removeMeasures(5, 1)])).toThrow(PatchTargetMissing);
  });
});

describe("structural patches — part measures and sequences", () => {
  it("setPartMeasureField sets clefs", () => {
    const score = makeScore();
    const next = applyPatchesToScore(score, [
      patch.setPartMeasureField(
        { partId: "p1", measureIndex: 0 },
        { field: "clefs", value: [{ clef: { sign: "G", staffPosition: -2 }, position: { fraction: [0, 4] } }] },
      ),
    ]);
    expect(next.parts[0]!.measures[0]!.clefs).toHaveLength(1);
  });

  it("setSequenceContent replaces a voice wholesale (empty-measure bootstrap)", () => {
    // Insert a blank measure, then fill voice 0 without any anchor event.
    const inserted = applyPatchesToScore(makeScore(), [patch.insertMeasures(1, [{}])]);
    const next = applyPatchesToScore(inserted, [
      patch.setSequenceContent({ partId: "p1", measureIndex: 1, voice: 0 }, [
        {
          type: "event",
          id: "x1",
          duration: { base: "half" },
          notes: [{ id: "xn1", pitch: { step: "G", octave: 4 } }],
        },
      ]),
    ]);
    const content = next.parts[0]!.measures[1]!.sequences[0]!.content;
    expect(content).toHaveLength(1);
    expect(content[0]).toMatchObject({ id: "x1" });
  });

  it("setSequenceContent creates intervening voices up to the target index", () => {
    const next = applyPatchesToScore(makeScore(), [
      patch.setSequenceContent({ partId: "p1", measureIndex: 0, voice: 2 }, [
        { type: "event", id: "v2", duration: { base: "whole" }, rest: {} },
      ]),
    ]);
    const seqs = next.parts[0]!.measures[0]!.sequences;
    expect(seqs).toHaveLength(3);
    expect(seqs[2]!.content[0]).toMatchObject({ id: "v2" });
  });
});

describe("structural patches — parts and score-level", () => {
  it("addPart normalizes measures to the global length", () => {
    const score = applyPatchesToScore(makeScore(), [patch.insertMeasures(1, [{}, {}])]); // 3 global measures
    const next = applyPatchesToScore(score, [patch.addPart({ id: "p2", name: "Cello", measures: [] })]);
    expect(next.parts).toHaveLength(2);
    expect(next.parts[1]!.measures).toHaveLength(3);
  });

  it("addPart rejects a duplicate part id", () => {
    expect(() => applyPatchesToScore(makeScore(), [patch.addPart({ id: "p1", name: "Dup", measures: [] })])).toThrow(
      PatchTargetMissing,
    );
  });

  it("removePart drops a part by id", () => {
    const score = applyPatchesToScore(makeScore(), [patch.addPart({ id: "p2", name: "Cello", measures: [] })]);
    const next = applyPatchesToScore(score, [patch.removePart("p1")]);
    expect(next.parts.map((p) => p.id)).toEqual(["p2"]);
  });

  it("setPartField updates name and clears optional fields", () => {
    const score = makeScore();
    const named = applyPatchesToScore(score, [patch.setPartField("p1", { field: "name", value: "Harpsichord" })]);
    expect(named.parts[0]!.name).toBe("Harpsichord");
    const staved = applyPatchesToScore(named, [patch.setPartField("p1", { field: "staves", value: 2 })]);
    expect(staved.parts[0]!.staves).toBe(2);
    const cleared = applyPatchesToScore(staved, [patch.setPartField("p1", { field: "staves", value: undefined })]);
    expect(cleared.parts[0]!.staves).toBeUndefined();
  });

  it("setScoreMetadata replaces and clears the block", () => {
    const score = makeScore();
    const withMeta = applyPatchesToScore(score, [patch.setScoreMetadata({ title: "Cue 1", composer: "Me" })]);
    expect(withMeta.metadata).toEqual({ title: "Cue 1", composer: "Me" });
    const cleared = applyPatchesToScore(withMeta, [patch.setScoreMetadata(undefined)]);
    expect(cleared.metadata).toBeUndefined();
  });

  it("setScoreExtension writes and clears videoSync", () => {
    const score = makeScore();
    const withSync = applyPatchesToScore(score, [
      patch.setScoreExtension({
        field: "videoSync",
        value: { version: 1, pictureOffsetSeconds: 0, pictureAudioEnabled: true },
      }),
    ]);
    expect(withSync.videoSync?.pictureOffsetSeconds).toBe(0);
    const cleared = applyPatchesToScore(withSync, [patch.setScoreExtension({ field: "videoSync", value: undefined })]);
    expect(cleared.videoSync).toBeUndefined();
  });
});

describe("patchAffectedMeasures for structural patches", () => {
  it("returns the measure index for a global-measure field edit", () => {
    expect(patchAffectedMeasures([patch.setGlobalMeasureField(3, { field: "time", value: undefined })])).toEqual({
      start: 3,
      end: 3,
    });
  });

  it("returns null when a structural insert/remove is present (force full repair)", () => {
    expect(patchAffectedMeasures([patch.insertMeasures(0, [{}])])).toBeNull();
    expect(patchAffectedMeasures([patch.removeMeasures(0, 1)])).toBeNull();
    expect(patchAffectedMeasures([patch.addPart({ id: "z", name: "Z", measures: [] })])).toBeNull();
  });
});
