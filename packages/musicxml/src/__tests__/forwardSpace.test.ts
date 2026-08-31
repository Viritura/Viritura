import { describe, expect, it } from "vitest";
import { convertMusicXmlToMnx } from "../convert/convertMusicXmlToMnx";
import type { MnxSpace, MnxTuplet } from "../types";

function score(measureBody: string): string {
  return `<?xml version="1.0"?>
  <score-partwise version="4.0">
    <part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list>
    <part id="P1"><measure number="1">${measureBody}</measure></part>
  </score-partwise>`;
}

function content(measureBody: string): unknown[] {
  const mnx = convertMusicXmlToMnx(score(measureBody));
  return mnx.parts[0]!.measures[0]!.sequences![0]!.content;
}

function isSpace(c: unknown): c is MnxSpace {
  return typeof c === "object" && c !== null && "type" in c && (c as { type: string }).type === "space";
}

describe("convertMusicXmlToMnx — forward / backup repositioning", () => {
  it("does NOT emit a space when backup+forward only reposition a <direction>", () => {
    // A half note (divisions=4 → duration 8 = 1/2 whole note) followed by the
    // backup+direction+forward idiom MusicXML uses to attach a dynamic at the
    // note's offset. The forward moves the cursor back over already-written
    // content, so no space should be produced — the measure must be exactly
    // the half note, not a half note + a spurious half-rest space.
    const half = `<note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration><type>half</type></note>`;
    const reposition =
      `<backup><duration>8</duration></backup>` +
      `<direction placement="below"><direction-type><dynamics><p/></dynamics></direction-type></direction>` +
      `<forward><duration>8</duration></forward>`;
    const c = content(`<attributes><divisions>4</divisions></attributes>${half}${reposition}`);
    expect(c.filter(isSpace)).toHaveLength(0);
    expect(c).toHaveLength(1);
  });

  it("still emits a space for a forward into genuinely empty territory", () => {
    // A half note, then a real forward (no prior content there) of a quarter:
    // this is a true rhythmic skip and must become a quarter-rest space.
    const half = `<note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration><type>half</type></note>`;
    const skip = `<forward><duration>4</duration></forward>`;
    const c = content(`<attributes><divisions>4</divisions></attributes>${half}${skip}`);
    const spaces = c.filter(isSpace);
    expect(spaces).toHaveLength(1);
    expect(spaces[0]!.duration).toEqual([1, 4]);
  });

  it("keeps a tuplet intact when backup+forward reposition a direction mid-tuplet", () => {
    // Mirrors the Rhapsody clarinet bar: a dotted-half, then a 17:8 run with a
    // dynamic + crescendo attached mid-tuplet via backup/forward. The bar must
    // total one whole note with NO stray spaces inside or outside the tuplet.
    const divisions = 68;
    const dottedHalf =
      `<note><pitch><step>G</step><octave>3</octave></pitch><duration>${3 * divisions}</duration>` +
      `<type>half</type><dot/></note>`;
    const repositionDynamic =
      `<backup><duration>${3 * divisions}</duration></backup>` +
      `<direction placement="below"><direction-type><dynamics><p/></dynamics></direction-type></direction>` +
      `<forward><duration>${3 * divisions}</duration></forward>`;
    // 17 thirty-second notes in the time of 8 (duration 4 each at divisions=68).
    const tnote = (i: number, pos: "start" | "" | "stop"): string =>
      `<note><pitch><step>A</step><octave>${3 + Math.floor(i / 7)}</octave></pitch><duration>4</duration>` +
      `<type>32nd</type>` +
      `<time-modification><actual-notes>17</actual-notes><normal-notes>8</normal-notes><normal-type>32nd</normal-type></time-modification>` +
      (pos ? `<notations><tuplet type="${pos}"/></notations>` : ``) +
      `</note>`;
    // Mid-tuplet direction reposition after the first tuplet note.
    const midTupletDir =
      `<backup><duration>4</duration></backup>` +
      `<direction><direction-type><wedge type="crescendo"/></direction-type></direction>` +
      `<forward><duration>4</duration></forward>`;
    let run = tnote(0, "start") + midTupletDir;
    for (let i = 1; i < 16; i++) run += tnote(i, "");
    run += tnote(16, "stop");
    const c = content(
      `<attributes><divisions>${divisions}</divisions></attributes>${dottedHalf}${repositionDynamic}${run}`,
    );
    // No spaces anywhere at the top level.
    expect(c.filter(isSpace)).toHaveLength(0);
    // Top level = [dotted-half, tuplet].
    expect(c).toHaveLength(2);
    const tuplet = c.find(
      (x) => typeof x === "object" && x !== null && "type" in x && (x as { type: string }).type === "tuplet",
    ) as MnxTuplet | undefined;
    expect(tuplet).toBeDefined();
    // The tuplet holds all 17 notes and no spaces.
    expect(tuplet!.content).toHaveLength(17);
    expect(tuplet!.content.filter(isSpace)).toHaveLength(0);
  });

  it("prepends a leading space when a voice enters mid-measure via backup", () => {
    // Mirrors the Rhapsody left-hand bar: voice 1 fills the whole bar, then a
    // <backup> of a half note rewinds the cursor to beat 3, where voice 2's
    // first note is written directly — no <forward>, no leading rest. Without a
    // leading space the second voice would start at the bar's beginning. It
    // must instead open with a half-rest space so it enters on beat 3.
    const voice1 =
      `<note><pitch><step>C</step><octave>5</octave></pitch><duration>16</duration>` +
      `<type>whole</type><voice>1</voice></note>`;
    const voice2 =
      `<backup><duration>8</duration></backup>` +
      `<note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration>` +
      `<type>quarter</type><voice>2</voice></note>` +
      `<note><pitch><step>F</step><octave>4</octave></pitch><duration>4</duration>` +
      `<type>quarter</type><voice>2</voice></note>`;
    const mnx = convertMusicXmlToMnx(score(`<attributes><divisions>4</divisions></attributes>${voice1}${voice2}`));
    const sequences = mnx.parts[0]!.measures[0]!.sequences!;
    expect(sequences).toHaveLength(2);
    const second = sequences[1]!.content;
    // Leading half-rest space, then the two quarter notes.
    expect(isSpace(second[0])).toBe(true);
    expect((second[0] as MnxSpace).duration).toEqual([1, 2]);
    expect(second).toHaveLength(3);
    expect(second.filter(isSpace)).toHaveLength(1);
  });
});
