import { describe, expect, it } from "vitest";
import { convertMusicXmlToMnx } from "../convert/convertMusicXmlToMnx";
import type { MnxMultiNoteTremolo } from "../types";

function score(measureBody: string): string {
  return `<?xml version="1.0"?>
  <score-partwise version="4.0">
    <part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list>
    <part id="P1"><measure number="1">${measureBody}</measure></part>
  </score-partwise>`;
}

function firstSequenceContent(measureBody: string) {
  const mnx = convertMusicXmlToMnx(score(measureBody));
  return mnx.parts[0]!.measures[0]!.sequences![0]!.content;
}

function firstTremolo(measureBody: string): MnxMultiNoteTremolo {
  const content = firstSequenceContent(measureBody);
  return content.find((c) => "type" in c && c.type === "tremolo") as MnxMultiNoteTremolo;
}

// divisions=4 → quarter=4, eighth=2, 16th=1.
const ATTRS = `<attributes><divisions>4</divisions></attributes>`;

describe("convertMusicXmlToMnx — multi-note tremolos", () => {
  it("wraps a two-note tremolo into one MNX tremolo container occupying the written value", () => {
    // Two eighth notes, each with <duration>1</duration> (a 16th of metric) and
    // time-modification 2:1 — a two-note tremolo that together occupies one
    // eighth note's worth of metric time.
    const note = (pos: "start" | "stop", step: string): string =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration><type>eighth</type>` +
      `<time-modification><actual-notes>2</actual-notes><normal-notes>1</normal-notes></time-modification>` +
      `<beam number="1">${pos === "start" ? "begin" : "end"}</beam>` +
      `<notations><ornaments><tremolo type="${pos}">2</tremolo></ornaments></notations></note>`;

    const trem = firstTremolo(`${ATTRS}${note("start", "C")}${note("stop", "G")}`);
    expect(trem).toBeDefined();
    expect(trem.type).toBe("tremolo");
    expect(trem.marks).toBe(2);
    // Total metric footprint = one eighth (16th × 2).
    expect(trem.outer).toEqual({ duration: { base: "16th" }, multiple: 2 });
    // Both written events are preserved at their notated (eighth) value.
    expect(trem.content).toHaveLength(2);
    expect(trem.content.map((e) => e.duration.base)).toEqual(["eighth", "eighth"]);
  });

  it("does not emit a regular beam group for the tremolo's two notes", () => {
    const note = (pos: "start" | "stop", step: string): string =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration><type>eighth</type>` +
      `<time-modification><actual-notes>2</actual-notes><normal-notes>1</normal-notes></time-modification>` +
      `<beam number="1">${pos === "start" ? "begin" : "end"}</beam>` +
      `<notations><ornaments><tremolo type="${pos}">3</tremolo></ornaments></notations></note>`;

    const mnx = convertMusicXmlToMnx(score(`${ATTRS}${note("start", "C")}${note("stop", "G")}`));
    const beams = mnx.parts[0]!.measures[0]!.beams ?? [];
    expect(beams).toHaveLength(0);
  });

  it("keeps a single-note tremolo as an event marking, not a container", () => {
    const note =
      `<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type>` +
      `<notations><ornaments><tremolo type="single">3</tremolo></ornaments></notations></note>`;
    const content = firstSequenceContent(`${ATTRS}${note}`);
    expect(content.some((c) => "type" in c && c.type === "tremolo")).toBe(false);
    const ev = content[0] as { markings?: { tremolo?: { marks: number } } };
    expect(ev.markings?.tremolo).toEqual({ marks: 3 });
  });
});
