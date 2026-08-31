import { describe, expect, it } from "vitest";
import { findPlaygroundDocument, playgroundDocuments } from "./playgroundDocuments";
import { formatMnxSource } from "./playgroundEditor";
import { validatePlaygroundSource } from "./usePlaygroundDocument";

describe("MNX playground documents", () => {
  it("keeps every curated starter valid", () => {
    for (const document of playgroundDocuments) {
      expect(validatePlaygroundSource(document.source), document.id).toEqual({
        document: JSON.parse(document.source) as object,
      });
    }
  });

  it("beams the three events in the tuplets starter", () => {
    const source = JSON.parse(findPlaygroundDocument("tuplets").source) as {
      parts: Array<{
        measures: Array<{
          beams: Array<{ events: string[] }>;
          sequences: Array<{ content: Array<{ type?: string; content?: Array<{ id?: string }> }> }>;
        }>;
      }>;
    };
    const measure = source.parts[0]!.measures[0]!;
    const tuplet = measure.sequences[0]!.content.find((event) => event.type === "tuplet")!;

    expect(tuplet.content?.map((event) => event.id)).toEqual(["tuplet-1", "tuplet-2", "tuplet-3"]);
    expect(measure.beams).toEqual([{ events: ["tuplet-1", "tuplet-2", "tuplet-3"] }]);
  });

  it("reports malformed JSON before schema validation", () => {
    const result = validatePlaygroundSource('{"mnx":');

    expect(result.document).toBeUndefined();
    expect(result.error).toMatch(/^JSON:/);
  });

  it("reports schema errors without returning a render candidate", () => {
    const result = validatePlaygroundSource(JSON.stringify({ mnx: { version: 1 } }));

    expect(result.document).toBeUndefined();
    expect(result.error).toMatch(/^Schema:/);
  });

  it("formats valid JSON with two-space indentation", () => {
    expect(formatMnxSource('{"mnx":{"version":1}}')).toBe(`{
  "mnx": {
    "version": 1
  }
}`);
  });

  it("falls back to the first starter for an unknown id", () => {
    expect(findPlaygroundDocument("missing")).toBe(playgroundDocuments[0]);
  });
});
