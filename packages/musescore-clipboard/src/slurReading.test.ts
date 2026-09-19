import { describe, expect, it } from "vitest";
import type { NoteEvent, SequenceContent } from "@viritura/core";
import { MuseScoreConversionError, readMuseScoreClipboard, writeMuseScoreStaffList } from ".";

// Independently authored XML, not live captures or output from our writer.
// MuseScore 4.7.5 source contract at 3654226c2e99289916916953a98e585a3d3b315a:
// https://github.com/musescore/MuseScore/tree/3654226c2e99289916916953a98e585a3d3b315a
// rw/write/twrite.cpp:1093-1153,2628-2653,2669-2725: ChordRest slurs and saved appearance.
// rw/write/connectorinfowriter.cpp:52-139: start body, reciprocal locations, clipboard absolute fractions.
// dom/location.cpp:65-93,128-139,214-230 and location.h:46-51: non-note sentinel cancels to zero delta.
// rw/read460/tread.cpp:3754-3817: Slur properties and segments.
// dom/property.cpp:72,91,483; types/types.h:1044-1050; types/typesconv.cpp:2255-2289:
// up=auto/up/down; lineType=0 solid,1 dotted,2 dashed,3 wide-dashed (not representable).
// dom/slurtie.cpp:184-193: SlurSegment is emitted only for user-modified appearance.

const CANONICAL_SLUR = `<StaffList version="4.70" tick="0/1" len="1/2" staff="24" staves="1">
  <Staff id="24">
    <Chord><durationType>quarter</durationType>
      <Spanner type="Slur"><Slur/>
        <next><location><fractions>1/4</fractions></location></next>
      </Spanner>
      <Note><pitch>60</pitch><tpc>14</tpc></Note>
      <Note><pitch>64</pitch><tpc>18</tpc></Note>
    </Chord>
    <Chord><durationType>quarter</durationType>
      <Spanner type="Slur">
        <prev><location><fractions>-1/4</fractions></location></prev>
      </Spanner>
      <Note><pitch>67</pitch><tpc>15</tpc></Note>
    </Chord>
  </Staff>
</StaffList>`;

function start(delta = "1/4", properties = "", fields = ""): string {
  return (
    `<Spanner type="Slur"><Slur>${properties}</Slur>` +
    `<next><location><fractions>${delta}</fractions>${fields}</location></next></Spanner>`
  );
}

function end(delta = "-1/4", fields = ""): string {
  return `<Spanner type="Slur"><prev><location><fractions>${delta}</fractions>${fields}</location></prev></Spanner>`;
}

function chord(connectors = "", duration = "quarter", extra = ""): string {
  return (
    `<Chord><durationType>${duration}</durationType>${connectors}${extra}` +
    "<Note><pitch>60</pitch><tpc>14</tpc></Note></Chord>"
  );
}

function rest(connectors = ""): string {
  return `<Rest><durationType>quarter</durationType>${connectors}</Rest>`;
}

function staffList(content: string, length = "1/2", tick = "0/1"): string {
  return (
    `<StaffList version="4.70" tick="${tick}" len="${length}" staff="24" staves="1"><Staff id="24">` +
    `<location><fractions>${tick}</fractions></location>${content}</Staff></StaffList>`
  );
}

function events(content: readonly SequenceContent[]): NoteEvent[] {
  return content.flatMap((item): NoteEvent[] =>
    item.type === "event" ? [item] : item.type === "tuplet" || item.type === "grace" ? events(item.content) : [],
  );
}

function expectInvalid(xml: string, message: RegExp): void {
  expect(() => readMuseScoreClipboard(xml)).toThrow(MuseScoreConversionError);
  expect(() => readMuseScoreClipboard(xml)).toThrow(message);
}

function tuplet(base: string): string {
  return `<Tuplet><normalNotes>2</normalNotes><actualNotes>3</actualNotes><baseNote>${base}</baseNote></Tuplet>`;
}

describe("source-authored ChordRest slur import", () => {
  it("imports a canonical empty Slur body between different pitches using event IDs, never note IDs", () => {
    const [from, to] = events(readMuseScoreClipboard(CANONICAL_SLUR).content);
    expect(from!.slurs).toEqual([{ target: to!.id }]);
    expect(to!.slurs).toBeUndefined();
    expect(from!.notes).toHaveLength(2);
    expect(from!.id).not.toBe(to!.id);
    expect(to!.notes![0]!.pitch.step).toBe("G");
    for (const event of [from!, to!]) {
      for (const note of event.notes!) {
        expect(from!.slurs![0]!.target).not.toBe(note.id);
        expect(note.ties).toBeUndefined();
      }
    }
  });

  it("keeps public slur export rejected without mutating imported content", () => {
    const imported = readMuseScoreClipboard(CANONICAL_SLUR);
    const before = JSON.stringify(imported);
    const written = writeMuseScoreStaffList({ ...imported, events: imported.content });
    expect(written.xml).toBeNull();
    expect(written.warning).toMatch(/slurs/);
    expect(JSON.stringify(imported)).toBe(before);
  });

  it.each(["3/8", "7/1", "23/12"])("normalizes source-absolute tick %s exactly once", (tick) => {
    const parsed = readMuseScoreClipboard(
      staffList(chord(start("1/2", "<ticks_f>2/4</ticks_f>")) + rest() + chord(end("-1/2")), "3/4", tick),
    );
    const [from, , to] = events(parsed.content);
    expect(parsed.content).toHaveLength(3);
    expect(from!.slurs).toEqual([{ target: to!.id }]);
  });

  it.each([
    ["Chord to Rest", chord, rest],
    ["Rest to Chord", rest, chord],
    ["Rest to Rest", rest, rest],
  ] as const)("imports %s through the shared ChordRest contract", (_name, from, to) => {
    const parsed = events(readMuseScoreClipboard(staffList(from(start()) + to(end()))).content);
    expect(parsed[0]!.slurs).toEqual([{ target: parsed[1]!.id }]);
  });

  it("uses actual nested-tuplet onsets instead of nominal note durations", () => {
    const parsed = readMuseScoreClipboard(
      staffList(
        tuplet("eighth") +
          chord("", "eighth") +
          tuplet("16th") +
          chord(start("1/36", "<ticks_f>1/36</ticks_f>"), "16th") +
          chord(end("-1/36"), "16th") +
          chord("", "16th") +
          "<endTuplet/>" +
          chord("", "eighth") +
          "<endTuplet/>",
        "1/4",
      ),
    );
    const notes = events(parsed.content);
    expect(notes[1]!.slurs).toEqual([{ target: notes[2]!.id }]);
    expect(parsed.content[0]!.type).toBe("tuplet");
  });

  it("spans bars, nested tuplets, voices and staves while only resetting staff/voice at Staff boundaries", () => {
    const xml =
      `<StaffList version="4.70" tick="7/8" len="3/2" staff="24" staves="2">` +
      `<Staff id="24"><location><voices>3</voices><fractions>7/8</fractions></location>` +
      tuplet("eighth") +
      chord("", "eighth") +
      tuplet("16th") +
      chord(start("7/6", "<ticks_f>7/6</ticks_f>", "<staves>1</staves><voices>-3</voices>"), "16th") +
      chord("", "16th") +
      chord("", "16th") +
      "<endTuplet/>" +
      chord("", "eighth") +
      "<endTuplet/></Staff>" +
      `<Staff id="25"><location><fractions>1/1</fractions></location>` +
      chord(end("-7/6", "<staves>-1</staves><voices>3</voices>")) +
      "</Staff></StaffList>";
    const parsed = readMuseScoreClipboard(xml);
    const [source, destination] = parsed.tracks!;
    expect(source).toMatchObject({ staffOffset: 0, voiceIndex: 3 });
    expect(destination).toMatchObject({ staffOffset: 1, voiceIndex: 0 });
    expect(destination!.content[0]).toEqual({ type: "space", duration: [5, 4] });
    expect(events(source!.content)[1]!.slurs).toEqual([{ target: events(destination!.content)[0]!.id }]);
  });

  it("pairs an end parsed before its start on another voice", () => {
    const parsed = readMuseScoreClipboard(
      staffList(
        "<location><fractions>1/4</fractions></location>" +
          chord(end("-1/4", "<voices>2</voices>")) +
          "<location><voices>2</voices><fractions>-1/2</fractions></location>" +
          chord(start("1/4", "", "<voices>-2</voices>")),
      ),
    );
    const [destination, source] = parsed.tracks!;
    expect(source!.voiceIndex).toBe(2);
    expect(events(source!.content)[0]!.slurs).toEqual([{ target: events(destination!.content)[0]!.id }]);
  });

  it("preserves overlapping, nested, shared-start, shared-end and chained distinct pairs", () => {
    const parsed = events(
      readMuseScoreClipboard(
        staffList(
          chord(start("3/4") + start("1/2") + start("1/4")) +
            chord(start("1/2") + end() + start("1/4")) +
            chord(end() + start("1/4") + end("-1/2")) +
            chord(end("-1/2") + end("-3/4") + end()),
          "1/1",
        ),
      ).content,
    );
    const [a, b, c, d] = parsed;
    expect(a!.slurs).toEqual([{ target: d!.id }, { target: c!.id }, { target: b!.id }]);
    expect(b!.slurs).toEqual([{ target: d!.id }, { target: c!.id }]);
    expect(c!.slurs).toEqual([{ target: d!.id }]);
    expect(d!.slurs).toBeUndefined();
  });

  it("keeps different cross-voice targets at the same onset distinct", () => {
    const parsed = readMuseScoreClipboard(
      staffList(
        chord(start("1/4") + start("1/4", "", "<voices>1</voices>")) +
          chord(end()) +
          "<location><voices>1</voices><fractions>-1/4</fractions></location>" +
          chord(end("-1/4", "<voices>-1</voices>")),
      ),
    );
    const [voice0, voice1] = parsed.tracks!;
    const [from, to] = events(voice0!.content);
    expect(from!.slurs).toEqual([{ target: to!.id }, { target: events(voice1!.content)[0]!.id }]);
  });

  it.each(["up", "down", "auto"])("maps native up=%s without inventing independent endpoint directions", (side) => {
    const [from, to] = events(
      readMuseScoreClipboard(staffList(chord(start("1/4", `<up>${side}</up>`)) + chord(end()))).content,
    );
    expect(from!.slurs).toEqual([{ target: to!.id, ...(side === "auto" ? {} : { side, sideEnd: side }) }]);
  });

  it.each([
    [0, "solid"],
    [1, "dotted"],
    [2, "dashed"],
  ])("maps native lineType=%i to %s", (source, lineType) => {
    const [from, to] = events(
      readMuseScoreClipboard(
        staffList(chord(start("1/4", `<up>down</up><lineType>${source}</lineType>`)) + chord(end())),
      ).content,
    );
    expect(from!.slurs).toEqual([{ target: to!.id, side: "down", sideEnd: "down", lineType }]);
  });

  it("accepts explicit neutral anchor deltas and normal partialSpannerDirection", () => {
    const fields = "<notes>0</notes><staves>0</staves><voices>0</voices><measures>0</measures><timeTick>0</timeTick>";
    const [from, to] = events(
      readMuseScoreClipboard(
        staffList(
          chord(start("1/4", "<partialSpannerDirection>none</partialSpannerDirection>", fields)) +
            chord(end("-1/4", fields)),
        ),
      ).content,
    );
    expect(from!.slurs).toEqual([{ target: to!.id }]);
  });
});

describe("unsupported or malformed slur diagnostics", () => {
  it.each([
    ["dangling start", start(), "", /orphan/],
    ["dangling end", "", end(), /orphan/],
    ["nonreciprocal end", start(), end("-1/8"), /reciprocal/],
    ["duplicate start", start() + start(), end(), /ambiguous duplicate/],
    ["duplicate end", start(), end() + end(), /ambiguous duplicate/],
    ["equivalent duplicate fractions", start() + start("2/8"), end(), /ambiguous duplicate/],
    ["same pair with different appearance", start() + start("1/4", "<up>down</up>"), end(), /ambiguous duplicate/],
    ["missing body", start().replace("<Slur></Slur>", ""), end(), /body/],
    ["body on end", start(), end().replace("<prev>", "<Slur/><prev>"), /body/],
    ["missing location", start().replace(/<location>.*<\/location>/, ""), end(), /missing location/],
    ["both directions", start().replace("</Spanner>", "<prev><location/></prev></Spanner>"), end(), /exactly one/],
    ["neither direction", '<Spanner type="Slur"><Slur/></Spanner>', end(), /exactly one/],
    ["wrong ticks", start("1/4", "<ticks_f>1/8</ticks_f>"), end(), /ticks_f/],
    ["invalid ticks", start("1/4", "<ticks_f>1/0</ticks_f>"), end(), /invalid fraction/],
    ["outside staff", start("1/4", "", "<staves>1</staves>"), end(), /outside/],
    ["outside voice", start("1/4", "", "<voices>4</voices>"), end(), /outside/],
    ["negative staff", start("1/4", "", "<staves>-1</staves>"), end(), /outside/],
    ["negative voice", start("1/4", "", "<voices>-1</voices>"), end(), /outside/],
    ["outside copied time", start("3/4"), end("-3/4"), /outside/],
    ["before copied time", start(), end("-3/4"), /outside/],
    ["note ordinal", start("1/4", "", "<notes>1</notes>"), end(), /note-index/],
    ["negative note ordinal", start("1/4", "", "<notes>-1</notes>"), end(), /note-index/],
    ["end note ordinal", start(), end("-1/4", "<notes>1</notes>"), /note-index/],
    ["grace anchor", start("1/4", "", "<grace>0</grace>"), end(), /grace/],
    ["measure anchor", start("1/4", "", "<measures>1</measures>"), end(), /measure/],
    ["time-tick anchor", start("1/4", "", "<timeTick>1</timeTick>"), end(), /time-tick/],
    ["invalid fraction", start("bad"), end(), /invalid fraction/],
    ["duplicate fraction", start("1/4", "", "<fractions>1/4</fractions>"), end(), /duplicate/],
    ["nested fraction", start().replace("1/4", "<x/>1/4"), end(), /nested/],
  ])("rejects %s", (_name, from, to, message) => {
    expectInvalid(staffList(chord(from as string) + chord(to as string)), message as RegExp);
  });

  it.each([
    ["wide dashed style", "<lineType>3</lineType>", /lineType/],
    ["negative style", "<lineType>-1</lineType>", /lineType/],
    ["unknown style", "<lineType>4</lineType>", /lineType/],
    ["word style", "<lineType>dotted</lineType>", /lineType/],
    ["invented style tag", "<style>1</style>", /property/],
    ["numeric direction", "<up>1</up>", /direction/],
    ["unknown direction", "<up>above</up>", /direction/],
    ["independent end direction", "<sideEnd>down</sideEnd>", /property/],
    ["partial incoming", "<partialSpannerDirection>incoming</partialSpannerDirection>", /partial Slur/],
    ["partial outgoing", "<partialSpannerDirection>outgoing</partialSpannerDirection>", /partial Slur/],
    ["partial both", "<partialSpannerDirection>both</partialSpannerDirection>", /partial Slur/],
    ["unknown partial", "<partialSpannerDirection>other</partialSpannerDirection>", /partial Slur/],
    ["unknown geometry", '<offset x="1" y="0"/>', /property/],
    ["segment geometry", '<SlurSegment no="0"><o1 x="1" y="0"/></SlurSegment>', /SlurSegment/],
    ["segment appearance", '<SlurSegment no="0"><visible>0</visible></SlurSegment>', /SlurSegment/],
    ["empty segment", '<SlurSegment no="0"/>', /SlurSegment/],
    ["duplicate direction", "<up>up</up><up>down</up>", /duplicate/],
    ["duplicate line type", "<lineType>1</lineType><lineType>2</lineType>", /duplicate/],
    ["duplicate ticks", "<ticks_f>1/4</ticks_f><ticks_f>1/4</ticks_f>", /duplicate/],
    ["nested direction", "<up><x/>up</up>", /nested/],
    ["attributed direction", '<up value="down">up</up>', /attributes/],
    ["nested line type", "<lineType><x/>1</lineType>", /nested/],
    ["nested ticks", "<ticks_f><x/>1/4</ticks_f>", /nested/],
  ])("rejects %s rather than discarding unrepresented properties", (_name, properties, message) => {
    expectInvalid(staffList(chord(start("1/4", properties as string)) + chord(end())), message as RegExp);
  });

  it("rejects unknown Slur body attributes", () => {
    expectInvalid(CANONICAL_SLUR.replace("<Slur/>", '<Slur visible="0"/>'), /attributes/);
  });

  it("rejects reciprocal self and backwards slurs", () => {
    expectInvalid(staffList(chord(start("0/1") + end("0/1"))), /strictly later/);
    expectInvalid(staffList(chord(end("1/4")) + chord(start("-1/4"))), /strictly later/);
  });

  it("rejects partial self-slurs explicitly, before interpreting zero duration", () => {
    expectInvalid(
      staffList(chord(start("0/1", "<partialSpannerDirection>outgoing</partialSpannerDirection>") + end("0/1"))),
      /partial Slur/,
    );
  });

  it.each(["acciaccatura", "appoggiatura", "grace8after"])("rejects a slur on a %s chord", (grace) => {
    expectInvalid(staffList(chord(start(), "eighth", `<${grace}/>`)), /grace/);
    expectInvalid(staffList(chord(start()) + chord(end(), "eighth", `<${grace}/>`)), /grace/);
  });

  it("rejects unresolved zero note deltas instead of selecting an unrelated event", () => {
    expectInvalid(staffList(chord(start("1/8")) + chord(end("-1/8"))), /reciprocal/);
  });

  it.each(["Tie", "HairPin", "Glissando", "Ottava"])("keeps %s unsupported at ChordRest level", (type) => {
    expectInvalid(
      staffList(chord(start().replaceAll("Slur", type)) + chord(end().replaceAll("Slur", type))),
      /Spanner type/,
    );
    expectInvalid(
      staffList(rest(start().replaceAll("Slur", type)) + rest(end().replaceAll("Slur", type))),
      /Spanner type/,
    );
  });

  it("keeps slurs unsupported at Note and staff-stream levels", () => {
    expectInvalid(staffList(chord().replace("<Note>", `<Note>${start()}`) + chord(end())), /Slur/);
    expectInvalid(staffList(start() + chord() + end() + chord()), /Slur/);
  });

  it.each(["Tie", "HairPin"])("retains strict shared-start and shared-end rejection for %s", (type) => {
    const wrap = (connector: string): string =>
      type === "Tie" ? chord().replace("<Note>", `<Note>${connector}`) : connector + chord();
    const source = (delta: string): string => start(delta).replaceAll("Slur", type);
    const target = (delta: string): string => end(delta).replaceAll("Slur", type);
    expectInvalid(
      staffList(wrap(source("1/4") + source("1/2")) + wrap(target("-1/4")) + wrap(target("-1/2")), "3/4"),
      /ambiguous duplicate/,
    );
    expectInvalid(
      staffList(wrap(source("1/2")) + wrap(source("1/4")) + wrap(target("-1/2") + target("-1/4")), "3/4"),
      /ambiguous duplicate/,
    );
  });
});
