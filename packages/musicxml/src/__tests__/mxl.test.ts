import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { convertMxlToMnx } from "../index";

const MUSIC_XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <direction><direction-type><dynamics><p/></dynamics></direction-type></direction>
      <direction><direction-type><wedge type="crescendo"/></direction-type></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
      <direction><direction-type><wedge type="stop"/></direction-type></direction>
      <direction><direction-type><dynamics><f/></dynamics></direction-type></direction>
    </measure>
  </part>
</score-partwise>`;

describe("convertMxlToMnx", () => {
  it("converts archived dynamics and wedges to standard dynamic groups", async () => {
    const zip = new JSZip();
    zip.file("META-INF/container.xml", "<container/>");
    zip.file("score.xml", MUSIC_XML);
    const archive = await zip.generateAsync({ type: "uint8array" });

    const score = await convertMxlToMnx(archive);
    const dynamics = score.parts[0]!.measures[0]!.dynamics!;

    expect(dynamics.some((group) => group.type === "immediate" && group.value === "p")).toBe(true);
    expect(dynamics.some((group) => group.type === "immediate" && group.value === "f")).toBe(true);
    expect(dynamics).toContainEqual(
      expect.objectContaining({
        type: "gradual",
        wedgeType: "increasing",
        end: expect.any(Object),
      }),
    );
    expect(dynamics.every((group) => typeof group.id === "string")).toBe(true);
  });
});
