import { describe, expect, it } from "vitest";
import { parseMnx } from "../mnx/parser";
import { serializeMnx } from "../mnx/serializer";
import { DeltaSerializer } from "../mnx/deltaSerializer";

function documentWithWorkflow() {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [{ id: "part-1", measures: [{ sequences: [{ content: [] }] }] }],
    _x: {
      viritura: {
        lyricWorkflow: {
          sources: {
            "source-1": {
              id: "source-1",
              lineId: "verse",
              text: "Hal-le _",
              language: "en",
              tokens: [
                {
                  id: "token-1",
                  text: "Hal",
                  type: "start",
                  eventId: "event-1",
                  partId: "part-1",
                  sequenceIndex: 0,
                },
                { id: "token-2", skip: true },
              ],
            },
          },
        },
      },
    },
  };
}

describe("lyric workflow vendor extension", () => {
  it("round-trips original source text and stable token anchors", () => {
    const score = parseMnx(documentWithWorkflow());
    expect(score.lyricWorkflow?.sources["source-1"]?.text).toBe("Hal-le _");
    expect(parseMnx(serializeMnx(score)).lyricWorkflow).toEqual(score.lyricWorkflow);
  });

  it("rejects malformed source records through schema validation", () => {
    const document = documentWithWorkflow();
    document._x.viritura.lyricWorkflow.sources["source-1"]!.tokens[0]!.sequenceIndex = -1;
    expect(() => parseMnx(document)).toThrow(/sequenceIndex/);
  });

  it("marks workflow-only edits as structural serialization changes", () => {
    const score = parseMnx(documentWithWorkflow());
    const serializer = new DeltaSerializer();
    serializer.serialize(score);
    const edited = structuredClone(score);
    edited.lyricWorkflow!.sources["source-1"]!.text = "Changed source";
    expect(serializer.serialize(edited).structuralChange).toBe(true);
  });
});
