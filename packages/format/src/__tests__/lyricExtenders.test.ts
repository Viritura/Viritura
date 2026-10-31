import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseMnx } from "../mnx/parser";
import { serializeMnx } from "../mnx/serializer";
import { DeltaSerializer } from "../mnx/deltaSerializer";
import { applyPatchesToScore, patch } from "@viritura/core";

function documentWithExtenders() {
  return {
    mnx: { version: 1, support: { useLyricExtenders: false } },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [
      {
        id: "part-1",
        measures: [
          {
            sequences: [
              {
                content: [
                  {
                    id: "event-1",
                    duration: { base: "quarter" },
                    notes: [{ pitch: { step: "C", octave: 4 } }],
                    lyrics: {
                      lines: {
                        verse: {
                          text: "Ah",
                          extender: {
                            id: "word-line",
                            target: "event-2",
                            _c: "comment",
                            _x: { example: { annotation: "retained" } },
                          },
                        },
                        second: { text: "No", extender: { show: false, target: "ignored" } },
                        third: { text: "Mm", extender: {} },
                      },
                    },
                  },
                  {
                    id: "event-2",
                    duration: { base: "quarter" },
                    notes: [{ pitch: { step: "D", octave: 4 } }],
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

describe("MNX lyric extenders", () => {
  it("keeps cold, cached and edited delta output identical to full serialization", () => {
    let score = parseMnx(documentWithExtenders());
    const delta = new DeltaSerializer();
    const locator = { sequencePath: { partId: "part-1", measureIndex: 0, voice: 0 }, eventId: "event-1" };
    const edits = [
      patch.setMnxSupport({ useLyricExtenders: true }),
      patch.setEventField(locator, {
        field: "lyrics",
        value: { lines: { verse: { text: "Ah", extender: { target: "event-1" } } } },
      }),
      patch.setEventField(locator, {
        field: "lyrics",
        value: { lines: { verse: { text: "Ah", extender: { show: false } } } },
      }),
      patch.setEventField(locator, { field: "lyrics", value: undefined }),
      patch.setMnxSupport(undefined),
    ];
    expect(delta.serialize(score).json).toBe(JSON.stringify(serializeMnx(score)));
    for (const edit of edits) {
      score = applyPatchesToScore(score, [edit]);
      const output = delta.serialize(score);
      expect(output.json).toBe(JSON.stringify(serializeMnx(score)));
      expect(delta.serialize(score).json).toBe(output.json);
      expect(serializeMnx(parseMnx(JSON.parse(output.json)))).toEqual(serializeMnx(score));
    }
  });

  it("preserves support policy, explicit suppression, inferred show, and target omission", () => {
    const score = parseMnx(documentWithExtenders());
    expect(score.mnx.support?.useLyricExtenders).toBe(false);
    expect(score.parts[0]!.measures[0]!.sequences[0]!.content[0]).toMatchObject({
      lyrics: {
        lines: {
          verse: {
            extender: {
              id: "word-line",
              target: "event-2",
              _c: "comment",
              _x: { example: { annotation: "retained" } },
            },
          },
          second: { extender: { show: false, target: "ignored" } },
          third: { extender: {} },
        },
      },
    });
  });

  it("round-trips extenders through full serialization", () => {
    const score = parseMnx(documentWithExtenders());
    const serialized = serializeMnx(score);
    expect(parseMnx(serialized)).toEqual(score);
  });

  it("loads the pinned v46 extender fixture through generated raw types", () => {
    const fixture = readFileSync(resolve(__dirname, "../../fixtures/mnx-v46/lyric-extenders.mnx"), "utf8");
    const score = parseMnx(JSON.parse(fixture));
    expect(score.mnx.support?.useLyricExtenders).toBe(true);
    expect(score.parts[0]!.measures[0]!.sequences[0]!.content[0]).toMatchObject({
      lyrics: {
        lines: {
          "1": {
            extender: {
              id: "word-line",
              show: true,
              target: "last-covered-event",
              _c: "retained extender note",
              _x: { example: { annotation: "retained" } },
            },
          },
        },
      },
    });
  });
});
