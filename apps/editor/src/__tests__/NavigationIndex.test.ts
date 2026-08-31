import { describe, it, expect } from "vitest";
import type { Score } from "@viritura/core";
import {
  buildNavigationIndex,
  findNextInVoice,
  findPrevInVoice,
  findNextMeasure,
  findPrevMeasure,
  findFirst,
  findLast,
  findNextSameType,
  findAdjacentVoice,
  getEntry,
  findNext,
  findPrev,
  findEntriesInMeasure,
  findNextAtPosition,
  findPrevAtPosition,
} from "../navigation/NavigationIndex";

/** Build a minimal Score for testing. */
function makeScore(
  parts: {
    measures: {
      sequences: {
        content: {
          id?: string;
          rest?: Record<string, never>;
          notes?: { pitch: { step: string; octave: number } }[];
        }[];
      }[];
    }[];
  }[],
): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: parts[0]?.measures.map(() => ({})) ?? [],
    },
    parts: parts.map((p) => ({
      name: "Test",
      measures: p.measures.map((m) => ({
        sequences: m.sequences.map((s) => ({
          content: s.content.map((e, eIdx) => {
            const event: {
              type: "event";
              duration: { base: "quarter" };
              id?: string;
              notes?: {
                pitch: {
                  step: "C" | "D" | "E" | "F" | "G" | "A" | "B";
                  octave: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
                };
              }[];
              rest?: Record<string, never>;
            } = {
              type: "event" as const,
              duration: { base: "quarter" as const },
            };
            event.id = e.id ?? `e${eIdx}`;
            if (e.notes) {
              event.notes = e.notes.map((n) => ({
                pitch: {
                  step: n.pitch.step as "C" | "D" | "E" | "F" | "G" | "A" | "B",
                  octave: n.pitch.octave as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9,
                },
              }));
            }
            if (e.rest) event.rest = e.rest;
            return event;
          }),
        })),
      })),
    })),
  };
}

/**
 * Build a Score with global measure annotations and part-level directions.
 */
function makeAnnotatedScore(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [
        {
          time: { count: 4, unit: 4 },
          key: { fifths: 0 },
          tempos: [{ bpm: 120, value: { base: "quarter" }, location: { fraction: [0, 1] } }],
          rehearsalMark: { text: "A" },
        },
        {
          barline: { type: "final" } as NonNullable<Score["global"]["measures"][0]["barline"]>,
          ending: { numbers: [1], duration: 1 },
          jump: { type: "dsalfine" } as NonNullable<Score["global"]["measures"][0]["jump"]>,
        },
      ],
    },
    parts: [
      {
        name: "Piano",
        measures: [
          {
            clefs: [{ sign: "G" } as never],
            sequences: [
              {
                content: [
                  {
                    type: "event" as const,
                    id: "e0",
                    duration: { base: "quarter" as const },
                    notes: [{ pitch: { step: "C" as const, octave: 4 as const } }],
                  },
                  {
                    type: "event" as const,
                    id: "e1",
                    duration: { base: "quarter" as const },
                    notes: [{ pitch: { step: "D" as const, octave: 4 as const } }],
                  },
                ],
              },
            ],
            dynamics: [
              {
                id: "dyn-1",
                type: "immediate",
                position: { fraction: [0, 1] as [number, number] },
                value: "f",
                glyphs: ["dynamicForte"],
              },
              {
                id: "hairpin-1",
                type: "gradual",
                position: { fraction: [0, 1] as [number, number] },
                end: { measure: "m0", position: { fraction: [1, 1] as [number, number] } },
                wedgeType: "increasing",
              },
            ] as NonNullable<Score["parts"][0]["measures"][0]["dynamics"]>,
            expressions: [
              {
                text: "dolce",
                position: { fraction: [1, 4] as [number, number] },
                placement: "below",
              },
            ] as NonNullable<Score["parts"][0]["measures"][0]["expressions"]>,
          },
          {
            sequences: [
              {
                content: [
                  {
                    type: "event" as const,
                    id: "e0",
                    duration: { base: "quarter" as const },
                    notes: [{ pitch: { step: "E" as const, octave: 4 as const } }],
                  },
                ],
              },
            ],
            pedals: [
              {
                type: "sustain",
                position: { fraction: [0, 1] as [number, number] },
                end: { fraction: [1, 1] as [number, number] },
              },
            ] as unknown as NonNullable<Score["parts"][0]["measures"][0]["pedals"]>,
            chordSymbols: [
              {
                position: { fraction: [0, 1] as [number, number] },
                root: { step: "C" },
                quality: "major",
              },
            ] as NonNullable<Score["parts"][0]["measures"][0]["chordSymbols"]>,
            ottavas: [
              {
                position: { fraction: [0, 1] as [number, number] },
                end: { fraction: [1, 1] as [number, number] },
                value: 8,
              },
            ] as unknown as NonNullable<Score["parts"][0]["measures"][0]["ottavas"]>,
          },
        ],
      },
    ],
  };
}

describe("buildNavigationIndex", () => {
  it("builds entries for a simple one-voice score", () => {
    const score = makeScore([
      {
        measures: [
          {
            sequences: [
              {
                content: [
                  { notes: [{ pitch: { step: "C", octave: 4 } }] },
                  { notes: [{ pitch: { step: "D", octave: 4 } }] },
                ],
              },
            ],
          },
          {
            sequences: [
              {
                content: [
                  { notes: [{ pitch: { step: "E", octave: 4 } }] },
                  { notes: [{ pitch: { step: "F", octave: 4 } }] },
                ],
              },
            ],
          },
        ],
      },
    ]);

    const nav = buildNavigationIndex(score);
    expect(nav.entries).toHaveLength(4);
    expect(nav.entries[0]!.elementId).toBe("p0/m0/s0/e0");
    expect(nav.entries[1]!.elementId).toBe("p0/m0/s0/e1");
    expect(nav.entries[2]!.elementId).toBe("p0/m1/s0/e0");
    expect(nav.entries[3]!.elementId).toBe("p0/m1/s0/e1");
  });

  it("uses event.id when available", () => {
    const score = makeScore([
      {
        measures: [
          {
            sequences: [
              {
                content: [{ id: "note1", notes: [{ pitch: { step: "C", octave: 4 } }] }],
              },
            ],
          },
        ],
      },
    ]);

    const nav = buildNavigationIndex(score);
    expect(nav.entries[0]!.elementId).toBe("p0/m0/s0/note1");
  });

  it("marks rests correctly", () => {
    const score = makeScore([
      {
        measures: [
          {
            sequences: [
              {
                content: [{ notes: [{ pitch: { step: "C", octave: 4 } }] }, { rest: {} }],
              },
            ],
          },
        ],
      },
    ]);

    const nav = buildNavigationIndex(score);
    expect(nav.entries[0]!.isRest).toBe(false);
    expect(nav.entries[1]!.isRest).toBe(true);
  });
});

describe("findNextInVoice / findPrevInVoice", () => {
  const score = makeScore([
    {
      measures: [
        {
          sequences: [
            {
              content: [
                { notes: [{ pitch: { step: "C", octave: 4 } }] },
                { notes: [{ pitch: { step: "D", octave: 4 } }] },
              ],
            },
          ],
        },
        {
          sequences: [
            {
              content: [{ notes: [{ pitch: { step: "E", octave: 4 } }] }],
            },
          ],
        },
      ],
    },
  ]);
  const nav = buildNavigationIndex(score);

  it("moves to next event in same voice", () => {
    expect(findNextInVoice(nav, "p0/m0/s0/e0")).toBe("p0/m0/s0/e1");
  });

  it("moves across measures in same voice", () => {
    expect(findNextInVoice(nav, "p0/m0/s0/e1")).toBe("p0/m1/s0/e0");
  });

  it("returns undefined at end", () => {
    expect(findNextInVoice(nav, "p0/m1/s0/e0")).toBeUndefined();
  });

  it("moves to previous event in same voice", () => {
    expect(findPrevInVoice(nav, "p0/m0/s0/e1")).toBe("p0/m0/s0/e0");
  });

  it("returns undefined at beginning", () => {
    expect(findPrevInVoice(nav, "p0/m0/s0/e0")).toBeUndefined();
  });
});

describe("findNextMeasure / findPrevMeasure", () => {
  const score = makeScore([
    {
      measures: [
        {
          sequences: [
            {
              content: [
                { notes: [{ pitch: { step: "C", octave: 4 } }] },
                { notes: [{ pitch: { step: "D", octave: 4 } }] },
              ],
            },
          ],
        },
        {
          sequences: [
            {
              content: [
                { notes: [{ pitch: { step: "E", octave: 4 } }] },
                { notes: [{ pitch: { step: "F", octave: 4 } }] },
              ],
            },
          ],
        },
      ],
    },
  ]);
  const nav = buildNavigationIndex(score);

  it("jumps to first event of next measure", () => {
    expect(findNextMeasure(nav, "p0/m0/s0/e0")).toBe("p0/m1/s0/e0");
    expect(findNextMeasure(nav, "p0/m0/s0/e1")).toBe("p0/m1/s0/e0");
  });

  it("returns undefined at last measure", () => {
    expect(findNextMeasure(nav, "p0/m1/s0/e0")).toBeUndefined();
  });

  it("jumps to first event of previous measure", () => {
    expect(findPrevMeasure(nav, "p0/m1/s0/e1")).toBe("p0/m0/s0/e0");
  });

  it("returns undefined at first measure", () => {
    expect(findPrevMeasure(nav, "p0/m0/s0/e0")).toBeUndefined();
  });
});

describe("findFirst / findLast", () => {
  const score = makeScore([
    {
      measures: [
        {
          sequences: [
            {
              content: [{ notes: [{ pitch: { step: "C", octave: 4 } }] }],
            },
          ],
        },
        {
          sequences: [
            {
              content: [{ notes: [{ pitch: { step: "E", octave: 4 } }] }],
            },
          ],
        },
      ],
    },
  ]);
  const nav = buildNavigationIndex(score);

  it("returns first element", () => {
    expect(findFirst(nav)).toBe("p0/m0/s0/e0");
  });

  it("returns last element", () => {
    expect(findLast(nav)).toBe("p0/m1/s0/e0");
  });

  it("returns undefined for empty score", () => {
    const emptyNav = buildNavigationIndex({
      mnx: { version: 1 },
      global: { measures: [] },
      parts: [],
    });
    expect(findFirst(emptyNav)).toBeUndefined();
    expect(findLast(emptyNav)).toBeUndefined();
  });
});

describe("findNextSameType", () => {
  const score = makeScore([
    {
      measures: [
        {
          sequences: [
            {
              content: [
                { notes: [{ pitch: { step: "C", octave: 4 } }] },
                { rest: {} },
                { notes: [{ pitch: { step: "E", octave: 4 } }] },
              ],
            },
          ],
        },
      ],
    },
  ]);
  const nav = buildNavigationIndex(score);

  it("skips to next note (skipping rest)", () => {
    expect(findNextSameType(nav, "p0/m0/s0/e0")).toBe("p0/m0/s0/e2");
  });

  it("finds the only rest", () => {
    // The rest at e1 wraps back to itself (only rest)
    expect(findNextSameType(nav, "p0/m0/s0/e1")).toBeUndefined();
  });
});

describe("findAdjacentVoice", () => {
  const score = makeScore([
    {
      measures: [
        {
          sequences: [
            {
              content: [{ notes: [{ pitch: { step: "C", octave: 5 } }] }],
            },
            {
              content: [{ rest: {} }],
            },
          ],
        },
      ],
    },
  ]);
  const nav = buildNavigationIndex(score);

  it("moves down from voice 0 to voice 1", () => {
    expect(findAdjacentVoice(nav, "p0/m0/s0/e0", "down")).toBe("p0/m0/s1/e0");
  });

  it("moves up from voice 1 to voice 0", () => {
    expect(findAdjacentVoice(nav, "p0/m0/s1/e0", "up")).toBe("p0/m0/s0/e0");
  });

  it("returns undefined when no adjacent voice", () => {
    expect(findAdjacentVoice(nav, "p0/m0/s0/e0", "up")).toBeUndefined();
    expect(findAdjacentVoice(nav, "p0/m0/s1/e0", "down")).toBeUndefined();
  });
});

describe("getEntry", () => {
  const score = makeScore([
    {
      measures: [
        {
          sequences: [
            {
              content: [{ notes: [{ pitch: { step: "C", octave: 4 } }] }],
            },
          ],
        },
      ],
    },
  ]);
  const nav = buildNavigationIndex(score);

  it("returns entry for valid ID", () => {
    const entry = getEntry(nav, "p0/m0/s0/e0");
    expect(entry).toBeDefined();
    expect(entry!.partIndex).toBe(0);
    expect(entry!.measureIndex).toBe(0);
    expect(entry!.isRest).toBe(false);
    expect(entry!.elementType).toBe("event");
  });

  it("returns undefined for invalid ID", () => {
    expect(getEntry(nav, "nonexistent")).toBeUndefined();
  });
});

// ═══════════════════════════════════════════
// Non-event element indexing
// ═══════════════════════════════════════════

describe("buildNavigationIndex with non-event elements", () => {
  const score = makeAnnotatedScore();
  const nav = buildNavigationIndex(score);

  it("includes global time signature entries", () => {
    const entry = getEntry(nav, "m0/time");
    expect(entry).toBeDefined();
    expect(entry!.elementType).toBe("time-signature");
    expect(entry!.partIndex).toBe(-1);
    expect(entry!.measureIndex).toBe(0);
  });

  it("includes tempo entries", () => {
    const entry = getEntry(nav, "m0/tempo0");
    expect(entry).toBeDefined();
    expect(entry!.elementType).toBe("tempo");
    expect(entry!.partIndex).toBe(-1);
  });

  it("includes rehearsal mark entries", () => {
    const entry = getEntry(nav, "m0/rehearsal");
    expect(entry).toBeDefined();
    expect(entry!.elementType).toBe("rehearsal");
  });

  it("includes jump entries", () => {
    const entry = getEntry(nav, "m1/jump");
    expect(entry).toBeDefined();
    expect(entry!.elementType).toBe("jump");
  });

  it("includes volta entries", () => {
    const entry = getEntry(nav, "m1/volta");
    expect(entry).toBeDefined();
    expect(entry!.elementType).toBe("volta");
  });

  it("includes clef entries", () => {
    const entry = getEntry(nav, "p0/m0/clef");
    expect(entry).toBeDefined();
    expect(entry!.elementType).toBe("clef");
    expect(entry!.partIndex).toBe(0);
  });

  it("includes key signature entries", () => {
    const entry = getEntry(nav, "p0/m0/key");
    expect(entry).toBeDefined();
    expect(entry!.elementType).toBe("key-signature");
  });

  it("includes barline entries", () => {
    const entry = getEntry(nav, "m1/barline");
    expect(entry).toBeDefined();
    expect(entry!.elementType).toBe("barline");
  });

  it("includes dynamic entries", () => {
    const entry = getEntry(nav, "p0/m0/dyndyn-1");
    expect(entry).toBeDefined();
    expect(entry!.elementType).toBe("dynamic");
  });

  it("includes hairpin entries", () => {
    const entry = getEntry(nav, "p0/m0/hairpinhairpin-1");
    expect(entry).toBeDefined();
    expect(entry!.elementType).toBe("hairpin");
  });

  it("includes expression entries", () => {
    const entry = getEntry(nav, "p0/m0/expr0");
    expect(entry).toBeDefined();
    expect(entry!.elementType).toBe("expression");
  });

  it("includes pedal entries", () => {
    const entry = getEntry(nav, "p0/m1/pedal0");
    expect(entry).toBeDefined();
    expect(entry!.elementType).toBe("pedal");
  });

  it("includes chord symbol entries", () => {
    const entry = getEntry(nav, "p0/m1/chord0");
    expect(entry).toBeDefined();
    expect(entry!.elementType).toBe("chord-symbol");
  });

  it("includes ottava entries", () => {
    const entry = getEntry(nav, "p0/m1/ottava0");
    expect(entry).toBeDefined();
    expect(entry!.elementType).toBe("ottava");
  });

  it("events still have correct elementType", () => {
    const entry = getEntry(nav, "p0/m0/s0/e0");
    expect(entry).toBeDefined();
    expect(entry!.elementType).toBe("event");
  });
});

describe("sort order within measures", () => {
  const score = makeAnnotatedScore();
  const nav = buildNavigationIndex(score);

  it("sorts clef before key before time before events within measure 0", () => {
    const m0Entries = nav.entries.filter((e) => e.measureIndex === 0 && e.partIndex === 0);
    const ids = m0Entries.map((e) => e.elementId);
    const clefIdx = ids.indexOf("p0/m0/clef");
    const keyIdx = ids.indexOf("p0/m0/key");
    const eventIdx = ids.indexOf("p0/m0/s0/e0");

    expect(clefIdx).toBeGreaterThanOrEqual(0);
    expect(keyIdx).toBeGreaterThanOrEqual(0);
    expect(clefIdx).toBeLessThan(keyIdx);
    expect(keyIdx).toBeLessThan(eventIdx);
  });

  it("sorts barline after events within a measure", () => {
    const m1Entries = nav.entries.filter((e) => e.measureIndex === 1 && e.partIndex === 0);
    const ids = m1Entries.map((e) => e.elementId);
    const eventIdx = ids.indexOf("p0/m1/s0/e0");
    const barlineIdx = ids.indexOf("m1/barline");

    expect(eventIdx).toBeGreaterThanOrEqual(0);
    expect(barlineIdx).toBeGreaterThanOrEqual(0);
    expect(eventIdx).toBeLessThan(barlineIdx);
  });

  it("global entries (partIndex -1) sort before part entries", () => {
    const m0All = nav.entries.filter((e) => e.measureIndex === 0);
    const globalEntries = m0All.filter((e) => e.partIndex === -1);
    const partEntries = m0All.filter((e) => e.partIndex >= 0);

    if (globalEntries.length > 0 && partEntries.length > 0) {
      const lastGlobal = nav.entries.indexOf(globalEntries[globalEntries.length - 1]!);
      const firstPart = nav.entries.indexOf(partEntries[0]!);
      expect(lastGlobal).toBeLessThan(firstPart);
    }
  });
});

// ═══════════════════════════════════════════
// Backward-compatible navigation still works
// ═══════════════════════════════════════════

describe("backward compatibility with non-event entries present", () => {
  const score = makeAnnotatedScore();
  const nav = buildNavigationIndex(score);

  it("findFirst returns first event, not clef/time/key", () => {
    const first = findFirst(nav);
    expect(first).toBe("p0/m0/s0/e0");
  });

  it("findLast returns last event, not barline/jump", () => {
    const last = findLast(nav);
    expect(last).toBe("p0/m1/s0/e0");
  });

  it("findNextInVoice skips non-event entries", () => {
    const next = findNextInVoice(nav, "p0/m0/s0/e0");
    expect(next).toBe("p0/m0/s0/e1");
  });

  it("findNextInVoice crosses measures, skipping annotations", () => {
    const next = findNextInVoice(nav, "p0/m0/s0/e1");
    expect(next).toBe("p0/m1/s0/e0");
  });

  it("findPrevInVoice skips non-event entries", () => {
    const prev = findPrevInVoice(nav, "p0/m0/s0/e1");
    expect(prev).toBe("p0/m0/s0/e0");
  });

  it("findNextMeasure skips non-event entries", () => {
    const next = findNextMeasure(nav, "p0/m0/s0/e0");
    expect(next).toBe("p0/m1/s0/e0");
  });

  it("findPrevMeasure skips non-event entries", () => {
    const prev = findPrevMeasure(nav, "p0/m1/s0/e0");
    expect(prev).toBe("p0/m0/s0/e0");
  });

  it("findNextSameType skips non-event entries", () => {
    const next = findNextSameType(nav, "p0/m0/s0/e0");
    expect(next).toBe("p0/m0/s0/e1");
  });
});

// ═══════════════════════════════════════════
// Filtered navigation (findNext / findPrev)
// ═══════════════════════════════════════════

describe("findNext / findPrev with filter", () => {
  const score = makeAnnotatedScore();
  const nav = buildNavigationIndex(score);

  it("findNext without filter returns next event", () => {
    const next = findNext(nav, "p0/m0/s0/e0");
    expect(next).toBeDefined();
    expect(next!.elementId).toBe("p0/m0/s0/e1");
  });

  it("findNext with dynamic filter finds dynamics", () => {
    const next = findNext(nav, "p0/m0/s0/e0", ["dynamic"]);
    expect(next).toBeDefined();
    expect(next!.elementId).toBe("p0/m0/dyndyn-1");
  });

  it("findNext with hairpin filter finds hairpins", () => {
    const next = findNext(nav, "p0/m0/s0/e0", ["hairpin"]);
    expect(next).toBeDefined();
    expect(next!.elementId).toBe("p0/m0/hairpinhairpin-1");
  });

  it("findPrev from event to preceding annotation", () => {
    // From second event, look back for dynamics
    const prev = findPrev(nav, "p0/m0/s0/e1", ["dynamic"]);
    expect(prev).toBeDefined();
    expect(prev!.elementId).toBe("p0/m0/dyndyn-1");
  });

  it("findNext with multiple type filter", () => {
    const next = findNext(nav, "p0/m0/s0/e0", ["dynamic", "hairpin", "expression"]);
    expect(next).toBeDefined();
    // Should find whichever comes first in sort order
    expect(["dynamic", "hairpin", "expression"]).toContain(next!.elementType);
  });

  it("findNext returns undefined when no match ahead", () => {
    // From the last entry, no more events
    const next = findNext(nav, "p0/m1/s0/e0", ["tempo"]);
    expect(next).toBeUndefined();
  });

  it("findPrev returns undefined when no match behind", () => {
    // From the first event, no previous events
    const prev = findPrev(nav, "p0/m0/s0/e0");
    expect(prev).toBeUndefined();
  });

  it("findNext with global type filter", () => {
    const next = findNext(nav, "m0/time", ["tempo"]);
    expect(next).toBeDefined();
    expect(next!.elementType).toBe("tempo");
  });
});

describe("findEntriesInMeasure", () => {
  const score = makeAnnotatedScore();
  const nav = buildNavigationIndex(score);

  it("finds all events in measure 0 for part 0", () => {
    const entries = findEntriesInMeasure(nav, "p0/m0/s0/e0");
    expect(entries.length).toBe(2); // e0, e1 — default filter is events only
  });

  it("finds dynamics in measure 0", () => {
    const entries = findEntriesInMeasure(nav, "p0/m0/s0/e0", ["dynamic"]);
    expect(entries.length).toBe(1);
    expect(entries[0]!.elementId).toBe("p0/m0/dyndyn-1");
  });

  it("finds all directions in measure 0", () => {
    const entries = findEntriesInMeasure(nav, "p0/m0/s0/e0", ["dynamic", "hairpin", "expression"]);
    expect(entries.length).toBe(3);
  });

  it("finds barline in measure 1", () => {
    const entries = findEntriesInMeasure(nav, "p0/m1/s0/e0", ["barline"]);
    expect(entries.length).toBe(1);
    expect(entries[0]!.elementId).toBe("m1/barline");
  });
});

// ═══════════════════════════════════════════
// Tab-cycle navigation (findNextAtPosition / findPrevAtPosition)
// ═══════════════════════════════════════════

describe("findNextAtPosition / findPrevAtPosition", () => {
  // Score with a note and a dynamic at the same beat position (beat 0)
  const score: Score = {
    mnx: { version: 1 },
    global: { measures: [{}] },
    parts: [
      {
        name: "Piano",
        measures: [
          {
            sequences: [
              {
                content: [
                  {
                    type: "event",
                    id: "e0",
                    duration: { base: "quarter" },
                    notes: [{ pitch: { step: "C", octave: 4 } }],
                  },
                  {
                    type: "event",
                    id: "e1",
                    duration: { base: "quarter" },
                    notes: [{ pitch: { step: "D", octave: 4 } }],
                  },
                ],
              },
            ],
            dynamics: [
              { id: "dyn-cycle", type: "immediate", position: { fraction: [0, 1] }, value: "f" },
              {
                id: "hairpin-cycle",
                type: "gradual",
                position: { fraction: [0, 1] },
                end: { measure: "m0", position: { fraction: [1, 2] } },
                wedgeType: "increasing",
              },
            ],
          },
        ],
      },
    ],
  };
  const nav = buildNavigationIndex(score);

  it("cycles from note to dynamic at same position", () => {
    const next = findNextAtPosition(nav, "p0/m0/s0/e0");
    expect(next).toBeDefined();
    // Should be one of the other elements at beat 0 (dynamic or hairpin)
    const entry = getEntry(nav, next!);
    expect(entry).toBeDefined();
    expect(entry!.measureIndex).toBe(0);
  });

  it("cycles back to the first element after last in group", () => {
    // Collect all elements at beat 0 in part 0
    const atBeat0 = nav.entries.filter((e) => e.partIndex === 0 && e.measureIndex === 0 && Math.abs(e.sortKey) < 0.001);
    expect(atBeat0.length).toBeGreaterThanOrEqual(3); // event, dynamic, hairpin

    // Cycle from the last element back to the first
    const lastId = atBeat0[atBeat0.length - 1]!.elementId;
    const next = findNextAtPosition(nav, lastId);
    expect(next).toBe(atBeat0[0]!.elementId);
  });

  it("Shift+Tab cycles in reverse", () => {
    const atBeat0 = nav.entries.filter((e) => e.partIndex === 0 && e.measureIndex === 0 && Math.abs(e.sortKey) < 0.001);
    expect(atBeat0.length).toBeGreaterThanOrEqual(3);

    // From first element, reverse-cycle wraps to last
    const firstId = atBeat0[0]!.elementId;
    const prev = findPrevAtPosition(nav, firstId);
    expect(prev).toBe(atBeat0[atBeat0.length - 1]!.elementId);
  });

  it("returns undefined when only one element at position", () => {
    // The second event (D4) is at sortKey 1, alone at that position
    const result = findNextAtPosition(nav, "p0/m0/s0/e1");
    expect(result).toBeUndefined();
  });

  it("returns undefined for unknown element ID", () => {
    expect(findNextAtPosition(nav, "nonexistent")).toBeUndefined();
    expect(findPrevAtPosition(nav, "nonexistent")).toBeUndefined();
  });
});

describe("findNextAtPosition with global annotations", () => {
  const score: Score = {
    mnx: { version: 1 },
    global: {
      measures: [
        {
          tempos: [{ bpm: 120, value: { base: "quarter" }, location: { fraction: [0, 1] } }],
        },
      ],
    },
    parts: [
      {
        name: "Piano",
        measures: [
          {
            sequences: [
              {
                content: [
                  {
                    type: "event",
                    id: "e0",
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
  const nav = buildNavigationIndex(score);

  it("includes tempo at beat 0 alongside the event", () => {
    // In agent-17's model, global entries have partIndex=-1
    const atBeat0 = nav.entries.filter(
      (e) => (e.partIndex === 0 || e.partIndex === -1) && e.measureIndex === 0 && Math.abs(e.sortKey) < 0.001,
    );
    const types = atBeat0.map((e) => e.elementType);
    expect(types).toContain("event");
    expect(types).toContain("tempo");
  });

  it("Tab cycles between event and tempo", () => {
    const next = findNextAtPosition(nav, "p0/m0/s0/e0");
    expect(next).toBeDefined();
    const entry = getEntry(nav, next!);
    expect(entry?.elementType).toBe("tempo");
  });
});

// ═══════════════════════════════════════════
// Tuplet navigation
// ═══════════════════════════════════════════

describe("tuplet navigation", () => {
  // Score: [quarter] [triplet: eighth, eighth, eighth] [quarter]
  const score: Score = {
    mnx: { version: 1 },
    global: { measures: [{}] },
    parts: [
      {
        name: "Piano",
        measures: [
          {
            sequences: [
              {
                content: [
                  {
                    type: "event",
                    id: "ev-before",
                    duration: { base: "quarter" },
                    notes: [{ pitch: { step: "C", octave: 4 } }],
                  },
                  {
                    type: "tuplet",
                    outer: { multiple: 2, duration: { base: "quarter" } },
                    inner: { multiple: 3, duration: { base: "eighth" } },
                    content: [
                      {
                        type: "event",
                        id: "ev-t0",
                        duration: { base: "eighth" },
                        notes: [{ pitch: { step: "D", octave: 4 } }],
                      },
                      {
                        type: "event",
                        id: "ev-t1",
                        duration: { base: "eighth" },
                        notes: [{ pitch: { step: "E", octave: 4 } }],
                      },
                      {
                        type: "event",
                        id: "ev-t2",
                        duration: { base: "eighth" },
                        notes: [{ pitch: { step: "F", octave: 4 } }],
                      },
                    ],
                  },
                  {
                    type: "event",
                    id: "ev-after",
                    duration: { base: "quarter" },
                    notes: [{ pitch: { step: "G", octave: 4 } }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  const nav = buildNavigationIndex(score);

  it("indexes all inner tuplet events individually", () => {
    const eventEntries = nav.entries.filter((e) => e.elementType === "event" || e.elementType === "rest");
    // 1 before + 3 inner + 1 after = 5
    expect(eventEntries).toHaveLength(5);
    const ids = eventEntries.map((e) => e.elementId);
    expect(ids).toContain("p0/m0/s0/ev-before");
    expect(ids).toContain("p0/m0/s0/ev-t0");
    expect(ids).toContain("p0/m0/s0/ev-t1");
    expect(ids).toContain("p0/m0/s0/ev-t2");
    expect(ids).toContain("p0/m0/s0/ev-after");
  });

  it("inner tuplet events carry correct tupletIndex", () => {
    const t0 = nav.entries.find((e) => e.elementId === "p0/m0/s0/ev-t0");
    expect(t0?.tupletIndex).toBe(1); // tuplet is at content[1]
    expect(t0?.eventIndex).toBe(0); // first inner event
    const t2 = nav.entries.find((e) => e.elementId === "p0/m0/s0/ev-t2");
    expect(t2?.tupletIndex).toBe(1);
    expect(t2?.eventIndex).toBe(2); // third inner event
  });

  it("ArrowRight navigates into tuplet", () => {
    const next = findNextInVoice(nav, "p0/m0/s0/ev-before");
    expect(next).toBe("p0/m0/s0/ev-t0");
  });

  it("ArrowRight navigates through all inner events", () => {
    expect(findNextInVoice(nav, "p0/m0/s0/ev-t0")).toBe("p0/m0/s0/ev-t1");
    expect(findNextInVoice(nav, "p0/m0/s0/ev-t1")).toBe("p0/m0/s0/ev-t2");
  });

  it("ArrowRight exits tuplet to next event", () => {
    const next = findNextInVoice(nav, "p0/m0/s0/ev-t2");
    expect(next).toBe("p0/m0/s0/ev-after");
  });

  it("ArrowLeft navigates backwards through tuplet", () => {
    expect(findPrevInVoice(nav, "p0/m0/s0/ev-after")).toBe("p0/m0/s0/ev-t2");
    expect(findPrevInVoice(nav, "p0/m0/s0/ev-t2")).toBe("p0/m0/s0/ev-t1");
    expect(findPrevInVoice(nav, "p0/m0/s0/ev-t1")).toBe("p0/m0/s0/ev-t0");
    expect(findPrevInVoice(nav, "p0/m0/s0/ev-t0")).toBe("p0/m0/s0/ev-before");
  });

  it("inner events have strictly increasing beat positions", () => {
    const t0 = nav.entries.find((e) => e.elementId === "p0/m0/s0/ev-t0")!;
    const t1 = nav.entries.find((e) => e.elementId === "p0/m0/s0/ev-t1")!;
    const t2 = nav.entries.find((e) => e.elementId === "p0/m0/s0/ev-t2")!;
    expect(t0.sortKey).toBeLessThan(t1.sortKey);
    expect(t1.sortKey).toBeLessThan(t2.sortKey);
  });
});
