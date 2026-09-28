import { describe, expect, it } from "vitest";
import { parseTextContent } from "../mnx/textContent";
import { migrateLegacyTextContent } from "../mnx/legacyTextContent";
import { parseMnx, parseMnxUnvalidated } from "../mnx/parser";
import { serializeMnx } from "../mnx/serializer";

describe("parseTextContent", () => {
  it("widens a legacy plain string into a single text run", () => {
    expect(parseTextContent("dolce")).toEqual([{ text: "dolce" }]);
    expect(parseTextContent("")).toBeUndefined();
  });

  it("returns undefined for absent or non-text values", () => {
    expect(parseTextContent(undefined)).toBeUndefined();
    expect(parseTextContent(null)).toBeUndefined();
    expect(parseTextContent(42)).toBeUndefined();
    expect(parseTextContent({ text: "dolce" })).toBeUndefined();
  });

  it("keeps text runs with their inline style", () => {
    const content = parseTextContent([{ text: "dolce", style: { weight: "bold", size: 1.5 } }]);
    expect(content).toEqual([{ text: "dolce", style: { weight: "bold", size: 1.5 } }]);
  });

  it("keeps glyph runs and their separate smufl style", () => {
    const content = parseTextContent([{ glyphs: ["dynamicPiano"], smuflStyle: { color: "#ff0000" } }]);
    expect(content).toEqual([{ glyphs: ["dynamicPiano"], smuflStyle: { color: "#ff0000" } }]);
  });

  it("drops chunks that are neither text nor glyph runs", () => {
    // Previously an `Array.isArray` check cast payloads like this straight
    // through, so malformed content reached layout as a `TextContent`.
    expect(parseTextContent([1, 2, 3])).toBeUndefined();
    expect(parseTextContent([{ glyphs: [7] }])).toBeUndefined();
    expect(parseTextContent([{ text: "keep" }, null, { nope: true }])).toEqual([{ text: "keep" }]);
  });

  it("drops style keys outside the documented vocabulary", () => {
    const content = parseTextContent([
      {
        text: "dolce",
        style: { font: "comic-sans", weight: "heavy", size: 0, decorations: ["underline", "sparkle"] },
      },
    ]);
    expect(content).toEqual([{ text: "dolce", style: { decorations: ["underline"] } }]);
  });

  it("drops numeric style values outside the schema bounds", () => {
    // `tempo` is outside viritura-extensions.json, so this decoder is the only
    // validation before layout; an unbounded multiplier would reach geometry.
    expect(parseTextContent([{ text: "dolce", style: { size: 1e6 } }])).toEqual([{ text: "dolce" }]);
    expect(parseTextContent([{ text: "dolce", style: { size: 12 } }])).toEqual([
      { text: "dolce", style: { size: 12 } },
    ]);
    expect(parseTextContent([{ text: "dolce", style: { weight: 0 } }])).toEqual([{ text: "dolce" }]);
    expect(parseTextContent([{ text: "dolce", style: { weight: 5000 } }])).toEqual([{ text: "dolce" }]);
    expect(parseTextContent([{ text: "dolce", style: { weight: 700 } }])).toEqual([
      { text: "dolce", style: { weight: 700 } },
    ]);
  });

  it("omits an empty style rather than emitting a bare object", () => {
    expect(parseTextContent([{ text: "dolce", style: {} }])).toEqual([{ text: "dolce" }]);
  });
});

describe("tempo text content", () => {
  function documentWithTempoText(text: unknown) {
    return {
      mnx: { version: 1 },
      global: {
        measures: [
          {
            time: { count: 4, unit: 4 },
            tempos: [{ bpm: 120, value: { base: "quarter" }, _x: { viritura: { text } } }],
          },
        ],
      },
      parts: [{ id: "part-1", measures: [{ sequences: [{ content: [] }] }] }],
    };
  }

  it("round-trips styled chunks through parse and serialize", () => {
    const text = [{ text: "Allegro ", style: { fontStyle: "italic" } }, { glyphs: ["metNoteQuarterUp"] }];
    const score = parseMnx(documentWithTempoText(text));
    expect(score.global.measures[0].tempos?.[0].text).toEqual(text);

    const out = serializeMnx(score) as Record<string, unknown>;
    const global = out["global"] as { measures: { tempos: { _x: { viritura: { text: unknown } } }[] }[] };
    expect(global.measures[0].tempos[0]._x.viritura.text).toEqual(text);
  });

  it("ignores a malformed tempo text payload instead of adopting it", () => {
    // The schema rejects this shape, so only the unvalidated entry point can
    // reach the decoder with it — third-party and recovery imports use that path.
    const score = parseMnxUnvalidated(documentWithTempoText([1, 2, 3]));
    expect(score.global.measures[0].tempos?.[0].text).toBeUndefined();
  });

  it("keeps the usable chunks of a partly malformed payload", () => {
    const score = parseMnxUnvalidated(documentWithTempoText([{ text: "Allegro" }, { bogus: true }]));
    expect(score.global.measures[0].tempos?.[0].text).toEqual([{ text: "Allegro" }]);
  });

  it("accepts a legacy plain-string document through the validating parser", () => {
    // The schema is array-only, so this document only loads because the
    // migration widens it before validation runs.
    const score = parseMnx(documentWithTempoText("Molto moderato"));
    expect(score.global.measures[0].tempos?.[0].text).toEqual([{ text: "Molto moderato" }]);
  });
});

describe("migrateLegacyTextContent", () => {
  const legacyDocument = {
    mnx: { version: 1 },
    global: {
      measures: [
        {
          time: { count: 4, unit: 4 },
          tempos: [{ bpm: 120, value: { base: "quarter" }, _x: { viritura: { text: "Andante" } } }],
          _x: { viritura: { rehearsalMark: { text: "A" } } },
        },
      ],
    },
    parts: [
      {
        id: "part-1",
        measures: [
          {
            sequences: [{ content: [] }],
            _x: { viritura: { expressions: [{ text: "dolce", position: { fraction: [0, 1] } }] } },
          },
        ],
      },
    ],
  };

  it("widens strings at all three text-content sites", () => {
    const out = migrateLegacyTextContent(structuredClone(legacyDocument)) as typeof legacyDocument;
    expect(out.global.measures[0]!.tempos[0]!._x.viritura.text).toEqual([{ text: "Andante" }]);
    expect(out.global.measures[0]!._x.viritura.rehearsalMark.text).toEqual([{ text: "A" }]);
    expect(out.parts[0]!.measures[0]!._x.viritura.expressions[0]!.text).toEqual([{ text: "dolce" }]);
  });

  it("does not mutate the input document", () => {
    const input = structuredClone(legacyDocument);
    const snapshot = structuredClone(input);
    migrateLegacyTextContent(input);
    expect(input).toEqual(snapshot);
  });

  it("returns the same reference when there is nothing to upgrade", () => {
    const current = structuredClone(legacyDocument);
    current.global.measures[0]!.tempos[0]!._x.viritura.text = [{ text: "Andante" }] as never;
    current.global.measures[0]!._x.viritura.rehearsalMark.text = [{ text: "A" }] as never;
    current.parts[0]!.measures[0]!._x.viritura.expressions[0]!.text = [{ text: "dolce" }] as never;
    expect(migrateLegacyTextContent(current)).toBe(current);
  });

  it("leaves non-object input alone", () => {
    expect(migrateLegacyTextContent(null)).toBeNull();
    expect(migrateLegacyTextContent("nope")).toBe("nope");
  });
});
