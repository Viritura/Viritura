import type { Transposition } from "@viritura/core";
import { describe, expect, it } from "vitest";
import { MuseScoreConversionError } from "./errors";
import { parseHarmony, serializeHarmony } from "./harmony";
import { accidentalXml, notePitchXml, parseMuseScoreNote } from "./noteReading";
import type { ReadPolicy } from "./readPolicy";
import { parseSafeXml } from "./xml";

function recoveryPolicy(skipUnsupported = true): { policy: ReadPolicy; diagnostics: MuseScoreConversionError[] } {
  const diagnostics: MuseScoreConversionError[] = [];
  const policy = {
    skipUnsupported,
    warn(message: string, path?: string, sourceTime?: string): void {
      diagnostics.push(new MuseScoreConversionError("unsupported-content", message, path, sourceTime));
    },
    skip(message: string, path?: string, sourceTime?: string): void {
      const error = new MuseScoreConversionError("unsupported-content", message, path, sourceTime);
      if (!skipUnsupported) throw error;
      diagnostics.push(error);
    },
    recover<T>(operation: () => T): T | undefined {
      try {
        return operation();
      } catch (error) {
        if (!skipUnsupported || !(error instanceof MuseScoreConversionError) || error.code !== "unsupported-content") {
          throw error;
        }
        diagnostics.push(error);
        return undefined;
      }
    },
  } as ReadPolicy;
  return { policy, diagnostics };
}

const PITCH = "<pitch>60</pitch><tpc>14</tpc>";
const NATURAL = "<subtype>accidentalNatural</subtype>";
const CLARINET: Transposition = { interval: { halfSteps: 2, staffDistance: 1 } };
const element = (xml: string) => parseSafeXml(xml).documentElement;
const note = (fields: string, policy?: ReadPolicy, transposition?: Transposition) =>
  parseMuseScoreNote(element(`<Note>${fields}</Note>`), "Note", transposition, policy);
const accidental = (fields: string, policy?: ReadPolicy) => note(`${PITCH}<Accidental>${fields}</Accidental>`, policy);
const info = (fields = "<name>m7</name><root>14</root><bass>15</bass>") => `<harmonyInfo>${fields}</harmonyInfo>`;
const harmony = (fields: string, policy?: ReadPolicy) =>
  parseHarmony(element(`<Harmony>${fields}</Harmony>`), [1, 4], "Harmony", policy);

describe("note property recovery", () => {
  it.each([
    "<head>cross</head>",
    "<headGroup>diamond</headGroup>",
    "<headType>breve</headType>",
    "<velocity>96</velocity>",
    "<veloOffset>12</veloOffset>",
    "<veloType>user</veloType>",
    "<tuning>25.5</tuning>",
    "<fret>4</fret>",
    "<string>2</string>",
    "<small>1</small>",
    "<ghost>1</ghost>",
    '<color r="255" g="0" b="0"/>',
    '<offset x="1" y="2"/>',
    "<Ornament><subtype>trill</subtype></Ornament>",
    "<Articulation><subtype>ornamentTurn</subtype></Articulation>",
    "<Fingering><text>3</text></Fingering>",
    "<Symbol><name>ornamentMordent</name></Symbol>",
    '<Bend><point time="0" pitch="100"/></Bend>',
  ])("keeps the note but reports its unsupported property: %s", (property) => {
    for (const policy of [undefined, recoveryPolicy(false).policy]) {
      expect(() => note(property + PITCH, policy)).toThrow(expect.objectContaining({ code: "unsupported-content" }));
    }
    const { policy, diagnostics } = recoveryPolicy();
    const parsed = policy.recover(() => note(property + PITCH, policy));
    expect(parsed).toEqual({ id: expect.any(String), pitch: { step: "C", octave: 4 } });
    expect(parsed).not.toHaveProperty("velocity");
    expect(notePitchXml(parsed!, "Note")).toBe(PITCH);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ code: "unsupported-content", path: expect.stringMatching(/^Note\//) });
  });

  it("reports independent losses without dropping a note or its supported accidental", () => {
    const { policy, diagnostics } = recoveryPolicy();
    const parsed = note(
      `<velocity>90</velocity><head>cross</head>${PITCH}<Accidental>${NATURAL}<role>1</role><bracket>1</bracket></Accidental>`,
      policy,
    );
    expect(parsed.accidentalDisplay).toEqual({ show: true, force: true, enclosure: { symbol: "parentheses" } });
    expect(diagnostics.map((item) => item.path)).toEqual(["Note/velocity", "Note/head"]);
  });

  it.each([
    "<pitch>wrong</pitch><tpc>14</tpc>",
    "<pitch>128</pitch><tpc>14</tpc>",
    "<pitch>60</pitch><tpc>15</tpc>",
    "<pitch>60</pitch><tpc>41</tpc>",
    "<pitch>60</pitch><tpc>14</tpc><tpc2>15</tpc2>",
    "<pitch>60</pitch><tpc>14</tpc><tpc2>41</tpc2>",
    "<pitch>60</pitch><tpc>14</tpc><tpc2>bad</tpc2>",
    "<pitch>60</pitch><pitch>60</pitch><tpc>14</tpc>",
    "<pitch><value>60</value></pitch><tpc>14</tpc>",
    '<pitch unit="midi">60</pitch><tpc>14</tpc>',
    `${PITCH}<Accidental>${NATURAL}<role>bad</role></Accidental>`,
    `${PITCH}<Accidental><subtype>accidentalFlat</subtype></Accidental>`,
  ])("does not hide malformed supported fields behind a head property: %s", (fields) => {
    for (const skip of [false, true]) {
      const { policy, diagnostics } = recoveryPolicy(skip);
      expect(() => policy.recover(() => note(`<head>cross</head>${fields}`, policy))).toThrow(
        expect.objectContaining({ code: expect.stringMatching(/^invalid-(structure|pitch)$/) }),
      );
      expect(diagnostics).toHaveLength(0);
    }
  });

  it.each([
    "<durationType>quarter</durationType>",
    "<ticks>480</ticks>",
    "<location><fractions>1/4</fractions></location>",
    "<unknown>1</unknown>",
    `<unknown><Note>${PITCH}</Note></unknown>`,
    `<unknown><Chord><Note>${PITCH}</Note></Chord></unknown>`,
    `<Ornament><unknown><Note>${PITCH}</Note></unknown></Ornament>`,
    "<head><value>cross</value></head>",
    "<Events><Event><ontime>0</ontime></Event></Events>",
    "<color><Events><Event><ontime>0</ontime></Event></Events></color>",
    "<offset><unknown>1</unknown></offset>",
    "<placement><value>above</value></placement>",
  ])("keeps unknown structure and timing fatal: %s", (fields) => {
    const { policy } = recoveryPolicy();
    expect(() => policy.recover(() => note(PITCH + fields, policy))).toThrow(
      expect.objectContaining({ code: "invalid-structure" }),
    );
  });

  it("never recovers unsafe XML or unknown Note attributes", () => {
    const { policy } = recoveryPolicy();
    expect(() => policy.recover(() => note('<!DOCTYPE Note [<!ENTITY a "x">]>', policy))).toThrow(
      expect.objectContaining({ code: "unsafe-xml" }),
    );
    expect(() =>
      policy.recover(() =>
        parseMuseScoreNote(element(`<Note duration="1/4">${PITCH}</Note>`), "Note", undefined, policy),
      ),
    ).toThrow(expect.objectContaining({ code: "invalid-structure" }));
  });
});

describe("independent accidental display recovery", () => {
  it.each(["accidentalQuarterToneSharpStein", "accidentalNaturalSharp", "accidentalSharpSharp"])(
    "drops only the display for an unsupported glyph %s",
    (subtype) => {
      const fields = `<subtype>${subtype}</subtype><bracket>1</bracket><role>1</role>`;
      expect(() => accidental(fields)).toThrow(expect.objectContaining({ code: "unsupported-content" }));
      const { policy, diagnostics } = recoveryPolicy();
      const parsed = accidental(fields, policy);
      expect(parsed.pitch).toEqual({ step: "C", octave: 4 });
      expect(parsed).not.toHaveProperty("accidentalDisplay");
      expect(diagnostics).toMatchObject([{ code: "unsupported-content", path: "Note/Accidental/subtype" }]);
    },
  );

  it.each([
    ["<small>1</small>", "small"],
    ["<stackingOrderOffset>2</stackingOrderOffset>", "stackingOrderOffset"],
    ['<color r="255" g="0" b="0"/>', "color"],
    ['<offset x="1" y="0"/>', "offset"],
  ])("keeps supported display attributes despite %s", (property, name) => {
    const fields = `${NATURAL}<role>1</role><visible>0</visible><bracket>2</bracket>${property}`;
    expect(() => accidental(fields)).toThrow(expect.objectContaining({ code: "unsupported-content" }));
    const { policy, diagnostics } = recoveryPolicy();
    expect(accidental(fields, policy).accidentalDisplay).toEqual({
      show: false,
      force: true,
      enclosure: { symbol: "brackets" },
    });
    expect(diagnostics).toMatchObject([{ path: `Note/Accidental/${name}` }]);
  });

  it("discards unsupported brackets and roles independently", () => {
    const { policy, diagnostics } = recoveryPolicy();
    expect(accidental(`${NATURAL}<bracket>3</bracket><role>1</role>`, policy).accidentalDisplay).toEqual({
      show: true,
      force: true,
    });
    expect(
      accidental(`${NATURAL}<bracket>1</bracket><role>2</role><visible>0</visible>`, policy).accidentalDisplay,
    ).toEqual({
      show: false,
      enclosure: { symbol: "parentheses" },
    });
    expect(diagnostics.map((item) => item.path)).toEqual(["Note/Accidental/bracket", "Note/Accidental/role"]);
  });

  it.each([
    "<subtype>accidentalQuarterToneSharpStein</subtype><role>bad</role>",
    "<subtype>accidentalQuarterToneSharpStein</subtype><visible>2</visible>",
    "<subtype>accidentalQuarterToneSharpStein</subtype><bracket>1.5</bracket>",
    "<subtype>accidentalQuarterToneSharpStein</subtype><small>bad</small>",
    `${NATURAL}<bracket>3</bracket><role>bad</role>`,
    `${NATURAL}<role>2</role><stackingOrderOffset>bad</stackingOrderOffset>`,
    `${NATURAL}<small>1</small><stackingOrderOffset>bad</stackingOrderOffset>`,
    `<color r="255"/><subtype><name>accidentalNatural</name></subtype>`,
    `<color r="255"/>${NATURAL}<subtype>accidentalNatural</subtype>`,
    `<color r="255"/>${NATURAL}<bracket unit="x">1</bracket>`,
    `<color r="255"/><subtype>accidentalFlat</subtype>`,
    '<color r="255"/>',
  ])("validates all supported accidental fields before any recovery: %s", (fields) => {
    for (const skip of [false, true]) {
      const { policy, diagnostics } = recoveryPolicy(skip);
      expect(() => policy.recover(() => accidental(fields, policy))).toThrow(
        expect.objectContaining({ code: expect.stringMatching(/^invalid-(structure|pitch)$/) }),
      );
      expect(diagnostics).toHaveLength(0);
    }
  });
});

describe("written spelling recovery", () => {
  it.each([undefined, { interval: { halfSteps: 0, staffDistance: 0 } }])(
    "discards an unrepresentable written override without respelling concert pitch: %s",
    (transposition) => {
      const fields = `${PITCH}<tpc2>26</tpc2>`;
      expect(() => note(fields, undefined, transposition)).toThrow(
        expect.objectContaining({ code: "unsupported-content" }),
      );
      const { policy, diagnostics } = recoveryPolicy();
      const parsed = note(fields, policy, transposition);
      expect(parsed).toEqual({ id: expect.any(String), pitch: { step: "C", octave: 4 } });
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toMatch(/written.*pitch|written spelling/);
    },
  );

  it("retains a representable transposing override beside an unsupported ornament", () => {
    const { policy, diagnostics } = recoveryPolicy();
    const parsed = note(
      `<pitch>58</pitch><tpc>12</tpc><tpc2>26</tpc2><Ornament><subtype>trill</subtype></Ornament>`,
      policy,
      CLARINET,
    );
    expect(parsed.pitch).toEqual({ step: "B", octave: 3, alter: -1 });
    expect(parsed.written).toEqual({ diatonicDelta: -1 });
    expect(diagnostics).toHaveLength(1);
  });

  it("validates source accidentals, then discards displays that require the lost spelling", () => {
    const { policy, diagnostics } = recoveryPolicy();
    const parsed = note(`${PITCH}<tpc2>26</tpc2><Accidental><subtype>accidentalSharp</subtype></Accidental>`, policy);
    expect(parsed.pitch).toEqual({ step: "C", octave: 4 });
    expect(parsed.written).toBeUndefined();
    expect(parsed.accidentalDisplay).toBeUndefined();
    expect(diagnostics.map((item) => item.path)).toEqual(["Note/tpc2", "Note/Accidental/subtype"]);
    expect(note(`${PITCH}<tpc2>26</tpc2><Accidental>${NATURAL}</Accidental>`, policy).accidentalDisplay).toEqual({
      show: true,
      force: false,
    });
  });

  it.each([{ interval: { halfSteps: 10, staffDistance: 0 } }, { interval: { halfSteps: 72, staffDistance: 42 } }])(
    "keeps concert pitch if the inferred native written spelling is unsupported: %s",
    (transposition) => {
      const { policy, diagnostics } = recoveryPolicy();
      expect(note(PITCH, policy, transposition)).toEqual({ id: expect.any(String), pitch: { step: "C", octave: 4 } });
      expect(diagnostics).toHaveLength(1);
    },
  );

  it.each([`${NATURAL}<visible>2</visible>`, `${NATURAL}<role>bad</role>`, "<subtype>accidentalFlat</subtype>"])(
    "still validates accidentals when tpc2 cannot be represented: %s",
    (fields) => {
      const { policy, diagnostics } = recoveryPolicy();
      expect(() =>
        policy.recover(() => note(`${PITCH}<tpc2>26</tpc2><Accidental>${fields}</Accidental>`, policy)),
      ).toThrow(expect.objectContaining({ code: expect.stringMatching(/^invalid-(structure|pitch)$/) }));
      expect(diagnostics).toHaveLength(0);
    },
  );
});

describe("harmony recovery boundaries", () => {
  it.each([
    "<fontFace>Jazz</fontFace>",
    "<fontSize>14</fontSize>",
    "<fontStyle>1</fontStyle>",
    "<style>Jazz</style>",
    "<placement>above</placement>",
    '<color r="255" g="0" b="0"/>',
    '<offset x="1" y="0"/>',
  ])("retains supported harmony semantics beside a visual style: %s", (style) => {
    for (const fields of [style + info(), info(`<name>m7</name><root>14</root><bass>15</bass>${style}`)]) {
      expect(() => harmony(fields)).toThrow(expect.objectContaining({ code: "unsupported-content" }));
      expect(() => harmony(fields, recoveryPolicy(false).policy)).toThrow(
        expect.objectContaining({ code: "unsupported-content" }),
      );
      const { policy, diagnostics } = recoveryPolicy();
      expect(policy.recover(() => harmony(fields, policy))).toEqual({
        position: { fraction: [1, 4] },
        root: { step: "C" },
        bass: { step: "G" },
        quality: "minor",
        extension: 7,
      });
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.path).toMatch(/^Harmony\/(harmonyInfo\/)?/);
    }
  });

  it.each([
    info("<name>unknown</name><root>14</root>"),
    info("<name>constructor</name><root>14</root>"),
    info("<name>toString</name><root>14</root>"),
    `${info()}<degree><degree-value>9</degree-value><degree-alter>1</degree-alter><degree-type>add</degree-type></degree>`,
    `<style>Jazz</style>${info()}<degree/>`,
    info("<root>14</root><degree><degree-value>9</degree-value></degree>"),
    info() + info("<root>15</root>"),
  ])("retains unsupported harmony semantics as diagnosed raw text: %s", (fields) => {
    const { policy, diagnostics } = recoveryPolicy();
    expect(policy.recover(() => harmony(fields, policy))).toMatchObject({
      position: { fraction: [1, 4] },
      rawText: expect.any(String),
      quality: "other",
    });
    expect(diagnostics).toHaveLength(1);
    expect(harmony(info(), policy).quality).toBe("minor");
  });

  it.each([
    "<name>unknown</name><root>bad</root>",
    "<name>unknown</name><root>99</root>",
    "<name>unknown</name><root>14</root><bass>bad</bass>",
    "<name>unknown</name><root>14</root><bass/>",
    "<name>unknown</name><root>14</root><bass>1.0</bass>",
    "<name>unknown</name><root>14</root><base>99</base>",
    "<name>unknown</name><root>14</root><bass>15</bass><base>bad</base>",
    "<name>unknown</name><root>14</root><bass>15</bass><bass>15</bass>",
    "<name>unknown</name><root>14</root><extension>bad</extension>",
    "<name>unknown</name><root><value>14</value></root>",
    '<name>unknown</name><root unit="tpc">14</root>',
    "<name>m7</name><name>unknown</name><root>14</root>",
    "<name><value>unknown</value></name><root>14</root>",
    "<name>unknown</name><root>14</root><root>14</root>",
    "<name/>",
  ])("does not hide malformed harmony fields behind semantics or styles: %s", (fields) => {
    for (const wrapper of [
      info(fields),
      `<style>Jazz</style>${info(fields)}`,
      `${info()}${info(fields)}`,
      `${info()}${info(fields)}<degree/>`,
    ]) {
      const { policy, diagnostics } = recoveryPolicy();
      expect(() => policy.recover(() => harmony(wrapper, policy))).toThrow(
        expect.objectContaining({ code: expect.stringMatching(/^invalid-(structure|pitch)$/) }),
      );
      expect(diagnostics).toHaveLength(0);
    }
  });

  it.each([
    "",
    `<unknown>${info()}</unknown>`,
    `${info()}<unknown><Chord/></unknown>`,
    `${info()}<offset><Note>${PITCH}</Note></offset>`,
    `${info()}<color><Events><Event><ontime>0</ontime></Event></Events></color>`,
    `${info()}<offset><unknown>1</unknown></offset>`,
    `${info()}<degree><degree-value>bad</degree-value></degree>`,
    `${info()}<degree><Events><Event><ontime>0</ontime></Event></Events></degree>`,
    `${info()}<durationType>quarter</durationType>`,
    `${info("<name>unknown</name><root>14</root>")}<fontSize><value>14</value></fontSize>`,
    `${info()}unexpected`,
  ])("does not recover unknown or malformed harmony structure: %s", (fields) => {
    const { policy } = recoveryPolicy();
    expect(() => policy.recover(() => harmony(fields, policy))).toThrow(
      expect.objectContaining({ code: "invalid-structure" }),
    );
  });

  it("leaves non-harmony export strict regardless of read policy use", () => {
    const { policy } = recoveryPolicy();
    const parsed = accidental(`${NATURAL}<small>1</small>`, policy);
    const unsupportedDisplay = { show: true, color: "red" };
    expect(() => accidentalXml({ ...parsed, accidentalDisplay: unsupportedDisplay }, "Note")).toThrow(
      expect.objectContaining({ code: "unsupported-content" }),
    );
    expect(() => notePitchXml({ ...parsed, written: { diatonicDelta: -1 } }, "Note")).toThrow(
      expect.objectContaining({ code: "unsupported-content" }),
    );
    const warnings: string[] = [];
    expect(serializeHarmony({ ...harmony(info(), policy), textOverride: "custom" }, "Harmony", warnings)).toBe(
      "<Harmony><harmonyInfo><name>custom</name></harmonyInfo></Harmony>",
    );
    expect(warnings).toEqual([expect.stringContaining("unsupported harmony")]);
  });
});
