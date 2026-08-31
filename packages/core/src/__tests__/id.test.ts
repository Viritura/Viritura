import { describe, it, expect } from "vitest";
import { generateId, generateUniqueId, collectScoreIds } from "../id";
import type { Score } from "../model/score";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("generateId", () => {
  it("returns a 36-character UUID v7 string", () => {
    const id = generateId();
    expect(id).toHaveLength(36);
    expect(id).toMatch(UUID_V7);
  });

  it("only contains UUID v7 shape", () => {
    for (let i = 0; i < 100; i++) {
      const id = generateId();
      expect(id).toMatch(UUID_V7);
    }
  });

  it("generates unique IDs (no duplicates in 1000 calls)", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(generateId());
    }
    expect(ids.size).toBe(1000);
  });
});

describe("generateUniqueId", () => {
  it("avoids collisions with existing IDs", () => {
    const existing = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const id = generateUniqueId(existing);
      expect(existing.has(id)).toBe(false);
      existing.add(id);
    }
  });
});

describe("collectScoreIds", () => {
  it("collects IDs from global measures, parts, events, and notes", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: {
        measures: [{ id: "gm1", time: { count: 4, unit: 4 } }, { id: "gm2" }],
      },
      parts: [
        {
          id: "p1",
          name: "Piano",
          measures: [
            {
              sequences: [
                {
                  content: [
                    {
                      type: "event" as const,
                      id: "ev1",
                      duration: { base: "whole" as const },
                      notes: [
                        { id: "n1", pitch: { step: "C" as const, octave: 4 as const } },
                        { id: "n2", pitch: { step: "E" as const, octave: 4 as const } },
                      ],
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
                      type: "event" as const,
                      id: "ev2",
                      duration: { base: "half" as const },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const ids = collectScoreIds(score);
    expect(ids).toEqual(new Set(["gm1", "gm2", "p1", "ev1", "n1", "n2", "ev2"]));
  });

  it("skips undefined IDs", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{}] },
      parts: [
        {
          name: "Test",
          measures: [
            {
              sequences: [
                {
                  content: [{ type: "event" as const, duration: { base: "whole" as const } }],
                },
              ],
            },
          ],
        },
      ],
    };

    const ids = collectScoreIds(score);
    expect(ids.size).toBe(0);
  });
});
