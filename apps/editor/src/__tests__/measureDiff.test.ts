import { describe, it, expect } from "vitest";
import { computeMeasureDiff } from "../diff/measureDiff";

// Slurs example — two measures, one part
const slursOriginal = {
  mnx: { version: 1 },
  global: {
    measures: [{ time: { count: 4, unit: 4 } }, {}],
  },
  parts: [
    {
      measures: [
        {
          clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
          sequences: [
            {
              content: [
                {
                  id: "ev1",
                  duration: { base: "quarter" },
                  notes: [{ pitch: { step: "C", octave: 5 } }],
                  slurs: [{ side: "up", target: "ev4" }],
                },
                {
                  id: "ev2",
                  duration: { base: "quarter" },
                  notes: [{ pitch: { step: "D", octave: 5 } }],
                },
                {
                  id: "ev3",
                  duration: { base: "quarter" },
                  notes: [{ pitch: { step: "E", octave: 5 } }],
                },
                {
                  id: "ev4",
                  duration: { base: "quarter" },
                  notes: [{ pitch: { step: "C", octave: 5 } }],
                },
              ],
            },
          ],
        },
        {
          sequences: [
            {
              content: [
                {
                  id: "ev5",
                  duration: { base: "quarter" },
                  notes: [{ pitch: { step: "G", octave: 4 } }],
                  slurs: [{ side: "down", target: "ev8" }],
                },
                {
                  id: "ev6",
                  duration: { base: "quarter" },
                  notes: [{ pitch: { step: "A", octave: 4 } }],
                },
                {
                  id: "ev7",
                  duration: { base: "quarter" },
                  notes: [{ pitch: { step: "G", octave: 4 } }],
                },
                {
                  id: "ev8",
                  duration: { base: "quarter" },
                  notes: [{ pitch: { step: "E", octave: 4 } }],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

// Modified: last note in measure 1 changed from E4 → C5
const slursModified = JSON.parse(JSON.stringify(slursOriginal));
slursModified.parts[0].measures[1].sequences[0].content[3].notes[0].pitch = {
  step: "C",
  octave: 5,
};

describe("computeMeasureDiff", () => {
  it("detects unchanged measures", () => {
    const result = computeMeasureDiff(slursOriginal, slursOriginal);
    expect(result.measures.get("p0/m0")).toBe("unchanged");
    expect(result.measures.get("p0/m1")).toBe("unchanged");
    expect(result.globalMeasures.get("global/m0")).toBe("unchanged");
    expect(result.globalMeasures.get("global/m1")).toBe("unchanged");
    expect(result.parts.get("p0")).toBe("unchanged");
  });

  it("detects modified measure when note changes", () => {
    const result = computeMeasureDiff(slursOriginal, slursModified);
    expect(result.measures.get("p0/m0")).toBe("unchanged");
    expect(result.measures.get("p0/m1")).toBe("modified");
    expect(result.parts.get("p0")).toBe("modified");
    expect(result.globalMeasures.get("global/m0")).toBe("unchanged");
    expect(result.globalMeasures.get("global/m1")).toBe("unchanged");
  });

  it("detects added measures at the end", () => {
    const modified = JSON.parse(JSON.stringify(slursOriginal));
    modified.parts[0].measures.push({
      sequences: [
        {
          content: [
            {
              id: "ev9",
              duration: { base: "whole" },
              notes: [{ pitch: { step: "C", octave: 5 } }],
            },
          ],
        },
      ],
    });
    modified.global.measures.push({});

    const result = computeMeasureDiff(slursOriginal, modified);
    expect(result.measures.get("p0/m0")).toBe("unchanged");
    expect(result.measures.get("p0/m1")).toBe("unchanged");
    expect(result.measures.get("p0/m2")).toBe("added");
    expect(result.globalMeasures.get("global/m2")).toBe("added");
  });

  it("detects removed measures", () => {
    const original = JSON.parse(JSON.stringify(slursOriginal));
    original.parts[0].measures.push({
      sequences: [
        {
          content: [
            {
              id: "ev9",
              duration: { base: "whole" },
              notes: [{ pitch: { step: "C", octave: 5 } }],
            },
          ],
        },
      ],
    });
    original.global.measures.push({});

    const result = computeMeasureDiff(original, slursOriginal);
    expect(result.measures.get("p0/m2")).toBe("removed");
    expect(result.globalMeasures.get("global/m2")).toBe("removed");
  });

  it("detects added parts", () => {
    const modified = JSON.parse(JSON.stringify(slursOriginal));
    modified.parts.push({
      name: "Flute",
      measures: [{ sequences: [{ content: [] }] }, { sequences: [{ content: [] }] }],
    });

    const result = computeMeasureDiff(slursOriginal, modified);
    expect(result.parts.get("p0")).toBe("unchanged");
    expect(result.parts.get("p1")).toBe("added");
    expect(result.measures.get("p1/m0")).toBe("added");
    expect(result.measures.get("p1/m1")).toBe("added");
  });

  it("detects removed parts", () => {
    const original = JSON.parse(JSON.stringify(slursOriginal));
    original.parts.push({
      name: "Flute",
      measures: [{ sequences: [{ content: [] }] }, { sequences: [{ content: [] }] }],
    });

    const result = computeMeasureDiff(original, slursOriginal);
    expect(result.parts.get("p0")).toBe("unchanged");
    expect(result.parts.get("p1")).toBe("removed");
    expect(result.measures.get("p1/m0")).toBe("removed");
    expect(result.measures.get("p1/m1")).toBe("removed");
  });

  it("detects global measure changes (time signature)", () => {
    const modified = JSON.parse(JSON.stringify(slursOriginal));
    modified.global.measures[0].time = { count: 3, unit: 4 };

    const result = computeMeasureDiff(slursOriginal, modified);
    // Time signature change makes global measure 0 content different,
    // so LCS won't match it — it shows as deleted+added or modified depending on alignment
    const g0 = result.globalMeasures.get("global/m0");
    // The measure content changed, so it won't be "unchanged"
    expect(g0).not.toBe("unchanged");
  });

  it("handles empty documents", () => {
    const empty = { mnx: { version: 1 }, global: { measures: [] }, parts: [] };
    const result = computeMeasureDiff(empty, empty);
    expect(result.measures.size).toBe(0);
    expect(result.globalMeasures.size).toBe(0);
    expect(result.parts.size).toBe(0);
  });

  it("handles documents with missing optional fields", () => {
    const minimal = { mnx: { version: 1 } };
    const result = computeMeasureDiff(minimal, minimal);
    expect(result.measures.size).toBe(0);
    expect(result.globalMeasures.size).toBe(0);
    expect(result.parts.size).toBe(0);
  });

  it("is not sensitive to object key order", () => {
    const a = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 }, key: { fifths: 0 } }] },
      parts: [
        {
          measures: [
            {
              sequences: [{ content: [] }],
              clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
            },
          ],
        },
      ],
    };
    const b = {
      mnx: { version: 1 },
      global: { measures: [{ key: { fifths: 0 }, time: { unit: 4, count: 4 } }] },
      parts: [
        {
          measures: [
            {
              clefs: [{ clef: { staffPosition: -2, sign: "G" } }],
              sequences: [{ content: [] }],
            },
          ],
        },
      ],
    };

    const result = computeMeasureDiff(a, b);
    expect(result.measures.get("p0/m0")).toBe("unchanged");
    expect(result.globalMeasures.get("global/m0")).toBe("unchanged");
  });

  it("detects multiple parts with mixed changes", () => {
    const original = {
      mnx: { version: 1 },
      global: { measures: [{}, {}] },
      parts: [
        {
          measures: [
            { sequences: [{ content: [{ id: "a", notes: [{ pitch: { step: "C", octave: 4 } }] }] }] },
            { sequences: [{ content: [{ id: "b", notes: [{ pitch: { step: "D", octave: 4 } }] }] }] },
          ],
        },
        {
          measures: [
            { sequences: [{ content: [{ id: "c", notes: [{ pitch: { step: "E", octave: 4 } }] }] }] },
            { sequences: [{ content: [{ id: "d", notes: [{ pitch: { step: "F", octave: 4 } }] }] }] },
          ],
        },
      ],
    };

    const modified = JSON.parse(JSON.stringify(original));
    modified.parts[0].measures[1].sequences[0].content[0].notes[0].pitch.step = "G";

    modified.parts[1].measures[0].sequences[0].content[0].notes[0].pitch.step = "A";

    const result = computeMeasureDiff(original, modified);
    expect(result.measures.get("p0/m0")).toBe("unchanged");
    expect(result.parts.get("p0")).toBe("modified");
    expect(result.parts.get("p1")).toBe("modified");
  });

  // === LCS-specific tests (diff.10) ===

  it("handles measure insertion in the middle — shifted measures stay unchanged", () => {
    const mA = { sequences: [{ content: [{ id: "a" }] }] };
    const mB = { sequences: [{ content: [{ id: "b" }] }] };
    const mC = { sequences: [{ content: [{ id: "c" }] }] };
    const mNew = { sequences: [{ content: [{ id: "new" }] }] };

    const original = {
      mnx: { version: 1 },
      global: { measures: [{}, {}, {}] },
      parts: [{ measures: [mA, mB, mC] }],
    };
    const modified = {
      mnx: { version: 1 },
      global: { measures: [{}, {}, {}, {}] },
      parts: [{ measures: [mA, mB, mNew, mC] }],
    };

    const result = computeMeasureDiff(original, modified);

    // With LCS alignment: A matches, B matches, mNew is inserted, C matches
    // So only the new measure should be "added", others "unchanged"
    const statuses: MeasureDiffStatus[] = [];
    for (let i = 0; i < 4; i++) {
      statuses.push(result.measures.get(`p0/m${i}`)!);
    }

    const addedCount = statuses.filter((s) => s === "added").length;
    const unchangedCount = statuses.filter((s) => s === "unchanged").length;

    expect(addedCount).toBe(1);
    expect(unchangedCount).toBe(3);
  });

  it("handles measure deletion in the middle — remaining measures stay unchanged", () => {
    const mA = { sequences: [{ content: [{ id: "a" }] }] };
    const mB = { sequences: [{ content: [{ id: "b" }] }] };
    const mC = { sequences: [{ content: [{ id: "c" }] }] };

    const original = {
      mnx: { version: 1 },
      global: { measures: [{}, {}, {}] },
      parts: [{ measures: [mA, mB, mC] }],
    };
    const modified = {
      mnx: { version: 1 },
      global: { measures: [{}, {}] },
      parts: [{ measures: [mA, mC] }],
    };

    const result = computeMeasureDiff(original, modified);

    // With LCS: A matches, B is deleted, C matches
    const statuses: MeasureDiffStatus[] = [];
    for (const [, status] of result.measures) {
      statuses.push(status);
    }

    const removedCount = statuses.filter((s) => s === "removed").length;
    const unchangedCount = statuses.filter((s) => s === "unchanged").length;

    expect(removedCount).toBe(1);
    expect(unchangedCount).toBe(2);
  });

  it("handles simultaneous insertion and modification", () => {
    const mA = { sequences: [{ content: [{ id: "a" }] }] };
    const mB = { sequences: [{ content: [{ id: "b" }] }] };
    const mBmod = { sequences: [{ content: [{ id: "b", extra: true }] }] };
    const mNew = { sequences: [{ content: [{ id: "new" }] }] };

    const original = {
      mnx: { version: 1 },
      global: { measures: [{}, {}] },
      parts: [{ measures: [mA, mB] }],
    };
    const modified = {
      mnx: { version: 1 },
      global: { measures: [{}, {}, {}] },
      parts: [{ measures: [mA, mNew, mBmod] }],
    };

    const result = computeMeasureDiff(original, modified);

    // A is unchanged, mNew is inserted, mB→mBmod doesn't match in LCS since hashes differ
    const statuses: MeasureDiffStatus[] = [];
    for (let i = 0; ; i++) {
      const s = result.measures.get(`p0/m${i}`);
      if (s === undefined) break;
      statuses.push(s);
    }

    // mA should be unchanged
    expect(statuses[0]).toBe("unchanged");
    // At least one added and the modified mB should show as deleted+added or modified
    expect(statuses.some((s) => s === "added")).toBe(true);
  });

  it("provides alignment info for parts", () => {
    const mA = { sequences: [{ content: [{ id: "a" }] }] };
    const mB = { sequences: [{ content: [{ id: "b" }] }] };
    const mNew = { sequences: [{ content: [{ id: "new" }] }] };

    const original = {
      mnx: { version: 1 },
      global: { measures: [{}, {}] },
      parts: [{ measures: [mA, mB] }],
    };
    const modified = {
      mnx: { version: 1 },
      global: { measures: [{}, {}, {}] },
      parts: [{ measures: [mA, mNew, mB] }],
    };

    const result = computeMeasureDiff(original, modified);
    const alignment = result.alignments.get(0);
    expect(alignment).toBeDefined();
    expect(alignment!.length).toBe(3);

    // Check that matched entries have both indices
    const matched = alignment!.filter((a) => a.status === "unchanged");
    expect(matched.length).toBe(2);
    for (const m of matched) {
      expect(m.originalIndex).toBeDefined();
      expect(m.modifiedIndex).toBeDefined();
    }
  });

  it("handles large-scale insertion without false positives", () => {
    // 10 identical measures, insert 1 at position 5
    const makeMeasure = (id: string) => ({ sequences: [{ content: [{ id }] }] });
    const origMeasures = Array.from({ length: 10 }, (_, i) => makeMeasure(`m${i}`));
    const modMeasures = [...origMeasures.slice(0, 5), makeMeasure("inserted"), ...origMeasures.slice(5)];

    const original = {
      mnx: { version: 1 },
      global: { measures: origMeasures.map(() => ({})) },
      parts: [{ measures: origMeasures }],
    };
    const modified = {
      mnx: { version: 1 },
      global: { measures: modMeasures.map(() => ({})) },
      parts: [{ measures: modMeasures }],
    };

    const result = computeMeasureDiff(original, modified);

    // Count statuses
    let addedCount = 0;
    let unchangedCount = 0;
    let modifiedCount = 0;
    for (const [key, status] of result.measures) {
      if (!key.startsWith("p0/")) continue;
      if (status === "added") addedCount++;
      if (status === "unchanged") unchangedCount++;
      if (status === "modified") modifiedCount++;
    }

    // Only 1 measure should be added, 10 should be unchanged, 0 modified
    expect(addedCount).toBe(1);
    expect(unchangedCount).toBe(10);
    expect(modifiedCount).toBe(0);
  });
});

// Re-export the type for use in test assertions
type MeasureDiffStatus = "unchanged" | "modified" | "added" | "removed";
