import { describe, expect, it } from "vitest";
import { convertMusicXmlToMnx } from "../convert/convertMusicXmlToMnx";

function pianoScore(measureBody: string): string {
  return `<?xml version="1.0"?>
  <score-partwise version="4.0">
    <part-list>
      <score-part id="P1"><part-name>Piano</part-name></score-part>
    </part-list>
    <part id="P1">
      <measure number="1">${measureBody}</measure>
    </part>
  </score-partwise>`;
}

const QUARTER = `<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>`;

describe("convertMusicXmlToMnx — clefs", () => {
  it("emits a measure-initial clef without a position", () => {
    const mnx = convertMusicXmlToMnx(
      pianoScore(
        `<attributes><divisions>1</divisions><clef><sign>G</sign><line>2</line></clef></attributes>${QUARTER.repeat(4)}`,
      ),
    );
    const clefs = mnx.parts[0]!.measures[0]!.clefs!;
    expect(clefs).toHaveLength(1);
    expect(clefs[0]!.clef.sign).toBe("G");
    expect(clefs[0]!.position).toBeUndefined();
  });

  it("captures a mid-measure clef change with its rhythmic position", () => {
    // Two quarters under G clef, then a clef change to F4 (bass), then two more.
    const mnx = convertMusicXmlToMnx(
      pianoScore(
        `<attributes><divisions>1</divisions><clef><sign>G</sign><line>2</line></clef></attributes>` +
          QUARTER.repeat(2) +
          `<attributes><clef><sign>F</sign><line>4</line></clef></attributes>` +
          QUARTER.repeat(2),
      ),
    );
    const clefs = mnx.parts[0]!.measures[0]!.clefs!;
    expect(clefs).toHaveLength(2);
    expect(clefs[0]!.clef.sign).toBe("G");
    expect(clefs[0]!.position).toBeUndefined();
    expect(clefs[1]!.clef.sign).toBe("F");
    // Two quarter notes = 1/2 of a whole note from the measure start.
    expect(clefs[1]!.position?.fraction).toEqual([1, 2]);
  });

  it("keeps per-staff clef numbers for grand-staff clef changes", () => {
    const mnx = convertMusicXmlToMnx(
      pianoScore(
        `<attributes><divisions>1</divisions><staves>2</staves>` +
          `<clef number="1"><sign>G</sign><line>2</line></clef>` +
          `<clef number="2"><sign>F</sign><line>4</line></clef></attributes>` +
          QUARTER.repeat(4),
      ),
    );
    const clefs = mnx.parts[0]!.measures[0]!.clefs!;
    expect(clefs).toHaveLength(2);
    expect(clefs[0]!.staff).toBe(1);
    expect(clefs[1]!.staff).toBe(2);
  });
});
