import { describe, expect, it } from "vitest";
import { convertMusicXmlToMnx, DiagnosticCollector } from "../index";

function score(content: string, secondPart = ""): string {
  return `<score-partwise version="4.0"><part-list>
    <score-part id="P1"><part-name>Test</part-name></score-part>
    ${secondPart ? '<score-part id="P2"><part-name>Second</part-name></score-part>' : ""}
    </part-list><part id="P1"><measure number="1"><attributes><divisions>4</divisions>
    <time><beats>4</beats><beat-type>4</beat-type></time></attributes>${content}
    <note><rest/><duration>16</duration><type>whole</type></note></measure></part>
    ${secondPart ? `<part id="P2"><measure number="1">${secondPart}<note><rest/><duration>16</duration><type>whole</type></note></measure></part>` : ""}
    </score-partwise>`;
}

function sound(swing: string, tempo = ""): string {
  return `<sound${tempo ? ` tempo="${tempo}"` : ""}><swing>${swing}</swing></sound>`;
}

const ratio = "<first>3</first><second>2</second>";

describe("explicit MusicXML swing", () => {
  it.each(["", "<swing-type>eighth</swing-type>", "<swing-type>16th</swing-type>"])(
    "imports ratios with default or explicit subdivision %s",
    (type) => {
      const result = convertMusicXmlToMnx(score(sound(ratio + type, "90")), { includeVendorExtensions: true });
      expect(result.global.measures[0].tempos?.[0]._x?.viritura.swing).toEqual({
        mode: "swing",
        subdivision: type.includes("16th") ? "16th" : "eighth",
        ratio: [3, 2],
      });
      expect(result.global.measures[0].tempos?.[0].bpm).toBe(90);
    },
  );

  it("imports a swing-only anchor without a BPM and retains ordered resets", () => {
    const result = convertMusicXmlToMnx(
      score(`<sound tempo="90"/><forward><duration>4</duration></forward>${sound(ratio)}${sound("<straight/>")}`),
      { includeVendorExtensions: true },
    );
    const tempos = result.global.measures[0]._x?.viritura.tempos;
    expect(result.global.measures[0].tempos).toBeUndefined();
    expect(tempos?.map((tempo) => tempo.bpm)).toEqual([90, undefined, undefined]);
    expect(tempos?.[1].location?.fraction).toEqual([1, 4]);
    expect(tempos?.[2].swing).toEqual({ mode: "straight" });
  });

  it("keeps metronome beat unit independent and gives it precedence over sound tempo", () => {
    const result = convertMusicXmlToMnx(
      score(`<direction><direction-type><metronome>
      <beat-unit>half</beat-unit><beat-unit-dot/><per-minute>90</per-minute>
      </metronome></direction-type>${sound(ratio + "<swing-type>16th</swing-type>", "135")}</direction>`),
      { includeVendorExtensions: true },
    );
    expect(result.global.measures[0].tempos).toHaveLength(1);
    expect(result.global.measures[0].tempos?.[0].value).toEqual({ base: "half", dots: 1 });
    expect(result.global.measures[0].tempos?.[0].bpm).toBe(90);
  });

  it.each([
    { offset: '<offset sound="yes">4</offset>', position: [1, 4] },
    { offset: '<offset sound="no">4</offset>', position: [0, 1] },
    { offset: "<offset>4</offset>", position: [0, 1] },
  ])("honors direction offset playback semantics %j", ({ offset, position }) => {
    const result = convertMusicXmlToMnx(
      score(`<direction><direction-type><words>Groove</words></direction-type>${offset}${sound(ratio)}</direction>`),
      { includeVendorExtensions: true },
    );
    expect(result.global.measures[0]._x?.viritura.tempos?.[0].location?.fraction).toEqual(position);
  });

  it("uses a sound offset and preserves placement through backup and forward", () => {
    const result = convertMusicXmlToMnx(
      score(`<forward><duration>8</duration></forward>
      <backup><duration>4</duration></backup><direction><direction-type><words>Groove</words></direction-type>
      <offset sound="yes">8</offset><sound><offset>4</offset><swing>${ratio}</swing></sound></direction>`),
      { includeVendorExtensions: true },
    );
    expect(result.global.measures[0]._x?.viritura.tempos?.[0].location?.fraction).toEqual([1, 2]);
  });

  it("preserves distinct same-position instructions in source order", () => {
    const result = convertMusicXmlToMnx(score(`${sound("<straight/>")}${sound(ratio, "90")}`), {
      includeVendorExtensions: true,
    });
    expect(result.global.measures[0]._x?.viritura.tempos?.map((tempo) => tempo.swing?.mode)).toEqual([
      "straight",
      "swing",
    ]);
  });

  it("does not invent a ratio from printed prose", () => {
    const diagnostics = new DiagnosticCollector();
    const result = convertMusicXmlToMnx(
      score('<sound tempo="90"/><direction><direction-type><words>Swung 16ths</words></direction-type></direction>'),
      { includeVendorExtensions: true, diagnostics },
    );
    expect(result.global.measures[0].tempos?.[0]._x?.viritura.swing).toBeUndefined();
    expect(diagnostics.all().some((diagnostic) => diagnostic.code === "musicxml-swing-text-only")).toBe(true);
  });

  it("reports extension-disabled loss without enabling swing", () => {
    const diagnostics = new DiagnosticCollector();
    const result = convertMusicXmlToMnx(score(sound(ratio, "90")), { diagnostics });
    expect(result.global.measures[0].tempos?.[0]._x).toBeUndefined();
    expect(diagnostics.all().some((diagnostic) => diagnostic.code === "musicxml-swing")).toBe(true);
  });

  it("diagnoses unsupported scopes rather than making a staff instruction global", () => {
    const diagnostics = new DiagnosticCollector();
    const result = convertMusicXmlToMnx(
      score(
        `<direction><direction-type><words>Staff groove</words></direction-type><staff>2</staff>${sound(ratio)}</direction>`,
        sound(ratio),
      ),
      { includeVendorExtensions: true, diagnostics },
    );
    expect(result.global.measures[0]._x?.viritura.tempos).toBeUndefined();
    expect(diagnostics.all().filter((diagnostic) => diagnostic.code === "musicxml-swing-scope")).toHaveLength(2);
    expect(() => convertMusicXmlToMnx(score("", sound(ratio)), { includeVendorExtensions: true })).toThrow(/scope/);
  });

  it.each([
    "",
    "<first>0</first><second>1</second>",
    "<first>1.5</first><second>1</second>",
    "<first>2</first>",
    "<straight/><first>2</first><second>1</second>",
    ratio + "<swing-type>quarter</swing-type>",
    "<first>9007199254740992</first><second>1</second>",
    "<straight/><straight/>",
    "<first>2</first><first>3</first><second>1</second>",
  ])("rejects malformed instructions explicitly %s", (content) => {
    expect(() => convertMusicXmlToMnx(score(sound(content)), { includeVendorExtensions: true })).toThrow(
      /swing|straight/i,
    );
  });
});
