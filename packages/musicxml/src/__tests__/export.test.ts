import { readdirSync, readFileSync } from "node:fs";
import { DOMParser } from "@xmldom/xmldom";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { DiagnosticCollector, type NoteEvent, type Score } from "@viritura/core";
import { parseMnx } from "@viritura/format";
import { convertMusicXmlToMnx, convertMxlToMnx, convertScoreToMusicXml, convertScoreToMxl, MXL_MIME } from "../index";

const whole = (id: string, step = "C", octave = 4): NoteEvent => ({
  type: "event",
  id,
  duration: { base: "whole" },
  notes: [{ id: `${id}-note`, pitch: { step, octave } }],
});
function score(): Score {
  return {
    mnx: { version: 1 },
    metadata: { title: "A & B <Finale>", composer: "Composer" },
    global: { measures: [{ id: "m1", time: { count: 4, unit: 4 }, key: { fifths: 0 } }] },
    parts: [
      {
        id: "clarinet",
        name: "Clarinet",
        transposition: { interval: { staffDistance: 1, halfSteps: 2 } },
        measures: [{ sequences: [{ content: [whole("c1")] }] }],
      },
      { id: "cello", name: "Cello", measures: [{ sequences: [{ content: [whole("b1", "C", 3)] }] }] },
    ],
    layouts: [
      {
        id: "full",
        content: [
          { type: "staff", sources: [{ part: "clarinet" }] },
          { type: "staff", sources: [{ part: "cello" }] },
        ],
      },
      { id: "part", content: [{ type: "staff", sources: [{ part: "clarinet" }] }] },
    ],
    scores: [
      { name: "Full Score", layout: "full", useWritten: false },
      { name: "Clarinet", layout: "part", useWritten: true },
    ],
  };
}
const document = (xml: string) =>
  new DOMParser({
    onError: (_level, message) => {
      throw new Error(message);
    },
  }).parseFromString(xml, "application/xml");
const texts = (xml: string, tag: string) =>
  Array.from(document(xml).getElementsByTagName(tag)).map((element) => element.textContent);

describe("MusicXML export", () => {
  it("round-trips shared fermata identity, exact anchor and settings across overlapping rhythms and part exports", () => {
    const source = score();
    source.global.measures[0]!.fermatas = [
      { id: "shared-hold", position: { fraction: [3, 4] }, multiplier: 2.75, clickBehavior: "keepClicking" },
    ];
    source.parts[1]!.measures[0]!.sequences[0]!.content = [
      { ...whole("start"), duration: { base: "half", dots: 1 } },
      { ...whole("end"), duration: { base: "quarter" } },
    ];
    for (const scoreIndex of [0, 1]) {
      const xml = convertScoreToMusicXml(source, { scoreIndex }).xml;
      expect(texts(xml, "fermata")).toHaveLength(scoreIndex === 0 ? 2 : 1);
      const imported = parseMnx(convertMusicXmlToMnx(xml, { includeVendorExtensions: true }));
      expect(imported.global.measures[0]!.fermatas).toEqual(source.global.measures[0]!.fermatas);
      expect(imported.parts[0]!.measures[0]!.sequences[0]!.content[0]).not.toHaveProperty("fermata");
    }
  });

  it.each<[string, string, string[][]]>([
    ["C7b9", "dominant", [["9", "-1", "add"]]],
    ["C7#5", "dominant", [["5", "1", "alter"]]],
    ["Caug(b5)", "augmented", [["5", "-2", "alter"]]],
    ["Cdim(#5)", "diminished", [["5", "2", "alter"]]],
    ["C7sus4", "suspended-fourth", [["7", "0", "add"]]],
    ["Csus4add9", "suspended-fourth", [["9", "0", "add"]]],
    ["Cø6", "diminished", [["6", "0", "add"]]],
  ])("preserves %s using MusicXML kind-relative alterations", (rawText, kind, expected) => {
    const source = score();
    source.global.measures[0]!.chordSymbols = [{ position: { fraction: [0, 1] }, rawText }];
    const xml = convertScoreToMusicXml(source, { scoreIndex: 0 }).xml;
    const harmony = document(xml).getElementsByTagName("harmony")[0]!;
    expect(harmony.getElementsByTagName("kind")[0]!.textContent).toBe(kind);
    expect(
      Array.from(harmony.getElementsByTagName("degree")).map((degree) =>
        ["degree-value", "degree-alter", "degree-type"].map((tag) => degree.getElementsByTagName(tag)[0]!.textContent),
      ),
    ).toEqual(expected);
  });

  it.each([
    { name: "treble", clef: { sign: "G", staffPosition: -2 }, line: "2" },
    { name: "bass", clef: { sign: "F", staffPosition: 2 }, line: "4" },
    { name: "alto", clef: { sign: "C", staffPosition: 0 }, line: "3" },
    { name: "tenor", clef: { sign: "C", staffPosition: 2 }, line: "4" },
  ] as const)("numbers the $name clef's line from 1 at the bottom of the staff", ({ clef, line }) => {
    const source = score();
    source.parts[0]!.measures[0]!.clefs = [{ clef }];
    const xml = convertScoreToMusicXml(source).xml;
    expect(texts(xml, "line")).toEqual([line]);
    const imported = parseMnx(convertMusicXmlToMnx(xml));
    expect(imported.parts[0]!.measures[0]!.clefs![0]!.clef).toEqual(clef);
  });

  it("numbers clef lines by how many lines the staff has at that point", () => {
    const source = score();
    source.global.measures.push({ id: "m2" });
    source.parts[1]!.measures.push({ sequences: [{ content: [whole("b2")] }] });
    const clef = { sign: "C", staffPosition: 0 } as const;
    source.parts[0]!.measures = [
      {
        clefs: [{ clef }, { clef, position: { fraction: [1, 2] } }],
        staffConfigs: [{ position: { fraction: [1, 2] }, config: { lines: 3 } }],
        sequences: [{ content: [whole("c1")] }],
      },
      { clefs: [{ clef }], sequences: [{ content: [whole("c2")] }] },
    ];
    expect(texts(convertScoreToMusicXml(source).xml, "line")).toEqual(["3", "2", "2"]);
  });

  it("exports the selected instruments without mutating the document and escapes metadata", () => {
    const source = score();
    const before = structuredClone(source);
    const result = convertScoreToMusicXml(source, { scoreIndex: 1 });
    expect(texts(result.xml, "part-name")).toEqual(["Clarinet"]);
    expect(texts(result.xml, "work-title")).toEqual(["A & B <Finale>"]);
    expect(texts(result.xml, "step")).toEqual(["D"]);
    expect(texts(result.xml, "chromatic")).toEqual(["-2"]);
    expect(texts(result.xml, "fifths")).toEqual(["2"]);
    expect(source).toEqual(before);
    expect(() => convertScoreToMusicXml(source, { scoreIndex: -1 })).toThrow(/selected score/);
  });

  it("retains authored enharmonic key flips and concert spelling across key changes", () => {
    const source = score();
    source.parts = [source.parts[0]!];
    source.global.measures[0]!.key = { fifths: 4 };
    source.global.measures.push({ id: "m2", key: { fifths: 0 } });
    source.parts[0]!.transposition = { interval: { staffDistance: 1, halfSteps: 2 }, keyFifthsFlipAt: 6 };
    source.parts[0]!.measures[0]!.sequences = [{ content: [whole("flipped", "E")] }];
    source.parts[0]!.measures.push({ sequences: [{ content: [whole("natural")] }] });
    const xml = convertScoreToMusicXml(source, { scoreIndex: 1 }).xml;
    expect(texts(xml, "fifths")).toEqual(["-6", "2"]);
    expect(texts(xml, "step")).toEqual(["G", "D"]);
    expect(texts(xml, "diatonic")).toEqual(["-2", "-1"]);
    const imported = convertMusicXmlToMnx(xml);
    expect(imported.parts[0]!.measures[0]!.sequences![0]!.content[0]).toMatchObject({
      notes: [{ pitch: { step: "E", octave: 4 } }],
    });
    expect(imported.parts[0]!.measures[1]!.sequences![0]!.content[0]).toMatchObject({
      notes: [{ pitch: { step: "C", octave: 4 } }],
    });
  });

  it("exports a concert score with sounding notes and written-part transposition information", () => {
    const result = convertScoreToMusicXml(score(), { scoreIndex: 0 });
    expect(texts(result.xml, "step")).toEqual(["C", "C"]);
    expect(texts(result.xml, "concert-score")).toHaveLength(1);
    expect(texts(result.xml, "transpose")).toHaveLength(0);
    expect(texts(result.xml, "part-transpose")).toHaveLength(1);
    const imported = convertMusicXmlToMnx(result.xml);
    expect(imported.parts[0]!.measures[0]!.sequences![0]!.content[0]).toMatchObject({
      notes: [{ pitch: { step: "C", octave: 4 } }],
    });
  });

  it("retains polyphony, chords, spaces and exact nested tuplet durations", () => {
    const source = score();
    source.parts[0]!.measures[0]!.sequences = [
      {
        voice: "upper",
        content: [
          {
            type: "tuplet",
            inner: { multiple: 3, duration: { base: "quarter" } },
            outer: { multiple: 2, duration: { base: "quarter" } },
            content: [
              { ...whole("t1"), duration: { base: "quarter" } },
              {
                type: "tuplet",
                inner: { multiple: 3, duration: { base: "eighth" } },
                outer: { multiple: 2, duration: { base: "eighth" } },
                content: [1, 2, 3].map((i) => ({ ...whole(`inner${i}`), duration: { base: "eighth" } })),
              },
              { ...whole("t2"), duration: { base: "quarter" } },
            ],
          },
          { type: "space", duration: [1, 2] },
        ],
      },
      {
        voice: "lower",
        content: [
          { ...whole("chord"), notes: [{ pitch: { step: "C", octave: 4 } }, { pitch: { step: "E", octave: 4 } }] },
        ],
      },
    ];
    const xml = convertScoreToMusicXml(source, { scoreIndex: 1 }).xml;
    expect(texts(xml, "divisions")).toEqual(["9"]);
    expect(texts(xml, "actual-notes")).toContain("9");
    expect(texts(xml, "normal-notes")).toContain("4");
    expect(texts(xml, "chord")).toHaveLength(1);
    expect(texts(xml, "backup")).toHaveLength(1);
    expect(texts(xml, "forward")).toHaveLength(1);
    expect(new Set(texts(xml, "voice"))).toEqual(new Set(["1", "2"]));
  });

  it("uses pickup duration and meter-independent full-bar rests", () => {
    const source = score();
    source.global.measures[0]!.number = 0;
    source.parts[1]!.measures[0]!.sequences = [{ content: [{ ...whole("pick"), duration: { base: "quarter" } }] }];
    source.parts[0]!.measures[0]!.sequences = [{ content: [], fullMeasure: { visualDuration: { base: "whole" } } }];
    const xml = convertScoreToMusicXml(source, { scoreIndex: 0 }).xml;
    expect(document(xml).getElementsByTagName("measure")[0]!.getAttribute("implicit")).toBe("yes");
    expect(document(xml).getElementsByTagName("rest")[0]!.getAttribute("measure")).toBe("yes");
    expect(texts(xml, "duration")).toEqual(["1", "1"]);
  });

  it("applies fitted staff-meter scaling when calculating pickup duration", () => {
    const source = score();
    source.global.measures[0]!.number = 0;
    source.global.measures[0]!.time = { count: 2, unit: 4 };
    source.parts[0]!.measures[0]!.staffMeters = [
      { staff: 1, meter: { count: 6, unit: 8 }, synchronization: "fitMeasure" },
    ];
    source.parts[0]!.measures[0]!.sequences = [
      { content: [{ ...whole("fitted-pickup"), duration: { base: "half", dots: 1 } }] },
    ];
    source.parts[1]!.measures[0]!.sequences = [
      { content: [{ ...whole("short-pickup"), duration: { base: "quarter" } }] },
    ];

    const xml = convertScoreToMusicXml(source, { scoreIndex: 0 }).xml;
    const firstMeasure = document(xml).getElementsByTagName("part")[0]!.getElementsByTagName("measure")[0]!;
    expect(firstMeasure.getElementsByTagName("forward")).toHaveLength(0);
    expect(Array.from(firstMeasure.getElementsByTagName("duration")).map((duration) => duration.textContent)).toEqual([
      "2",
    ]);
  });

  it("materializes chained similes without duplicate event IDs", () => {
    const source = score();
    source.global.measures.push({ id: "m2" }, { id: "m3" });
    for (const part of source.parts)
      part.measures.push(
        { measureRepeat: { number: 1 }, sequences: [] },
        { measureRepeat: { number: 1 }, sequences: [] },
      );
    const xml = convertScoreToMusicXml(source, { scoreIndex: 1 }).xml;
    expect(texts(xml, "step")).toEqual(["D", "D", "D"]);
    expect(texts(xml, "measure-repeat")).toHaveLength(4);
  });

  it("preserves octave-shift sounding pitch and positioned hairpin boundaries on reimport", () => {
    const source = score();
    source.parts[0]!.measures[0]!.sequences = [
      { content: [1, 2, 3, 4].map((i) => ({ ...whole(`q${i}`, "C", 5), duration: { base: "quarter" } })) },
    ];
    source.parts[0]!.measures[0]!.ottavas = [
      { position: { fraction: [1, 4] }, value: 1, end: { measure: "m1", position: { fraction: [3, 4] } } },
    ];
    source.parts[0]!.measures[0]!.dynamics = [
      {
        type: "gradual",
        position: { fraction: [1, 4] },
        wedgeType: "increasing",
        end: { measure: "m1", position: { fraction: [3, 4] } },
      },
    ];
    const xml = convertScoreToMusicXml(source, { scoreIndex: 1 }).xml;
    expect(texts(xml, "octave")).toEqual(["5", "4", "4", "5"]);
    const imported = convertMusicXmlToMnx(xml, { includeVendorExtensions: true });
    expect(imported.parts[0]!.measures[0]!.sequences![0]!.content).toHaveLength(4);
    for (const event of imported.parts[0]!.measures[0]!.sequences![0]!.content)
      expect(event).toMatchObject({ notes: [{ pitch: { step: "C", octave: 5 } }] });
    expect(imported.parts[0]!.measures[0]!.dynamics).toContainEqual(
      expect.objectContaining({
        position: { fraction: [1, 4] },
        end: { measure: expect.any(String), position: { fraction: [3, 4] } },
      }),
    );
  });

  it("writes a standard compressed archive whose declared .musicxml root can be imported", async () => {
    const result = await convertScoreToMxl(score(), { scoreIndex: 1 });
    const zip = await JSZip.loadAsync(result.bytes);
    expect(Object.keys(zip.files)[0]).toBe("mimetype");
    expect(await zip.file("mimetype")!.async("string")).toBe(MXL_MIME);
    expect(await zip.file("META-INF/container.xml")!.async("string")).toContain('full-path="score.musicxml"');
    expect((await convertMxlToMnx(result.bytes)).parts).toHaveLength(1);
    expect(Array.from(result.bytes.slice(8, 10))).toEqual([0, 0]);
  });

  it("keeps octave shifts voice-scoped and excludes another selected view's dynamics", () => {
    const source = score();
    const measure = source.parts[0]!.measures[0]!;
    measure.sequences = [
      { voice: "upper", content: [whole("upper", "C", 5)] },
      { voice: "lower", content: [whole("lower")] },
    ];
    measure.ottavas = [
      {
        position: { fraction: [0, 1] },
        end: { measure: "m1", position: { fraction: [1, 1] } },
        value: 1,
        voice: "upper",
      },
    ];
    measure.dynamics = [
      { id: "lower-dynamic", type: "immediate", value: "f", voice: "lower", position: { fraction: [0, 1] } },
    ];
    const full = convertScoreToMusicXml(source, { scoreIndex: 0 }).xml;
    const imported = convertMusicXmlToMnx(full);
    expect(imported.parts[0]!.measures[0]!.sequences!.map((sequence) => sequence.content[0])).toMatchObject([
      { notes: [{ pitch: { octave: 5 } }] },
      { notes: [{ pitch: { octave: 4 } }] },
    ]);
    source.layouts![1]!.content = [{ type: "staff", sources: [{ part: "clarinet", voice: "upper" }] }];
    const selected = convertScoreToMusicXml(source, { scoreIndex: 1 }).xml;
    expect(texts(selected, "note")).toHaveLength(1);
    expect(texts(selected, "f")).toHaveLength(0);
    expect(texts(selected, "octave-shift")).toHaveLength(2);
  });

  it("resets preferred written octave transposition after an instrument change", () => {
    const source = score();
    source.parts = [source.parts[0]!];
    source.layouts![0]!.content = [{ type: "staff", sources: [{ part: "clarinet" }] }];
    source.parts[0]!.transposition = { interval: { staffDistance: 7, halfSteps: 12 }, prefersWrittenPitches: true };
    source.global.measures.push({ id: "m2" });
    source.parts[0]!.measures.push({
      sequences: [{ content: [whole("reset")] }],
      instrumentChanges: [{ transposition: { interval: { staffDistance: 0, halfSteps: 0 } } }],
    });
    const xml = convertScoreToMusicXml(source, { scoreIndex: 0 }).xml;
    expect(texts(xml, "octave")).toEqual(["5", "4"]);
    expect(texts(xml, "chromatic")).toContain("0");
    const imported = convertMusicXmlToMnx(xml);
    for (const measure of imported.parts[0]!.measures)
      expect(measure.sequences![0]!.content[0]).toMatchObject({ notes: [{ pitch: { octave: 4 } }] });
  });

  it("retains shared caesuras, bounded arpeggios and grace color without inventing playback timing", () => {
    const source = score();
    const event = whole("ranged");
    event.markings = { trill: { accidental: 2 }, ornaments: ["shortTrill", "trillMordent"] };
    event.notes = [
      { id: "low", pitch: { step: "C", octave: 4 } },
      { pitch: { step: "E", octave: 4 } },
      { id: "high", pitch: { step: "G", octave: 4 } },
      { pitch: { step: "C", octave: 5 } },
    ];
    source.global.measures[0]!.caesura = {};
    source.parts[0]!.measures[0]!.arpeggios = [{ span: { start: "low", end: "high" }, direction: "up" }];
    source.parts[0]!.measures[0]!.expressions = [
      { id: "alpha", position: { fraction: [0, 1] }, text: [{ text: "Color", style: { color: "#12345680" } }] },
    ];
    source.parts[0]!.measures[0]!.sequences = [
      {
        content: [
          {
            type: "grace",
            graceType: "stealPrevious",
            color: "#ff0000",
            content: [{ ...whole("grace"), duration: { base: "eighth" } }],
          },
          event,
        ],
      },
    ];
    const result = convertScoreToMusicXml(source, { scoreIndex: 1 });
    expect(texts(result.xml, "caesura")).toEqual(["normal"]);
    expect(texts(result.xml, "arpeggiate")).toHaveLength(3);
    expect(document(result.xml).getElementsByTagName("note")[0]!.getAttribute("color")).toBe("#FF0000");
    expect(document(result.xml).getElementsByTagName("words")[0]!.getAttribute("color")).toBe("#80123456");
    expect(texts(result.xml, "accidental-mark")).toEqual(["double-sharp"]);
    expect(
      Array.from(document(result.xml).getElementsByTagName("other-ornament")).map((ornament) =>
        ornament.getAttribute("smufl"),
      ),
    ).toEqual(["ornamentShortTrill", "ornamentTrillMordent"]);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "musicxml-grace-timing")).toBe(true);
  });

  it("preserves same-note lyric extenders and diagnoses missing extract targets", () => {
    const source = score();
    const event = whole("lyric");
    event.lyrics = { lines: { verse: { text: "Sustain", extender: { show: true, target: "lyric" } } } };
    source.parts[0]!.measures[0]!.sequences = [{ content: [event] }];
    const xml = convertScoreToMusicXml(source, { scoreIndex: 1 }).xml;
    expect(document(xml).getElementsByTagName("extend")[0]!.hasAttribute("type")).toBe(false);
    event.lyrics.lines.verse!.extender!.target = "excluded";
    const missing = convertScoreToMusicXml(source, { scoreIndex: 1 });
    expect(texts(missing.xml, "extend")).toHaveLength(0);
    expect(missing.diagnostics.some((diagnostic) => diagnostic.code === "musicxml-lyric-target")).toBe(true);
  });

  it("reports nonportable playback and layout information and rejects overfilled bars", () => {
    const source = score();
    source.global.measures[0]!.gradualTempo = {
      kind: "rit",
      position: { fraction: [0, 1] },
      end: { measure: "m1", position: { fraction: [1, 1] } },
      endBpm: 60,
    };
    const diagnostics = new DiagnosticCollector();
    const result = convertScoreToMusicXml(source, { scoreIndex: 1, diagnostics });
    expect(result.diagnostics.some((entry) => entry.code === "musicxml-tempo-ramp")).toBe(true);
    source.parts[0]!.measures[0]!.sequences[0]!.content.push(whole("overflow"));
    expect(() => convertScoreToMusicXml(source, { scoreIndex: 1 })).toThrow(/overfills/);
  });
});

const fixtures = new URL("../../../format/fixtures/mnx/", import.meta.url);
describe("MNX interoperability fixtures", () => {
  it.each(readdirSync(fixtures).filter((name) => name.endsWith(".mnx")))(
    "exports %s as MusicXML 4.0",
    (name) => {
      const source = parseMnx(JSON.parse(readFileSync(new URL(name, fixtures), "utf8")));
      if (name === "beat-count-issues.mnx") {
        expect(() => convertScoreToMusicXml(source)).toThrow(/overfills/);
        return;
      }
      const xml = convertScoreToMusicXml(source).xml;
      const output = document(xml);
      expect(output.documentElement?.getAttribute("version")).toBe("4.0");
      expect(output.getElementsByTagName("part").length).toBe(source.parts.length);
    },
    // Rhapsody in Blue exports ~10 MB of XML; parallel CI workspaces slow it well past local timings.
    120_000,
  );
});
