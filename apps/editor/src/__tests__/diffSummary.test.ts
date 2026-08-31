import { describe, it, expect } from "vitest";
import { computeDiffSummary } from "../diff/measureDiff";

// Minimal MNX score with 2 measures, 1 part
function makeScore(overrides?: { measures?: unknown[]; globalMeasures?: unknown[]; partName?: string }): string {
  const doc = {
    mnx: { version: 1 },
    global: {
      measures: overrides?.globalMeasures ?? [{ time: { count: 4, unit: 4 } }, {}],
    },
    parts: [
      {
        name: overrides?.partName ?? "Piano",
        measures: overrides?.measures ?? [
          {
            sequences: [
              {
                content: [
                  {
                    duration: { base: "quarter" },
                    notes: [{ pitch: { step: "C", octave: 4 } }],
                  },
                  {
                    duration: { base: "quarter" },
                    notes: [{ pitch: { step: "D", octave: 4 } }],
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
                    duration: { base: "quarter" },
                    notes: [{ pitch: { step: "E", octave: 4 } }],
                  },
                  {
                    duration: { base: "quarter" },
                    notes: [{ pitch: { step: "F", octave: 4 } }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  return JSON.stringify(doc, null, 2);
}

describe("computeDiffSummary", () => {
  it("returns empty array when documents are identical", () => {
    const json = makeScore();
    const result = computeDiffSummary(json, json);
    expect(result).toEqual([]);
  });

  it("detects a pitch change in a measure", () => {
    const original = makeScore();
    const mod = makeScore({
      measures: [
        {
          sequences: [
            {
              content: [
                {
                  duration: { base: "quarter" },
                  notes: [{ pitch: { step: "C", octave: 4 } }],
                },
                {
                  duration: { base: "quarter" },
                  notes: [{ pitch: { step: "D", octave: 4 } }],
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
                  duration: { base: "quarter" },
                  notes: [{ pitch: { step: "C", octave: 5 } }],
                },
                {
                  duration: { base: "quarter" },
                  notes: [{ pitch: { step: "F", octave: 4 } }],
                },
              ],
            },
          ],
        },
      ],
    });

    const changes = computeDiffSummary(original, mod);
    expect(changes.length).toBeGreaterThan(0);
    const noteChange = changes.find((c) => c.summary.includes("E4") && c.summary.includes("C5"));
    expect(noteChange).toBeDefined();
    expect(noteChange?.type).toBe("modified");
    expect(noteChange?.measureIndex).toBe(1);
  });

  it("detects a time signature change", () => {
    const original = makeScore();
    const mod = makeScore({
      globalMeasures: [{ time: { count: 3, unit: 4 } }, {}],
    });

    const changes = computeDiffSummary(original, mod);
    const timeSigChange = changes.find((c) => c.summary.includes("Time signature"));
    expect(timeSigChange).toBeDefined();
    expect(timeSigChange?.summary).toContain("4/4");
    expect(timeSigChange?.summary).toContain("3/4");
    expect(timeSigChange?.type).toBe("modified");
  });

  it("detects a key signature change", () => {
    const original = makeScore({
      globalMeasures: [{ time: { count: 4, unit: 4 }, key: { fifths: 0 } }, {}],
    });
    const mod = makeScore({
      globalMeasures: [{ time: { count: 4, unit: 4 }, key: { fifths: 1 } }, {}],
    });

    const changes = computeDiffSummary(original, mod);
    const keyChange = changes.find((c) => c.summary.includes("Key signature"));
    expect(keyChange).toBeDefined();
    expect(keyChange?.summary).toContain("C major");
    expect(keyChange?.summary).toContain("G major");
  });

  it("detects an added measure", () => {
    const original = makeScore();
    const mod = makeScore({
      measures: [
        {
          sequences: [
            {
              content: [
                { duration: { base: "quarter" }, notes: [{ pitch: { step: "C", octave: 4 } }] },
                { duration: { base: "quarter" }, notes: [{ pitch: { step: "D", octave: 4 } }] },
              ],
            },
          ],
        },
        {
          sequences: [
            {
              content: [
                { duration: { base: "quarter" }, notes: [{ pitch: { step: "E", octave: 4 } }] },
                { duration: { base: "quarter" }, notes: [{ pitch: { step: "F", octave: 4 } }] },
              ],
            },
          ],
        },
        {
          sequences: [
            {
              content: [{ duration: { base: "quarter" }, notes: [{ pitch: { step: "G", octave: 4 } }] }],
            },
          ],
        },
      ],
      globalMeasures: [{ time: { count: 4, unit: 4 } }, {}, {}],
    });

    const changes = computeDiffSummary(original, mod);
    const addedGlobal = changes.find((c) => c.type === "added" && c.measureIndex === 2 && c.partIndex === -1);
    expect(addedGlobal).toBeDefined();
    const addedPart = changes.find((c) => c.type === "added" && c.measureIndex === 2 && c.partIndex === 0);
    expect(addedPart).toBeDefined();
  });

  it("detects dynamics added", () => {
    const original = makeScore();
    const mod = makeScore({
      measures: [
        {
          sequences: [
            {
              content: [
                { duration: { base: "quarter" }, notes: [{ pitch: { step: "C", octave: 4 } }] },
                { duration: { base: "quarter" }, notes: [{ pitch: { step: "D", octave: 4 } }] },
              ],
            },
          ],
          dynamics: [{ position: { fraction: [0, 1] }, value: "ff" }],
        },
        {
          sequences: [
            {
              content: [
                { duration: { base: "quarter" }, notes: [{ pitch: { step: "E", octave: 4 } }] },
                { duration: { base: "quarter" }, notes: [{ pitch: { step: "F", octave: 4 } }] },
              ],
            },
          ],
        },
      ],
    });

    const changes = computeDiffSummary(original, mod);
    const dynChange = changes.find((c) => c.summary.includes("Dynamics"));
    expect(dynChange).toBeDefined();
    expect(dynChange?.type).toBe("added");
    expect(dynChange?.summary).toContain("ff");
  });

  it("returns empty array for invalid JSON", () => {
    expect(computeDiffSummary("not json", "also not json")).toEqual([]);
  });

  it("clicking summary item: diff with 2 changes shows 2+ items", () => {
    const original = makeScore();
    // Change both measures
    const mod = makeScore({
      measures: [
        {
          sequences: [
            {
              content: [
                { duration: { base: "half" }, notes: [{ pitch: { step: "C", octave: 4 } }] },
                { duration: { base: "quarter" }, notes: [{ pitch: { step: "D", octave: 4 } }] },
              ],
            },
          ],
        },
        {
          sequences: [
            {
              content: [
                { duration: { base: "quarter" }, notes: [{ pitch: { step: "G", octave: 5 } }] },
                { duration: { base: "quarter" }, notes: [{ pitch: { step: "F", octave: 4 } }] },
              ],
            },
          ],
        },
      ],
    });

    const changes = computeDiffSummary(original, mod);
    // Should have at least 2 changes (one per modified measure)
    expect(changes.length).toBeGreaterThanOrEqual(2);
    // Verify changes are in different measures
    const measures = new Set(changes.map((c) => c.measureIndex));
    expect(measures.size).toBeGreaterThanOrEqual(2);
  });
});
