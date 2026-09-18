import { describe, expect, it } from "vitest";
import type { AccidentalDisplay, Note, Transposition } from "@viritura/core";
import { accidentalXml, notePitchXml, parseMuseScoreNote } from "./noteReading";
import { children, parseSafeXml } from "./xml";

// Complete stafflist.xml from capture 20260918-003803-790-ac1ef9b5.
// capture.json: complete=true, 720 bytes, notes="Accidentals - a natural".
const NATURAL_CAPTURE = `<?xml version="1.0" encoding="UTF-8"?>
<StaffList version="4.70" tick="17/4" len="6/8" staff="25" staves="1">
  <Staff id="25">
    <voiceOffset>
      <voice id="0">0</voice>
      </voiceOffset>
    <location>
      <fractions>17/4</fractions>
      </location>
    <Chord>
      <dots>1</dots>
      <durationType>quarter</durationType>
      <Note>
        <pitch>60</pitch>
        <tpc>14</tpc>
        </Note>
      </Chord>
    <Chord>
      <dots>1</dots>
      <durationType>quarter</durationType>
      <Note>
        <Accidental>
          <subtype>accidentalNatural</subtype>
          </Accidental>
        <pitch>59</pitch>
        <tpc>19</tpc>
        </Note>
      </Chord>
    </Staff>
  </StaffList>
`;

const CLARINET: Transposition = { interval: { halfSteps: 2, staffDistance: 1 } };
const BASS: Transposition = { interval: { halfSteps: 12, staffDistance: 7 }, prefersWrittenPitches: true };
const STANDARD_ACCIDENTALS = [
  { subtype: "accidentalTripleFlat", alter: -3, midi: 57, tpc: -7 },
  { subtype: "accidentalDoubleFlat", alter: -2, midi: 58, tpc: 0 },
  { subtype: "accidentalFlat", alter: -1, midi: 59, tpc: 7 },
  { subtype: "accidentalNatural", alter: 0, midi: 60, tpc: 14 },
  { subtype: "accidentalSharp", alter: 1, midi: 61, tpc: 21 },
  { subtype: "accidentalDoubleSharp", alter: 2, midi: 62, tpc: 28 },
  { subtype: "accidentalTripleSharp", alter: 3, midi: 63, tpc: 35 },
] as const;

function parse(fields: string, transposition?: Transposition): Note {
  return parseMuseScoreNote(parseSafeXml(`<Note>${fields}</Note>`).documentElement, "Note", transposition);
}

function accidental(fields: string, pitch = "<pitch>59</pitch><tpc>19</tpc>"): Note {
  return parse(`<Accidental>${fields}</Accidental>${pitch}`);
}

describe("MuseScore explicit Note accidental source contract", () => {
  it("reads the supplied B3 natural without replacing concert TPC or assuming intentional user role", () => {
    const notes = Array.from(parseSafeXml(NATURAL_CAPTURE).querySelectorAll("Note")).map((element) =>
      parseMuseScoreNote(element, "Staff[25]/Note"),
    );
    expect(notes[0]?.pitch).toEqual({ step: "C", octave: 4 });
    expect(notes[0]?.accidentalDisplay).toBeUndefined();
    expect(notes[1]?.pitch).toEqual({ step: "B", octave: 3 });
    expect(notes[1]?.accidentalDisplay).toEqual({ show: true, force: false });
  });

  it.each(STANDARD_ACCIDENTALS)("reads $subtype using authoritative concert pitch", ({ subtype, alter, midi, tpc }) => {
    const note = accidental(`<subtype>${subtype}</subtype><role>1</role>`, `<pitch>${midi}</pitch><tpc>${tpc}</tpc>`);
    expect(note.pitch).toEqual({ step: "C", octave: 4, ...(alter === 0 ? {} : { alter }) });
    expect(note.accidentalDisplay).toEqual({ show: true, force: true });
  });

  it.each([
    [0, undefined],
    [1, { symbol: "parentheses" }],
    [2, { symbol: "brackets" }],
  ])("preserves bracket %i and explicit user role", (bracket, enclosure) => {
    expect(
      accidental(`<subtype>accidentalNatural</subtype><bracket>${bracket}</bracket><role>1</role>`).accidentalDisplay,
    ).toEqual({ show: true, force: true, ...(enclosure ? { enclosure } : {}) });
  });

  it("preserves explicit automatic role and hidden user accidentals", () => {
    expect(accidental("<subtype>accidentalNatural</subtype><role>0</role>").accidentalDisplay).toEqual({
      show: true,
      force: false,
    });
    expect(
      accidental("<subtype>accidentalNatural</subtype><role>1</role><visible>0</visible>").accidentalDisplay,
    ).toEqual({ show: false, force: true });
    expect(
      accidental("<subtype>accidentalNatural</subtype><small>0</small><stackingOrderOffset>0</stackingOrderOffset>")
        .pitch,
    ).toEqual({ step: "B", octave: 3 });
  });

  it.each([
    "<subtype>accidentalQuarterToneSharpStein</subtype>",
    "<subtype>accidentalNaturalSharp</subtype>",
    "<subtype>accidentalSharpSharp</subtype>",
    "<subtype>accidentalNatural</subtype><bracket>3</bracket>",
    "<subtype>accidentalNatural</subtype><role>2</role>",
    "<subtype>accidentalNatural</subtype><small>1</small>",
    "<subtype>accidentalNatural</subtype><stackingOrderOffset>1</stackingOrderOffset>",
    '<subtype>accidentalNatural</subtype><color r="255" g="0" b="0"/>',
    "<subtype>accidentalNatural</subtype><unknown>1</unknown>",
  ])("explicitly rejects unrepresentable accidental properties: %s", (fields) => {
    expect(() => accidental(fields)).toThrow(expect.objectContaining({ code: "unsupported-content" }));
  });

  it.each([
    "",
    "<subtype/>",
    "<subtype>accidentalNatural</subtype><subtype>accidentalNatural</subtype>",
    "<subtype>accidentalNatural</subtype><bracket>1</bracket><bracket>2</bracket>",
    "<subtype>accidentalNatural</subtype><role>0</role><role>1</role>",
    "<subtype>accidentalNatural</subtype><role>user</role>",
    "<subtype>accidentalNatural</subtype><visible>2</visible>",
    "<subtype><name>accidentalNatural</name></subtype>",
    '<subtype>accidentalNatural</subtype><bracket kind="courtesy">1</bracket>',
  ])("rejects malformed accidental properties: %s", (fields) => {
    expect(() => accidental(fields)).toThrow(expect.objectContaining({ code: "invalid-structure" }));
  });

  it("accepts either concert-view or written-view accidentals without changing concert pitch", () => {
    for (const tpc2 of ["", "<tpc2>21</tpc2>"]) {
      const note = parse(
        `<Accidental><subtype>accidentalSharp</subtype></Accidental><pitch>59</pitch><tpc>19</tpc>${tpc2}`,
        CLARINET,
      );
      expect(note.pitch).toEqual({ step: "B", octave: 3 });
      expect(note.accidentalDisplay?.show).toBe(true);
      const concertView = parse(
        `<Accidental><subtype>accidentalNatural</subtype><bracket>1</bracket><role>1</role></Accidental><pitch>59</pitch><tpc>19</tpc>${tpc2}`,
        CLARINET,
      );
      expect(concertView.pitch).toEqual(note.pitch);
      expect(concertView.accidentalDisplay).toEqual({ show: true, force: true, enclosure: { symbol: "parentheses" } });
      const written = notePitchXml(concertView, "Note", CLARINET);
      expect(written).toContain("<subtype>accidentalSharp</subtype>");
      expect(parse(written, CLARINET)).toMatchObject({
        pitch: concertView.pitch,
        accidentalDisplay: concertView.accidentalDisplay,
      });
      expect(() =>
        parse(
          `<Accidental><subtype>accidentalFlat</subtype></Accidental><pitch>59</pitch><tpc>19</tpc>${tpc2}`,
          CLARINET,
        ),
      ).toThrow(expect.objectContaining({ code: "invalid-pitch" }));
    }
    expect(() => accidental("<subtype>accidentalFlat</subtype>")).toThrow(/contradicts written pitch/);
  });

  it("permits Spanner children without claiming to validate connectors", () => {
    const note = parse('<pitch>60</pitch><tpc>14</tpc><Spanner type="Tie"/><Spanner type="Slur"/>');
    expect(note.pitch).toEqual({ step: "C", octave: 4 });
    expect(note.ties).toBeUndefined();
  });

  it.each([
    "<pitch>60</pitch><pitch>60</pitch><tpc>14</tpc>",
    "<pitch>60</pitch><tpc>14</tpc><tpc>14</tpc>",
    "<pitch>60</pitch><tpc>14</tpc><tpc2>14</tpc2><tpc2>14</tpc2>",
    "<pitch>60</pitch><tpc>14</tpc><Accidental/><Accidental/>",
    "<pitch><value>60</value></pitch><tpc>14</tpc>",
    '<pitch unit="midi">60</pitch><tpc>14</tpc>',
    "<pitch>60</pitch><tpc>14</tpc>unexpected",
    "<pitch>60</pitch><tpc>14.0</tpc>",
  ])("rejects ambiguous Note scalars: %s", (fields) => {
    expect(() => parse(fields)).toThrow(expect.objectContaining({ code: "invalid-structure" }));
  });

  it("does not silently ignore the noncanonical lowercase accidental property", () => {
    expect(() => parse("<pitch>60</pitch><tpc>14</tpc><accidental>1</accidental>")).toThrow(
      expect.objectContaining({ code: "unsupported-content" }),
    );
  });
});

describe("MuseScore concert and written TPC interchange", () => {
  it("preserves standard transposing spelling without modifying the sounding octave", () => {
    expect(parse("<pitch>29</pitch><tpc>13</tpc><tpc2>13</tpc2>", BASS).pitch).toEqual({ step: "F", octave: 1 });
    const clarinet = parse("<pitch>58</pitch><tpc>12</tpc><tpc2>14</tpc2>", CLARINET);
    expect(clarinet.pitch).toEqual({ step: "B", octave: 3, alter: -1 });
    expect(clarinet.written).toBeUndefined();
  });

  it("retains a representable nonstandard written enharmonic via diatonicDelta, not concert respelling", () => {
    const fields =
      "<Accidental><subtype>accidentalSharp</subtype><role>1</role></Accidental><pitch>58</pitch><tpc>12</tpc><tpc2>26</tpc2>";
    const note = parse(fields, CLARINET);
    expect(note.pitch).toEqual({ step: "B", octave: 3, alter: -1 });
    expect(note.written).toEqual({ diatonicDelta: -1 });
    expect(note.accidentalDisplay).toEqual({ show: true, force: true });
    expect(notePitchXml(note, "Note", CLARINET)).toContain("<pitch>58</pitch><tpc>12</tpc><tpc2>26</tpc2>");
  });

  it("emits an explicit tpc2 equal to concert TPC when omission would lose the written override", () => {
    const diminishedSecond: Transposition = { interval: { halfSteps: 0, staffDistance: 1 } };
    const note = parse("<pitch>60</pitch><tpc>14</tpc><tpc2>14</tpc2>", diminishedSecond);
    expect(note.written).toEqual({ diatonicDelta: -1 });
    const xml = notePitchXml(note, "Note", diminishedSecond);
    expect(xml).toBe("<pitch>60</pitch><tpc>14</tpc><tpc2>14</tpc2>");
    expect(parse(xml, diminishedSecond).written).toEqual(note.written);
  });

  it("rejects written overrides with an explicit zero interval that StaffList cannot retain", () => {
    expect(() =>
      notePitchXml({ pitch: { step: "C", octave: 4 }, written: { diatonicDelta: 1 } }, "Note", {
        interval: { halfSteps: 0, staffDistance: 0 },
      }),
    ).toThrow(expect.objectContaining({ code: "unsupported-content" }));
  });

  it.each([
    ["<pitch>60</pitch><tpc>14</tpc><tpc2>15</tpc2>", undefined],
    ["<pitch>58</pitch><tpc>12</tpc><tpc2>15</tpc2>", CLARINET],
    ["<pitch>58</pitch><tpc>12</tpc><tpc2>41</tpc2>", CLARINET],
    ["<pitch>60</pitch><tpc>-9</tpc>", undefined],
    ["<pitch>60</pitch><tpc>41</tpc>", undefined],
    ["<pitch>128</pitch><tpc>22</tpc>", undefined],
    ["<pitch>-1</pitch><tpc>19</tpc>", undefined],
    ["<pitch>60</pitch><tpc>15</tpc>", undefined],
  ])("rejects contradictory or invalid pitch values: %s", (fields, transposition) => {
    expect(() => parse(fields, transposition)).toThrow(expect.objectContaining({ code: "invalid-pitch" }));
  });

  it("rejects a second spelling without a native source transposition context", () => {
    expect(() => parse("<pitch>60</pitch><tpc>14</tpc><tpc2>26</tpc2>")).toThrow(
      expect.objectContaining({ code: "unsupported-content", path: "Note/tpc2" }),
    );
  });

  it("exports sounding MIDI/TPC with source staff tpc2, omitting redundant octave-only tpc2", () => {
    expect(notePitchXml({ pitch: { step: "F", octave: 1 } }, "Note", BASS)).toBe("<pitch>29</pitch><tpc>13</tpc>");
    expect(notePitchXml({ pitch: { step: "B", octave: 3, alter: -1 } }, "Note", CLARINET)).toBe(
      "<pitch>58</pitch><tpc>12</tpc><tpc2>14</tpc2>",
    );
    expect(notePitchXml({ pitch: { step: "C", octave: 4 } }, "Note")).toBe("<pitch>60</pitch><tpc>14</tpc>");
  });
});

describe("MuseScore explicit accidental XML writing", () => {
  it.each(STANDARD_ACCIDENTALS)("exports $subtype with the intentional USER role", ({ subtype, alter, midi, tpc }) => {
    const note: Note = { pitch: { step: "C", octave: 4, alter }, accidentalDisplay: { show: true, force: true } };
    expect(notePitchXml(note, "Note")).toBe(
      `<Accidental><role>1</role><subtype>${subtype}</subtype></Accidental><pitch>${midi}</pitch><tpc>${tpc}</tpc>`,
    );
  });

  it("exports the written sharp of a concert natural on a transposing source staff", () => {
    const note: Note = { pitch: { step: "B", octave: 3 }, accidentalDisplay: { show: true, force: true } };
    expect(notePitchXml(note, "Note", CLARINET)).toBe(
      "<Accidental><role>1</role><subtype>accidentalSharp</subtype></Accidental><pitch>59</pitch><tpc>19</tpc><tpc2>21</tpc2>",
    );
  });

  it.each(["parentheses", "brackets"] as const)("exports %s, hide and intentional role without loss", (symbol) => {
    const note: Note = {
      pitch: { step: "B", octave: 3 },
      accidentalDisplay: { show: false, force: true, enclosure: { symbol } },
    };
    const xml = notePitchXml(note, "Note");
    expect(xml).toContain(`<bracket>${symbol === "parentheses" ? 1 : 2}</bracket>`);
    expect(xml).toContain("<role>1</role>");
    expect(xml).toContain("<visible>0</visible>");
    expect(parse(xml).accidentalDisplay).toEqual(note.accidentalDisplay);
  });

  it("distinguishes absent accidental display from explicit automatic display", () => {
    const note: Note = { pitch: { step: "B", octave: 3 } };
    expect(accidentalXml(note, "Note")).toBe("");
    note.accidentalDisplay = { show: true };
    expect(accidentalXml(note, "Note")).toBe(
      "<Accidental><role>0</role><subtype>accidentalNatural</subtype></Accidental>",
    );
  });

  it.each([
    { show: true, _x: { vendor: { glyph: "special" } } },
    { show: true, enclosure: { symbol: "parentheses", _x: { vendor: { color: "red" } } } },
  ] satisfies AccidentalDisplay[])(
    "rejects additional native accidental metadata rather than discarding it",
    (display) => {
      expect(() => accidentalXml({ pitch: { step: "B", octave: 3 }, accidentalDisplay: display }, "Note")).toThrow(
        expect.objectContaining({ code: "unsupported-content" }),
      );
    },
  );

  it("rejects fractional native pitch and unsupported written metadata", () => {
    expect(() => notePitchXml({ pitch: { step: "C", octave: 4, alter: 0.5 } }, "Note")).toThrow(
      expect.objectContaining({ code: "invalid-pitch" }),
    );
    expect(() =>
      notePitchXml({ pitch: { step: "C", octave: 4 }, written: { _x: { vendor: {} } } }, "Note", CLARINET),
    ).toThrow(expect.objectContaining({ code: "unsupported-content" }));
  });

  it("keeps XML pitch fields scalar and free of a Note wrapper so connectors can append endpoints", () => {
    const xml = notePitchXml(
      { pitch: { step: "C", octave: 4 }, accidentalDisplay: { show: true, force: true } },
      "Note",
    );
    expect(children(parseSafeXml(`<Note>${xml}</Note>`).documentElement).map((element) => element.tagName)).toEqual([
      "Accidental",
      "pitch",
      "tpc",
    ]);
  });
});
