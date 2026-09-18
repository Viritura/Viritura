import { describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import { parseMnx, serializeMnx } from "@viritura/format";
import { applyPaste, type ClipboardSelection } from "../../commands/clipboardCommands";
import {
  MUSESCORE_STAFF_LIST_MIME,
  MUSESCORE_SYMBOL_LIST_MIME,
  MuseScoreConversionError,
  readMuseScoreClipboard,
  writeMuseScoreStaffList,
} from ".";
import { physicalStaffOffset } from "../clipboardTrackMapping";

const USER_STAFF_LIST = `<?xml version="1.0" encoding="UTF-8"?>
<StaffList version="4.70" tick="0/1" len="4/4" staff="22" staves="1">
  <Staff id="22">
    <voiceOffset><voice id="0">0</voice></voiceOffset>
    <Harmony><harmonyInfo><name>m</name><root>14</root></harmonyInfo></Harmony>
    <Dynamic><subtype>mf</subtype><velocity>96</velocity></Dynamic>
    <Chord><durationType>eighth</durationType><Note><pitch>75</pitch><tpc>11</tpc></Note></Chord>
    <Chord><durationType>eighth</durationType><Note><pitch>79</pitch><tpc>15</tpc></Note></Chord>
    <Chord><durationType>eighth</durationType><Note><pitch>84</pitch><tpc>14</tpc></Note></Chord>
    <Chord><durationType>eighth</durationType><Note><pitch>86</pitch><tpc>16</tpc></Note></Chord>
    <Chord><durationType>eighth</durationType><Note><pitch>87</pitch><tpc>11</tpc></Note></Chord>
    <Chord><durationType>eighth</durationType><Note><pitch>86</pitch><tpc>16</tpc></Note></Chord>
    <Chord><durationType>eighth</durationType><Note><pitch>84</pitch><tpc>14</tpc></Note></Chord>
    <Chord><durationType>eighth</durationType><Note><pitch>79</pitch><tpc>15</tpc></Note></Chord>
  </Staff>
</StaffList>`;

function destinationScore(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 }, key: { fifths: 0 } }] },
    parts: [
      {
        name: "Piano",
        measures: [
          {
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
}

describe("MuseScore StaffList import", () => {
  it("imports the supplied MuseScore 4.70 notes, C minor harmony, and written mf", () => {
    const parsed = readMuseScoreClipboard(USER_STAFF_LIST, MUSESCORE_STAFF_LIST_MIME);
    expect(parsed.content).toHaveLength(8);
    expect(parsed.content.map((item) => (item.type === "event" ? item.notes?.[0]?.pitch : undefined))).toEqual([
      { step: "E", octave: 5, alter: -1 },
      { step: "G", octave: 5 },
      { step: "C", octave: 6 },
      { step: "D", octave: 6 },
      { step: "E", octave: 6, alter: -1 },
      { step: "D", octave: 6 },
      { step: "C", octave: 6 },
      { step: "G", octave: 5 },
    ]);
    expect(parsed.content.every((item) => item.type === "event" && item.duration.base === "eighth")).toBe(true);
    expect(parsed.chordSymbols?.[0]?.chordSymbol).toMatchObject({
      root: { step: "C" },
      quality: "minor",
      position: { fraction: [0, 1] },
    });
    expect(parsed.dynamics?.[0]?.dynamic).toEqual({
      id: expect.any(String),
      type: "immediate",
      value: "mf",
      position: { fraction: [0, 1] },
    });
  });

  it.each([-1, 0, 1, 49, 80, 96, 127, 128])(
    "ignores source dynamic velocity %s without retaining metadata",
    (velocity) => {
      const parsed = readMuseScoreClipboard(
        USER_STAFF_LIST.replace("<velocity>96</velocity>", `<velocity>${velocity}</velocity>`),
      );
      const semantic = readMuseScoreClipboard(USER_STAFF_LIST.replace("<velocity>96</velocity>", ""));
      const withoutIds = (value: unknown): unknown =>
        JSON.parse(JSON.stringify(value, (key, item: unknown) => (key === "id" ? undefined : item)));
      expect(withoutIds(parsed)).toEqual(withoutIds(semantic));
    },
  );

  it("rejects nested notation in a recognized scalar dynamic property", () => {
    const xml = USER_STAFF_LIST.replace("<velocity>96</velocity>", "<velocity><subtype>f</subtype></velocity>");
    expect(() => readMuseScoreClipboard(xml)).toThrow("velocity must be scalar");
  });

  it("applies imported annotations and a whole note of melody atomically", () => {
    const parsed = readMuseScoreClipboard(USER_STAFF_LIST);
    const score = applyPaste(destinationScore(), parsed, 0, 0, 0, 0);
    expect(score.parts[0]!.measures[0]!.sequences[0]!.content).toHaveLength(8);
    expect(score.parts[0]!.measures[0]!.chordSymbols?.[0]).toMatchObject({
      root: { step: "C" },
      quality: "minor",
    });

    expect(score.parts[0]!.measures[0]!.dynamics?.[0]).toEqual({
      id: expect.any(String),
      type: "immediate",
      value: "mf",
      staff: 1,
      position: { fraction: [0, 16] },
    });
    const mnx = serializeMnx(score);
    expect(mnx).toHaveProperty("parts.0.measures.0.dynamics", score.parts[0]!.measures[0]!.dynamics);
    expect(parseMnx(mnx).parts[0]!.measures[0]!.dynamics).toEqual(score.parts[0]!.measures[0]!.dynamics);
  });

  it("places imported melody, Cm, and mf on the selected lower destination staff", () => {
    const parsed = readMuseScoreClipboard(USER_STAFF_LIST);
    const score = destinationScore();
    score.parts[0]!.staves = 2;
    score.parts[0]!.measures[0]!.sequences.push({
      staff: 2,
      content: [{ type: "event", duration: { base: "whole" }, rest: {} }],
    });
    const pasted = applyPaste(score, parsed, 0, 0, 1, 0);
    expect(pasted.parts[0]!.measures[0]!.chordSymbols?.[0]?.displayStaff).toBe(2);
    expect(pasted.parts[0]!.measures[0]!.dynamics?.[0]?.staff).toBe(2);
    expect(pasted.parts[0]!.measures[0]!.sequences[0]).toEqual(score.parts[0]!.measures[0]!.sequences[0]);
  });

  it("keeps primary harmony ownership explicit when StaffList contains multiple voices", () => {
    const xml = USER_STAFF_LIST.replace(
      "</Staff>",
      `<location><voices>1</voices><fractions>-1/1</fractions></location>
       <Chord><durationType>whole</durationType><Note><pitch>60</pitch><tpc>14</tpc></Note></Chord></Staff>`,
    );
    const parsed = readMuseScoreClipboard(xml);
    expect(parsed.tracks).toHaveLength(2);
    const pasted = applyPaste(destinationScore(), parsed, 0, 0, 0, 0);
    expect(pasted.parts[0]!.measures[0]!.chordSymbols?.[0]).toMatchObject({
      displayStaff: 1,
      root: { step: "C" },
      quality: "minor",
    });
    expect(pasted.parts[0]!.measures[0]!.dynamics?.[0]).toMatchObject({ staff: 1, value: "mf" });
  });

  it("decodes nested tuplets and dotted chords", () => {
    const xml = `<StaffList version="4.70" tick="0/1" len="1/2" staff="0" staves="1"><Staff id="0">
      <voiceOffset><voice id="0">0</voice></voiceOffset>
      <Tuplet><normalNotes>2</normalNotes><actualNotes>3</actualNotes><baseNote>eighth</baseNote></Tuplet>
      <Chord><durationType>eighth</durationType><Note><pitch>60</pitch><tpc>14</tpc></Note></Chord>
      <Tuplet><normalNotes>2</normalNotes><actualNotes>3</actualNotes><baseNote>16th</baseNote></Tuplet>
      <Chord><durationType>16th</durationType><Note><pitch>62</pitch><tpc>16</tpc></Note></Chord>
      <Chord><durationType>16th</durationType><Note><pitch>64</pitch><tpc>18</tpc></Note></Chord>
      <Chord><durationType>16th</durationType><Note><pitch>65</pitch><tpc>13</tpc></Note></Chord>
      <endTuplet/><Chord><durationType>eighth</durationType><Note><pitch>67</pitch><tpc>15</tpc></Note></Chord>
      <endTuplet/></Staff></StaffList>`;
    const parsed = readMuseScoreClipboard(xml);
    expect(parsed.content[0]).toMatchObject({
      type: "tuplet",
      inner: { multiple: 3 },
      outer: { multiple: 2 },
      content: [
        { type: "event", duration: { base: "eighth" } },
        { type: "tuplet", inner: { multiple: 3 }, outer: { multiple: 2 } },
        { type: "event", duration: { base: "eighth" } },
      ],
    });
  });

  it("preserves physical staff, voice, and voiceOffset metadata", () => {
    const xml = `<StaffList version="4.70" tick="0/1" len="1/2" staff="4" staves="2">
      <Staff id="4"><voiceOffset><voice id="0">0</voice></voiceOffset>
      <Chord><durationType>quarter</durationType><Note><pitch>60</pitch><tpc>14</tpc></Note></Chord></Staff>
      <Staff id="5"><voiceOffset><voice id="2">480</voice></voiceOffset>
      <location><voices>2</voices></location>
      <Chord><durationType>quarter</durationType><Note><pitch>48</pitch><tpc>14</tpc></Note></Chord></Staff>
    </StaffList>`;
    const parsed = readMuseScoreClipboard(xml);
    expect(parsed.tracks).toMatchObject([
      { staffOffset: 0, voiceIndex: 0 },
      { staffOffset: 1, voiceIndex: 2, leadIn: [1, 4] },
    ]);

    const score = destinationScore();
    score.parts[0]!.staves = 2;
    score.parts[0]!.measures[0]!.sequences = [
      { staff: 1, content: [{ type: "event", duration: { base: "whole" }, rest: {} }] },
      { staff: 2, content: [] },
      { staff: 2, content: [] },
      { staff: 2, content: [{ type: "event", duration: { base: "whole" }, rest: {} }] },
    ];
    const pasted = applyPaste(score, parsed, 0, 0, 0, 0);
    const lowerStaffVoices = pasted.parts[0]!.measures[0]!.sequences.filter((sequence) => sequence.staff === 2);
    expect(lowerStaffVoices[2]!.content).toMatchObject([
      { type: "event", duration: { base: "quarter" }, rest: {} },
      { type: "event", notes: [{ pitch: { step: "C", octave: 3 } }] },
      { type: "event", duration: { base: "half" }, rest: {} },
    ]);
  });

  it("normalizes physical staff offsets to a lower-staff source anchor", () => {
    const score = destinationScore();
    score.parts[0]!.staves = 2;
    score.parts[0]!.measures[0]!.sequences = [
      { staff: 1, content: [] },
      { staff: 2, content: [] },
    ];
    expect(physicalStaffOffset(score, 0, 0, 1, 0, 0, 1)).toBe(0);
  });

  it.each([
    [`<StaffList version="4.7" tick="0/1" len="1/4" staff="0" staves="1"><Staff id="0"/></StaffList>`, "version"],
    [`<!DOCTYPE StaffList><StaffList version="4.70"/>`, "DTD"],
    [
      `<StaffList version="4.70" tick="0/1" len="1/4" staff="0" staves="1"><Staff id="0"><Bogus/></Staff></StaffList>`,
      "Bogus",
    ],
    [`<StaffList`, "malformed"],
  ])("rejects unsafe, future, malformed, or unknown input", (xml, message) => {
    expect(() => readMuseScoreClipboard(xml)).toThrowError(MuseScoreConversionError);
    expect(() => readMuseScoreClipboard(xml)).toThrow(message);
  });

  it("rejects SymbolList annotations explicitly rather than guessing notes", () => {
    const xml = `<SymbolList version="4.70"><trackOffset>0</trackOffset><Dynamic><subtype>mf</subtype></Dynamic></SymbolList>`;
    expect(() => readMuseScoreClipboard(xml, MUSESCORE_SYMBOL_LIST_MIME)).toThrow("not supported");
  });

  it("imports a single Note symbol with the default quarter duration", () => {
    const parsed = readMuseScoreClipboard(`<EngravingItem><Note><pitch>61</pitch><tpc>21</tpc></Note></EngravingItem>`);
    expect(parsed.content[0]).toMatchObject({
      type: "event",
      duration: { base: "quarter" },
      notes: [{ pitch: { step: "C", alter: 1, octave: 4 } }],
    });
  });

  it("preserves enharmonic C-flat and B-sharp TPC spellings", () => {
    const parsed = readMuseScoreClipboard(
      `<StaffList version="4.70" tick="0/1" len="1/2" staff="0" staves="1"><Staff id="0">` +
        `<voiceOffset><voice id="0">0</voice></voiceOffset>` +
        `<Chord><durationType>quarter</durationType><Note><pitch>59</pitch><tpc>7</tpc></Note></Chord>` +
        `<Chord><durationType>quarter</durationType><Note><pitch>72</pitch><tpc>26</tpc></Note></Chord>` +
        `</Staff></StaffList>`,
    );
    expect(parsed.content).toMatchObject([
      { notes: [{ pitch: { step: "C", octave: 4, alter: -1 } }] },
      { notes: [{ pitch: { step: "B", octave: 4, alter: 1 } }] },
    ]);
  });

  it("rejects partial tuplets", () => {
    const xml = `<StaffList version="4.70" tick="0/1" len="1/4" staff="0" staves="1"><Staff id="0">
      <Tuplet><normalNotes>2</normalNotes><actualNotes>3</actualNotes><baseNote>eighth</baseNote></Tuplet>
      <Chord><durationType>eighth</durationType><Note><pitch>60</pitch><tpc>14</tpc></Note></Chord>
    </Staff></StaffList>`;
    expect(() => readMuseScoreClipboard(xml)).toThrow("missing endTuplet");
  });
});

describe("MuseScore StaffList export", () => {
  it("writes exact 4.70 StaffList with notes, rests, dots, spelling, harmony, and semantic dynamics", () => {
    const selection: ClipboardSelection = {
      events: [
        {
          type: "event",
          duration: { base: "eighth", dots: 1 },
          notes: [{ pitch: { step: "E", octave: 5, alter: -1 } }],
        },
        { type: "event", duration: { base: "16th" }, rest: {} },
      ],
      timeSignature: { count: 4, unit: 4 },
      keySignature: { fifths: 0 },
      dynamics: [
        {
          measureOffset: 0,
          offset: [0, 1],
          dynamic: {
            id: "mf",
            type: "immediate",
            value: "mf",
            position: { fraction: [0, 1] },
          },
        },
      ],
      chordSymbols: [
        {
          measureOffset: 0,
          offset: [0, 1],
          chordSymbol: { position: { fraction: [0, 1] }, root: { step: "C" }, quality: "minor" },
        },
      ],
      partIndex: 0,
      measureIndex: 0,
      sequenceIndex: 0,
      eventIndex: 0,
    };
    const result = writeMuseScoreStaffList(selection);
    expect(result.warning).toBeUndefined();
    expect(result.xml).toContain('<StaffList version="4.70" tick="0/1" len="1/4" staff="0" staves="1">');
    expect(result.xml).toContain("<Harmony><harmonyInfo><name>m</name><root>14</root>");
    expect(result.xml).toContain("<Dynamic><subtype>mf</subtype></Dynamic>");
    expect(result.xml).not.toContain("<velocity>");
    expect(result.xml).toContain("<pitch>75</pitch><tpc>11</tpc>");
    expect(result.xml).toContain("<dots>1</dots>");
    const parsed = readMuseScoreClipboard(result.xml!);
    expect(parsed.content).toHaveLength(2);
    expect(parsed.dynamics?.[0]?.dynamic).toEqual({
      id: expect.any(String),
      type: "immediate",
      value: "mf",
      position: { fraction: [0, 1] },
    });
  });

  it("returns an explicit warning while leaving callers free to preserve native JSON", () => {
    const selection: ClipboardSelection = {
      events: [
        {
          type: "event",
          duration: { base: "quarter" },
          notes: [{ pitch: { step: "C", octave: 4 }, ties: [{ target: "outside" }] }],
        },
      ],
      timeSignature: { count: 4, unit: 4 },
      keySignature: { fifths: 0 },
      partIndex: 0,
      measureIndex: 0,
      sequenceIndex: 0,
      eventIndex: 0,
    };
    expect(writeMuseScoreStaffList(selection)).toMatchObject({ xml: null, warning: expect.stringContaining("ties") });
  });

  it("derives MuseScore tuplet ratios from both inner and outer durations", () => {
    const selection: ClipboardSelection = {
      events: [
        {
          type: "tuplet",
          inner: { duration: { base: "eighth" }, multiple: 3 },
          outer: { duration: { base: "quarter" }, multiple: 1 },
          content: (["C", "D", "E"] as const).map((step) => ({
            type: "event" as const,
            duration: { base: "eighth" as const },
            notes: [{ pitch: { step, octave: 4 as const } }],
          })),
        },
      ],
      timeSignature: { count: 4, unit: 4 },
      keySignature: { fifths: 0 },
      partIndex: 0,
      measureIndex: 0,
      sequenceIndex: 0,
      eventIndex: 0,
    };
    const result = writeMuseScoreStaffList(selection);
    expect(result.xml).toContain("<normalNotes>2</normalNotes><actualNotes>3</actualNotes><baseNote>eighth</baseNote>");
    expect(readMuseScoreClipboard(result.xml!).content[0]).toMatchObject({
      type: "tuplet",
      inner: { multiple: 3 },
      outer: { multiple: 2 },
    });
  });

  it("round-trips after-grace timing semantics", () => {
    const selection: ClipboardSelection = {
      events: [
        {
          type: "grace",
          graceType: "stealPrevious",
          content: [
            {
              type: "event",
              duration: { base: "16th" },
              notes: [{ pitch: { step: "D", octave: 4 } }],
            },
          ],
        },
        {
          type: "event",
          duration: { base: "quarter" },
          notes: [{ pitch: { step: "E", octave: 4 } }],
        },
      ],
      timeSignature: { count: 4, unit: 4 },
      keySignature: { fifths: 0 },
      partIndex: 0,
      measureIndex: 0,
      sequenceIndex: 0,
      eventIndex: 0,
    };
    const result = writeMuseScoreStaffList(selection);
    expect(result.xml).toContain("<grace16after/>");
    expect(readMuseScoreClipboard(result.xml!).content[0]).toMatchObject({
      type: "grace",
      graceType: "stealPrevious",
    });
  });
});
