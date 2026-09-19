import { describe, expect, it } from "vitest";
import { MuseScoreConversionError, readMuseScoreClipboard, type MuseScoreClipboardData } from ".";

const SKIP = { unsupported: "skip" } as const;
const NOTE = "<Note><pitch>60</pitch><tpc>14</tpc></Note>";
const ORNAMENT_PROPERTIES = [
  "<startOnUpperNote>1</startOnUpperNote>",
  "<intervalAbove>second,major</intervalAbove>",
  "<intervalBelow>second,minor</intervalBelow>",
  "<ornamentShowAccidental>1</ornamentShowAccidental>",
  "<ornamentShowCueNote>off</ornamentShowCueNote>",
  "<ornamentStyle>baroque</ornamentStyle>",
  "<anchor>3</anchor>",
  '<channel name="normal"/>',
  '<channe name="normal"/>',
];

function chord(properties = ""): string {
  return `<Chord><durationType>quarter</durationType>${properties}${NOTE}</Chord>`;
}

function staffList(content: string): string {
  return `<StaffList version="4.70" tick="0/1" len="1/1" staff="1" staves="1"><Staff id="1">${content}</Staff></StaffList>`;
}

function harmony(properties = "", outer = ""): string {
  return `<Harmony><harmonyInfo><root>14</root><name>m7</name>${properties}</harmonyInfo>${outer}</Harmony>`;
}

function semantic(data: MuseScoreClipboardData): unknown {
  return JSON.parse(
    JSON.stringify(data, (key, value: unknown) => (key === "id" || key === "diagnostics" ? undefined : value)),
  );
}

function expectFatal(content: string): void {
  expect(() => readMuseScoreClipboard(staffList(content + chord()), undefined, SKIP)).toThrowError(
    expect.objectContaining({ code: "invalid-structure" }),
  );
}

describe.each(["chord", "note", "staff"] as const)("ornament recovery at the %s boundary", (boundary) => {
  function content(ornament: string): string {
    const articulation = "<Articulation><subtype>articStaccatoAbove</subtype></Articulation>";
    const first = chord(articulation + (boundary === "chord" ? ornament : ""));
    return (
      (boundary === "note"
        ? first.replace("</Note>", `${ornament}</Note>`)
        : boundary === "staff"
          ? ornament + first
          : first) +
      "<Dynamic><subtype>mf</subtype></Dynamic>" +
      chord() +
      "<Dynamic><subtype>p</subtype></Dynamic>"
    );
  }

  it.each([...ORNAMENT_PROPERTIES, ORNAMENT_PROPERTIES.slice(0, 7).join("")])(
    "discards only the ornament with recognized properties: %s",
    (properties) => {
      const xml = staffList(content(`<Ornament><subtype>ornamentTurn</subtype>${properties}</Ornament>`));
      const data = readMuseScoreClipboard(xml, undefined, SKIP);
      expect(semantic(data)).toEqual(semantic(readMuseScoreClipboard(staffList(content("")))));
      expect(data.content).toHaveLength(2);
      expect(data.content).toMatchObject([
        { type: "event", duration: { base: "quarter" }, markings: { staccato: {} } },
        { type: "event", duration: { base: "quarter" } },
      ]);
      expect(data.dynamics).toMatchObject([
        { offset: [1, 4], dynamic: { value: "mf" } },
        { offset: [1, 2], dynamic: { value: "p" } },
      ]);
      expect(data.diagnostics).toEqual([
        expect.objectContaining({
          code: "unsupported-content",
          path: expect.stringMatching(/\/Ornament(?:\[\d+\])?$/),
        }),
      ]);
      expect(() => readMuseScoreClipboard(xml)).toThrowError(expect.objectContaining({ code: "unsupported-content" }));
      expect(() => readMuseScoreClipboard(xml, undefined, { unsupported: "error" })).toThrowError(
        expect.objectContaining({ code: "unsupported-content" }),
      );
    },
  );

  it.each(ORNAMENT_PROPERTIES)("still rejects malformed recognized properties: %s", (property) => {
    const name = /^<(\w+)/.exec(property)![1]!;
    for (const malformed of [
      property + property,
      `<${name}><Note><pitch>60</pitch></Note></${name}>`,
      `<${name} unexpected="1"/>`,
    ]) {
      expectFatal(content(`<Ornament><subtype>ornamentTurn</subtype>${malformed}</Ornament>`));
    }
  });

  it.each([
    "<unknown>1</unknown>",
    "<Note><pitch>60</pitch></Note>",
    "<Chord><durationType>quarter</durationType></Chord>",
    "<location><fractions>1/4</fractions></location>",
    '<channel name="normal">unexpected</channel>',
    '<channe name="normal"><Unknown/></channe>',
  ])("does not discard unknown or unsafe ornament structure: %s", (property) => {
    expectFatal(content(`<Ornament><subtype>ornamentTurn</subtype>${property}</Ornament>`));
  });
});

describe("notation recovery preserves supported semantics", () => {
  it("retains written articulation while diagnosing unsupported playback settings", () => {
    const xml = staffList(chord("<Articulation><subtype>articStaccatoAbove</subtype><play>0</play></Articulation>"));
    const data = readMuseScoreClipboard(xml, undefined, SKIP);
    expect(semantic(data)).toEqual(semantic(readMuseScoreClipboard(xml.replace("<play>0</play>", ""))));
    expect(data.content[0]).toMatchObject({ markings: { staccato: {} } });
    expect(data.diagnostics).toMatchObject([{ path: expect.stringMatching(/Articulation\[0\]\/play$/) }]);
    expect(() => readMuseScoreClipboard(xml)).toThrow(MuseScoreConversionError);
  });

  it("retains staccato and mf while diagnosing their direction styles independently", () => {
    const articulation = "<Articulation><subtype>articStaccatoAbove</subtype><direction>up</direction></Articulation>";
    const dynamic = "<Dynamic><subtype>mf</subtype><direction>up</direction></Dynamic>";
    const xml = staffList(chord(articulation) + dynamic + chord());
    const data = readMuseScoreClipboard(xml, undefined, SKIP);
    expect(semantic(data)).toEqual(semantic(readMuseScoreClipboard(xml.replaceAll("<direction>up</direction>", ""))));
    expect(data.content[0]).toMatchObject({ markings: { staccato: {} } });
    expect(data.dynamics).toMatchObject([{ offset: [1, 4], dynamic: { value: "mf" } }]);
    expect(data.diagnostics).toHaveLength(2);
    expect(data.diagnostics?.map((item) => item.path)).toEqual([
      expect.stringMatching(/Articulation\[0\]\/direction$/),
      expect.stringMatching(/Dynamic\[\d+\]\/direction$/),
    ]);
    expect(() => readMuseScoreClipboard(xml)).toThrow(MuseScoreConversionError);
  });

  it.each(["inner", "outer"])("retains slash chord bassCase styling at the %s level", (level) => {
    const style = "<bassCase>1</bassCase>";
    const content = harmony("<bass>18</bass>" + (level === "inner" ? style : ""), level === "outer" ? style : "");
    const data = readMuseScoreClipboard(staffList(content + chord()), undefined, SKIP);
    expect(data.chordSymbols).toMatchObject([
      {
        chordSymbol: { root: { step: "C" }, quality: "minor", extension: 7, bass: { step: "E" } },
      },
    ]);
    expect(data.diagnostics).toMatchObject([{ path: expect.stringMatching(/\/bassCase$/) }]);
  });

  it.each(["inner", "outer"])("discards %s harmony playback independently of Cm7", (level) => {
    const xml = staffList(
      harmony(level === "inner" ? "<play>0</play>" : "", level === "outer" ? "<play>0</play>" : "") + chord(),
    );
    const data = readMuseScoreClipboard(xml, undefined, SKIP);
    expect(semantic(data)).toEqual(semantic(readMuseScoreClipboard(xml.replace("<play>0</play>", ""))));
    expect(data.chordSymbols).toMatchObject([{ chordSymbol: { root: { step: "C" }, quality: "minor", extension: 7 } }]);
    expect(data.diagnostics).toMatchObject([{ path: expect.stringMatching(/\/play$/) }]);
    expect(() => readMuseScoreClipboard(xml)).toThrow(MuseScoreConversionError);
  });

  it.each([
    "custom dynamic",
    "molto <sym>dynamicForte</sym>",
    '<font face="Edwin" size="12"/><b>molto <i>forte</i></b><br/><u>subito</u>',
    "&lt;custom&gt;",
  ])("skips a custom-text dynamic without losing notes or the following dynamic: %s", (text) => {
    const custom = `<Dynamic><subtype>other</subtype><text>${text}</text></Dynamic>`;
    const following = "<Dynamic><subtype>p</subtype></Dynamic>";
    const xml = staffList(chord() + custom + chord() + following);
    const data = readMuseScoreClipboard(xml, undefined, SKIP);
    expect(semantic(data)).toEqual(semantic(readMuseScoreClipboard(xml.replace(custom, ""))));
    expect(data.content).toHaveLength(2);
    expect(data.dynamics).toMatchObject([{ offset: [1, 2], dynamic: { value: "p" } }]);
    expect(data.diagnostics).toHaveLength(1);
    expect(data.diagnostics?.[0]).toMatchObject({
      code: "unsupported-content",
      message: expect.stringContaining('dynamic "other"'),
    });
    expect(() => readMuseScoreClipboard(xml)).toThrow(MuseScoreConversionError);
  });

  it("does not silently interpret a supported subtype with custom text as an ordinary dynamic", () => {
    const data = readMuseScoreClipboard(
      staffList("<Dynamic><subtype>mf</subtype><text>custom</text></Dynamic>" + chord()),
      undefined,
      SKIP,
    );
    expect(data.content).toHaveLength(1);
    expect(data.dynamics ?? []).toHaveLength(0);
    expect(data.diagnostics).toHaveLength(1);
  });
});

describe("notation recovery rejects unknown or malformed nested shapes", () => {
  it.each(ORNAMENT_PROPERTIES)("does not allow ornament-specific properties on other decorations: %s", (property) => {
    expectFatal(chord(`<Fingering><text>1</text>${property}</Fingering>`));
  });

  it.each([
    "<text><Unknown/></text>",
    "<text><b><Note/></b></text>",
    '<text><font face="Edwin"><Unknown/></font></text>',
    "<text><sym><b>dynamicForte</b></sym></text>",
    '<text><b unexpected="1">forte</b></text>',
    '<text unexpected="1">forte</text>',
    "<text>first</text><text>second</text>",
    "<direction><Unknown/></direction>",
    '<direction unexpected="1">up</direction>',
    '<color unknown="1"/>',
    '<offset x="1"><Unknown/></offset>',
  ])("rejects malformed dynamic properties before unsupported-subtype recovery: %s", (properties) => {
    expectFatal(`<Dynamic><subtype>other</subtype>${properties}</Dynamic>`);
  });

  it.each([
    "<direction><Unknown/></direction>",
    "<direction>up</direction><direction>down</direction>",
    '<color unknown="1"/>',
    '<offset x="1"><Unknown/></offset>',
  ])("rejects malformed articulation properties: %s", (properties) => {
    expectFatal(chord(`<Articulation><subtype>articStaccatoAbove</subtype>${properties}</Articulation>`));
  });

  it.each(["<play><Unknown/></play>", '<play timing="1">0</play>', "<play>0</play><play>1</play>"])(
    "rejects malformed articulation playback properties: %s",
    (properties) => {
      expectFatal(chord(`<Articulation><subtype>articStaccatoAbove</subtype>${properties}</Articulation>`));
    },
  );

  it.each([
    "<play><Unknown/></play>",
    '<play timing="1">0</play>',
    "<play>0</play><play>1</play>",
    "<bassCase><Unknown/></bassCase>",
    "<bassCase>1</bassCase><bassCase>2</bassCase>",
    "<baseCase>1</baseCase>",
    '<color unknown="1"/>',
    "<degree>unexpected<degree-value>9</degree-value></degree>",
    "<degree><Unknown/></degree>",
  ])("rejects malformed harmony properties before unsupported-quality recovery: %s", (properties) => {
    expectFatal(harmony(properties));
    expectFatal(harmony(properties).replace("<name>m7</name>", "<name>unsupported</name>"));
  });

  it.each([
    "<StaffText><Unknown/></StaffText>",
    "<StaffText><text><Unknown/></text></StaffText>",
    chord("<Lyrics><text><Unknown/></text></Lyrics>"),
    chord("<stemDirection><Unknown/></stemDirection>"),
    chord('<color unknown="1"/>'),
  ])("does not treat unknown decoration nesting as safe to discard: %s", expectFatal);
});
