/**
 * Round-trip tests for all MNX example files.
 *
 * For each .mnx file: parse → serialize → parse again. The two parsed
 * Score objects must be deeply equal. This ensures no data is lost
 * during the parse/serialize cycle.
 */

import { describe, it, expect } from "vitest";
import { parseMnx, parseMnxWithDiagnostics } from "../mnx/parser";
import { serializeMnx } from "../mnx/serializer";
import * as fs from "node:fs";
import * as path from "node:path";

const scoresDir = path.resolve(__dirname, "../../fixtures/mnx");

/** All .mnx files in the scores directory. */
const mnxFiles = fs
  .readdirSync(scoresDir)
  .filter((f) => f.endsWith(".mnx"))
  .sort();

describe("MNX round-trip (parse → serialize → parse)", () => {
  it("preserves an explicit empty beam list that suppresses auto-beaming", () => {
    const source = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 2, unit: 4 } }] },
      parts: [
        {
          measures: [
            {
              beams: [],
              sequences: [
                {
                  content: [
                    { id: "e1", duration: { base: "eighth" }, notes: [{ pitch: { step: "C", octave: 4 } }] },
                    { id: "e2", duration: { base: "eighth" }, notes: [{ pitch: { step: "D", octave: 4 } }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const serialized = serializeMnx(parseMnx(source));
    expect(serialized.parts[0]!.measures[0]!.beams).toEqual([]);
  });

  it("preserves a multi-note tremolo individual duration", () => {
    const source = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        {
          measures: [
            {
              sequences: [
                {
                  content: [
                    {
                      type: "tremolo",
                      marks: 2,
                      outer: { duration: { base: "quarter" }, multiple: 2 },
                      individualDuration: { base: "quarter" },
                      content: [
                        { duration: { base: "half" }, notes: [{ pitch: { step: "C", octave: 4 } }] },
                        { duration: { base: "half" }, notes: [{ pitch: { step: "E", octave: 4 } }] },
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
    const serialized = serializeMnx(parseMnx(source));
    const tremolo = serialized.parts[0]!.measures[0]!.sequences![0]!.content[0] as Record<string, unknown>;
    expect(tremolo["individualDuration"]).toEqual({ base: "quarter" });
  });

  it("should have MNX example files to test", () => {
    expect(mnxFiles.length).toBeGreaterThan(0);
  });

  for (const file of mnxFiles) {
    it(`round-trips ${file}`, () => {
      const raw = fs.readFileSync(path.join(scoresDir, file), "utf-8");
      const originalJson = JSON.parse(raw);

      // First parse
      const score1 = parseMnx(originalJson);

      // Serialize back to JSON
      const serialized = serializeMnx(score1);

      // Second parse
      const score2 = parseMnx(serialized);

      // The two Score objects must be identical
      expect(score2).toEqual(score1);
    });
  }
});

describe("MNX serialize → parse produces valid JSON", () => {
  for (const file of mnxFiles) {
    it(`serializes ${file} to valid JSON`, () => {
      const raw = fs.readFileSync(path.join(scoresDir, file), "utf-8");
      const originalJson = JSON.parse(raw);
      const score = parseMnx(originalJson);
      const serialized = serializeMnx(score);

      // Must be serializable to JSON string and back
      const jsonStr = JSON.stringify(serialized);
      expect(() => JSON.parse(jsonStr)).not.toThrow();
    });
  }
});

describe("MNX sound-profile extension round-trip", () => {
  it("preserves a stable part-ID-keyed source assignment", () => {
    const source = {
      mnx: { version: 1 },
      global: { measures: [] },
      parts: [
        { id: "clarinet-1", name: "Clarinet", measures: [] },
        { id: "tuba-1", name: "Tuba", measures: [] },
      ],
      _x: {
        viritura: {
          soundProfile: {
            profileId: "viritura-sounds",
            profileVersion: 1,
            parts: { "clarinet-1": { sourceId: "tuba-primary" } },
          },
        },
      },
    };

    const parsed = parseMnx(source);
    expect(parsed.soundProfile).toEqual(source._x.viritura.soundProfile);
    expect(serializeMnx(parsed)).toMatchObject({
      _x: { viritura: { soundProfile: source._x.viritura.soundProfile } },
    });
    expect(parseMnx(serializeMnx(parsed))).toEqual(parsed);
  });
});

describe("MNX round-trip preserves editor wiring fields", () => {
  it("preserves repeat/ending, clef changes, accidentalDisplay, ties/slurs, and navigation symbols", () => {
    const source = {
      mnx: { version: 1 },
      global: {
        measures: [
          {
            time: { count: 4, unit: 4 },
            repeatStart: { times: 2 },
            ending: { duration: 1, numbers: [1], open: true },
            segno: { location: { fraction: [0, 1] }, glyph: "segno" },
          },
          {
            repeatEnd: { times: 2 },
            _x: {
              viritura: {
                jump: { type: "dcalcoda", location: { fraction: [1, 1] } },
              },
            },
          },
        ],
      },
      parts: [
        {
          name: "Violin",
          measures: [
            {
              clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
              sequences: [
                {
                  content: [
                    {
                      type: "event",
                      id: "ev1",
                      duration: { base: "half" },
                      notes: [
                        {
                          id: "n1",
                          pitch: { step: "F", octave: 4, alter: 1 },
                          ties: [{ target: "n2", side: "up" }],
                          accidentalDisplay: {
                            show: true,
                            force: true,
                            enclosure: { symbol: "parentheses" },
                          },
                        },
                      ],
                      slurs: [{ target: "ev2", side: "down" }],
                    },
                    {
                      type: "event",
                      id: "ev2",
                      duration: { base: "half" },
                      notes: [{ id: "n2", pitch: { step: "F", octave: 4, alter: 1 } }],
                    },
                  ],
                },
              ],
            },
            {
              clefs: [{ clef: { sign: "F", staffPosition: 2 } }],
              sequences: [
                {
                  content: [{ type: "event", duration: { base: "whole" }, rest: {} }],
                },
              ],
            },
          ],
        },
      ],
    };

    // `repeatStart.times` is a retained legacy extension, so this broad wiring
    // fixture intentionally uses the lenient path on both round-trip legs.
    const parsed1 = parseMnxWithDiagnostics(source).score;
    const serialized = serializeMnx(parsed1);
    const parsed2 = parseMnxWithDiagnostics(serialized).score;

    expect(parsed2).toEqual(parsed1);
    expect(serialized.global.measures[0]!.repeatStart).toEqual({ times: 2 });
    expect(serialized.global.measures[0]!.ending).toEqual({ duration: 1, numbers: [1], open: true });
    expect(serialized.global.measures[0]!.segno).toEqual({
      location: { fraction: [0, 1] },
      glyph: "segno",
    });
    expect(serialized.global.measures[1]!.repeatEnd).toEqual({ times: 2 });
    expect(serialized.global.measures[1]!._x?.viritura?.jump).toEqual({
      type: "dcalcoda",
      location: { fraction: [1, 1] },
    });
    expect(serialized.parts[0]!.measures[1]!.clefs![0]!.clef).toEqual({
      sign: "F",
      staffPosition: 2,
    });
    expect(serialized.parts[0]!.measures[0]!.sequences[0]!.content[0]!.notes![0]!.accidentalDisplay).toEqual({
      show: true,
      force: true,
      enclosure: { symbol: "parentheses" },
    });
    expect(serialized.parts[0]!.measures[0]!.sequences[0]!.content[0]!.notes![0]!.ties).toEqual([
      { target: "n2", side: "up" },
    ]);
    expect(serialized.parts[0]!.measures[0]!.sequences[0]!.content[0]!.slurs).toEqual([
      { target: "ev2", side: "down" },
    ]);
  });

  it("preserves a per-note notehead override (_x.viritura.notehead)", () => {
    const source = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        {
          name: "Violin",
          measures: [
            {
              sequences: [
                {
                  content: [
                    {
                      type: "event",
                      duration: { base: "quarter" },
                      notes: [{ pitch: { step: "E", octave: 4 }, _x: { viritura: { notehead: "diamond" } } }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const parsed1 = parseMnx(source);
    expect(parsed1.parts[0]!.measures[0]!.sequences[0]!.content[0]!.notes![0]!.notehead).toBe("diamond");

    const serialized = serializeMnx(parsed1);
    const noteJson = serialized.parts[0]!.measures[0]!.sequences[0]!.content[0]!.notes![0]! as {
      _x?: { viritura?: { notehead?: string } };
    };
    expect(noteJson._x).toEqual({ viritura: { notehead: "diamond" } });

    const parsed2 = parseMnx(serialized);
    expect(parsed2).toEqual(parsed1);
  });
});

describe("MNX round-trip preserves page-turn settings", () => {
  function buildScoreWithPageTurns(pageTurns: unknown) {
    return {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        {
          name: "Violin",
          measures: [
            {
              clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
              sequences: [{ content: [{ duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 4 } }] }] }],
            },
          ],
        },
      ],
      scores: [{ name: "Violin", _x: { viritura: { pageSetup: { pageTurns } } } }],
    };
  }

  it("preserves an enabled page-turn preset through parse → serialize → parse", () => {
    const score1 = parseMnx(buildScoreWithPageTurns({ enabled: true, preset: "professional" }));
    const score2 = parseMnx(serializeMnx(score1));
    expect(score2.scores?.[0]?.pageSetup?.pageTurns).toEqual({ enabled: true, preset: "professional" });
    expect(score2).toEqual(score1);
  });

  it("preserves an explicit disabled page-turn choice (does not drop to undefined)", () => {
    const score1 = parseMnx(buildScoreWithPageTurns({ enabled: false }));
    const score2 = parseMnx(serializeMnx(score1));
    expect(score2.scores?.[0]?.pageSetup?.pageTurns).toEqual({ enabled: false });
    expect(score2).toEqual(score1);
  });

  it("preserves every detailed page-turn setting and objective weight", () => {
    const pageTurns = {
      enabled: true,
      comfortableSecs: 7,
      vsSecs: 4,
      minAcceptableSecs: 2,
      targetFillFraction: 0.92,
      minFillFraction: 0.78,
      verticalJustifyThreshold: 0.68,
      allowPartialPages: false,
      allowIntentionalBlanks: false,
      titlePage: "always",
      firstPageRecto: false,
      emitVsMarks: false,
      defaultBpm: 72,
      weights: {
        density: 2,
        turn: 3,
        sparse: 4,
        titlePage: 5,
        blankPage: 6,
        timeMarking: 7,
      },
    };
    const score1 = parseMnx(buildScoreWithPageTurns(pageTurns));
    const score2 = parseMnx(serializeMnx(score1));

    expect(score2.scores?.[0]?.pageSetup?.pageTurns).toEqual(pageTurns);
    expect(score2).toEqual(score1);
  });
});
