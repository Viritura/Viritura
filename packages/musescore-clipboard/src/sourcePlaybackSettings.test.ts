import { describe, expect, it } from "vitest";
import { MuseScoreConversionError, readMuseScoreClipboard } from ".";
import { readFileSync } from "node:fs";

const hairpinXml = readFileSync(new URL("../fixtures/realCaptures/hairpin.xml", import.meta.url), "utf8");

const dynamicXml = `<StaffList version="4.70" tick="0/1" len="1/4" staff="0" staves="1"><Staff id="0">
  <Dynamic><subtype>mf</subtype></Dynamic>
  <Chord><durationType>quarter</durationType><Note><pitch>60</pitch><tpc>14</tpc></Note></Chord>
</Staff></StaffList>`;

// MuseScore v4.7.5 writes only these element-specific playback properties:
// Dynamic: https://github.com/musescore/MuseScore/blob/3654226c2e99289916916953a98e585a3d3b315a/src/engraving/rw/write/twrite.cpp#L1288-L1308
// Hairpin: https://github.com/musescore/MuseScore/blob/3654226c2e99289916916953a98e585a3d3b315a/src/engraving/rw/write/twrite.cpp#L1683-L1707
// Hairpin PLAY is inherited through TextLineBase / SLine / Spanner (L1592-L1602, L1642-L1672).
// Scalar writeProperty emits text without attributes:
// https://github.com/musescore/MuseScore/blob/3654226c2e99289916916953a98e585a3d3b315a/src/engraving/rw/xmlwriter.cpp#L250-L310
const playbackSettings = [
  {
    element: "Dynamic",
    xml: dynamicXml,
    ignored: ["velocity", "play", "veloChange", "veloChangeSpeed"],
    rejected: ["visible", "offset", "ticks_f", "dynRange", "dynType", "singleNoteDynamics", "veloChangeMethod"],
  },
  {
    element: "HairPin",
    xml: hairpinXml,
    ignored: ["veloChange", "singleNoteDynamics", "veloChangeMethod", "play"],
    rejected: ["visible", "height", "beginText", "duration", "dynRange", "dynType", "velocity", "veloChangeSpeed"],
  },
];

function withoutIds(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (key, item: unknown) => (key === "id" ? undefined : item)));
}

describe.each(playbackSettings)("$element source playback settings", ({ element, xml, ignored, rejected }) => {
  const withProperty = (property: string) => xml.replace(`</${element}>`, `${property}</${element}>`);

  // Numeric velocity variants already have regression coverage in museScoreClipboard.test.ts.
  it.each(
    ignored
      .filter((field) => field !== "velocity")
      .flatMap((field) => ["", "0", "1", "20", "not a number"].map((value) => ({ field, value }))),
  )("discards $field=$value exactly like an absent property", ({ field, value }) => {
    const parsed = readMuseScoreClipboard(withProperty(`<${field}>${value}</${field}>`));
    expect(withoutIds(parsed)).toEqual(withoutIds(readMuseScoreClipboard(xml)));
  });

  it.each(ignored)("rejects nested XML in %s without swallowing notation", (field) => {
    const parse = () => readMuseScoreClipboard(withProperty(`<${field}><subtype>f</subtype></${field}>`));
    expect(parse).toThrow(MuseScoreConversionError);
    expect(parse).toThrow(
      element === "Dynamic" ? `${field} must be scalar` : "connector scalar properties cannot contain nested elements",
    );
  });

  it.each(ignored)("rejects attributes on %s", (field) => {
    const parse = () => readMuseScoreClipboard(withProperty(`<${field} value="0">1</${field}>`));
    expect(parse).toThrow(MuseScoreConversionError);
    expect(parse).toThrow(
      element === "Dynamic" ? `${field} must be scalar` : "connector scalar properties cannot contain attributes",
    );
  });

  it.each(rejected)("still rejects non-playback or wrong-element property %s", (field) => {
    const parse = () => readMuseScoreClipboard(withProperty(`<${field}>0</${field}>`));
    expect(parse).toThrow(MuseScoreConversionError);
    expect(parse).toThrow(`property "${field}" is not supported`);
  });
});

it("imports a source-muted mf as an active semantic dynamic without metadata", () => {
  const parsed = readMuseScoreClipboard(
    dynamicXml.replace(
      "</Dynamic>",
      "<play>0</play><veloChange>20</veloChange><veloChangeSpeed>1</veloChangeSpeed></Dynamic>",
    ),
  );
  expect(parsed.dynamics).toEqual([
    {
      partOffset: 0,
      measureOffset: 0,
      staffOffset: 0,
      offset: [0, 1],
      dynamic: {
        id: expect.any(String),
        type: "immediate",
        value: "mf",
        position: { fraction: [0, 1] },
      },
    },
  ]);
});

it("keeps the captured crescendo and exact endpoint when source playback is disabled or interpolated", () => {
  const xml = hairpinXml
    .replace("</Dynamic>", "<play>0</play></Dynamic>")
    .replace(
      "</HairPin>",
      "<veloChange>20</veloChange><singleNoteDynamics>0</singleNoteDynamics>" +
        "<veloChangeMethod>1</veloChangeMethod><play>0</play></HairPin>",
    );
  const parsed = readMuseScoreClipboard(xml);
  expect(withoutIds(parsed)).toEqual(withoutIds(readMuseScoreClipboard(hairpinXml)));
  expect(parsed.dynamics).toEqual([
    {
      measureOffset: 0,
      endMeasureOffset: 0,
      staffOffset: 0,
      offset: [0, 1],
      endOffset: [3, 4],
      dynamic: {
        id: expect.any(String),
        type: "gradual",
        value: "mf",
        wedgeType: "increasing",
        position: { fraction: [0, 1] },
        end: { measure: "0", position: { fraction: [3, 4] } },
      },
    },
  ]);
});
