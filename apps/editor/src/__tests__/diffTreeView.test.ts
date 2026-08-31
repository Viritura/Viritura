import { describe, it, expect } from "vitest";
import { semanticDiff, collectLeaves, countChanges } from "../diff/semanticDiff";
import type { DiffNode } from "../diff/semanticDiff";

// ─── Helpers ─────────────────────────────────────────────────────

function makeMnx(parts: unknown[], globalMeasures: unknown[] = [{}]) {
  return {
    mnx: { version: 1 },
    global: { measures: globalMeasures },
    parts,
  };
}

function makePart(name: string, measures: unknown[]) {
  return { name, measures };
}

function makeMeasure(notes: Array<{ step: string; octave: number }>) {
  return {
    sequences: [
      {
        content: notes.map((n) => ({
          duration: { base: "quarter" },
          notes: [{ pitch: { step: n.step, octave: n.octave } }],
        })),
      },
    ],
  };
}

// ─── Tests ───────────────────────────────────────────────────────

describe("semanticDiff", () => {
  it("returns unchanged for identical documents", () => {
    const doc = makeMnx([makePart("Piano", [makeMeasure([{ step: "C", octave: 4 }])])]);
    const result = semanticDiff(doc, JSON.parse(JSON.stringify(doc)));
    expect(result.type).toBe("unchanged");
    expect(result.summary).toBe("No changes");
  });

  it("detects a single pitch change", () => {
    const original = makeMnx([
      makePart("Piano", [
        makeMeasure([
          { step: "C", octave: 4 },
          { step: "E", octave: 4 },
        ]),
      ]),
    ]);
    const modified = makeMnx([
      makePart("Piano", [
        makeMeasure([
          { step: "C", octave: 4 },
          { step: "C", octave: 5 },
        ]),
      ]),
    ]);

    const result = semanticDiff(original, modified);
    expect(result.type).toBe("modified");

    const leaves = collectLeaves(result);
    expect(leaves.length).toBeGreaterThanOrEqual(1);
    const pitchLeaf = leaves.find((l) => l.summary.includes("Pitch"));
    expect(pitchLeaf).toBeDefined();
    expect(pitchLeaf!.summary).toContain("E4");
    expect(pitchLeaf!.summary).toContain("C5");
  });

  it("detects an added measure", () => {
    const original = makeMnx([makePart("Piano", [makeMeasure([{ step: "C", octave: 4 }])])], [{}]);
    const modified = makeMnx(
      [makePart("Piano", [makeMeasure([{ step: "C", octave: 4 }]), makeMeasure([{ step: "D", octave: 4 }])])],
      [{}, {}],
    );

    const result = semanticDiff(original, modified);
    expect(result.type).toBe("modified");

    const leaves = collectLeaves(result);
    const addedLeaf = leaves.find((l) => l.type === "added");
    expect(addedLeaf).toBeDefined();
  });

  it("detects a removed measure", () => {
    const original = makeMnx(
      [makePart("Piano", [makeMeasure([{ step: "C", octave: 4 }]), makeMeasure([{ step: "D", octave: 4 }])])],
      [{}, {}],
    );
    const modified = makeMnx([makePart("Piano", [makeMeasure([{ step: "C", octave: 4 }])])], [{}]);

    const result = semanticDiff(original, modified);
    const leaves = collectLeaves(result);
    const removedLeaf = leaves.find((l) => l.type === "removed");
    expect(removedLeaf).toBeDefined();
  });

  it("detects time signature change in global measures", () => {
    const original = makeMnx(
      [makePart("Piano", [makeMeasure([{ step: "C", octave: 4 }])])],
      [{ time: { count: 4, unit: 4 } }],
    );
    const modified = makeMnx(
      [makePart("Piano", [makeMeasure([{ step: "C", octave: 4 }])])],
      [{ time: { count: 3, unit: 4 } }],
    );

    const result = semanticDiff(original, modified);
    const leaves = collectLeaves(result);
    const timeSigLeaf = leaves.find((l) => l.summary.includes("Time signature"));
    expect(timeSigLeaf).toBeDefined();
    expect(timeSigLeaf!.summary).toContain("4/4");
    expect(timeSigLeaf!.summary).toContain("3/4");
  });

  it("handles multiple parts with one changed", () => {
    const original = makeMnx([
      makePart("Violin", [makeMeasure([{ step: "A", octave: 4 }])]),
      makePart("Cello", [makeMeasure([{ step: "C", octave: 3 }])]),
    ]);
    const modified = makeMnx([
      makePart("Violin", [makeMeasure([{ step: "A", octave: 4 }])]),
      makePart("Cello", [makeMeasure([{ step: "G", octave: 3 }])]),
    ]);

    const result = semanticDiff(original, modified);
    const leaves = collectLeaves(result);
    // Only the Cello note should have changed
    expect(leaves.length).toBeGreaterThanOrEqual(1);
    const celleLeaf = leaves.find((l) => l.summary.includes("C3") && l.summary.includes("G3"));
    expect(celleLeaf).toBeDefined();
  });
});

describe("collectLeaves", () => {
  it("returns empty array for unchanged root", () => {
    const node: DiffNode = {
      path: "",
      label: "Score",
      type: "unchanged",
      summary: "No changes",
    };
    expect(collectLeaves(node)).toEqual([]);
  });

  it("returns leaf nodes only", () => {
    const node: DiffNode = {
      path: "",
      label: "Score",
      type: "modified",
      summary: "2 sections changed",
      children: [
        {
          path: "parts[0]",
          label: "Piano",
          type: "modified",
          summary: "1 measure changed",
          children: [
            {
              path: "parts[0].measures[0]",
              label: "Piano → Measure 1",
              type: "modified",
              summary: "Pitch E4 → C5",
              beforeJson: "{}",
              afterJson: "{}",
            },
          ],
        },
        {
          path: "global",
          label: "Global",
          type: "modified",
          summary: "Time sig changed",
          beforeJson: "{}",
          afterJson: "{}",
        },
      ],
    };

    const leaves = collectLeaves(node);
    expect(leaves).toHaveLength(2);
    expect(leaves[0]!.path).toBe("parts[0].measures[0]");
    expect(leaves[1]!.path).toBe("global");
  });
});

describe("countChanges", () => {
  it("counts change types correctly", () => {
    const node: DiffNode = {
      path: "",
      label: "Score",
      type: "modified",
      summary: "changes",
      children: [
        { path: "a", label: "A", type: "modified", summary: "mod" },
        { path: "b", label: "B", type: "added", summary: "add" },
        { path: "c", label: "C", type: "removed", summary: "rem" },
        { path: "d", label: "D", type: "added", summary: "add2" },
      ],
    };

    const counts = countChanges(node);
    expect(counts.modified).toBe(1);
    expect(counts.added).toBe(2);
    expect(counts.removed).toBe(1);
    expect(counts.unchanged).toBe(0);
  });
});

describe("DiffNode structure for DiffTreeView", () => {
  it("provides beforeJson/afterJson on modified leaf nodes", () => {
    const original = makeMnx([
      makePart("Piano", [
        makeMeasure([
          { step: "C", octave: 4 },
          { step: "E", octave: 4 },
        ]),
      ]),
    ]);
    const modified = makeMnx([
      makePart("Piano", [
        makeMeasure([
          { step: "C", octave: 4 },
          { step: "G", octave: 4 },
        ]),
      ]),
    ]);

    const result = semanticDiff(original, modified);
    const leaves = collectLeaves(result);
    const modLeaf = leaves.find((l) => l.type === "modified");
    expect(modLeaf).toBeDefined();
    expect(modLeaf!.beforeJson).toBeDefined();
    expect(modLeaf!.afterJson).toBeDefined();
    // JSON snippets should be valid JSON
    expect(() => JSON.parse(modLeaf!.beforeJson!)).not.toThrow();
    expect(() => JSON.parse(modLeaf!.afterJson!)).not.toThrow();
  });

  it("provides afterJson on added leaf nodes", () => {
    const original = makeMnx([makePart("Piano", [makeMeasure([{ step: "C", octave: 4 }])])], [{}]);
    const modified = makeMnx(
      [makePart("Piano", [makeMeasure([{ step: "C", octave: 4 }]), makeMeasure([{ step: "D", octave: 4 }])])],
      [{}, {}],
    );

    const result = semanticDiff(original, modified);
    const leaves = collectLeaves(result);
    const addedLeaf = leaves.find((l) => l.type === "added");
    expect(addedLeaf).toBeDefined();
    expect(addedLeaf!.afterJson).toBeDefined();
  });

  it("provides beforeJson on removed leaf nodes", () => {
    const original = makeMnx(
      [makePart("Piano", [makeMeasure([{ step: "C", octave: 4 }]), makeMeasure([{ step: "D", octave: 4 }])])],
      [{}, {}],
    );
    const modified = makeMnx([makePart("Piano", [makeMeasure([{ step: "C", octave: 4 }])])], [{}]);

    const result = semanticDiff(original, modified);
    const leaves = collectLeaves(result);
    const removedLeaf = leaves.find((l) => l.type === "removed");
    expect(removedLeaf).toBeDefined();
    expect(removedLeaf!.beforeJson).toBeDefined();
  });

  it("tree scales to orchestral scores — only changed items appear", () => {
    // 20 parts × 10 measures, but only 1 note changed in part 5, measure 3
    const parts = Array.from({ length: 20 }, (_, i) =>
      makePart(
        `Part ${i + 1}`,
        Array.from({ length: 10 }, (_, m) => makeMeasure([{ step: "C", octave: 3 + (m % 3) }])),
      ),
    );
    const original = makeMnx(
      parts,
      Array.from({ length: 10 }, () => ({})),
    );

    const modParts = JSON.parse(JSON.stringify(parts)) as typeof parts;
    // Change part 5, measure 3, first note
    const seq = (
      modParts[5] as {
        measures: Array<{
          sequences: Array<{ content: Array<{ notes: Array<{ pitch: { step: string; octave: number } }> }> }>;
        }>;
      }
    ).measures[3]!.sequences[0]!;
    seq.content[0]!.notes[0]!.pitch.step = "G";
    seq.content[0]!.notes[0]!.pitch.octave = 5;
    const modified = makeMnx(
      modParts,
      Array.from({ length: 10 }, () => ({})),
    );

    const result = semanticDiff(original, modified);
    const leaves = collectLeaves(result);
    // Should have a small number of changes — not 200 (one per measure per part)
    expect(leaves.length).toBeLessThanOrEqual(5);
    expect(leaves.length).toBeGreaterThanOrEqual(1);
    // The pitch change should appear in the leaves
    const pitchLeaf = leaves.find((l) => l.summary.includes("G5"));
    expect(pitchLeaf).toBeDefined();
  });
});
