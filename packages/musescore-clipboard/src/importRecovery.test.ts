import { describe, expect, it } from "vitest";
import type { NoteEvent, SequenceContent } from "@viritura/core";
import {
  MUSESCORE_STAFF_LIST_MIME,
  MUSESCORE_SYMBOL_MIME,
  MuseScoreConversionError,
  readMuseScoreClipboard,
  writeMuseScoreStaffList,
  type MuseScoreClipboardData,
  type MuseScoreClipboardReadOptions,
  type MuseScoreErrorCode,
} from ".";

const SKIP = { unsupported: "skip" } as const;
const ERROR = { unsupported: "error" } as const;

function note(properties = ""): string {
  return `<Note><pitch>60</pitch><tpc>14</tpc>${properties}</Note>`;
}

function chord(properties = "", noteProperties = "", duration = "quarter"): string {
  return `<Chord><durationType>${duration}</durationType>${properties}${note(noteProperties)}</Chord>`;
}

function rest(properties = "", duration = "quarter"): string {
  return `<Rest><durationType>${duration}</durationType>${properties}</Rest>`;
}

function tuplet(properties = "", base = "eighth"): string {
  return `<Tuplet><normalNotes>2</normalNotes><actualNotes>3</actualNotes><baseNote>${base}</baseNote>${properties}</Tuplet>`;
}

function staffList(content: string, length = "1/1", tick = "0/1"): string {
  return (
    `<StaffList version="4.70" tick="${tick}" len="${length}" staff="4" staves="1"><Staff id="4">` +
    `<location><fractions>${tick}</fractions></location>${content}</Staff></StaffList>`
  );
}

function dynamic(value = "mf", properties = ""): string {
  return `<Dynamic><subtype>${value}</subtype>${properties}</Dynamic>`;
}

function harmony(name = "m", properties = ""): string {
  return `<Harmony><harmonyInfo><name>${name}</name><root>14</root></harmonyInfo>${properties}</Harmony>`;
}

function start(type: string, properties = "", delta = "1/4"): string {
  return (
    `<Spanner type="${type}"><${type}>${properties}</${type}>` +
    `<next><location><fractions>${delta}</fractions></location></next></Spanner>`
  );
}

function end(type: string, delta = "-1/4"): string {
  return `<Spanner type="${type}"><prev><location><fractions>${delta}</fractions></location></prev></Spanner>`;
}

function recover(xml: string): MuseScoreClipboardData {
  return readMuseScoreClipboard(xml, undefined, SKIP);
}

function semantic(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (key, item: unknown) => (key === "id" || key === "diagnostics" ? undefined : item)),
  );
}

function events(content: readonly SequenceContent[]): NoteEvent[] {
  return content.flatMap((item): NoteEvent[] =>
    item.type === "event" ? [item] : item.type === "tuplet" || item.type === "grace" ? events(item.content) : [],
  );
}

function expectFailure(
  xml: string,
  code: MuseScoreErrorCode,
  options: MuseScoreClipboardReadOptions = SKIP,
  mime?: string,
): void {
  try {
    readMuseScoreClipboard(xml, mime, options);
  } catch (error) {
    expect(error).toBeInstanceOf(MuseScoreConversionError);
    expect(error).toMatchObject({ code, message: expect.any(String) });
    return;
  }
  expect.unreachable(`Expected ${code}, not a successful clipboard import`);
}

function expectDiagnostics(data: MuseScoreClipboardData, count?: number): void {
  expect(data.diagnostics?.length).toBeGreaterThan(0);
  if (count !== undefined) expect(data.diagnostics).toHaveLength(count);
  for (const diagnostic of data.diagnostics ?? []) {
    expect(diagnostic).not.toBeInstanceOf(Error);
    expect(diagnostic.code).toBe("unsupported-content");
    expect(diagnostic.message.trim().length).toBeGreaterThan(0);
    expect(diagnostic.path).toMatch(/^\/(?:StaffList|EngravingItem)\//);
    expect(Object.keys(diagnostic).every((key) => ["code", "message", "path", "sourceTime"].includes(key))).toBe(true);
    if (diagnostic.sourceTime !== undefined) expect(diagnostic.sourceTime).toMatch(/^-?\d+\/\d+$/);
  }
}

describe("public recovery policy and diagnostics", () => {
  it.each([
    (xml: string) => xml.replace(' staff="4"', ""),
    (xml: string) => xml.replace(' staves="1"', ""),
    (xml: string) => xml.replace(' id="4"', ""),
    (xml: string) => xml.replace(' staff="4"', ' staff="4.0"'),
    (xml: string) => xml.replace(' id="4"', ' id=""'),
  ])("rejects missing or malformed physical staff identifiers", (invalid) => {
    expectFailure(invalid(staffList(chord())), "invalid-structure");
  });

  it.each([
    [start("Tie", "<ticks_f>bad</ticks_f>"), "invalid-timing"],
    [start("Tie", "", "bad"), "invalid-timing"],
    [end("Tie", "0/1"), "invalid-timing"],
    [end("Tie", "1/4"), "invalid-timing"],
    [start("Glissando", "", "bad"), "invalid-timing"],
    [start("Tie").replace("</location>", "<unknownTiming>1/4</unknownTiming></location>"), "invalid-structure"],
  ] as const)("validates single-note connectors before skipping: %s", (connector, code) => {
    expectFailure(`<EngravingItem>${note(connector)}</EngravingItem>`, code);
  });

  it.each([start("Tie"), end("Tie"), start("Glissando"), end("Glissando")])(
    "retains a single note with a safe unsupported endpoint: %s",
    (connector) => {
      const parsed = recover(`<EngravingItem>${note(connector)}</EngravingItem>`);
      expect(parsed.content).toHaveLength(1);
      expect(events(parsed.content)[0]?.notes?.[0]).not.toHaveProperty("ties");
      expectDiagnostics(parsed);
    },
  );

  it.each([
    `${note()}${note()}`,
    `<duration>1/4</duration><duration>1/2</duration>${note()}`,
    `<duration><value>1/4</value></duration>${note()}`,
  ])("rejects ambiguous single-note material: %s", (material) => {
    expectFailure(`<EngravingItem>${material}</EngravingItem>`, "invalid-structure");
  });

  it.each([undefined, {}, ERROR, SKIP])("omits diagnostics on lossless reads with options %j", (options) => {
    const xml = staffList(dynamic() + harmony() + chord() + rest());
    const data = readMuseScoreClipboard(xml, MUSESCORE_STAFF_LIST_MIME, options);
    expect(data).not.toHaveProperty("diagnostics");
    expect(semantic(data)).toEqual(semantic(readMuseScoreClipboard(xml)));
    expect(data.content).toHaveLength(2);
    expect(data.dynamics).toHaveLength(1);
    expect(data.chordSymbols).toHaveLength(1);
  });

  it.each([undefined, {}, ERROR])("remains strict by default or explicit request: %j", (options) => {
    const xml = staffList(chord("<Lyrics><text>hello</text></Lyrics>"));
    expectFailure(xml, "unsupported-content", options ?? {});
  });

  it("isolates strict calls, diagnostic arrays, and successful reads after a fatal read", () => {
    const xml = staffList(chord("<Lyrics><text>hello</text></Lyrics>"));
    const first = recover(xml);
    const saved = structuredClone(first);
    expectFailure(xml, "unsupported-content", {});
    expectFailure(xml, "unsupported-content", ERROR);
    expectFailure(staffList("<StaffText/><Chord/>"), "invalid-structure");
    const second = recover(xml);
    expect(semantic(second)).toEqual(semantic(first));
    expect(second.diagnostics).toEqual(first.diagnostics);
    expect(second.diagnostics).not.toBe(first.diagnostics);
    second.diagnostics![0]!.message = "caller edit";
    second.diagnostics!.push({ code: "unsupported-content", message: "caller addition" });
    expect(first).toEqual(saved);
    expect(readMuseScoreClipboard(staffList(chord()))).not.toHaveProperty("diagnostics");
    expect(recover(staffList(chord()))).not.toHaveProperty("diagnostics");
    expect(recover(xml).diagnostics).toEqual(saved.diagnostics);
  });

  it("reports each skipped staff annotation at its source-absolute time without advancing the cursor", () => {
    const xml = staffList(
      "<StaffText><text>first</text></StaffText>" +
        chord() +
        "<Tempo><tempo>2</tempo></Tempo>" +
        rest() +
        "<RehearsalMark><text>A</text></RehearsalMark>",
      "1/2",
      "5/4",
    );
    const data = recover(xml);
    expect(semantic(data)).toEqual(semantic(readMuseScoreClipboard(staffList(chord() + rest(), "1/2", "5/4"))));
    expectDiagnostics(data, 3);
    expect(data.diagnostics).toMatchObject([
      { path: "/StaffList/Staff[0]/StaffText[1]", sourceTime: "5/4" },
      { path: "/StaffList/Staff[0]/Tempo[3]", sourceTime: "3/2" },
      { path: "/StaffList/Staff[0]/RehearsalMark[5]", sourceTime: "7/4" },
    ]);
    const written = writeMuseScoreStaffList({ ...data, events: data.content });
    expect(written.warning).toBeUndefined();
    expect(written.xml).not.toBeNull();
    expect(written.xml).not.toMatch(/diagnostics|StaffText|RehearsalMark|Tempo/);
    expect(readMuseScoreClipboard(written.xml!)).not.toHaveProperty("diagnostics");
  });

  it.each([undefined, MUSESCORE_SYMBOL_MIME])("recovers a single note through the public API with MIME %s", (mime) => {
    const xml = `<EngravingItem><duration>1/8</duration>${note("<Fingering><text>2</text></Fingering>")}</EngravingItem>`;
    const data = readMuseScoreClipboard(xml, mime, SKIP);
    expectDiagnostics(data, 1);
    expect(data.content).toMatchObject([
      { duration: { base: "eighth" }, notes: [{ pitch: { step: "C", octave: 4 } }] },
    ]);
    expectFailure(xml, "unsupported-content", {});
    expect(readMuseScoreClipboard(`<EngravingItem>${note()}</EngravingItem>`, mime, SKIP)).not.toHaveProperty(
      "diagnostics",
    );
  });
});

describe("public recovery preserves rhythmic events while discarding decorations", () => {
  it.each(["TimeSig", "KeySig", "Clef", "BarLine", "MeasureRepeat", "RepeatMeasure"])(
    "does not hide structural %s under a note ornament",
    (structure) => {
      expectFailure(staffList(chord("", `<Ornament><${structure}/></Ornament>`)), "invalid-structure");
    },
  );

  it("retains concert pitch when an explicit valid written spelling exceeds native octaves", () => {
    const xml = staffList(
      "<transposeChromatic>12</transposeChromatic><transposeDiatonic>7</transposeDiatonic>" +
        chord("", "<tpc2>14</tpc2>").replace("<pitch>60</pitch>", "<pitch>12</pitch>"),
    );
    const parsed = recover(xml);
    expect(events(parsed.content)[0]?.notes).toEqual([{ id: expect.any(String), pitch: { step: "C", octave: 0 } }]);
    expectDiagnostics(parsed, 1);
    expect(parsed.diagnostics![0]!.path).toContain("/tpc2");
    expectFailure(xml, "unsupported-content", ERROR);
  });

  it.each(["<circledTip>1</circledTip>", "<lineVisible>0</lineVisible>", "<beginFontSize>14</beginFontSize>"])(
    "drops a styled hairpin without consuming the supported coincident dynamic: %s",
    (style) => {
      const parsed = recover(staffList(dynamic() + start("HairPin", style) + chord() + end("HairPin") + chord()));
      expect(parsed.content).toHaveLength(2);
      expect(parsed.dynamics).toHaveLength(1);
      expect(parsed.dynamics![0]!.dynamic).toMatchObject({ type: "immediate", value: "mf" });
      expectDiagnostics(parsed);
    },
  );

  it("skips text-valued unsupported spanner subtypes without disturbing notes or valid slurs", () => {
    const xml = staffList(
      start("Ottava", "<subtype>8va</subtype>") + chord(start("Slur")) + end("Ottava") + chord(end("Slur")),
    );
    const parsed = recover(xml);
    const [from, to] = events(parsed.content);
    expect(from?.slurs).toEqual([{ target: to?.id }]);
    expectDiagnostics(parsed, 2);
  });

  const decorations = [
    ["note fingering", chord("", "<Fingering><text>2</text></Fingering>"), chord()],
    ["note head", chord("", "<head>cross</head>"), chord()],
    ["note tuning", chord("", "<tuning>12</tuning>"), chord()],
    ["note visibility", chord("", "<visible>0</visible>"), chord()],
    ["note color", chord("", '<color r="255" g="0" b="0" a="255"/>'), chord()],
    ["note offset", chord("", '<offset x="2" y="1"/>'), chord()],
    ["chord lyrics", chord("<Lyrics><text>word</text></Lyrics>"), chord()],
    ["chord arpeggio", chord("<Arpeggio><subtype>0</subtype></Arpeggio>"), chord()],
    ["chord tremolo", chord("<Tremolo><subtype>r16</subtype></Tremolo>"), chord()],
    ["chord ornament", chord("<Ornament><subtype>ornamentTurn</subtype></Ornament>"), chord()],
    ["chord stem", chord("<stemDirection>up</stemDirection>"), chord()],
    ["chord beam", chord("<beamMode>begin</beamMode>"), chord()],
    ["chord color", chord('<color r="255" g="0" b="0" a="255"/>'), chord()],
    ["chord offset", chord('<offset x="2" y="1"/>'), chord()],
    ["rest fermata", rest("<Fermata><subtype>fermataAbove</subtype></Fermata>"), rest()],
    ["rest articulation", rest("<Articulation><subtype>articStaccatoAbove</subtype></Articulation>"), rest()],
    ["rest color", rest('<color r="255" g="0" b="0" a="255"/>'), rest()],
    ["rest small", rest("<small>1</small>"), rest()],
    ["rest placement", rest("<placement>above</placement>"), rest()],
  ] as const;

  it.each(decorations)("retains the full event and following onset despite %s", (_name, decorated, clean) => {
    const xml = staffList(decorated + dynamic("p") + chord());
    const data = recover(xml);
    expect(semantic(data)).toEqual(semantic(readMuseScoreClipboard(staffList(clean + dynamic("p") + chord()))));
    expectDiagnostics(data, 1);
    expect(data.content).toHaveLength(2);
    expect(data.dynamics).toMatchObject([{ offset: [1, 4], dynamic: { value: "p" } }]);
    expectFailure(xml, "unsupported-content", ERROR);
  });

  it.each([
    "<numberType>1</numberType>",
    "<bracketType>1</bracketType>",
    "<direction>up</direction>",
    "<Number><text>3</text></Number>",
    '<p1 x="1" y="0"/>',
    '<color r="255" g="0" b="0" a="255"/>',
  ])("retains complete tuplet ratios and exact following onset while skipping %s", (style) => {
    const triplet = chord("", "", "eighth").repeat(3) + "<endTuplet/>" + dynamic() + rest();
    const xml = staffList(tuplet(style) + triplet);
    const data = recover(xml);
    expect(semantic(data)).toEqual(semantic(readMuseScoreClipboard(staffList(tuplet() + triplet))));
    expectDiagnostics(data, 1);
    expect(data.content[0]).toMatchObject({
      type: "tuplet",
      inner: { multiple: 3 },
      outer: { multiple: 2 },
      content: [{}, {}, {}],
    });
    expect(data.dynamics).toMatchObject([{ offset: [1, 4] }]);
    expectFailure(xml, "unsupported-content", {});
  });

  it.each([
    ["articulation", "<Articulation><subtype>unknownArticulationAbove</subtype></Articulation>"],
    ["symbol", "<Symbol><name>unknownSymbol</name></Symbol>"],
  ])("retains supported markings on both sides of an unknown %s in the same chord", (_name, unknown) => {
    const before = "<Articulation><subtype>articStaccatoAbove</subtype></Articulation>";
    const after =
      "<Articulation><subtype>articAccentBelow</subtype></Articulation><Symbol><name>ornamentTrill</name></Symbol>";
    const data = recover(staffList(chord(before + unknown + after, "<Fingering><text>1</text></Fingering>")));
    expectDiagnostics(data, 2);
    expect(semantic(data)).toEqual(semantic(readMuseScoreClipboard(staffList(chord(before + after)))));
    expect(events(data.content)[0]?.markings).toEqual({ staccato: {}, accent: {}, trill: {} });
  });

  it("does not drop other pitches when one chord member has unsupported decorations", () => {
    const xml = staffList(
      chord(
        note().replace("<pitch>60</pitch><tpc>14</tpc>", "<pitch>64</pitch><tpc>18</tpc>"),
        "<head>diamond</head><Fingering><text>3</text></Fingering>",
      ),
    );
    const data = recover(xml);
    expectDiagnostics(data, 2);
    expect(events(data.content)[0]?.notes?.map((item) => item.pitch)).toEqual([
      { step: "E", octave: 4 },
      { step: "C", octave: 4 },
    ]);
    expect(events(data.content)[0]?.duration).toEqual({ base: "quarter" });
  });

  it("preserves nonzero selection start, physical staves, voices, lead-in, nested tuplets, grace, and gaps together", () => {
    const nested =
      tuplet("<numberType>1</numberType>") +
      chord("<acciaccatura/>", "<Fingering><text>1</text></Fingering>", "16th") +
      chord("", "", "eighth") +
      tuplet("<bracketType>1</bracketType>", "16th") +
      chord("", "", "16th").repeat(3) +
      "<endTuplet/>" +
      rest("<small>1</small>", "eighth") +
      "<endTuplet/>" +
      dynamic("p") +
      harmony("m");
    const xml = `<StaffList version="4.70" tick="3/2" len="1/1" staff="4" staves="2">
      <Staff id="4"><location><fractions>3/2</fractions></location>
        <StaffText><text>skip</text></StaffText>${nested}
        <location><fractions>1/4</fractions></location>${chord()}
        <location><voices>1</voices><fractions>-3/4</fractions></location>${rest("<visible>0</visible>")}
      </Staff>
      <Staff id="5"><voiceOffset><voice id="2">480</voice></voiceOffset>
        <location><voices>2</voices></location>${dynamic("f")}${harmony("7")}${chord("", "<head>cross</head>")}
      </Staff></StaffList>`;
    const clean = xml
      .replace("<numberType>1</numberType>", "")
      .replace("<bracketType>1</bracketType>", "")
      .replace("<Fingering><text>1</text></Fingering>", "")
      .replace("<small>1</small>", "")
      .replace("<StaffText><text>skip</text></StaffText>", "")
      .replace("<visible>0</visible>", "")
      .replace("<head>cross</head>", "");
    const data = recover(xml);
    expectDiagnostics(data, 7);
    expect(semantic(data)).toEqual(semantic(readMuseScoreClipboard(clean)));
    expect(data.tracks).toHaveLength(3);
    expect(data.content).toEqual(data.tracks![0]!.content);
    expect(data.tracks).toMatchObject([
      {
        partOffset: 0,
        staffOffset: 0,
        voiceIndex: 0,
        content: [
          {
            type: "tuplet",
            inner: { multiple: 3 },
            outer: { multiple: 2 },
            content: [
              { type: "grace", slash: true, graceType: "stealFollowing", content: [{ duration: { base: "16th" } }] },
              { type: "event", duration: { base: "eighth" } },
              { type: "tuplet", inner: { multiple: 3 }, outer: { multiple: 2 }, content: [{}, {}, {}] },
              { type: "event", rest: {}, duration: { base: "eighth" } },
            ],
          },
          { type: "space", duration: [1, 4] },
          { type: "event", duration: { base: "quarter" } },
        ],
      },
      { staffOffset: 0, voiceIndex: 1, content: [{ rest: {} }] },
      { staffOffset: 1, voiceIndex: 2, leadIn: [1, 4], content: [{ notes: [{ pitch: { step: "C", octave: 4 } }] }] },
    ]);
    expect(data.dynamics).toMatchObject([
      { staffOffset: 0, offset: [1, 4], dynamic: { value: "p" } },
      { staffOffset: 1, offset: [1, 4], dynamic: { value: "f" } },
    ]);
    expect(data.chordSymbols).toMatchObject([
      { staffOffset: 0, offset: [1, 4], chordSymbol: { quality: "minor" } },
      { staffOffset: 1, offset: [1, 4], chordSymbol: { quality: "dominant", extension: 7 } },
    ]);
  });
});

describe("public annotation recovery", () => {
  it.each([
    ["dynamic subtype", dynamic("sfz")],
    ["harmony quality", harmony("unrepresentable-quality")],
    ["harmony function", harmony("m", "<function>V</function>")],
    ["harmony text", harmony("m", "<text>custom</text>")],
    [
      "harmony degrees",
      harmony(
        "m",
        "<degree><degree-value>9</degree-value><degree-alter>1</degree-alter><degree-type>add</degree-type></degree>",
      ),
    ],
    ["polychord", harmony("m", "<harmonyInfo><name>7</name><root>15</root></harmonyInfo>")],
  ])("diagnoses unsupported semantic %s, retaining raw harmony and surrounding annotations", (_name, unsupported) => {
    const before = dynamic("p") + harmony("m") + chord();
    const after = chord() + dynamic("f") + harmony("7") + rest();
    const xml = staffList(before + unsupported + after);
    const data = recover(xml);
    expectDiagnostics(data, 1);
    const expected = readMuseScoreClipboard(staffList(before + after));
    expect(data.content).toHaveLength(expected.content.length);
    expect(data.dynamics).toMatchObject([
      { offset: [0, 1], dynamic: { value: "p" } },
      { offset: [1, 2], dynamic: { value: "f" } },
    ]);
    expect(data.chordSymbols).toMatchObject([
      { offset: [0, 1], chordSymbol: { quality: "minor" } },
      ...(_name.startsWith("dynamic")
        ? []
        : [{ offset: [1, 4], chordSymbol: { rawText: expect.any(String), quality: "other" } }]),
      { offset: [1, 2], chordSymbol: { quality: "dominant", extension: 7 } },
    ]);
    if (_name.startsWith("dynamic")) expectFailure(xml, "unsupported-content", ERROR);
    else {
      const strict = readMuseScoreClipboard(xml, undefined, ERROR);
      expect(strict.chordSymbols).toEqual(data.chordSymbols);
      expectDiagnostics(strict, 1);
    }
  });

  it.each([
    "<fontSize>18</fontSize>",
    "<visible>0</visible>",
    '<offset x="1" y="2"/>',
    '<color r="255" g="0" b="0" a="255"/>',
  ])("retains dynamic and harmony semantics when only style is unsupported: %s", (style) => {
    const data = recover(staffList(dynamic("mf", style) + harmony("m", style) + chord()));
    expectDiagnostics(data, 2);
    expect(semantic(data)).toEqual(semantic(readMuseScoreClipboard(staffList(dynamic() + harmony() + chord()))));
  });

  it.each([-1, 0, 1, 49, 96, 127, 128])("never persists source numeric velocity %s during recovery", (velocity) => {
    const xml = staffList(
      dynamic("mf", `<velocity>${velocity}</velocity>`) + chord("", `<velocity>${velocity}</velocity>`),
    );
    const data = recover(xml);
    expectDiagnostics(data, 1);
    expect(semantic(data)).toEqual(semantic(readMuseScoreClipboard(staffList(dynamic() + chord()))));
    expect(data.dynamics?.[0]?.dynamic).toEqual({
      id: expect.any(String),
      type: "immediate",
      value: "mf",
      position: { fraction: [0, 1] },
    });
    const notation = { ...data, diagnostics: undefined };
    expect(JSON.stringify(notation)).not.toMatch(/velocity|veloOffset|veloType|_x/);
    const written = writeMuseScoreStaffList({ ...data, events: data.content });
    expect(written.xml).not.toBeNull();
    expect(written.xml).not.toContain("velocity");
  });

  it.each([
    "",
    "<StaffText><text>only text</text></StaffText>",
    dynamic("sfz"),
    harmony("unsupported-quality"),
    start("Pedal"),
    dynamic() + harmony(),
    "<StaffText/><Tempo><tempo>2</tempo></Tempo>" + dynamic("sfz") + harmony("unsupported-quality"),
  ])("rejects empty or all-skipped rhythmic content rather than returning success: %s", (content) => {
    expectFailure(staffList(content), "empty-content");
  });

  it("omits an all-skipped staff when a different physical staff still contains music", () => {
    const xml = `<StaffList version="4.70" tick="0/1" len="1/4" staff="4" staves="2">
      <Staff id="4"><StaffText><text>skip</text></StaffText></Staff><Staff id="5">${rest()}</Staff></StaffList>`;
    const data = recover(xml);
    expectDiagnostics(data, 1);
    expect(data.tracks).toHaveLength(1);
    expect(data.tracks?.[0]).toMatchObject({ staffOffset: 1, voiceIndex: 0, content: [{ rest: {} }] });
    expect(data.content).toEqual(data.tracks![0]!.content);
  });
});

describe("public connector recovery leaves no dangling references", () => {
  it.each([
    ["unsupported slur appearance", start("Slur", "<lineType>3</lineType>"), end("Slur"), "", "", "", ""],
    [
      "partial slur",
      start("Slur", "<partialSpannerDirection>outgoing</partialSpannerDirection>"),
      end("Slur"),
      "",
      "",
      "",
      "",
    ],
    ["orphan slur", start("Slur"), "", "", "", "", ""],
    ["incoming slur outside selection", end("Slur"), "", "", "", "", ""],
    ["unknown chord connector", start("Ottava"), end("Ottava"), "", "", "", ""],
    ["unsupported tie", "", "", start("Tie", "<up>sideways</up>"), end("Tie"), "", ""],
    ["orphan tie", "", "", start("Tie"), "", "", ""],
    ["unknown note connector", "", "", start("Glissando"), end("Glissando"), "", ""],
    ["unsupported hairpin", "", "", "", "", start("HairPin", "<subtype>2</subtype>"), end("HairPin")],
    ["orphan hairpin", "", "", "", "", start("HairPin"), ""],
    ["unknown staff connector", "", "", "", "", start("Pedal"), end("Pedal")],
  ])(
    "preserves independent complete slur, tie and hairpin beside %s",
    (_name, chordStart, chordEnd, noteStart, noteEnd, staffStart, staffEnd) => {
      const xml = staffList(
        dynamic("p") +
          staffStart +
          chord(chordStart, noteStart) +
          staffEnd +
          chord(chordEnd, noteEnd) +
          dynamic("mf") +
          start("HairPin") +
          chord(start("Slur"), start("Tie")) +
          end("HairPin") +
          chord(end("Slur"), end("Tie")),
      );
      const data = recover(xml);
      expectDiagnostics(data);
      const imported = events(data.content);
      expect(imported).toHaveLength(4);
      expect(imported.map((event) => event.notes?.[0]?.pitch)).toEqual(
        Array.from({ length: 4 }, () => ({ step: "C", octave: 4 })),
      );
      expect(imported.map((event) => event.duration)).toEqual(Array.from({ length: 4 }, () => ({ base: "quarter" })));
      expect(imported[0]?.slurs).toBeUndefined();
      expect(imported[1]?.slurs).toBeUndefined();
      expect(imported[2]?.slurs).toEqual([{ target: imported[3]!.id }]);
      expect(imported[3]?.slurs).toBeUndefined();
      expect(imported[0]?.notes?.[0]?.ties).toBeUndefined();
      expect(imported[1]?.notes?.[0]?.ties).toBeUndefined();
      expect(imported[2]?.notes?.[0]?.ties).toEqual([{ target: imported[3]!.notes![0]!.id }]);
      expect(imported[3]?.notes?.[0]?.ties).toBeUndefined();
      expect(data.dynamics).toHaveLength(2);
      expect(data.dynamics).toMatchObject([
        { offset: [0, 1], dynamic: { type: "immediate", value: "p" } },
        { offset: [1, 2], endOffset: [3, 4], dynamic: { type: "gradual", value: "mf", wedgeType: "increasing" } },
      ]);
      const eventIds = new Set(imported.map((event) => event.id));
      const noteIds = new Set(imported.flatMap((event) => event.notes?.map((item) => item.id) ?? []));
      for (const event of imported) {
        for (const slur of event.slurs ?? []) expect(eventIds.has(slur.target)).toBe(true);
        for (const item of event.notes ?? []) {
          for (const tie of item.ties ?? []) expect(noteIds.has(tie.target)).toBe(true);
        }
      }
      expect(() => readMuseScoreClipboard(xml, undefined, ERROR)).toThrow(MuseScoreConversionError);
    },
  );

  it("keeps a valid shared-start slur when an independent slur with the same source is unsupported", () => {
    const data = recover(
      staffList(
        chord(start("Slur", "<lineType>3</lineType>") + start("Slur", "", "1/2")) +
          chord(end("Slur")) +
          chord(end("Slur", "-1/2")),
      ),
    );
    expectDiagnostics(data, 1);
    const [a, b, c] = events(data.content);
    expect(a?.slurs).toEqual([{ target: c!.id }]);
    expect(b?.slurs).toBeUndefined();
    expect(c?.slurs).toBeUndefined();
  });
});

describe("recovery cannot bypass fatal XML and envelope checks", () => {
  it.each([
    ["unclosed XML", "<StaffList", "malformed-xml"],
    ["mismatched tags", staffList(chord()).replace("</Note>", "</Rest>"), "malformed-xml"],
    ["unknown entity", staffList(chord("<Lyrics><text>&unknown;</text></Lyrics>")), "malformed-xml"],
    ["illegal character", staffList(chord("<Lyrics><text>&#0;</text></Lyrics>")), "malformed-xml"],
    ["DTD", "<!DOCTYPE StaffList>" + staffList(chord()), "unsafe-xml"],
    ["external DTD", '<!DOCTYPE StaffList SYSTEM "file:///not-read.dtd">' + staffList(chord()), "unsafe-xml"],
    ["entity declaration", '<!DOCTYPE StaffList [<!ENTITY text "expanded">]>' + staffList(chord()), "unsafe-xml"],
    ["future version", staffList(chord()).replace('version="4.70"', 'version="5.00"'), "unsupported-version"],
    ["nearby version", staffList(chord()).replace('version="4.70"', 'version="4.7"'), "unsupported-version"],
    ["missing version", staffList(chord()).replace('version="4.70"', ""), "unsupported-version"],
    ["no Staff", '<StaffList version="4.70" tick="0/1" len="1/1" staff="4" staves="1"/>', "invalid-structure"],
    ["unknown root child", staffList(chord()).replace("<Staff id", "<Unknown/><Staff id"), "invalid-structure"],
    [
      "unknown root attribute",
      staffList(chord()).replace("<StaffList ", '<StaffList ticks="480" '),
      "invalid-structure",
    ],
    [
      "unknown staff attribute",
      staffList(chord()).replace('<Staff id="4">', '<Staff id="4" ticks="480">'),
      "invalid-structure",
    ],
    ["wrong staff", staffList(chord()).replace('<Staff id="4">', '<Staff id="5">'), "invalid-structure"],
    ["zero length", staffList(chord(), "0/1"), "invalid-timing"],
    ["negative start", staffList(chord(), "1/1", "-1/4"), "invalid-timing"],
    ["content exceeds selection", staffList(chord(), "1/8"), "invalid-timing"],
    [
      "nontrivial time stretch",
      staffList(chord()).replace("<StaffList ", '<StaffList timeStretch="2/1" '),
      "unsupported-content",
    ],
  ] as const)("still throws for %s", (_name, xml, code) => {
    expectFailure(xml, code);
  });

  it("rejects a MIME/root mismatch even with recovery enabled", () => {
    expectFailure(staffList(chord()), "invalid-structure", SKIP, MUSESCORE_SYMBOL_MIME);
  });

  it("rejects over 8 MiB measured in UTF-8 bytes, not JavaScript string length", () => {
    const xml = staffList(chord()) + `<!--${"é".repeat(4 * 1024 * 1024)}-->`;
    expect(xml.length).toBeLessThan(8 * 1024 * 1024);
    expectFailure(xml, "unsafe-xml");
  });

  it("accepts a valid payload exactly at the 8 MiB boundary", () => {
    const base = staffList(chord()) + "<!---->";
    const xml = base.replace("<!---->", `<!--${" ".repeat(8 * 1024 * 1024 - base.length)}-->`);
    expect(new TextEncoder().encode(xml)).toHaveLength(8 * 1024 * 1024);
    const data = recover(xml);
    expect(data.content).toHaveLength(1);
    expect(data).not.toHaveProperty("diagnostics");
  });

  it.each([64, 65, 128])("rejects deep nesting even inside a skippable decoration (%s wrappers)", (depth) => {
    expectFailure(
      staffList(chord("<Lyrics>" + "<text>".repeat(depth) + "word" + "</text>".repeat(depth) + "</Lyrics>")),
      "unsafe-xml",
    );
  });

  it("enforces the element-count budget before skipping annotations", () => {
    expectFailure(staffList(chord() + "<StaffText/>".repeat(100_001)), "unsafe-xml");
  });
});

describe("recovery cannot guess invalid rhythmic structure", () => {
  it.each([
    ["unknown timing element", "<tick>480</tick>", "unsupported-content"],
    ["unknown duration element", "<ticks>480</ticks>", "unsupported-content"],
    ["unknown measure wrapper", `<Measure>${chord()}</Measure>`, "unsupported-content"],
    ["unknown voice wrapper", `<voice>${chord()}</voice>`, "unsupported-content"],
    ["unknown generic wrapper", `<Unknown>${chord()}</Unknown>`, "unsupported-content"],
    ["unknown empty element", "<Unknown/>", "unsupported-content"],
    ["unknown chord property", chord("<ticks>480</ticks>"), "unsupported-content"],
    ["unknown rest property", rest("<durationMode>custom</durationMode>"), "unsupported-content"],
    ["unknown tuplet property", tuplet("<ticks>480</ticks>"), "unsupported-content"],
    ["unknown note property", chord("", "<unknown>1</unknown>"), "invalid-structure"],
    ["unknown stream location field", "<location><unknown>1</unknown></location>", "invalid-structure"],
    ["nested stream location scalar", "<location><fractions><Chord/></fractions></location>", "invalid-structure"],
    [
      "duplicate location scalar",
      "<location><fractions>1/4</fractions><fractions>1/4</fractions></location>",
      "invalid-structure",
    ],
    ["unknown voice offset child", "<voiceOffset><Unknown>480</Unknown></voiceOffset>", "invalid-structure"],
    [
      "nested voice offset scalar",
      '<voiceOffset><voice id="0"><unknown>0</unknown></voice></voiceOffset>',
      "invalid-structure",
    ],
    [
      "duplicate voice offset",
      '<voiceOffset><voice id="0">0</voice><voice id="0">0</voice></voiceOffset>',
      "invalid-structure",
    ],
    ["invalid voice", "<location><voices>4</voices></location>", "invalid-structure"],
    ["measure-relative location", "<location><measures>1</measures></location>", "unsupported-content"],
    ["unknown tick anchor", "<location><timeTick>1</timeTick></location>", "unsupported-content"],
    ["negative source time", "<location><fractions>-1/4</fractions></location>", "invalid-timing"],
    ["overlap", chord() + "<location><fractions>-1/8</fractions></location>", "invalid-timing"],
    ["zero denominator", "<location><fractions>1/0</fractions></location>", "invalid-timing"],
    ["missing duration", `<Chord>${note()}</Chord>`, "invalid-structure"],
    ["unknown duration", chord("", "", "future-duration"), "unsupported-content"],
    ["missing measure-rest duration", rest("", "measure"), "unsupported-content"],
    ["unrepresentable duration", chord("<duration>1/7</duration>"), "invalid-timing"],
    ["zero duration", chord("<duration>0/1</duration>"), "invalid-timing"],
    ["negative duration", rest("<duration>-1/4</duration>"), "invalid-timing"],
    ["too many dots", chord("<dots>5</dots>"), "unsupported-content"],
    [
      "nested duration",
      `<Chord><durationType><text>quarter</text></durationType>${note()}</Chord>`,
      "invalid-structure",
    ],
    ["duplicate duration", chord("<durationType>quarter</durationType>"), "invalid-structure"],
    ["no chord notes", "<Chord><durationType>quarter</durationType></Chord>", "invalid-structure"],
    [
      "missing note pitch",
      "<Chord><durationType>quarter</durationType><Note><tpc>14</tpc></Note></Chord>",
      "invalid-structure",
    ],
    [
      "missing note spelling",
      "<Chord><durationType>quarter</durationType><Note><pitch>60</pitch></Note></Chord>",
      "invalid-structure",
    ],
    ["unmatched endTuplet", "<endTuplet/>", "invalid-structure"],
    ["unclosed tuplet", tuplet() + chord("", "", "eighth"), "invalid-structure"],
    ["incomplete tuplet", tuplet() + chord("", "", "eighth") + "<endTuplet/>", "invalid-timing"],
    ["empty tuplet", tuplet() + "<endTuplet/>", "invalid-structure"],
    ["invalid tuplet ratio", tuplet().replace("<actualNotes>3", "<actualNotes>0"), "invalid-timing"],
    ["oversized tuplet ratio", tuplet().replace("<actualNotes>3", "<actualNotes>129"), "invalid-timing"],
    ["missing tuplet base", tuplet().replace("<baseNote>eighth</baseNote>", ""), "invalid-structure"],
    ["unknown tuplet base", tuplet("", "unknown"), "unsupported-content"],
    ["tuplet internal gap", tuplet() + "<location><fractions>1/8</fractions></location>", "unsupported-content"],
    ["hidden rhythm in chord decoration", chord(`<Lyrics>${rest()}</Lyrics>`), "invalid-structure"],
    ["hidden rhythm in note decoration", chord("", `<Fingering>${chord()}</Fingering>`), "invalid-structure"],
    ["hidden rhythm in staff annotation", `<StaffText>${chord()}</StaffText>`, "invalid-structure"],
    ["hidden rhythm in tuplet style", tuplet(`<Number>${rest()}</Number>`), "invalid-structure"],
    ["nested dynamic velocity", dynamic("mf", "<velocity><Note/></velocity>"), "invalid-structure"],
    ["nested dynamic subtype", "<Dynamic><subtype><text>mf</text></subtype></Dynamic>", "invalid-structure"],
    ["missing dynamic subtype", "<Dynamic><velocity>90</velocity></Dynamic>", "invalid-structure"],
    ["missing articulation subtype", chord("<Articulation/>"), "invalid-structure"],
    ["missing symbol name", chord("<Symbol/>"), "invalid-structure"],
    [
      "nested articulation subtype",
      chord("<Articulation><subtype><text>articAccentAbove</text></subtype></Articulation>"),
      "invalid-structure",
    ],
    ["nested symbol name", chord("<Symbol><name><text>ornamentTrill</text></name></Symbol>"), "invalid-structure"],
    ["missing harmony info", "<Harmony><fontSize>12</fontSize></Harmony>", "invalid-structure"],
    ["missing harmony root and name", "<Harmony><harmonyInfo><name/></harmonyInfo></Harmony>", "invalid-structure"],
    [
      "nested harmony root",
      "<Harmony><harmonyInfo><root><text>14</text></root></harmonyInfo></Harmony>",
      "invalid-structure",
    ],
    ["unknown harmony field", harmony("m", "<unknown>1</unknown>"), "invalid-structure"],
    ["malformed skipped semantic dynamic", dynamic("sfz", "<velocity><Note/></velocity>"), "invalid-structure"],
    ["malformed skipped semantic harmony", harmony("unsupported", "<fontSize><Note/></fontSize>"), "invalid-structure"],
  ] as const)("throws for %s despite recoverable content earlier in the stream", (_name, invalid, code) => {
    expectFailure(staffList("<StaffText><text>recover this first</text></StaffText>" + invalid + chord(), "4/1"), code);
  });

  it("rejects content before a nonzero selection start even after skipping a decoration", () => {
    expectFailure(
      staffList("<StaffText/>" + "<location><fractions>-1/4</fractions></location>" + chord(), "1/1", "3/2"),
      "invalid-timing",
    );
  });

  it("does not hide a pitch mismatch between otherwise complete tie endpoints", () => {
    const xml = staffList(
      "<StaffText/>" +
        chord("", start("Tie")) +
        chord("", end("Tie")).replace("<pitch>60</pitch><tpc>14</tpc>", "<pitch>62</pitch><tpc>16</tpc>"),
    );
    expectFailure(xml, "invalid-pitch");
  });
});
