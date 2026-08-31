import { describe, expect, it } from "vitest";
import { convertMusicXmlToMnx } from "../convert/convertMusicXmlToMnx";
import type { MnxTuplet } from "../types";

function score(measureBody: string): string {
  return `<?xml version="1.0"?>
  <score-partwise version="4.0">
    <part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list>
    <part id="P1"><measure number="1">${measureBody}</measure></part>
  </score-partwise>`;
}

function firstTuplet(measureBody: string): MnxTuplet {
  const mnx = convertMusicXmlToMnx(score(measureBody));
  const content = mnx.parts[0]!.measures[0]!.sequences![0]!.content;
  const tuplet = content.find((c) => "type" in c && c.type === "tuplet");
  return tuplet as MnxTuplet;
}

const ATTRS = `<attributes><divisions>6</divisions></attributes>`;

describe("convertMusicXmlToMnx — tuplets", () => {
  it("uses the metric unit (normal-type) for a uniform eighth triplet", () => {
    // 3 eighths in the time of 2: durations 2 each at divisions=6 (eighth=3,
    // triplet-eighth=2).
    const note = (pos: "start" | "" | "stop"): string =>
      `<note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>eighth</type>` +
      `<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>` +
      (pos ? `<notations><tuplet type="${pos}"/></notations>` : ``) +
      `</note>`;
    const t = firstTuplet(`${ATTRS}${note("start")}${note("")}${note("stop")}`);
    expect(t.inner).toEqual({ multiple: 3, duration: { base: "eighth" } });
    expect(t.outer).toEqual({ multiple: 2, duration: { base: "eighth" } });
  });

  it("keeps the metric unit for a MIXED quarter+eighth eighth-triplet", () => {
    // A quarter (2 triplet-eighths, duration 4) plus an eighth (duration 2) fill
    // the same triplet space. The inner base must stay `eighth`, NOT `quarter`.
    const quarter =
      `<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type>` +
      `<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes><normal-type>eighth</normal-type></time-modification>` +
      `<notations><tuplet type="start"/></notations></note>`;
    const eighth =
      `<note><pitch><step>D</step><octave>4</octave></pitch><duration>2</duration><type>eighth</type>` +
      `<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes><normal-type>eighth</normal-type></time-modification>` +
      `<notations><tuplet type="stop"/></notations></note>`;
    const t = firstTuplet(`${ATTRS}${quarter}${eighth}`);
    expect(t.inner).toEqual({ multiple: 3, duration: { base: "eighth" } });
    expect(t.outer).toEqual({ multiple: 2, duration: { base: "eighth" } });
    // The two written events are preserved in order.
    expect(t.content.map((e) => ("duration" in e ? (e.duration as { base: string }).base : "?"))).toEqual([
      "quarter",
      "eighth",
    ]);
  });

  it("keeps both chord notes on the final event of a tuplet", () => {
    // Each triplet event is a two-note chord. The principal note of the last
    // event carries `<tuplet type="stop">`, which finalizes the tuplet before
    // its `<chord/>` sibling arrives — that bottom note must still be folded
    // into the final event, not discarded.
    const event = (step: string, pos: "start" | "" | "stop"): string =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>2</duration><type>eighth</type>` +
      `<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>` +
      (pos ? `<notations><tuplet type="${pos}"/></notations>` : ``) +
      `</note>` +
      `<note><chord/><pitch><step>${step}</step><octave>5</octave></pitch><duration>2</duration><type>eighth</type>` +
      `<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>` +
      `</note>`;
    const t = firstTuplet(`${ATTRS}${event("C", "start")}${event("D", "")}${event("E", "stop")}`);
    expect(t.content).toHaveLength(3);
    for (const ev of t.content) {
      expect("notes" in ev && (ev.notes as unknown[]).length).toBe(2);
    }
  });
});
