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
