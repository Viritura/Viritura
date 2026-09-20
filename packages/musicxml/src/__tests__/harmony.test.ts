import { describe, expect, it } from "vitest";
import { resolveChordSymbol, voiceChordSymbol, type ChordSymbol } from "@viritura/core";
import { convertMusicXmlToMnx, DiagnosticCollector, type MnxDocument, type MnxGlobalMeasure } from "../index";
import { consolidateImportedHarmony } from "../convert/harmonyConsolidation";

interface SourcePart {
  measures: string[];
  divisions?: number;
  attributes?: string;
}

function score(parts: SourcePart[]): string {
  return `<score-partwise version="4.0">
    <part-list>${parts
      .map((_, index) => `<score-part id="P${index}"><part-name>Part ${index}</part-name></score-part>`)
      .join("")}</part-list>
    ${parts
      .map(
        (part, index) =>
          `<part id="P${index}">${part.measures
            .map(
              (content, measureIndex) => `<measure number="${measureIndex + 1}">
              ${
                measureIndex === 0
                  ? `<attributes><divisions>${part.divisions ?? 1}</divisions>
                    <time><beats>4</beats><beat-type>4</beat-type></time>${part.attributes ?? ""}</attributes>`
                  : ""
              }
              ${content}
            </measure>`,
            )
            .join("")}</part>`,
      )
      .join("")}
  </score-partwise>`;
}

function harmony(step: string, kind = "major", extra = ""): string {
  return `<harmony><root><root-step>${step}</root-step></root><kind>${kind}</kind>${extra}</harmony>`;
}

function importHarmony(parts: SourcePart[]) {
  const diagnostics = new DiagnosticCollector();
  const document = convertMusicXmlToMnx(score(parts), { includeVendorExtensions: true, diagnostics });
  return { document, diagnostics: diagnostics.all() };
}

function expectGlobalOnly(document: MnxDocument, sourcePartIndices: number[]): void {
  for (const [index, part] of document.parts.entries()) {
    if (sourcePartIndices.includes(index)) {
      expect(part._x?.viritura.chordSymbolVisibility).toBe("show");
    }
    expect(part._x?.viritura ?? {}).not.toHaveProperty("chordSymbols");
    for (const measure of part.measures) {
      expect(measure._x?.viritura ?? {}).not.toHaveProperty("chordSymbols");
      expect(measure).not.toHaveProperty("chordSymbols");
    }
  }
  for (const measure of document.global.measures) {
    expect(measure).not.toHaveProperty("chordSymbols");
    for (const chord of measure._x?.viritura.chordSymbols ?? []) {
      expect(chord).not.toHaveProperty("displayStaff");
    }
  }
  expect(JSON.stringify(document.layouts ?? [])).not.toMatch(/globalChordSymbolVisibility|chordSymbolVisibility/);
}

describe("MusicXML global harmony merging", () => {
  it("immutably merges incoming positions without losing untouched global harmony or other extensions", () => {
    const originalChord: ChordSymbol = { position: { fraction: [3, 4] }, root: { step: "G" } };
    const original: MnxGlobalMeasure = {
      id: "m1",
      _x: { viritura: { chordSymbols: [originalChord], rehearsalMark: { text: "A" } } },
    };
    const incoming: ChordSymbol = { position: { fraction: [1, 2] }, root: { step: "C" }, quality: "major" };
    const snapshot = structuredClone(original);
    const sources = [
      {
        measureIndex: 0,
        partIndex: 1,
        staff: 1,
        chordSymbols: [{ ...incoming, position: { fraction: [2, 4] as [number, number] } }],
      },
      { measureIndex: 0, partIndex: 0, staff: 1, chordSymbols: [incoming] },
    ];
    const measures = [original];
    const diagnostics = new DiagnosticCollector();
    consolidateImportedHarmony(sources, measures, diagnostics);

    expect(measures[0]).not.toBe(original);
    expect(original).toEqual(snapshot);
    expect(measures[0]!._x?.viritura).toEqual({
      chordSymbols: [incoming, originalChord],
      rehearsalMark: { text: "A" },
    });
    expect(diagnostics.all()).toEqual([]);
  });
  it("does not emit harmony extensions when vendor extensions are disabled", () => {
    const diagnostics = new DiagnosticCollector();
    const document = convertMusicXmlToMnx(score([{ measures: [harmony("C")] }]), { diagnostics });

    expect(document.global.measures[0]!._x?.viritura.chordSymbols).toBeUndefined();
    expect(document.parts[0]!._x?.viritura.chordSymbolVisibility).toBeUndefined();
    expect(diagnostics.all()).toEqual([expect.objectContaining({ severity: "info", code: "musicxml-harmony" })]);
    expectGlobalOnly(document, []);
  });

  it.each([false, true])("uses source staff priority, not harmony XML order (reversed=%s)", (reversed) => {
    const harmonies = [harmony("C", "major", "<staff>1</staff>"), harmony("D", "minor", "<staff>2</staff>")];
    if (reversed) harmonies.reverse();
    const { document, diagnostics } = importHarmony([{ measures: [harmonies.join("")] }]);

    expect(document.global.measures[0]!._x?.viritura.chordSymbols).toEqual([
      { position: { fraction: [0, 1] }, root: { step: "C" }, quality: "major" },
    ]);
    expect(diagnostics).toEqual([expect.objectContaining({ severity: "warning", code: "musicxml-harmony-conflict" })]);
    expectGlobalOnly(document, [0]);
  });

  it("prioritizes the top source part before the source staff", () => {
    const { document, diagnostics } = importHarmony([
      { measures: [harmony("C", "major", "<staff>2</staff>")] },
      { measures: [harmony("D", "minor", "<staff>1</staff>")] },
    ]);

    expect(document.global.measures[0]!._x?.viritura.chordSymbols).toEqual([
      { position: { fraction: [0, 1] }, root: { step: "C" }, quality: "major" },
    ]);
    expect(diagnostics).toEqual([expect.objectContaining({ severity: "warning", code: "musicxml-harmony-conflict" })]);
    expectGlobalOnly(document, [0, 1]);
  });

  it("uses part-list display order even when XML part bodies are reordered", () => {
    const xml = score([{ measures: [harmony("C")] }, { measures: [harmony("D", "minor")] }]);
    const reordered = xml.replace(/(<part id="P0">[\s\S]*?<\/part>)(\s*)(<part id="P1">[\s\S]*?<\/part>)/, "$3$2$1");
    const diagnostics = new DiagnosticCollector();
    const document = convertMusicXmlToMnx(reordered, { includeVendorExtensions: true, diagnostics });
    expect(document.parts.map((part) => part.id)).toEqual(["P0", "P1"]);
    expect(document.global.measures[0]!._x?.viritura.chordSymbols?.[0]?.root).toEqual({ step: "C" });
    expect(diagnostics.all()).toEqual([
      expect.objectContaining({ severity: "warning", code: "musicxml-harmony-conflict" }),
    ]);
  });

  it("treats an omitted staff as the top staff", () => {
    const { document, diagnostics } = importHarmony([
      { measures: [harmony("D", "minor", "<staff>2</staff>") + harmony("C")] },
    ]);

    expect(document.global.measures[0]!._x?.viritura.chordSymbols).toEqual([
      { position: { fraction: [0, 1] }, root: { step: "C" }, quality: "major" },
    ]);
    expect(diagnostics).toEqual([expect.objectContaining({ severity: "warning", code: "musicxml-harmony-conflict" })]);
    expectGlobalOnly(document, [0]);
  });

  it("preserves distinct positions from incomplete lanes, sorted by rational onset", () => {
    const { document, diagnostics } = importHarmony([
      { measures: [harmony("G", "major", "<offset>2</offset>")] },
      { measures: [harmony("C") + harmony("D", "minor", "<offset>1</offset>")] },
      { measures: [""] },
    ]);

    expect(document.global.measures[0]!._x?.viritura.chordSymbols).toEqual([
      { position: { fraction: [0, 1] }, root: { step: "C" }, quality: "major" },
      { position: { fraction: [1, 4] }, root: { step: "D" }, quality: "minor" },
      { position: { fraction: [1, 2] }, root: { step: "G" }, quality: "major" },
    ]);
    expect(diagnostics).toEqual([]);
    expectGlobalOnly(document, [0, 1]);
  });

  it("does not merge the same onset across different measures or lose isolated source measures", () => {
    const { document, diagnostics } = importHarmony([
      { measures: [harmony("C"), ""] },
      { measures: ["", harmony("D", "minor")] },
    ]);

    expect(document.global.measures.map((measure) => measure._x?.viritura.chordSymbols)).toEqual([
      [{ position: { fraction: [0, 1] }, root: { step: "C" }, quality: "major" }],
      [{ position: { fraction: [0, 1] }, root: { step: "D" }, quality: "minor" }],
    ]);
    expect(diagnostics).toEqual([]);
    expectGlobalOnly(document, [0, 1]);
  });

  it("deduplicates equivalent fractions from parts with different divisions", () => {
    const { document, diagnostics } = importHarmony([
      { divisions: 3, measures: [harmony("C", "major", "<offset>1</offset>")] },
      { divisions: 6, measures: [harmony("C", "major", "<offset>2</offset>")] },
    ]);

    expect(document.global.measures[0]!._x?.viritura.chordSymbols).toEqual([
      { position: { fraction: [1, 12] }, root: { step: "C" }, quality: "major" },
    ]);
    expect(diagnostics).toEqual([]);
    expectGlobalOnly(document, [0, 1]);
  });

  it.each([
    [1, "0.5", [1, 8]],
    [1, "0.1", [1, 40]],
    [0.5, "0.25", [1, 8]],
  ])("preserves decimal offsets exactly (divisions=%s, offset=%s)", (divisions, offset, fraction) => {
    const { document, diagnostics } = importHarmony([
      { divisions, measures: [harmony("C", "major", `<offset>${offset}</offset>`)] },
    ]);
    expect(document.global.measures[0]!._x?.viritura.chordSymbols?.[0]?.position.fraction).toEqual(fraction);
    expect(diagnostics).toEqual([]);
  });

  it.each([
    ["forward", "<forward><duration>1</duration></forward>", "1", [5, 48]],
    ["note", "<note><rest/><duration>1</duration><type>eighth</type></note>", "1", [5, 48]],
    ["backup", "<forward><duration>2</duration></forward><backup><duration>1</duration></backup>", "1", [5, 48]],
    [
      "successive decimal forwards",
      "<forward><duration>0.1</duration></forward><forward><duration>0.2</duration></forward>",
      "0.3",
      [1, 32],
    ],
    ["decimal note", "<note><rest/><duration>0.3</duration><type>32nd</type></note>", "0.3", [1, 32]],
    ["inferred decimal note", "<note><rest/><duration>1.2</duration></note>", "1.2", [1, 8]],
    [
      "decimal backup",
      "<forward><duration>0.4</duration></forward><backup><duration>0.1</duration></backup>",
      "0.3",
      [1, 32],
    ],
  ])("merges %s timing with an equivalent offset using decimal divisions", (_, cursor, offset, fraction) => {
    const { document, diagnostics } = importHarmony([
      { divisions: 2.4, measures: [cursor + harmony("C") + '<sound tempo="120"/>'] },
      { divisions: 2.4, measures: [harmony("D", "major", `<offset>${offset}</offset>`)] },
    ]);

    expect(document.global.measures[0]!._x?.viritura.chordSymbols).toEqual([
      { position: { fraction }, root: { step: "C" }, quality: "major" },
    ]);
    expect(document.global.measures[0]!.tempos?.[0]?.location?.fraction).toEqual(fraction);
    expect(diagnostics).toEqual([
      expect.objectContaining({
        severity: "warning",
        code: "musicxml-harmony-conflict",
        message: expect.stringContaining(`at ${fraction.join("/")}: kept the topmost source staff in part 1`),
      }),
    ]);
    expectGlobalOnly(document, [0, 1]);
  });

  it.each([
    ["0.1", "0.4", [1, 24]],
    ["-0.1", "0.2", [1, 48]],
  ])("adds signed offset %s exactly to a decimal cursor", (offset, equivalentOffset, fraction) => {
    const { document, diagnostics } = importHarmony([
      {
        divisions: 2.4,
        measures: ["<forward><duration>0.3</duration></forward>" + harmony("C", "major", `<offset>${offset}</offset>`)],
      },
      { divisions: 2.4, measures: [harmony("D", "major", `<offset>${equivalentOffset}</offset>`)] },
    ]);
    expect(document.global.measures[0]!._x?.viritura.chordSymbols).toEqual([
      { position: { fraction }, root: { step: "C" }, quality: "major" },
    ]);
    expect(diagnostics).toEqual([expect.objectContaining({ severity: "warning", code: "musicxml-harmony-conflict" })]);
  });

  it("reduces long decimal durations before multiplication when locating harmonies", () => {
    const { document, diagnostics } = importHarmony([
      {
        divisions: 1.00000001,
        measures: ["<note><rest/><duration>1.00000001</duration><type>quarter</type></note>" + harmony("C")],
      },
      { divisions: 1.00000001, measures: [harmony("D", "major", "<offset>1.00000001</offset>")] },
    ]);
    expect(document.global.measures[0]!._x?.viritura.chordSymbols).toEqual([
      { position: { fraction: [1, 4] }, root: { step: "C" }, quality: "major" },
    ]);
    expect(diagnostics).toEqual([expect.objectContaining({ severity: "warning", code: "musicxml-harmony-conflict" })]);
  });

  it.each([
    [
      "explicit default alterations",
      `<root><root-step>C</root-step></root><kind>major</kind><bass><bass-step>E</bass-step></bass>`,
      `<root><root-step>C</root-step><root-alter>0</root-alter></root><kind>major</kind>
        <bass><bass-step>E</bass-step><bass-alter>0</bass-alter></bass>`,
    ],
    [
      "enharmonic roots and slash basses",
      `<root><root-step>C</root-step><root-alter>1</root-alter></root><kind>major</kind>
        <bass><bass-step>G</bass-step><bass-alter>1</bass-alter></bass>`,
      `<root><root-step>D</root-step><root-alter>-1</root-alter></root><kind>major</kind>
        <bass><bass-step>A</bass-step><bass-alter>-1</bass-alter></bass>`,
    ],
    [
      "equivalent quality text",
      `<root><root-step>C</root-step></root><kind text="M7">major-seventh</kind>`,
      `<root><root-step>C</root-step></root><kind text="maj7">major-seventh</kind>`,
    ],
  ])("silently deduplicates %s and retains the top source spelling", (_, top, bottom) => {
    const topPart = { measures: [`<harmony>${top}</harmony>`] };
    const { document: topOnly } = importHarmony([topPart]);
    const { document, diagnostics } = importHarmony([topPart, { measures: [`<harmony>${bottom}</harmony>`] }]);

    expect(document.global.measures[0]!._x?.viritura.chordSymbols).toEqual(
      topOnly.global.measures[0]!._x?.viritura.chordSymbols,
    );
    expect(document.global.measures[0]!._x?.viritura.chordSymbols).toHaveLength(1);
    expect(diagnostics).toEqual([]);
    expectGlobalOnly(document, [0, 1]);
  });

  it("deduplicates repeated equivalent harmonies within one staff", () => {
    const { document, diagnostics } = importHarmony([{ measures: [harmony("C") + harmony("C")] }]);
    expect(document.global.measures[0]!._x?.viritura.chordSymbols).toHaveLength(1);
    expect(diagnostics).toEqual([]);
    expectGlobalOnly(document, [0]);
  });

  it("reports every differing discarded source while ignoring equivalent sources", () => {
    const { document, diagnostics } = importHarmony([
      { measures: [harmony("C")] },
      { measures: [harmony("C")] },
      { measures: [harmony("D", "minor")] },
      { measures: [harmony("E", "minor")] },
    ]);
    expect(document.global.measures[0]!._x?.viritura.chordSymbols).toEqual([
      { position: { fraction: [0, 1] }, root: { step: "C" }, quality: "major" },
    ]);
    expect(diagnostics).toEqual([
      expect.objectContaining({ severity: "warning", code: "musicxml-harmony-conflict" }),
      expect.objectContaining({ severity: "warning", code: "musicxml-harmony-conflict" }),
    ]);
    expectGlobalOnly(document, [0, 1, 2, 3]);
  });

  it.each([
    ["quality", harmony("C", "minor")],
    ["extension", harmony("C", "major-seventh")],
    ["slash bass", harmony("C", "major", "<bass><bass-step>E</bass-step></bass>")],
  ])("does not mistake a different %s for equivalent harmony", (_, conflicting) => {
    const { document, diagnostics } = importHarmony([{ measures: [harmony("C")] }, { measures: [conflicting] }]);

    expect(document.global.measures[0]!._x?.viritura.chordSymbols).toEqual([
      { position: { fraction: [0, 1] }, root: { step: "C" }, quality: "major" },
    ]);
    expect(diagnostics).toEqual([expect.objectContaining({ severity: "warning", code: "musicxml-harmony-conflict" })]);
    expectGlobalOnly(document, [0, 1]);
  });
});

describe("MusicXML concert-pitch harmony", () => {
  const transpose = "<transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>";
  const written = harmony("D", "major", "<bass><bass-step>F</bass-step><bass-alter>1</bass-alter></bass>");

  it("transposes both the written root and slash bass to concert pitch", () => {
    const { document, diagnostics } = importHarmony([{ attributes: transpose, measures: [written] }]);
    const chords = document.global.measures[0]!._x?.viritura.chordSymbols;

    expect(chords).toEqual([
      { position: { fraction: [0, 1] }, root: { step: "C" }, quality: "major", bass: { step: "E" } },
    ]);
    expect(resolveChordSymbol(chords![0]!)).toMatchObject({ status: "supported" });
    expect(diagnostics).toEqual([]);
    expectGlobalOnly(document, [0]);
  });

  it("deduplicates transposing and concert-pitch parts only after normalizing to concert pitch", () => {
    const { document, diagnostics } = importHarmony([
      { attributes: transpose, measures: [written] },
      { measures: [harmony("C", "major", "<bass><bass-step>E</bass-step></bass>")] },
    ]);

    expect(document.global.measures[0]!._x?.viritura.chordSymbols).toEqual([
      { position: { fraction: [0, 1] }, root: { step: "C" }, quality: "major", bass: { step: "E" } },
    ]);
    expect(diagnostics).toEqual([]);
    expectGlobalOnly(document, [0, 1]);
  });

  it("uses per-staff source transposition, including a lower staff declared first", () => {
    const { document, diagnostics } = importHarmony([
      {
        attributes: `<transpose number="2"><diatonic>0</diatonic><chromatic>0</chromatic></transpose>
        <transpose number="1"><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>`,
        measures: [harmony("C", "major", "<bass><bass-step>E</bass-step></bass><staff>2</staff>") + written],
      },
    ]);
    expect(document.global.measures[0]!._x?.viritura.chordSymbols).toEqual([
      { position: { fraction: [0, 1] }, root: { step: "C" }, quality: "major", bass: { step: "E" } },
    ]);
    expect(diagnostics).toEqual([]);
  });

  it("tracks representation changes in document order and across measures", () => {
    const { document, diagnostics } = importHarmony([
      {
        attributes: transpose,
        measures: [
          written +
            `<forward><duration>1</duration></forward>
          <attributes><transpose><diatonic>0</diatonic><chromatic>0</chromatic></transpose></attributes>` +
            written,
          written,
        ],
      },
    ]);
    expect(
      document.global.measures.map((measure) =>
        measure._x?.viritura.chordSymbols?.map((chord) => [chord.position.fraction, chord.root, chord.bass]),
      ),
    ).toEqual([
      [
        [[0, 1], { step: "C" }, { step: "E" }],
        [[1, 4], { step: "D" }, { step: "F", alter: 1 }],
      ],
      [[[0, 1], { step: "D" }, { step: "F", alter: 1 }]],
    ]);
    expect(diagnostics).toEqual([]);
  });

  it("transposes unsupported root and slash text without inventing supported semantics", () => {
    const { document, diagnostics } = importHarmony([
      {
        attributes: transpose,
        measures: [harmony("D", "Neapolitan", "<bass><bass-step>F</bass-step><bass-alter>1</bass-alter></bass>")],
      },
    ]);
    const chord = document.global.measures[0]!._x?.viritura.chordSymbols?.[0];
    expect(chord).toMatchObject({ root: { step: "C" }, bass: { step: "E" }, rawText: "CNeapolitan/E" });
    expect(resolveChordSymbol(chord!)).toMatchObject({ status: "unsupported" });
    expect(diagnostics).toEqual([expect.objectContaining({ code: "musicxml-harmony-kind" })]);
  });

  it("normalizes microtonal slash bass before preserving unsupported text", () => {
    const { document, diagnostics } = importHarmony([
      {
        attributes: transpose,
        measures: [harmony("D", "major", "<bass><bass-step>F</bass-step><bass-alter>0.5</bass-alter></bass>")],
      },
    ]);
    expect(document.global.measures[0]!._x?.viritura.chordSymbols).toEqual([
      { position: { fraction: [0, 1] }, rawText: "C/E(-0.5)" },
    ]);
    expect(diagnostics).toEqual([expect.objectContaining({ code: "musicxml-harmony-kind" })]);
  });

  it.each(["", harmony("C")])("accepts fractional source transposition (%s)", (content) => {
    const { document, diagnostics } = importHarmony([
      {
        attributes: "<transpose><chromatic>0.5</chromatic></transpose>",
        measures: [content],
      },
    ]);
    if (content) {
      expect(document.global.measures[0]!._x?.viritura.chordSymbols).toEqual([
        { position: { fraction: [0, 1] }, rawText: "C(0.5)" },
      ]);
      expect(diagnostics).toEqual([expect.objectContaining({ code: "musicxml-harmony-kind" })]);
    } else {
      expect(diagnostics).toEqual([]);
    }
  });
});

describe("MusicXML unsupported harmony preservation", () => {
  it("preserves and normalizes the slash bass on unsupported numeral harmony", () => {
    const { document, diagnostics } = importHarmony([
      {
        attributes: "<transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>",
        measures: [
          "<harmony><numeral><numeral-root>5</numeral-root></numeral><kind>dominant</kind><bass><bass-step>G</bass-step></bass></harmony>",
        ],
      },
    ]);
    expect(document.global.measures[0]!._x?.viritura.chordSymbols?.[0]).toMatchObject({
      rawText: "5dominant/F",
      bass: { step: "F" },
    });
    expect(diagnostics).toEqual([expect.objectContaining({ code: "musicxml-harmony-kind" })]);
  });
  it("retains unsupported authored kind text rather than substituting a major triad label", () => {
    const { document, diagnostics } = importHarmony([
      {
        measures: ['<harmony><root><root-step>C</root-step></root><kind text="Mystery">major</kind></harmony>'],
      },
    ]);
    expect(document.global.measures[0]!._x?.viritura.chordSymbols?.[0]).toMatchObject({ rawText: "CMystery" });
    expect(diagnostics).toEqual([expect.objectContaining({ code: "musicxml-harmony-kind" })]);
  });

  it("preserves microtonal roots as unsupported text without invalid integer-only structured roots", () => {
    const { document, diagnostics } = importHarmony([
      {
        measures: [
          "<harmony><root><root-step>C</root-step><root-alter>0.5</root-alter></root><kind>major</kind></harmony>",
        ],
      },
    ]);
    expect(document.global.measures[0]!._x?.viritura.chordSymbols).toEqual([
      { position: { fraction: [0, 1] }, rawText: "C(0.5)" },
    ]);
    expect(diagnostics).toEqual([expect.objectContaining({ code: "musicxml-harmony-kind" })]);
  });
  it("preserves unknown source kind and authored kind text without a playable fallback", () => {
    const { document, diagnostics } = importHarmony([
      {
        measures: [`<harmony><root><root-step>C</root-step></root><kind text="Mystery">Neapolitan</kind></harmony>`],
      },
    ]);
    const chords = document.global.measures[0]!._x?.viritura.chordSymbols;

    expect(chords).toEqual([
      expect.objectContaining({
        root: { step: "C" },
        quality: "other",
        kindText: "Mystery",
        rawText: expect.stringMatching(/\S/),
      }),
    ]);
    expect(resolveChordSymbol(chords![0]!)).toMatchObject({ status: "unsupported" });
    expect(diagnostics).toEqual([expect.objectContaining({ severity: "warning", code: "musicxml-harmony-kind" })]);
    expectGlobalOnly(document, [0]);
  });

  it.each([
    ["numeral", "<numeral><numeral-root>5</numeral-root></numeral><kind>dominant</kind>"],
    ["rootless", '<kind text="Mystery">other</kind>'],
  ])("preserves %s markings as nonempty raw text with a warning", (_, content) => {
    const { document, diagnostics } = importHarmony([{ measures: [`<harmony>${content}</harmony>`] }]);
    const chords = document.global.measures[0]!._x?.viritura.chordSymbols;

    expect(chords).toEqual([
      expect.objectContaining({ position: { fraction: [0, 1] }, rawText: expect.stringMatching(/\S/) }),
    ]);
    expect(resolveChordSymbol(chords![0]!)).toMatchObject({ status: "unsupported" });
    expect(diagnostics).toEqual([expect.objectContaining({ severity: "warning" })]);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).not.toContain("musicxml-harmony-dropped");
    expectGlobalOnly(document, [0]);
  });

  it.each(["", "<root><root-step>C</root-step></root>"])(
    "imports kind none as silent N.C. even with a source root (%s)",
    (root) => {
      const { document, diagnostics } = importHarmony([{ measures: [`<harmony>${root}<kind>none</kind></harmony>`] }]);
      const chords = document.global.measures[0]!._x?.viritura.chordSymbols;

      expect(chords).toEqual([expect.objectContaining({ rawText: "N.C." })]);
      expect(resolveChordSymbol(chords![0]!)).toEqual({ status: "silent" });
      expect(voiceChordSymbol(chords![0]!)).toEqual({ leftHand: [], rightHand: [] });
      expect(diagnostics).toEqual([]);
      expectGlobalOnly(document, [0]);
    },
  );

  it.each(["add", "alter", "subtract"])("preserves unsupported %s degrees instead of playing a plain triad", (type) => {
    const { document, diagnostics } = importHarmony([
      {
        measures: [
          harmony(
            "C",
            "major",
            `<degree><degree-value>9</degree-value><degree-alter>-1</degree-alter><degree-type>${type}</degree-type></degree>`,
          ),
        ],
      },
    ]);
    const chords = document.global.measures[0]!._x?.viritura.chordSymbols;

    expect(chords).toEqual([expect.objectContaining({ rawText: expect.stringMatching(/\S/) })]);
    expect(resolveChordSymbol(chords![0]!)).toMatchObject({ status: "unsupported" });
    expect(voiceChordSymbol(chords![0]!)).toEqual({ leftHand: [], rightHand: [] });
    expect(diagnostics).toEqual([expect.objectContaining({ severity: "warning" })]);
    expectGlobalOnly(document, [0]);
  });
});

describe("MusicXML harmony structural validation", () => {
  it.each([
    ["root step", harmony("H")],
    ["empty root", "<harmony><root/><kind>major</kind></harmony>"],
    [
      "root alteration",
      "<harmony><root><root-step>C</root-step><root-alter>NaN</root-alter></root><kind>major</kind></harmony>",
    ],
    ["bass step", harmony("C", "major", "<bass><bass-step>H</bass-step></bass>")],
    [
      "bass alteration",
      harmony("C", "major", "<bass><bass-step>E</bass-step><bass-alter>Infinity</bass-alter></bass>"),
    ],
    ["position before the measure", harmony("C", "major", "<offset>-1</offset>")],
    ["non-numeric offset", harmony("C", "major", "<offset>NaN</offset>")],
    ["fractional staff", harmony("C", "major", "<staff>1.5</staff>")],
    ["missing kind", "<harmony><root><root-step>C</root-step></root></harmony>"],
  ])("throws for an invalid %s rather than silently dropping or downgrading the chord", (_, content) => {
    const diagnostics = new DiagnosticCollector();
    expect(() =>
      convertMusicXmlToMnx(score([{ measures: [content] }]), { includeVendorExtensions: true, diagnostics }),
    ).toThrow();
  });

  it.each([0, -1])("throws for invalid divisions %s when locating a harmony", (divisions) => {
    expect(() => importHarmony([{ divisions, measures: [harmony("C", "major", "<offset>1</offset>")] }])).toThrow();
  });
});
