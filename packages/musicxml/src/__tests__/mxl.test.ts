import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { convertMxlToMnx, DiagnosticCollector } from "../index";

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
  it("follows a nested .musicxml root instead of choosing an incidental XML file", async () => {
    const zip = new JSZip();
    zip.file("other.xml", "<not-a-score/>");
    zip.file("scores/main.musicxml", MUSIC_XML);
    zip.file(
      "META-INF/container.xml",
      '<container><rootfiles><rootfile full-path="scores/main.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>',
    );
    expect((await convertMxlToMnx(await zip.generateAsync({ type: "uint8array" }))).parts[0]!.name).toBe("Piano");
  });

  it("diagnoses legacy archives and rejects ambiguous or missing root files", async () => {
    const zip = new JSZip();
    zip.file("score.xml", MUSIC_XML);
    const diagnostics = new DiagnosticCollector();
    await convertMxlToMnx(await zip.generateAsync({ type: "uint8array" }), { diagnostics });
    expect(diagnostics.all()).toContainEqual(expect.objectContaining({ code: "mxl-legacy-container" }));
    zip.file("another.musicxml", MUSIC_XML);
    await expect(convertMxlToMnx(await zip.generateAsync({ type: "uint8array" }))).rejects.toThrow(/multiple/);
    zip.file(
      "META-INF/container.xml",
      '<container><rootfiles><rootfile full-path="missing.musicxml"/></rootfiles></container>',
    );
    await expect(convertMxlToMnx(await zip.generateAsync({ type: "uint8array" }))).rejects.toThrow(/missing/);
  });

  it.each([true, false])("imports clarinet pitches from an archive with concert pitch %s", async (concertPitch) => {
    const transpose = "<diatonic>-1</diatonic><chromatic>-2</chromatic>";
    const xml = `<score-partwise version="4.0">
        <defaults>${concertPitch ? "<concert-score/>" : ""}</defaults>
        <part-list><score-part id="P1"><part-name>Clarinet in Bb</part-name></score-part></part-list>
        <part id="P1"><measure number="1">
          <attributes>
            <divisions>1</divisions>
            <time><beats>4</beats><beat-type>4</beat-type></time>
            ${
              concertPitch
                ? `<for-part><part-transpose>${transpose}</part-transpose></for-part>`
                : `<transpose>${transpose}</transpose>`
            }
          </attributes>
          <note><pitch><step>${concertPitch ? "C" : "D"}</step><octave>4</octave></pitch>
            <duration>4</duration><type>whole</type></note>
        </measure></part>
      </score-partwise>`;
    const zip = new JSZip();
    zip.file("META-INF/container.xml", "<container/>");
    zip.file("score.xml", xml);
    const archive = await zip.generateAsync({ type: "uint8array" });

    const score = await convertMxlToMnx(archive);
    const part = score.parts[0]!;

    expect(part.transposition).toEqual({ interval: { halfSteps: 2, staffDistance: 1 } });
    expect(part.measures[0]!.sequences![0]!.content[0]).toMatchObject({
      notes: [{ pitch: { step: "C", octave: 4 } }],
    });
  });

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
