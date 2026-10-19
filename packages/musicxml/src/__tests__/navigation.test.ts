import { describe, expect, it } from "vitest";
import { convertMusicXmlToMnx } from "../convert";
import { convertMxlToMnx } from "../index";
import JSZip from "jszip";

function xml(content: string) {
  return `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Test</part-name></score-part></part-list>
    <part id="P1"><measure number="1"><attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
    <note><rest/><duration>4</duration><type>quarter</type></note>${content}</measure></part></score-partwise>`;
}

describe("native MusicXML navigation", () => {
  it.each([
    ['dacapo="yes"', "", "dc"],
    ['dacapo="yes"', "D.C. al Fine", "dcAlFine"],
    ['dacapo="yes"', "D.C. al Coda", "dcAlCoda"],
    ['dalsegno="sign"', "", "segno"],
    ['dalsegno="sign"', "D.S. al Fine", "dsAlFine"],
    ['dalsegno="sign"', "D.S. al Coda", "dsAlCoda"],
    ['tocoda="tail"', "", "toCoda"],
  ])("maps %s %s to %s", (attributes, words, type) => {
    const result = convertMusicXmlToMnx(
      xml(`<direction><direction-type><words>${words}</words></direction-type><sound ${attributes}/></direction>`),
    );
    expect(result.global.measures[0]!.jump).toEqual({ type, location: { fraction: [1, 4] } });
  });

  it("imports native coda without extensions, with glyph, color, and direction offset", () => {
    const result = convertMusicXmlToMnx(
      xml(
        `<direction><direction-type><coda smufl="codaSquare" color="#FF0000"/></direction-type><offset>4</offset><sound coda="tail"/></direction>`,
      ),
    );
    expect(result.global.measures[0]!.coda).toEqual({
      location: { fraction: [1, 2] },
      glyph: "codaSquare",
      color: "#ff0000",
    });
    expect(result.global.measures[0]!._x?.viritura ?? {}).not.toHaveProperty("coda");
  });

  it("handles bare sound destinations and numeric Fine intent", () => {
    const result = convertMusicXmlToMnx(xml('<sound segno="sign" coda="tail" fine="1"/>'));
    const measure = result.global.measures[0]!;
    expect(measure.segno?.location.fraction).toEqual([1, 4]);
    expect(measure.coda?.location.fraction).toEqual([1, 4]);
    expect(measure.fine?.location.fraction).toEqual([1, 4]);
  });

  it("does not infer a To Coda jump from authored words", () => {
    const result = convertMusicXmlToMnx(
      xml("<direction><direction-type><words>To Coda</words></direction-type></direction>"),
    );
    expect(result.global.measures[0]!.jump).toBeUndefined();
  });

  it("distinguishes the To Coda instruction sign from a coda destination", () => {
    const result = convertMusicXmlToMnx(
      xml('<direction><direction-type><coda/></direction-type><sound tocoda="tail"/></direction>'),
    );
    expect(result.global.measures[0]!.jump).toEqual({ type: "toCoda", location: { fraction: [1, 4] } });
    expect(result.global.measures[0]!.coda).toBeUndefined();
  });

  it.each([true, false])("combines a separate bare sound with direction qualifiers (sound first: %s)", (first) => {
    const sound = '<sound dacapo="yes"/>';
    const words = "<direction><direction-type><words>D.C. al Fine</words></direction-type></direction>";
    const result = convertMusicXmlToMnx(xml(first ? sound + words : words + sound));
    expect(result.global.measures[0]!.jump?.type).toBe("dcAlFine");
  });

  it("imports a standalone Fine direction and retains native navigation through MXL", async () => {
    const archive = new JSZip();
    archive.file(
      "score.xml",
      xml("<direction><direction-type><words>Fine</words><coda/></direction-type></direction>"),
    );
    const result = await convertMxlToMnx(await archive.generateAsync({ type: "uint8array" }));
    expect(result.global.measures[0]!.fine?.location.fraction).toEqual([1, 4]);
    expect(result.global.measures[0]!.coda?.location.fraction).toEqual([1, 4]);
  });
});
