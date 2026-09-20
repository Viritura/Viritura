import { describe, expect, it } from "vitest";
import { readMuseScoreClipboard } from ".";

const PITCH = "<pitch>60</pitch><tpc>14</tpc>";
const NOTE = `<Note>${PITCH}</Note>`;
const SKIP = { unsupported: "skip" } as const;
const chord = (properties = "") => `<Chord><durationType>quarter</durationType>${properties}${NOTE}</Chord>`;
const staffList = (content: string) =>
  `<StaffList version="4.70" tick="0/1" len="1/1" staff="1" staves="1"><Staff id="1">${content}</Staff></StaffList>`;

const contexts = [
  ["chord", (property: string) => chord(property)],
  ["rest", (property: string) => `<Rest><durationType>quarter</durationType>${property}</Rest>`],
  ["note", (property: string) => `<Chord><durationType>quarter</durationType><Note>${PITCH}${property}</Note></Chord>`],
  [
    "accidental",
    (property: string) =>
      `<Chord><durationType>quarter</durationType><Note>${PITCH}<Accidental><subtype>accidentalNatural</subtype>${property}</Accidental></Note></Chord>`,
  ],
  [
    "tuplet",
    (property: string) =>
      `<Tuplet><normalNotes>2</normalNotes><actualNotes>3</actualNotes><baseNote>quarter</baseNote>${property}</Tuplet>${chord().repeat(3)}<endTuplet/>`,
  ],
  ["staff annotation", (property: string) => `<StaffText><text>custom</text>${property}</StaffText>${chord()}`],
  ["dynamic", (property: string) => `<Dynamic><subtype>other</subtype>${property}</Dynamic>${chord()}`],
  [
    "harmony",
    (property: string) =>
      `<Harmony><harmonyInfo><root>14</root><name>m7</name></harmonyInfo>${property}</Harmony>${chord()}`,
  ],
] as const;

describe.each(contexts)("%s recovery shape boundaries", (_name, wrap) => {
  it.each([
    "<offset><unknownTiming>1/4</unknownTiming></offset>",
    "<color><Events><Event><ontime>0</ontime></Event></Events></color>",
    '<offset x="1" unknownTiming="1/4"/>',
    '<color r="255" unknownTiming="1/4"/>',
    '<offset x="1">1/4</offset>',
    '<color r="255">unexpected</color>',
    "<placement><unknownTiming>1/4</unknownTiming></placement>",
  ])("rejects malformed discarded properties: %s", (property) => {
    expect(() => readMuseScoreClipboard(staffList(wrap(property)), undefined, SKIP)).toThrow(
      expect.objectContaining({ code: "invalid-structure" }),
    );
  });

  it.each(['<offset x="1" y="2"/>', '<color r="255" g="0" b="0" a="255"/>'])(
    "still recovers known attribute-only styling: %s",
    (property) => {
      const data = readMuseScoreClipboard(staffList(wrap(property)), undefined, SKIP);
      expect(data.content.length).toBeGreaterThan(0);
      expect(data.diagnostics?.length).toBeGreaterThan(0);
    },
  );
});

describe("note embellishment recovery shapes", () => {
  it.each(["Fingering", "Symbol", "Image", "Text", "Bend", "Ornament", "Articulation", "NoteDot"])(
    "rejects unknown nesting and attributes inside %s",
    (tag) => {
      for (const fields of [
        "<unknownTiming>1/4</unknownTiming>",
        "<text><unknownTiming>1/4</unknownTiming></text>",
        '<offset x="1" unknownTiming="1/4"/>',
      ]) {
        const content = `<Chord><durationType>quarter</durationType><Note>${PITCH}<${tag}>${fields}</${tag}></Note></Chord>`;
        expect(() => readMuseScoreClipboard(staffList(content), undefined, SKIP)).toThrow(
          expect.objectContaining({ code: "invalid-structure" }),
        );
      }
    },
  );

  it.each([
    '<Bend><point time="0" pitch="100" vibrato="0"/></Bend>',
    "<Fingering><text><b>3</b></text></Fingering>",
    '<NoteDot><offset x="1" y="0"/></NoteDot>',
  ])("retains notes with known embellishment shapes: %s", (property) => {
    const content = `<Chord><durationType>quarter</durationType><Note>${PITCH}${property}</Note></Chord>`;
    const data = readMuseScoreClipboard(staffList(content), undefined, SKIP);
    expect(data.content[0]).toMatchObject({ notes: [{ pitch: { step: "C", octave: 4 } }] });
    expect(data.diagnostics).toHaveLength(1);
  });
});
