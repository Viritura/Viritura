import { describe, expect, it } from "vitest";
import { convertMusicXmlToMnx } from "../convert/convertMusicXmlToMnx";
import type { MnxEvent } from "../types";

function score(measureBody: string): string {
  return `<?xml version="1.0"?>
  <score-partwise version="4.0">
    <part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list>
    <part id="P1"><measure number="1">${measureBody}</measure></part>
  </score-partwise>`;
}

const ATTRS = `<attributes><divisions>4</divisions></attributes>`;

const NOTE_STEM_DOWN =
  `<note><pitch><step>C</step><octave>5</octave></pitch>` +
  `<duration>4</duration><type>quarter</type><stem>down</stem></note>`;

function firstEvent(measureBody: string, opts?: { discardStemDirections?: boolean }): MnxEvent {
  const mnx = convertMusicXmlToMnx(score(measureBody), opts);
  const content = mnx.parts[0]!.measures[0]!.sequences![0]!.content;
  // Events are the only sequence content without a `type` discriminator.
  return content.find((c) => c.type === undefined) as MnxEvent;
}

describe("convertMusicXmlToMnx — stem direction option", () => {
  it("preserves explicit <stem> by default", () => {
    const ev = firstEvent(`${ATTRS}${NOTE_STEM_DOWN}`);
    expect(ev.stemDirection).toBe("down");
  });

  it("preserves explicit <stem> when discardStemDirections is false", () => {
    const ev = firstEvent(`${ATTRS}${NOTE_STEM_DOWN}`, { discardStemDirections: false });
    expect(ev.stemDirection).toBe("down");
  });

  it("drops explicit <stem> when discardStemDirections is true", () => {
    const ev = firstEvent(`${ATTRS}${NOTE_STEM_DOWN}`, { discardStemDirections: true });
    expect(ev.stemDirection).toBeUndefined();
  });
});

function note(step: string, octave: number, voice: number, staff?: number): string {
  return (
    `<note><pitch><step>${step}</step><octave>${String(octave)}</octave></pitch>` +
    `<duration>16</duration><type>whole</type><voice>${String(voice)}</voice>` +
    (staff === undefined ? "" : `<staff>${String(staff)}</staff>`) +
    `</note>`
  );
}

const BACKUP = `<backup><duration>16</duration></backup>`;

function sequences(measureBody: string) {
  return convertMusicXmlToMnx(score(measureBody)).parts[0]!.measures[0]!.sequences!;
}

describe("convertMusicXmlToMnx — direction hint", () => {
  it("hints the first two voices of a staff as upper and lower", () => {
    const seqs = sequences(`${ATTRS}${note("A", 5, 1)}${BACKUP}${note("C", 4, 2)}`);
    expect(seqs.map((s) => s.directionHint)).toEqual(["upper", "lower"]);
  });

  it("leaves a single voice unhinted", () => {
    const seqs = sequences(`${ATTRS}${note("A", 5, 1)}`);
    expect(seqs[0]!.directionHint).toBeUndefined();
  });

  it("leaves a third voice unhinted because the convention only covers two", () => {
    const seqs = sequences(`${ATTRS}${note("A", 5, 1)}${BACKUP}${note("E", 4, 2)}${BACKUP}${note("C", 4, 3)}`);
    expect(seqs.map((s) => s.directionHint)).toEqual(["upper", "lower", undefined]);
  });

  it("ranks voices within each staff, not across the whole part", () => {
    // A grand staff numbers its lower-staff voices 5 and 6, so a global
    // "voice 1 is upper" rule would leave the bass staff unhinted.
    const attrs = `<attributes><divisions>4</divisions><staves>2</staves></attributes>`;
    const seqs = sequences(
      `${attrs}${note("A", 5, 1, 1)}${BACKUP}${note("E", 5, 2, 1)}` +
        `${BACKUP}${note("C", 4, 5, 2)}${BACKUP}${note("C", 3, 6, 2)}`,
    );
    expect(seqs.map((s) => [s.staff, s.directionHint])).toEqual([
      [1, "upper"],
      [1, "lower"],
      [2, "upper"],
      [2, "lower"],
    ]);
  });
});
