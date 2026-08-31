import { describe, expect, it } from "vitest";
import { semanticDiff, collectLeaves, countChanges, lcsAlign, lcsAlignWithModifications } from "../diff/semanticDiff";

// ─── Helpers ────────────────────────────────────────────────────

function makeSlursOriginal() {
  return {
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
}

function makeSlursModified() {
  const doc = makeSlursOriginal();
  // Change last note of measure 2 (ev8): E4 → C5
  const lastMeasure = doc.parts[0]!.measures[1]!;
  const lastSeq = lastMeasure.sequences![0]!;
  const lastEvent = lastSeq.content[3]!;
  lastEvent.notes![0]!.pitch = { step: "C", octave: 5 };
  return doc;
}

// ─── Tests ──────────────────────────────────────────────────────

describe("semanticDiff", () => {
  it("returns unchanged for identical documents", () => {
    const doc = makeSlursOriginal();
    const result = semanticDiff(doc, JSON.parse(JSON.stringify(doc)));
    expect(result.type).toBe("unchanged");
    expect(result.summary).toBe("No changes");
  });

  it("detects pitch change in slurs example (E4 → C5)", () => {
    const original = makeSlursOriginal();
    const modified = makeSlursModified();
    const result = semanticDiff(original, modified);

    expect(result.type).toBe("modified");

    // Should have exactly one leaf change
    const leaves = collectLeaves(result);
    expect(leaves.length).toBe(1);

    const leaf = leaves[0]!;
    expect(leaf.type).toBe("modified");
    expect(leaf.summary).toContain("Pitch E4 → C5");
    expect(leaf.label).toContain("Event 4");
    expect(leaf.label).toContain("Measure 2");
  });

  it("detects time signature change", () => {
    const original = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [{ measures: [{ sequences: [{ content: [] }] }] }],
    };
    const modified = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 3, unit: 4 } }] },
      parts: [{ measures: [{ sequences: [{ content: [] }] }] }],
    };

    const result = semanticDiff(original, modified);
    const leaves = collectLeaves(result);

    expect(leaves.length).toBe(1);
    expect(leaves[0]!.summary).toContain("Time signature: 4/4 → 3/4");
  });

  it("detects key signature change", () => {
    const original = {
      mnx: { version: 1 },
      global: { measures: [{ key: { fifths: 0 } }] },
      parts: [{ measures: [{ sequences: [{ content: [] }] }] }],
    };
    const modified = {
      mnx: { version: 1 },
      global: { measures: [{ key: { fifths: 1 } }] },
      parts: [{ measures: [{ sequences: [{ content: [] }] }] }],
    };

    const result = semanticDiff(original, modified);
    const leaves = collectLeaves(result);

    expect(leaves.length).toBe(1);
    expect(leaves[0]!.summary).toContain("Key signature: C major → G major");
  });

  it("detects added measure (only new measure shows as added)", () => {
    const original = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }, {}] },
      parts: [
        {
          name: "Piano",
          measures: [
            {
              sequences: [
                {
                  content: [{ id: "e1", duration: { base: "whole" }, rest: {} }],
                },
              ],
            },
            {
              sequences: [
                {
                  content: [{ id: "e2", duration: { base: "whole" }, rest: {} }],
                },
              ],
            },
          ],
        },
      ],
    };
    const modified = {
      mnx: { version: 1 },
      global: {
        measures: [{ time: { count: 4, unit: 4 } }, {}, {}],
      },
      parts: [
        {
          name: "Piano",
          measures: [
            {
              sequences: [
                {
                  content: [{ id: "e1", duration: { base: "whole" }, rest: {} }],
                },
              ],
            },
            {
              sequences: [
                {
                  content: [{ id: "e2", duration: { base: "whole" }, rest: {} }],
                },
              ],
            },
            {
              sequences: [
                {
                  content: [{ id: "e3", duration: { base: "whole" }, rest: {} }],
                },
              ],
            },
          ],
        },
      ],
    };

    const result = semanticDiff(original, modified);
    const leaves = collectLeaves(result);

    // Global measure added + part measure added
    const addedLeaves = leaves.filter((l) => l.type === "added");
    expect(addedLeaves.length).toBeGreaterThanOrEqual(1);
    expect(addedLeaves.some((l) => l.summary.includes("added"))).toBe(true);

    // Existing measures should NOT show as modified
    const modifiedLeaves = leaves.filter((l) => l.type === "modified");
    const modMeasures = modifiedLeaves.filter((l) => l.label.includes("Measure"));
    expect(modMeasures.length).toBe(0);
  });

  it("detects removed measure", () => {
    const original = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }, {}, {}] },
      parts: [
        {
          measures: [
            {
              sequences: [{ content: [{ duration: { base: "whole" }, rest: {} }] }],
            },
            {
              sequences: [{ content: [{ duration: { base: "whole" }, rest: {} }] }],
            },
            {
              sequences: [{ content: [{ duration: { base: "whole" }, rest: {} }] }],
            },
          ],
        },
      ],
    };
    const modified = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }, {}] },
      parts: [
        {
          measures: [
            {
              sequences: [{ content: [{ duration: { base: "whole" }, rest: {} }] }],
            },
            {
              sequences: [{ content: [{ duration: { base: "whole" }, rest: {} }] }],
            },
          ],
        },
      ],
    };

    const result = semanticDiff(original, modified);
    const leaves = collectLeaves(result);
    const removedLeaves = leaves.filter((l) => l.type === "removed");
    expect(removedLeaves.length).toBeGreaterThanOrEqual(1);
    expect(removedLeaves.some((l) => l.summary.includes("removed"))).toBe(true);
  });

  it("detects added part", () => {
    const original = {
      mnx: { version: 1 },
      global: { measures: [{}] },
      parts: [{ name: "Violin", measures: [{ sequences: [{ content: [] }] }] }],
    };
    const modified = {
      mnx: { version: 1 },
      global: { measures: [{}] },
      parts: [
        { name: "Violin", measures: [{ sequences: [{ content: [] }] }] },
        { name: "Cello", measures: [{ sequences: [{ content: [] }] }] },
      ],
    };

    const result = semanticDiff(original, modified);
    const leaves = collectLeaves(result);

    expect(leaves.some((l) => l.type === "added" && l.summary.includes("Cello"))).toBe(true);
  });

  it("detects duration change", () => {
    const original = {
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
                      duration: { base: "quarter" },
                      notes: [{ pitch: { step: "C", octave: 4 } }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const modified = {
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
                      duration: { base: "half" },
                      notes: [{ pitch: { step: "C", octave: 4 } }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const result = semanticDiff(original, modified);
    const leaves = collectLeaves(result);

    expect(leaves.length).toBe(1);
    expect(leaves[0]!.summary).toContain("Duration quarter → half");
  });

  it("detects dynamics change in a measure", () => {
    const original = {
      mnx: { version: 1 },
      global: { measures: [{}] },
      parts: [
        {
          measures: [{ sequences: [{ content: [] }] }],
        },
      ],
    };
    const modified = {
      mnx: { version: 1 },
      global: { measures: [{}] },
      parts: [
        {
          measures: [
            {
              sequences: [{ content: [] }],
              dynamics: [{ position: { fraction: [0, 1] }, value: "ff" }],
            },
          ],
        },
      ],
    };

    const result = semanticDiff(original, modified);
    const leaves = collectLeaves(result);

    expect(leaves.length).toBeGreaterThanOrEqual(1);
    expect(leaves.some((l) => l.summary.includes("Dynamics changed"))).toBe(true);
  });

  it("detects repeat, ending, and navigation changes in global measures", () => {
    const original = {
      mnx: { version: 1 },
      global: {
        measures: [
          {
            repeatStart: {},
            repeatEnd: { times: 2 },
            ending: { duration: 1, numbers: [1] },
            segno: { location: { fraction: [0, 1] } },
            jump: { type: "dsalfine", location: { fraction: [1, 1] } },
          },
        ],
      },
      parts: [{ measures: [{ sequences: [{ content: [] }] }] }],
    };
    const modified = {
      mnx: { version: 1 },
      global: {
        measures: [
          {
            repeatStart: { times: 3 },
            repeatEnd: {},
            ending: { duration: 1, numbers: [2], open: true },
            segno: { location: { fraction: [1, 2] } },
            jump: { type: "dcalcoda", location: { fraction: [1, 1] } },
          },
        ],
      },
      parts: [{ measures: [{ sequences: [{ content: [] }] }] }],
    };

    const leaves = collectLeaves(semanticDiff(original, modified));
    expect(leaves).toHaveLength(1);
    expect(leaves[0]!.summary).toContain("Repeat markings changed");
    expect(leaves[0]!.summary).toContain("Ending changed");
    expect(leaves[0]!.summary).toContain("Navigation marks changed");
  });

  it("detects clef changes in part measures", () => {
    const original = {
      mnx: { version: 1 },
      global: { measures: [{}] },
      parts: [
        {
          measures: [
            {
              clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
              sequences: [{ content: [] }],
            },
          ],
        },
      ],
    };
    const modified = {
      mnx: { version: 1 },
      global: { measures: [{}] },
      parts: [
        {
          measures: [
            {
              clefs: [{ clef: { sign: "F", staffPosition: 2 } }],
              sequences: [{ content: [] }],
            },
          ],
        },
      ],
    };

    const leaves = collectLeaves(semanticDiff(original, modified));
    expect(leaves).toHaveLength(1);
    expect(leaves[0]!.summary).toContain("Clefs changed");
  });

  it("detects accidental display and tie changes on notes", () => {
    const original = {
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
                      id: "ev1",
                      duration: { base: "quarter" },
                      notes: [
                        {
                          id: "n1",
                          pitch: { step: "C", octave: 4 },
                          ties: [{ target: "n2" }],
                          accidentalDisplay: { show: true },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const modified = {
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
                      id: "ev1",
                      duration: { base: "quarter" },
                      notes: [
                        {
                          id: "n1",
                          pitch: { step: "C", octave: 4 },
                          ties: [{ target: "n3", side: "up" }],
                          accidentalDisplay: {
                            show: true,
                            force: true,
                            enclosure: { symbol: "parentheses" },
                          },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const leaves = collectLeaves(semanticDiff(original, modified));
    const noteLeaf = leaves.find((l) => l.summary.includes("Accidental display changed"));
    expect(noteLeaf).toBeDefined();
    expect(noteLeaf!.summary).toContain("Ties changed");
  });

  it("detects slur changes on events", () => {
    const original = {
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
                      id: "ev1",
                      duration: { base: "quarter" },
                      notes: [{ pitch: { step: "C", octave: 4 } }],
                      slurs: [{ target: "ev2" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const modified = {
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
                      id: "ev1",
                      duration: { base: "quarter" },
                      notes: [{ pitch: { step: "C", octave: 4 } }],
                      slurs: [{ target: "ev3", side: "down" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const leaves = collectLeaves(semanticDiff(original, modified));
    expect(leaves.some((l) => l.summary.includes("Slurs changed"))).toBe(true);
  });

  it("countChanges returns correct totals", () => {
    const original = makeSlursOriginal();
    const modified = makeSlursModified();
    const result = semanticDiff(original, modified);
    const counts = countChanges(result);

    expect(counts.modified).toBe(1);
    expect(counts.added).toBe(0);
    expect(counts.removed).toBe(0);
  });

  it("handles empty documents", () => {
    const result = semanticDiff({}, {});
    expect(result.type).toBe("unchanged");
  });

  it("handles null/undefined parts gracefully", () => {
    const original = { mnx: { version: 1 } };
    const modified = { mnx: { version: 1 }, parts: [{ measures: [] }] };
    const result = semanticDiff(original, modified);
    expect(result.type).toBe("modified");
  });
});

describe("lcsAlign", () => {
  it("aligns identical sequences", () => {
    const result = lcsAlign([1, 2, 3], [1, 2, 3], String);
    expect(result).toEqual([
      { type: "match", originalIndex: 0, modifiedIndex: 0 },
      { type: "match", originalIndex: 1, modifiedIndex: 1 },
      { type: "match", originalIndex: 2, modifiedIndex: 2 },
    ]);
  });

  it("detects insertion in the middle", () => {
    const result = lcsAlign([1, 3], [1, 2, 3], String);
    expect(result).toEqual([
      { type: "match", originalIndex: 0, modifiedIndex: 0 },
      { type: "added", modifiedIndex: 1 },
      { type: "match", originalIndex: 1, modifiedIndex: 2 },
    ]);
  });

  it("detects deletion from the middle", () => {
    const result = lcsAlign([1, 2, 3], [1, 3], String);
    expect(result).toEqual([
      { type: "match", originalIndex: 0, modifiedIndex: 0 },
      { type: "removed", originalIndex: 1 },
      { type: "match", originalIndex: 2, modifiedIndex: 1 },
    ]);
  });

  it("handles completely different sequences", () => {
    const result = lcsAlign([1, 2], [3, 4], String);
    expect(result.filter((e) => e.type === "removed").length).toBe(2);
    expect(result.filter((e) => e.type === "added").length).toBe(2);
  });

  it("handles empty sequences", () => {
    expect(lcsAlign([], [], String)).toEqual([]);
    expect(lcsAlign([1], [], String)).toEqual([{ type: "removed", originalIndex: 0 }]);
    expect(lcsAlign([], [1], String)).toEqual([{ type: "added", modifiedIndex: 0 }]);
  });
});

describe("lcsAlignWithModifications", () => {
  it("pairs modified items instead of removed+added", () => {
    // [A, B, C] vs [A, B', C] where B' != B
    const result = lcsAlignWithModifications(["a", "b", "c"], ["a", "x", "c"], (s) => s);
    expect(result).toEqual([
      { type: "match", originalIndex: 0, modifiedIndex: 0 },
      { type: "match", originalIndex: 1, modifiedIndex: 1 },
      { type: "match", originalIndex: 2, modifiedIndex: 2 },
    ]);
  });

  it("handles insertion correctly", () => {
    const result = lcsAlignWithModifications(["a", "c"], ["a", "b", "c"], (s) => s);
    expect(result).toEqual([
      { type: "match", originalIndex: 0, modifiedIndex: 0 },
      { type: "added", modifiedIndex: 1 },
      { type: "match", originalIndex: 1, modifiedIndex: 2 },
    ]);
  });

  it("handles deletion correctly", () => {
    const result = lcsAlignWithModifications(["a", "b", "c"], ["a", "c"], (s) => s);
    expect(result).toEqual([
      { type: "match", originalIndex: 0, modifiedIndex: 0 },
      { type: "removed", originalIndex: 1 },
      { type: "match", originalIndex: 2, modifiedIndex: 1 },
    ]);
  });
});
