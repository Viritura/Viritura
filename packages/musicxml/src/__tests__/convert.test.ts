import { describe, it, expect } from "vitest";
import { DiagnosticCollector } from "../index";
import { convertMusicXmlToMnx } from "../convert";

// ─── Helper: wrap a single-part MusicXML score ──────────────────────

function wrapScore(
  partContent: string,
  opts: {
    partName?: string;
    partId?: string;
    divisions?: number;
    time?: string;
    key?: string;
    clef?: string;
  } = {},
): string {
  const {
    partName = "Test",
    partId = "P1",
    divisions = 1,
    time = "<beats>4</beats><beat-type>4</beat-type>",
    key = "<fifths>0</fifths>",
    clef = "<sign>G</sign><line>2</line>",
  } = opts;

  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="${partId}"><part-name>${partName}</part-name></score-part>
  </part-list>
  <part id="${partId}">
    <measure number="1">
      <attributes>
        <divisions>${divisions}</divisions>
        <key>${key}</key>
        <time>${time}</time>
        <clef>${clef}</clef>
      </attributes>
      ${partContent}
    </measure>
  </part>
</score-partwise>`;
}

// ═══════════════════════════════════════════════════════════════════════
// Basic functionality
// ═══════════════════════════════════════════════════════════════════════

describe("convertMusicXmlToMnx — basics", () => {
  it("converts a minimal single-note score with version 7", () => {
    const xml = wrapScore(`
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
      </note>
    `);
    const result = convertMusicXmlToMnx(xml);

    expect(result.mnx.version).toBe(7);
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0]!.name).toBe("Test");

    expect(result.global.measures).toHaveLength(1);
    expect(result.global.measures[0]!.time).toEqual({ count: 4, unit: 4 });
    expect(result.global.measures[0]!.key).toEqual({ fifths: 0 });

    const measure = result.parts[0]!.measures[0]!;
    expect(measure.clefs![0]!.clef).toEqual({ sign: "G", staffPosition: -2 });
    expect(measure.sequences).toHaveLength(1);

    const event = measure.sequences![0]!.content[0]! as {
      duration: { base: string };
      notes: { pitch: { step: string; octave: number } }[];
    };
    expect(event.duration).toEqual({ base: "whole" });
    expect(event.notes).toHaveLength(1);
    expect(event.notes![0]!.pitch).toEqual({ step: "C", octave: 4 });
  });

  it("handles multiple voices", () => {
    const xml = wrapScore(`
      <note>
        <pitch><step>E</step><octave>5</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
        <voice>1</voice>
      </note>
      <backup><duration>4</duration></backup>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
        <voice>2</voice>
      </note>
    `);

    const result = convertMusicXmlToMnx(xml);
    const measure = result.parts[0]!.measures[0]!;
    expect(measure.sequences).toHaveLength(2);
  });

  it("preserves rest events", () => {
    const xml = wrapScore(`
      <note>
        <rest/>
        <duration>2</duration>
        <type>half</type>
      </note>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>2</duration>
        <type>half</type>
      </note>
    `);

    const result = convertMusicXmlToMnx(xml);
    const content = result.parts[0]!.measures[0]!.sequences![0]!.content;
    expect(content).toHaveLength(2);
    expect((content[0]! as { rest: unknown }).rest).toBeDefined();
    expect((content[0]! as { duration: { base: string } }).duration).toEqual({ base: "half" });
  });

  it("handles ties across notes", () => {
    const xml = wrapScore(`
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>2</duration>
        <type>half</type>
        <tie type="start"/>
      </note>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>2</duration>
        <type>half</type>
        <tie type="stop"/>
      </note>
    `);

    const result = convertMusicXmlToMnx(xml);
    const content = result.parts[0]!.measures[0]!.sequences![0]!.content;
    const ev0 = content[0]! as { notes: { ties?: { target: string }[] }[] };
    const ev1 = content[1]! as { notes: { id?: string }[] };
    expect(ev0.notes[0]!.ties).toBeDefined();
    const targetId = ev0.notes[0]!.ties![0]!.target;
    expect(ev1.notes[0]!.id).toBe(targetId);
  });

  it("resolves ties that span a barline", () => {
    // A tie starting at the end of measure 1 and stopping at the start of
    // measure 2 must resolve: the stop note adopts the id the start note's
    // tie targets. The tie-pairing state must persist across measures.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Test</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration><type>whole</type>
        <tie type="start"/>
      </note>
    </measure>
    <measure number="2">
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration><type>whole</type>
        <tie type="stop"/>
      </note>
    </measure>
  </part>
</score-partwise>`;

    const result = convertMusicXmlToMnx(xml);
    const measures = result.parts[0]!.measures;
    const startEv = measures[0]!.sequences![0]!.content[0]! as {
      notes: { ties?: { target: string }[] }[];
    };
    const stopEv = measures[1]!.sequences![0]!.content[0]! as {
      notes: { id?: string }[];
    };
    const targetId = startEv.notes[0]!.ties![0]!.target;
    expect(targetId).toBeDefined();
    // The cross-barline target must point at the stop note's id (not dangle).
    expect(stopEv.notes[0]!.id).toBe(targetId);
  });

  it("reinterprets an orphan tie-start (no matching stop) as laissez-vibrer", () => {
    // A <tie type="start"> with no matching <tie type="stop"> anywhere in the
    // part is malformed (or a let-ring drawn without a destination). It must
    // NOT leave a dangling target pointing at a note that never exists.
    // (Rhapsody in Blue P28 mm.242-246.)
    const xml = wrapScore(`
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration><type>whole</type>
        <tie type="start"/>
      </note>
    `);

    const result = convertMusicXmlToMnx(xml);
    const ev0 = result.parts[0]!.measures[0]!.sequences![0]!.content[0]! as {
      notes: { ties?: { target?: string; lv?: boolean }[] }[];
    };
    const tie = ev0.notes[0]!.ties![0]!;
    expect(tie.target).toBeUndefined();
    expect(tie.lv).toBe(true);
  });

  it("detects a slur stop in a second <notations> block", () => {
    // MusicXML allows multiple sibling <notations> elements on one note. The
    // slur stop here lives in a SECOND <notations> block (the first holds an
    // articulation). Reading only the first block silently drops the stop,
    // leaving the slur target dangling. (Rhapsody in Blue m75 P1.)
    const xml = wrapScore(
      `
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type><notations><slur type="start" number="1"/></notations></note>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type>
        <notations><articulations><staccato/></articulations></notations>
        <notations><slur type="stop" number="1"/></notations>
      </note>
      <note><pitch><step>F</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type></note>
    `,
    );
    const result = convertMusicXmlToMnx(xml);
    const content = result.parts[0]!.measures[0]!.sequences![0]!.content as Array<{
      id?: string;
      slurs?: { target: string }[];
    }>;
    const ids = new Set(content.map((e) => e.id));
    for (const ev of content) for (const sl of ev.slurs ?? []) expect(ids.has(sl.target)).toBe(true);
  });

  it("preserves a caesura in a second <notations> block", () => {
    // A mid-measure caesura is commonly engraved alongside another
    // articulation, with the caesura placed in a SECOND <notations> block on
    // the same note (the first holds the accent). Reading only the first block
    // silently drops the caesura. (Rhapsody in Blue m486 P1.)
    const xml = wrapScore(
      `
      <note><pitch><step>C</step><octave>6</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>D</step><octave>6</octave></pitch><duration>1</duration><type>quarter</type>
        <notations><articulations><accent placement="above"/></articulations></notations>
        <notations><articulations><caesura>normal</caesura></articulations></notations>
      </note>
      <note><rest/><duration>2</duration><type>half</type></note>
    `,
    );
    const result = convertMusicXmlToMnx(xml, { includeVendorExtensions: true });
    const content = result.parts[0]!.measures[0]!.sequences![0]!.content as Array<{
      markings?: { accent?: unknown; _x?: { viritura?: Record<string, unknown> } };
    }>;
    const ev = content[1]!;
    expect(ev.markings?.accent).toBeDefined();
    expect(ev.markings?._x?.viritura?.["caesura"]).toBeDefined();
  });

  it("converts dotted notes", () => {
    const xml = wrapScore(
      `
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>6</duration>
        <type>half</type>
        <dot/>
      </note>
      <note>
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>2</duration>
        <type>quarter</type>
      </note>
    `,
      { divisions: 2 },
    );

    const result = convertMusicXmlToMnx(xml);
    const content = result.parts[0]!.measures[0]!.sequences![0]!.content;
    expect((content[0]! as { duration: { base: string; dots: number } }).duration).toEqual({ base: "half", dots: 1 });
  });

  it("handles chords", () => {
    const xml = wrapScore(`
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
      </note>
      <note>
        <chord/>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
      </note>
      <note>
        <chord/>
        <pitch><step>G</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
      </note>
    `);

    const result = convertMusicXmlToMnx(xml);
    const content = result.parts[0]!.measures[0]!.sequences![0]!.content;
    expect(content).toHaveLength(1);
    expect((content[0]! as { notes: unknown[] }).notes).toHaveLength(3);
  });

  it("handles dynamics", () => {
    const xml = wrapScore(`
      <direction>
        <direction-type>
          <dynamics><ff/></dynamics>
        </direction-type>
      </direction>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
      </note>
    `);

    const result = convertMusicXmlToMnx(xml);
    const measure = result.parts[0]!.measures[0]!;
    expect(measure.dynamics).toHaveLength(1);
    expect(measure.dynamics![0]!.value).toBe("ff");
  });

  it("dedupes identical dynamics and expressions from divisi voices", () => {
    // Divisi parts emit one <direction> per voice/layer, so the same dynamic
    // and word can appear twice at the same position. They must collapse to a
    // single entry rather than render overprinted.
    const xml = wrapScore(`
      <direction placement="above">
        <direction-type><dynamics><fff/></dynamics></direction-type>
      </direction>
      <direction placement="above">
        <direction-type><words>arco</words></direction-type>
      </direction>
      <direction placement="above">
        <direction-type><dynamics><fff/></dynamics></direction-type>
      </direction>
      <direction placement="above">
        <direction-type><words>arco</words></direction-type>
      </direction>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
      </note>
    `);

    const result = convertMusicXmlToMnx(xml, { includeVendorExtensions: true });
    const measure = result.parts[0]!.measures[0]!;
    expect(measure.dynamics).toHaveLength(1);
    expect(measure.dynamics![0]!.value).toBe("fff");
    const ext = (measure as unknown as Record<string, unknown>)._x as {
      viritura: Record<string, unknown>;
    };
    const exprs = ext.viritura["expressions"] as { text: string }[];
    expect(exprs).toHaveLength(1);
    expect(exprs[0]!.text).toBe("arco");
  });

  it("handles grace notes", () => {
    const xml = wrapScore(`
      <note>
        <grace/>
        <pitch><step>D</step><octave>5</octave></pitch>
        <type>eighth</type>
      </note>
      <note>
        <pitch><step>C</step><octave>5</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
      </note>
    `);

    const result = convertMusicXmlToMnx(xml);
    const content = result.parts[0]!.measures[0]!.sequences![0]!.content;
    expect(content).toHaveLength(2);
    expect((content[0]! as { type: string }).type).toBe("grace");
  });

  it("groups grace notes carrying <chord/> into multi-note grace events", () => {
    const xml = wrapScore(`
      <note>
        <grace slash="yes"/>
        <pitch><step>E</step><octave>4</octave></pitch><type>16th</type>
      </note>
      <note>
        <grace slash="yes"/><chord/>
        <pitch><step>G</step><octave>4</octave></pitch><type>16th</type>
      </note>
      <note>
        <grace slash="yes"/>
        <pitch><step>F</step><octave>4</octave></pitch><type>16th</type>
      </note>
      <note>
        <grace slash="yes"/><chord/>
        <pitch><step>A</step><octave>4</octave></pitch><type>16th</type>
      </note>
      <note>
        <pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>whole</type>
      </note>
    `);
    const content = convertMusicXmlToMnx(xml).parts[0]!.measures[0]!.sequences![0]!.content;
    const grace = content[0]! as { type: string; content: { notes?: unknown[] }[] };
    expect(grace.type).toBe("grace");
    // Two grace chords of two notes each, not four single notes.
    expect(grace.content).toHaveLength(2);
    expect(grace.content[0]!.notes).toHaveLength(2);
    expect(grace.content[1]!.notes).toHaveLength(2);
  });

  it("handles final barlines", () => {
    const xml = wrapScore(`
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
      </note>
      <barline location="right">
        <bar-style>light-heavy</bar-style>
      </barline>
    `);

    const result = convertMusicXmlToMnx(xml);
    expect(result.global.measures[0]!.barline).toEqual({ type: "final" });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Tuplets
// ═══════════════════════════════════════════════════════════════════════

describe("convertMusicXmlToMnx — tuplets", () => {
  it("converts a basic triplet", () => {
    const xml = wrapScore(
      `
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>1</duration>
        <type>eighth</type>
        <time-modification>
          <actual-notes>3</actual-notes>
          <normal-notes>2</normal-notes>
          <normal-type>eighth</normal-type>
        </time-modification>
        <notations><tuplet type="start" bracket="yes"/></notations>
      </note>
      <note>
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>1</duration>
        <type>eighth</type>
        <time-modification>
          <actual-notes>3</actual-notes>
          <normal-notes>2</normal-notes>
          <normal-type>eighth</normal-type>
        </time-modification>
      </note>
      <note>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>1</duration>
        <type>eighth</type>
        <time-modification>
          <actual-notes>3</actual-notes>
          <normal-notes>2</normal-notes>
          <normal-type>eighth</normal-type>
        </time-modification>
        <notations><tuplet type="stop"/></notations>
      </note>
    `,
      { divisions: 2 },
    );

    const result = convertMusicXmlToMnx(xml);
    const content = result.parts[0]!.measures[0]!.sequences![0]!.content;
    expect(content).toHaveLength(1);

    const tuplet = content[0]! as {
      type: string;
      inner: { multiple: number; duration: { base: string } };
      outer: { multiple: number; duration: { base: string } };
      content: unknown[];
      bracket: string;
    };
    expect(tuplet.type).toBe("tuplet");
    expect(tuplet.inner.multiple).toBe(3);
    expect(tuplet.inner.duration.base).toBe("eighth");
    expect(tuplet.outer.multiple).toBe(2);
    expect(tuplet.outer.duration.base).toBe("eighth");
    expect(tuplet.content).toHaveLength(3);
    expect(tuplet.bracket).toBe("yes");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Articulations
// ═══════════════════════════════════════════════════════════════════════

describe("convertMusicXmlToMnx — articulations", () => {
  it("converts staccato", () => {
    const xml = wrapScore(`
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
        <notations><articulations><staccato/></articulations></notations>
      </note>
    `);
    const event = convertMusicXmlToMnx(xml).parts[0]!.measures[0]!.sequences![0]!.content[0]! as {
      markings: { staccato: unknown };
    };
    expect(event.markings.staccato).toBeDefined();
  });

  it("converts accent", () => {
    const xml = wrapScore(`
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
        <notations><articulations><accent/></articulations></notations>
      </note>
    `);
    const event = convertMusicXmlToMnx(xml).parts[0]!.measures[0]!.sequences![0]!.content[0]! as {
      markings: { accent: unknown };
    };
    expect(event.markings.accent).toBeDefined();
  });

  it("converts tenuto", () => {
    const xml = wrapScore(`
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
        <notations><articulations><tenuto/></articulations></notations>
      </note>
    `);
    const event = convertMusicXmlToMnx(xml).parts[0]!.measures[0]!.sequences![0]!.content[0]! as {
      markings: { tenuto: unknown };
    };
    expect(event.markings.tenuto).toBeDefined();
  });

  it("converts strong-accent with direction", () => {
    const xml = wrapScore(`
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
        <notations><articulations><strong-accent type="up"/></articulations></notations>
      </note>
    `);
    const event = convertMusicXmlToMnx(xml).parts[0]!.measures[0]!.sequences![0]!.content[0]! as {
      markings: { strongAccent: { pointing: string } };
    };
    expect(event.markings.strongAccent).toEqual({ pointing: "up" });
  });

  it("converts multiple articulations on one note", () => {
    const xml = wrapScore(`
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
        <notations><articulations><staccato/><accent/></articulations></notations>
      </note>
    `);
    const event = convertMusicXmlToMnx(xml).parts[0]!.measures[0]!.sequences![0]!.content[0]! as {
      markings: { staccato: unknown; accent: unknown };
    };
    expect(event.markings.staccato).toBeDefined();
    expect(event.markings.accent).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Fermata & Ornaments
// ═══════════════════════════════════════════════════════════════════════

describe("convertMusicXmlToMnx — fermata & ornaments", () => {
  it("converts upright fermata to native MNX (orient defaults)", () => {
    const xml = wrapScore(`
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
        <notations><fermata type="upright"/></notations>
      </note>
    `);
    const event = convertMusicXmlToMnx(xml, { includeVendorExtensions: true }).parts[0]!.measures[0]!.sequences![0]!
      .content[0]! as { markings: { fermata: { orient?: string } } };
    expect(event.fermata).toEqual({});
  });

  it("converts inverted fermata to native MNX with orient=below", () => {
    const xml = wrapScore(`
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
        <notations><fermata type="inverted"/></notations>
      </note>
    `);
    const event = convertMusicXmlToMnx(xml).parts[0]!.measures[0]!.sequences![0]!.content[0]! as {
      markings: { fermata: { orient?: string } };
    };
    expect(event.fermata).toEqual({ orient: "below" });
  });

  it("converts trill-mark as vendor extension", () => {
    const xml = wrapScore(`
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
        <notations><ornaments><trill-mark/></ornaments></notations>
      </note>
    `);
    const event = convertMusicXmlToMnx(xml, { includeVendorExtensions: true }).parts[0]!.measures[0]!.sequences![0]!
      .content[0]! as { markings: { _x: { viritura: Record<string, unknown> } } };
    expect(event.markings._x.viritura["trill"]).toEqual({});
  });

  it("folds an <accidental-mark> sibling onto the trill (flat trill)", () => {
    const xml = wrapScore(`
      <note>
        <pitch><step>E</step><alter>-1</alter><octave>5</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
        <notations>
          <ornaments>
            <trill-mark/>
            <accidental-mark placement="above">flat</accidental-mark>
          </ornaments>
        </notations>
      </note>
    `);
    const event = convertMusicXmlToMnx(xml, { includeVendorExtensions: true }).parts[0]!.measures[0]!.sequences![0]!
      .content[0]! as { markings: { _x: { viritura: Record<string, unknown> } } };
    expect(event.markings._x.viritura["trill"]).toEqual({ accidental: -1 });
  });

  it("converts MusicXML ornament elements to Viritura ornament names", () => {
    const xml = wrapScore(`
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
        <notations><ornaments><mordent/><inverted-turn/></ornaments></notations>
      </note>
    `);
    const event = convertMusicXmlToMnx(xml, { includeVendorExtensions: true }).parts[0]!.measures[0]!.sequences![0]!
      .content[0]! as { markings: { _x: { viritura: Record<string, unknown> } } };
    expect(event.markings._x.viritura["ornaments"]).toEqual(["mordent", "invertedTurn"]);
  });

  it("converts MusicXML fingering to Viritura fingerings array", () => {
    const xml = wrapScore(`
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
        <notations><technical><fingering>2</fingering></technical></notations>
      </note>
    `);
    const event = convertMusicXmlToMnx(xml, { includeVendorExtensions: true }).parts[0]!.measures[0]!.sequences![0]!
      .content[0]! as { markings: { _x: { viritura: Record<string, unknown> } } };
    expect(event.markings._x.viritura["fingerings"]).toEqual([{ finger: 2 }]);
  });

  it("converts MusicXML <arpeggiate> to the consumed _x.viritura.arpeggio marking", () => {
    // The marking must be keyed "arpeggio" (read by the format parser and the
    // engine), NOT the dead "arpeggiate" field. Regression for arpeggios
    // silently dropped on import (e.g. Rhapsody in Blue m27 LH chord).
    const xml = wrapScore(`
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
        <notations><arpeggiate/></notations>
      </note>
      <note>
        <chord/>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
        <notations><arpeggiate/></notations>
      </note>
    `);
    const event = convertMusicXmlToMnx(xml, { includeVendorExtensions: true }).parts[0]!.measures[0]!.sequences![0]!
      .content[0]! as { markings: { _x: { viritura: Record<string, unknown> } } };
    expect(event.markings._x.viritura["arpeggio"]).toEqual({});
    expect(event.markings._x.viritura["arpeggiate"]).toBeUndefined();
  });

  it("carries the <arpeggiate> direction into the arpeggio marking", () => {
    const xml = wrapScore(`
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
        <notations><arpeggiate direction="down"/></notations>
      </note>
      <note>
        <chord/>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
      </note>
    `);
    const event = convertMusicXmlToMnx(xml, { includeVendorExtensions: true }).parts[0]!.measures[0]!.sequences![0]!
      .content[0]! as { markings: { _x: { viritura: Record<string, unknown> } } };
    expect(event.markings._x.viritura["arpeggio"]).toEqual({ direction: "down" });
  });

  it("converts non-arpeggiate to a standard MNX span on the chord event", () => {
    const xml = wrapScore(`
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
        <notations><non-arpeggiate/></notations>
      </note>
      <note>
        <chord/>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
      </note>
    `);

    const measure = convertMusicXmlToMnx(xml).parts[0]!.measures[0]!;
    const event = measure.sequences![0]!.content[0]! as { id?: string };

    expect(measure.nonArpeggios).toEqual([
      { position: { fraction: [0, 1] }, span: { start: event.id, end: event.id } },
    ]);
  });

  it("converts paired MusicXML glissandos to the Viritura extension", () => {
    const xml = wrapScore(`
      <note>
        <pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>half</type>
        <notations><glissando type="start" number="1" line-type="wavy">gliss.</glissando></notations>
      </note>
      <note>
        <pitch><step>G</step><octave>5</octave></pitch><duration>2</duration><type>half</type>
        <notations><glissando type="stop" number="1"/></notations>
      </note>
    `);

    const content = convertMusicXmlToMnx(xml, { includeVendorExtensions: true }).parts[0]!.measures[0]!.sequences![0]!
      .content;
    const start = content[0]! as { _x?: { viritura: { glissandos?: unknown[] } } };
    const end = content[1]! as { id?: string };

    expect(start._x?.viritura.glissandos).toEqual([{ target: end.id, style: "wavy", text: "gliss." }]);
  });

  it("reports glissando loss when Viritura extensions are disabled", () => {
    const xml = wrapScore(`
      <note>
        <pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>half</type>
        <notations><glissando type="start" number="1"/></notations>
      </note>
      <note>
        <pitch><step>G</step><octave>5</octave></pitch><duration>2</duration><type>half</type>
        <notations><glissando type="stop" number="1"/></notations>
      </note>
    `);
    const diagnostics = new DiagnosticCollector();

    convertMusicXmlToMnx(xml, { diagnostics });

    expect(diagnostics.all().map((diagnostic) => diagnostic.code)).toContain("musicxml-glissando");
  });

  it("converts single tremolo as native MNX", () => {
    const xml = wrapScore(`
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
        <notations><ornaments><tremolo type="single">3</tremolo></ornaments></notations>
      </note>
    `);
    const event = convertMusicXmlToMnx(xml).parts[0]!.measures[0]!.sequences![0]!.content[0]! as {
      markings: { tremolo: { marks: number } };
    };
    expect(event.markings.tremolo).toEqual({ marks: 3 });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Tempo
// ═══════════════════════════════════════════════════════════════════════

describe("convertMusicXmlToMnx — tempo", () => {
  it("converts metronome tempo", () => {
    const xml = wrapScore(`
      <direction>
        <direction-type>
          <metronome>
            <beat-unit>quarter</beat-unit>
            <per-minute>120</per-minute>
          </metronome>
        </direction-type>
      </direction>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
      </note>
    `);
    const result = convertMusicXmlToMnx(xml);
    expect(result.global.measures[0]!.tempos![0]!.bpm).toBe(120);
    expect(result.global.measures[0]!.tempos![0]!.value).toEqual({ base: "quarter" });
  });

  it("converts tempo from sound element", () => {
    const xml = wrapScore(`
      <direction>
        <direction-type><words>Allegro</words></direction-type>
        <sound tempo="132"/>
      </direction>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
      </note>
    `);
    const result = convertMusicXmlToMnx(xml);
    expect(result.global.measures[0]!.tempos![0]!.bpm).toBe(132);
  });

  it("preserves a fractional tempo from a sound element", () => {
    const xml = wrapScore(`
      <direction>
        <direction-type><words>Moderato</words></direction-type>
        <sound tempo="116.5"/>
      </direction>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
      </note>
    `);
    const result = convertMusicXmlToMnx(xml);
    expect(result.global.measures[0]!.tempos![0]!.bpm).toBe(116.5);
  });

  it("converts bare <sound tempo> directly under <measure>", () => {
    // Some exporters emit a bare `<sound tempo="…"/>` as a direct child of
    // `<measure>` (not wrapped in `<direction>`). It must still apply tempo.
    const xml = wrapScore(`
      <sound tempo="92"/>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
      </note>
    `);
    const result = convertMusicXmlToMnx(xml);
    expect(result.global.measures[0]!.tempos![0]!.bpm).toBe(92);
    expect(result.global.measures[0]!.tempos![0]!.value).toEqual({ base: "quarter" });
  });

  it("converts dotted beat-unit tempo", () => {
    const xml = wrapScore(`
      <direction>
        <direction-type>
          <metronome>
            <beat-unit>quarter</beat-unit>
            <beat-unit-dot/>
            <per-minute>80</per-minute>
          </metronome>
        </direction-type>
      </direction>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
      </note>
    `);
    const result = convertMusicXmlToMnx(xml);
    expect(result.global.measures[0]!.tempos![0]!.bpm).toBe(80);
    expect(result.global.measures[0]!.tempos![0]!.value).toEqual({ base: "quarter", dots: 1 });
  });

  it("attaches tempo-text directive to the measure tempo (vendor ext)", () => {
    // Tempo value (bare <sound tempo>) and its textual description
    // (<direction directive="yes"><words>) arrive as separate elements; the
    // text must ride along on the tempo as `_x.viritura.text`.
    const xml = wrapScore(`
      <sound tempo="80"/>
      <direction placement="above" directive="yes">
        <direction-type><words>Molto moderato</words></direction-type>
      </direction>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
      </note>
    `);
    const result = convertMusicXmlToMnx(xml, { includeVendorExtensions: true });
    const tempo = result.global.measures[0]!.tempos![0]!;
    expect(tempo.bpm).toBe(80);
    expect(tempo._x).toEqual({ viritura: { text: "Molto moderato" } });
    // The directive text must NOT also be emitted as a staff text expression.
    const measure = result.parts[0]!.measures[0]! as unknown as Record<string, unknown>;
    const ext = measure._x as { viritura?: Record<string, unknown> } | undefined;
    expect(ext?.viritura?.["expressions"]).toBeUndefined();
  });

  it("omits tempo-text directive when vendor extensions are disabled", () => {
    const xml = wrapScore(`
      <sound tempo="80"/>
      <direction placement="above" directive="yes">
        <direction-type><words>Molto moderato</words></direction-type>
      </direction>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
      </note>
    `);
    const result = convertMusicXmlToMnx(xml);
    expect(result.global.measures[0]!.tempos![0]!._x).toBeUndefined();
  });

  it("hides the metronome mark when tempo text is present and the flag is on", () => {
    // A written tempo text plus a numeric metronome mark. With the
    // hide-metronome option on, the bpm stays for playback but the engraved
    // metronome mark is suppressed (`showMetronomeMark: false`), leaving the
    // text alone — the convention for text-only repertoire.
    const xml = wrapScore(`
      <direction placement="above" directive="yes">
        <direction-type><words>Molto moderato</words></direction-type>
        <direction-type>
          <metronome>
            <beat-unit>quarter</beat-unit>
            <per-minute>80</per-minute>
          </metronome>
        </direction-type>
      </direction>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
      </note>
    `);
    const result = convertMusicXmlToMnx(xml, {
      includeVendorExtensions: true,
      hideMetronomeWhenTempoText: true,
    });
    const tempo = result.global.measures[0]!.tempos![0]!;
    expect(tempo.bpm).toBe(80);
    expect(tempo._x).toEqual({
      viritura: { text: "Molto moderato", showMetronomeMark: false },
    });
  });

  it("keeps the metronome mark when tempo text is present but the flag is off", () => {
    const xml = wrapScore(`
      <direction placement="above" directive="yes">
        <direction-type><words>Molto moderato</words></direction-type>
        <direction-type>
          <metronome>
            <beat-unit>quarter</beat-unit>
            <per-minute>80</per-minute>
          </metronome>
        </direction-type>
      </direction>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
      </note>
    `);
    const result = convertMusicXmlToMnx(xml, { includeVendorExtensions: true });
    const tempo = result.global.measures[0]!.tempos![0]!;
    expect(tempo.bpm).toBe(80);
    expect(tempo._x).toEqual({ viritura: { text: "Molto moderato" } });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Rehearsal marks
// ═══════════════════════════════════════════════════════════════════════

describe("convertMusicXmlToMnx — rehearsal marks", () => {
  it("trims surrounding whitespace from rehearsal mark text", () => {
    const xml = wrapScore(`
      <direction placement="above">
        <direction-type><rehearsal enclosure="rectangle">1  </rehearsal></direction-type>
      </direction>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
      </note>
    `);
    const result = convertMusicXmlToMnx(xml, { includeVendorExtensions: true });
    const global = result.global.measures[0]! as unknown as Record<string, unknown>;
    const ext = global._x as { viritura?: Record<string, unknown> } | undefined;
    expect(ext?.viritura?.["rehearsalMark"]).toEqual({ text: "1" });
  });
});

describe("convertMusicXmlToMnx — lyrics", () => {
  it("converts single-verse lyrics", () => {
    const xml = wrapScore(`
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>1</duration>
        <type>quarter</type>
        <lyric number="1"><syllabic>single</syllabic><text>Hel</text></lyric>
      </note>
      <note>
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>1</duration>
        <type>quarter</type>
        <lyric number="1"><syllabic>single</syllabic><text>lo</text></lyric>
      </note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration><type>half</type></note>
    `);

    const result = convertMusicXmlToMnx(xml);
    const content = result.parts[0]!.measures[0]!.sequences![0]!.content;
    const ev0 = content[0]! as { lyrics: { lines: Record<string, { text: string }> } };
    expect(ev0.lyrics.lines["line-1"]!.text).toBe("Hel");
    expect(result.global.lyrics).toBeDefined();
    expect(result.global.lyrics!.lineOrder).toContain("line-1");
  });

  it("converts syllabic begin/end types", () => {
    const xml = wrapScore(`
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>2</duration>
        <type>half</type>
        <lyric number="1"><syllabic>begin</syllabic><text>Hel</text></lyric>
      </note>
      <note>
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>2</duration>
        <type>half</type>
        <lyric number="1"><syllabic>end</syllabic><text>lo</text></lyric>
      </note>
    `);

    const result = convertMusicXmlToMnx(xml);
    const content = result.parts[0]!.measures[0]!.sequences![0]!.content;
    const ev0 = content[0]! as { lyrics: { lines: Record<string, { type: string }> } };
    expect(ev0.lyrics.lines["line-1"]!.type).toBe("start");
    const ev1 = content[1]! as { lyrics: { lines: Record<string, { type: string }> } };
    expect(ev1.lyrics.lines["line-1"]!.type).toBe("end");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Repeats, endings, navigation
// ═══════════════════════════════════════════════════════════════════════

describe("convertMusicXmlToMnx — repeats", () => {
  it("converts repeat barlines", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>T</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <barline location="left"><repeat direction="forward"/></barline>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
      <barline location="right"><repeat direction="backward"/></barline>
    </measure>
  </part>
</score-partwise>`;
    const result = convertMusicXmlToMnx(xml);
    expect(result.global.measures[0]!.repeatStart).toBeDefined();
    expect(result.global.measures[0]!.repeatEnd).toBeDefined();
  });

  it("converts volta endings", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>T</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <barline location="left"><ending number="1" type="start"/></barline>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
      <barline location="right"><ending number="1" type="stop"/><repeat direction="backward"/></barline>
    </measure>
    <measure number="2">
      <barline location="left"><ending number="2" type="start"/></barline>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
      <barline location="right"><ending number="2" type="stop"/></barline>
    </measure>
  </part>
</score-partwise>`;
    const result = convertMusicXmlToMnx(xml);
    expect(result.global.measures[0]!.ending!.numbers).toContain(1);
    expect(result.global.measures[0]!.ending!.duration).toBe(1);
    expect(result.global.measures[1]!.ending!.numbers).toContain(2);
  });
});

describe("convertMusicXmlToMnx — navigation", () => {
  it("converts segno", () => {
    const xml = wrapScore(`
      <direction><direction-type><segno/></direction-type></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    `);
    expect(convertMusicXmlToMnx(xml).global.measures[0]!.segno).toBeDefined();
  });

  it("converts coda to a Viritura extension without creating a segno", () => {
    const xml = wrapScore(`
      <direction><direction-type><coda smufl="codaSquare" color="#CC0000"/></direction-type></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    `);

    const measure = convertMusicXmlToMnx(xml, { includeVendorExtensions: true }).global.measures[0]!;

    expect(measure._x?.viritura.coda).toEqual({
      location: { fraction: [0, 1] },
      glyph: "codaSquare",
      color: "#cc0000",
    });
    expect(measure.segno).toBeUndefined();
  });

  it("reports coda loss when Viritura extensions are disabled", () => {
    const xml = wrapScore(`
      <direction><direction-type><coda/></direction-type></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    `);
    const diagnostics = new DiagnosticCollector();

    const result = convertMusicXmlToMnx(xml, { diagnostics });

    expect(result.global.measures[0]!._x?.viritura.coda).toBeUndefined();
    expect(diagnostics.all().map((diagnostic) => diagnostic.code)).toContain("musicxml-coda");
  });

  it("converts fine", () => {
    const xml = wrapScore(`
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
      <direction><direction-type><words>Fine</words></direction-type><sound fine="yes"/></direction>
    `);
    expect(convertMusicXmlToMnx(xml).global.measures[0]!.fine).toBeDefined();
  });

  it("converts D.C. al Fine", () => {
    const xml = wrapScore(`
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
      <direction><direction-type><words>D.C. al Fine</words></direction-type><sound dacapo="yes"/></direction>
    `);
    const result = convertMusicXmlToMnx(xml);
    expect(result.global.measures[0]!.jump!.type).toBe("dsalfine");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Forward (time skip) → space
// ═══════════════════════════════════════════════════════════════════════

describe("convertMusicXmlToMnx — forward skips", () => {
  it("converts a <forward>-only measure into a space sequence (not a bare measure)", () => {
    // A bar whose entire content is a <forward> skip (no note/rest) is legal
    // MusicXML — e.g. an unpitched cue staff that rests for the bar. The MNX
    // analogue is a `space` element, so the measure must still carry sequences.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Cue</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>16</duration>
        <type>whole</type>
      </note>
    </measure>
    <measure number="2">
      <forward><duration>16</duration></forward>
    </measure>
  </part>
</score-partwise>`;

    const result = convertMusicXmlToMnx(xml);
    const measure2 = result.parts[0]!.measures[1]!;
    expect(measure2.sequences).toHaveLength(1);

    const space = measure2.sequences![0]!.content[0]! as { type: string; duration: [number, number] };
    expect(space.type).toBe("space");
    // 16 divisions / (4 divisions per quarter × 4) = a whole note → 1/1.
    expect(space.duration).toEqual([1, 1]);
  });

  it("drops a phantom space-only voice when a real voice coexists in the bar", () => {
    // A backup+forward idiom can leave a second voice holding only a `space`
    // placeholder (no real notes). When a real voice fills the bar, the
    // phantom voice must be dropped rather than emitted as an empty slot.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><voice>1</voice><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note>
      <backup><duration>16</duration></backup>
      <forward><voice>2</voice><duration>4</duration></forward>
    </measure>
  </part>
</score-partwise>`;
    const result = convertMusicXmlToMnx(xml);
    const sequences = result.parts[0]!.measures[0]!.sequences!;
    // Only the real voice survives; the space-only voice 2 is dropped.
    expect(sequences).toHaveLength(1);
    expect(sequences[0]!.content.every((c) => !("type" in c && c.type === "space"))).toBe(true);
  });

  it("emits a space for a mid-measure forward gap", () => {
    const xml = wrapScore(`
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>1</duration>
        <type>quarter</type>
      </note>
      <forward><duration>1</duration></forward>
      <note>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>1</duration>
        <type>quarter</type>
      </note>
    `);

    const content = convertMusicXmlToMnx(xml).parts[0]!.measures[0]!.sequences![0]!.content;
    const space = content.find((c) => "type" in c && (c as { type?: string }).type === "space") as
      | { type: string; duration: [number, number] }
      | undefined;
    expect(space).toBeDefined();
    // 1 division / (1 division per quarter × 4) = a quarter note → 1/4.
    expect(space!.duration).toEqual([1, 4]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Multi-staff, transposition, beams
// ═══════════════════════════════════════════════════════════════════════

describe("convertMusicXmlToMnx — multi-staff", () => {
  it("handles piano grand staff", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions><key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>whole</type><voice>1</voice><staff>1</staff></note>
      <backup><duration>4</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><type>whole</type><voice>2</voice><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;
    const result = convertMusicXmlToMnx(xml);
    expect(result.parts[0]!.staves).toBe(2);
    expect(result.parts[0]!.measures[0]!.clefs).toHaveLength(2);
    const layout = result.layouts![0]!;
    const group = layout.content[0]! as { type: string; symbol: string };
    expect(group.type).toBe("group");
    expect(group.symbol).toBe("brace");
  });

  it("prunes declared staves that no note uses (divisi ossia staff)", () => {
    // A part can declare `<staves>2</staves>` (e.g. for string divisi) while
    // writing every voice on staff 1, leaving an empty ossia staff. The
    // converter should clamp to the staves actually used.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Violin I</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions><key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><type>whole</type><voice>1</voice><staff>1</staff></note>
      <backup><duration>4</duration></backup>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>4</duration><type>whole</type><voice>2</voice><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>`;
    const result = convertMusicXmlToMnx(xml);
    expect(result.parts[0]!.staves).toBeUndefined();
  });
});

describe("convertMusicXmlToMnx — multimeasure rests", () => {
  // Two parts: P1 always has a whole note; P2's content varies per test.
  function twoPartScore(p2Measures: string[], p1AttrsByMeasure: Record<number, string> = {}): string {
    const wholeNote = `<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>`;
    const wholeRest = `<note><rest measure="yes"/><duration>4</duration><type>whole</type></note>`;
    const baseAttrs = `<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>`;
    const p1 = p2Measures
      .map(
        (_, i) =>
          `<measure number="${i + 1}">${i === 0 ? baseAttrs : (p1AttrsByMeasure[i] ?? "")}${wholeNote}</measure>`,
      )
      .join("");
    const p2 = p2Measures
      .map((m, i) => `<measure number="${i + 1}">${i === 0 ? baseAttrs : ""}${m === "rest" ? wholeRest : m}</measure>`)
      .join("");
    return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Flute</part-name></score-part>
    <score-part id="P2"><part-name>Oboe</part-name></score-part>
  </part-list>
  <part id="P1">${p1}</part>
  <part id="P2">${p2}</part>
</score-partwise>`;
  }

  it("collapses a run of empty measures in a player part", () => {
    const xml = twoPartScore(["rest", "rest", "rest", "rest"]);
    const result = convertMusicXmlToMnx(xml);
    const p2Score = result.scores!.find((s) => s.layout === "part-P2")!;
    expect(p2Score.multimeasureRests).toEqual([{ start: result.global.measures[0]!.id, duration: 4 }]);
  });

  it("does not consolidate the full score", () => {
    const xml = twoPartScore(["rest", "rest", "rest", "rest"]);
    const result = convertMusicXmlToMnx(xml);
    const full = result.scores!.find((s) => s.layout === "full-score")!;
    expect(full.multimeasureRests).toBeUndefined();
  });

  it("breaks the run at a key change", () => {
    // Key change at measure 3 (driven by P1) must split the rest run.
    const xml = twoPartScore(["rest", "rest", "rest", "rest"], {
      2: `<attributes><key><fifths>2</fifths></key></attributes>`,
    });
    const result = convertMusicXmlToMnx(xml);
    const p2Score = result.scores!.find((s) => s.layout === "part-P2")!;
    expect(p2Score.multimeasureRests).toEqual([
      { start: result.global.measures[0]!.id, duration: 2 },
      { start: result.global.measures[2]!.id, duration: 2 },
    ]);
  });

  it("does not emit a multimeasure rest for a single empty measure", () => {
    const xml = twoPartScore([
      "rest",
      `<note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>`,
    ]);
    const result = convertMusicXmlToMnx(xml);
    const p2Score = result.scores!.find((s) => s.layout === "part-P2")!;
    expect(p2Score.multimeasureRests).toBeUndefined();
  });
});

describe("convertMusicXmlToMnx — transposition", () => {
  it("converts Bb clarinet: flips interval sign and stores sounding pitch", () => {
    // Bb clarinet: MusicXML transpose chromatic=-2, diatonic=-1 means
    // (written → sounding) is down a major 2nd. Written D4 sounds as C4.
    // MNX must store the sounding pitch and an inverted interval (+2 / +1).
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Clarinet in Bb</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
        <transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>
      </attributes>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`;
    const result = convertMusicXmlToMnx(xml);
    expect(result.parts[0]!.transposition).toEqual({
      interval: { halfSteps: 2, staffDistance: 1 },
    });
    const event = result.parts[0]!.measures[0]!.sequences![0]!.content[0]! as {
      notes: { pitch: { step: string; octave: number; alter?: number } }[];
    };
    expect(event.notes![0]!.pitch).toEqual({ step: "C", octave: 4 });
  });

  it("Bb clarinet written C4 sounds as Bb3", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Clarinet in Bb</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
        <transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`;
    const result = convertMusicXmlToMnx(xml);
    const event = result.parts[0]!.measures[0]!.sequences![0]!.content[0]! as {
      notes: { pitch: { step: string; octave: number; alter?: number } }[];
    };
    expect(event.notes![0]!.pitch).toEqual({ step: "B", octave: 3, alter: -1 });
  });

  it("Horn in F: written G4 sounds as C4, interval halfSteps=+7 staffDistance=+4", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Horn in F</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
        <transpose><diatonic>-4</diatonic><chromatic>-7</chromatic></transpose>
      </attributes>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`;
    const result = convertMusicXmlToMnx(xml);
    expect(result.parts[0]!.transposition).toEqual({
      interval: { halfSteps: 7, staffDistance: 4 },
    });
    const event = result.parts[0]!.measures[0]!.sequences![0]!.content[0]! as {
      notes: { pitch: { step: string; octave: number; alter?: number } }[];
    };
    expect(event.notes![0]!.pitch).toEqual({ step: "C", octave: 4 });
  });

  it("respects octave-change: bass clarinet written C4 sounds as Bb2", () => {
    // Bass clarinet in Bb: chromatic=-2, diatonic=-1, octave-change=-1.
    // Written C4 → sounding Bb2.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Bass Clarinet</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
        <transpose><diatonic>-1</diatonic><chromatic>-2</chromatic><octave-change>-1</octave-change></transpose>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`;
    const result = convertMusicXmlToMnx(xml);
    expect(result.parts[0]!.transposition).toEqual({
      interval: { halfSteps: 14, staffDistance: 8 },
    });
    const event = result.parts[0]!.measures[0]!.sequences![0]!.content[0]! as {
      notes: { pitch: { step: string; octave: number; alter?: number } }[];
    };
    expect(event.notes![0]!.pitch).toEqual({ step: "B", octave: 2, alter: -1 });
  });

  it("piccolo (octave up) sets prefersWrittenPitches", () => {
    // Piccolo: chromatic=0, diatonic=0, octave-change=1 — a pure-octave
    // transposer that should stay at written pitch even in a concert score.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piccolo</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
        <transpose><diatonic>0</diatonic><chromatic>0</chromatic><octave-change>1</octave-change></transpose>
      </attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`;
    const result = convertMusicXmlToMnx(xml);
    expect(result.parts[0]!.transposition).toEqual({
      interval: { halfSteps: -12, staffDistance: -7 },
      prefersWrittenPitches: true,
    });
  });

  it("double bass (octave down) sets prefersWrittenPitches", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Double Bass</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>F</sign><line>4</line></clef>
        <transpose><diatonic>0</diatonic><chromatic>0</chromatic><octave-change>-1</octave-change></transpose>
      </attributes>
      <note><pitch><step>E</step><octave>2</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`;
    const result = convertMusicXmlToMnx(xml);
    expect(result.parts[0]!.transposition).toEqual({
      interval: { halfSteps: 12, staffDistance: 7 },
      prefersWrittenPitches: true,
    });
  });
});

describe("convertMusicXmlToMnx — beams", () => {
  it("creates beam groups", () => {
    const xml = wrapScore(
      `
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>eighth</type><beam number="1">begin</beam></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>eighth</type><beam number="1">continue</beam></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>eighth</type><beam number="1">end</beam></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    `,
      { divisions: 2 },
    );
    const measure = convertMusicXmlToMnx(xml).parts[0]!.measures[0]!;
    expect(measure.beams).toBeDefined();
    expect(measure.beams![0]!.events).toHaveLength(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Wedges (standard gradual dynamic groups), slurs, metadata, time display
// ═══════════════════════════════════════════════════════════════════════

describe("convertMusicXmlToMnx — wedges", () => {
  it("preserves wedges when vendor extensions are disabled", () => {
    const xml = wrapScore(`
      <direction><direction-type><wedge type="crescendo"/></direction-type></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>half</type></note>
      <direction><direction-type><wedge type="stop"/></direction-type></direction>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>2</duration><type>half</type></note>
    `);
    const measure = convertMusicXmlToMnx(xml).parts[0]!.measures[0]!;
    expect(measure.dynamics).toHaveLength(1);
    expect(measure.dynamics![0]).toMatchObject({ type: "gradual", wedgeType: "increasing" });
  });

  it("pairs crescendo + stop into a single hairpin span with an end position", () => {
    const xml = wrapScore(`
      <direction><direction-type><wedge type="crescendo"/></direction-type></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>half</type></note>
      <direction><direction-type><wedge type="stop"/></direction-type></direction>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>2</duration><type>half</type></note>
    `);
    const score = convertMusicXmlToMnx(xml, { includeVendorExtensions: true });
    const measure = score.parts[0]!.measures[0]!;
    const measureId = score.global.measures[0]!.id;
    const hairpins = measure.dynamics!.filter((group) => group.type === "gradual");
    expect(hairpins).toHaveLength(1);
    expect(hairpins[0]!.wedgeType).toBe("increasing");
    expect(hairpins[0]!.end!.measure).toBe(measureId);
  });

  it("maps diminuendo wedges to decrescendo hairpins", () => {
    const xml = wrapScore(`
      <direction><direction-type><wedge type="diminuendo"/></direction-type></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>half</type></note>
      <direction><direction-type><wedge type="stop"/></direction-type></direction>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>2</duration><type>half</type></note>
    `);
    const measure = convertMusicXmlToMnx(xml, { includeVendorExtensions: true }).parts[0]!.measures[0]!;
    const hairpins = measure.dynamics!.filter((group) => group.type === "gradual");
    expect(hairpins[0]!.wedgeType).toBe("decreasing");
  });

  it("pairs pedal start + stop into a single sustain pedal span", () => {
    const xml = wrapScore(`
      <direction><direction-type><pedal type="start"/></direction-type></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>half</type></note>
      <direction><direction-type><pedal type="stop"/></direction-type></direction>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>2</duration><type>half</type></note>
    `);
    const measure = convertMusicXmlToMnx(xml, { includeVendorExtensions: true }).parts[0]!.measures[0]!;
    const ext = (measure as unknown as Record<string, unknown>)._x as { viritura: Record<string, unknown> };
    const pedals = ext.viritura["pedals"] as { type: string; end: { measure: string } }[];
    expect(pedals).toHaveLength(1);
    expect(pedals[0]!.type).toBe("sustain");
    expect(pedals[0]!.end).toBeDefined();
  });

  it("emits standalone words as text expressions with placement", () => {
    const xml = wrapScore(`
      <direction placement="above"><direction-type><words>dolce</words></direction-type></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    `);
    const measure = convertMusicXmlToMnx(xml, { includeVendorExtensions: true }).parts[0]!.measures[0]!;
    const ext = (measure as unknown as Record<string, unknown>)._x as { viritura: Record<string, unknown> };
    const expressions = ext.viritura["expressions"] as { text: string; placement?: string }[];
    expect(expressions).toHaveLength(1);
    expect(expressions[0]!.text).toBe("dolce");
    expect(expressions[0]!.placement).toBe("above");
  });

  it("dedupes identical words repeated across direction-types in one direction", () => {
    // Some exporters emit a single <direction> with two <direction-type>
    // children carrying the identical <words> (e.g. "pizz."). Only one staff
    // text expression should result, not a duplicate.
    const xml = wrapScore(`
      <direction placement="above">
        <direction-type><words>pizz.</words></direction-type>
        <direction-type><words>pizz.</words></direction-type>
      </direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    `);
    const measure = convertMusicXmlToMnx(xml, { includeVendorExtensions: true }).parts[0]!.measures[0]!;
    const ext = (measure as unknown as Record<string, unknown>)._x as { viritura: Record<string, unknown> };
    const expressions = ext.viritura["expressions"] as { text: string }[];
    expect(expressions).toHaveLength(1);
    expect(expressions[0]!.text).toBe("pizz.");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Octave shifts (8va / 8vb) — first-class MNX `ottavas`, paired across
// measures at the part level (regression: stops in a later measure were
// dropped, leaving the span pointing back at its own start position).
// ═══════════════════════════════════════════════════════════════════════

type OttavaSpan = {
  value: number;
  position: { fraction: [number, number] };
  end: { measure: string; position: { fraction: [number, number] } };
  staff?: number;
};

describe("convertMusicXmlToMnx — octave shifts", () => {
  it("pairs an octave-shift start + stop within a single measure", () => {
    // "down" octave-shift sounds an octave higher → 8va (value 1).
    const xml = wrapScore(`
      <direction><direction-type><octave-shift type="down" size="8"/></direction-type></direction>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration><type>half</type></note>
      <direction><direction-type><octave-shift type="stop" size="8"/></direction-type></direction>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>2</duration><type>half</type></note>
    `);
    const score = convertMusicXmlToMnx(xml);
    const measure = score.parts[0]!.measures[0]!;
    const measureId = score.global.measures[0]!.id;
    const ottavas = measure.ottavas as OttavaSpan[] | undefined;
    expect(ottavas).toHaveLength(1);
    expect(ottavas![0]!.value).toBe(1);
    expect(ottavas![0]!.position.fraction).toEqual([0, 1]);
    // Stop lands after a half note → end at 1/2 of this same measure.
    expect(ottavas![0]!.end.measure).toBe(measureId);
    expect(ottavas![0]!.end.position.fraction).toEqual([1, 2]);
  });

  it("pairs an octave-shift whose stop is in a later measure", () => {
    // The shift opens in measure 1 and closes in measure 2. Before the fix the
    // stop (in a fresh measure) was dropped and the start kept a bogus end at
    // measure 1, position 0 — making the span collapse to nothing.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Test</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef></attributes>
      <direction><direction-type><octave-shift type="down" size="8"/></direction-type></direction>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure>
    <measure number="2">
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>2</duration><type>half</type></note>
      <direction><direction-type><octave-shift type="stop" size="8"/></direction-type></direction>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>2</duration><type>half</type></note>
    </measure>
  </part>
</score-partwise>`;
    const score = convertMusicXmlToMnx(xml);
    const startMeasure = score.parts[0]!.measures[0]!;
    const m2Id = score.global.measures[1]!.id;
    const ottavas = startMeasure.ottavas as OttavaSpan[] | undefined;
    // The completed span is attached to its START measure (measure 1).
    expect(ottavas).toHaveLength(1);
    expect(ottavas![0]!.value).toBe(1);
    expect(ottavas![0]!.position.fraction).toEqual([0, 1]);
    // …but its end points into measure 2 at the half-note offset.
    expect(ottavas![0]!.end.measure).toBe(m2Id);
    expect(ottavas![0]!.end.position.fraction).toEqual([1, 2]);
    // The stop measure itself carries no ottava span.
    expect(score.parts[0]!.measures[1]!.ottavas).toBeUndefined();
  });

  it("maps size 15 to a two-octave shift and `up` to a negative value", () => {
    const xml = wrapScore(`
      <direction><direction-type><octave-shift type="up" size="15"/></direction-type></direction>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>2</duration><type>half</type></note>
      <direction><direction-type><octave-shift type="stop" size="15"/></direction-type></direction>
      <note><pitch><step>D</step><octave>3</octave></pitch><duration>2</duration><type>half</type></note>
    `);
    const measure = convertMusicXmlToMnx(xml).parts[0]!.measures[0]!;
    const ottavas = measure.ottavas as OttavaSpan[] | undefined;
    expect(ottavas).toHaveLength(1);
    expect(ottavas![0]!.value).toBe(-2);
  });
});

describe("convertMusicXmlToMnx — slurs", () => {
  it("converts slur start with target and side", () => {
    const xml = wrapScore(`
      <note>
        <pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>half</type>
        <notations><slur type="start" number="1" placement="above"/></notations>
      </note>
      <note>
        <pitch><step>D</step><octave>4</octave></pitch><duration>2</duration><type>half</type>
        <notations><slur type="stop" number="1"/></notations>
      </note>
    `);
    const content = convertMusicXmlToMnx(xml).parts[0]!.measures[0]!.sequences![0]!.content;
    const ev0 = content[0]! as { slurs: { target: string; side: string }[] };
    expect(ev0.slurs[0]!.target).toBeDefined();
    expect(ev0.slurs[0]!.side).toBe("up");
  });

  it("slur target matches stop event ID", () => {
    const xml = wrapScore(`
      <note>
        <pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>half</type>
        <notations><slur type="start" number="1"/></notations>
      </note>
      <note>
        <pitch><step>D</step><octave>4</octave></pitch><duration>2</duration><type>half</type>
        <notations><slur type="stop" number="1"/></notations>
      </note>
    `);
    const content = convertMusicXmlToMnx(xml).parts[0]!.measures[0]!.sequences![0]!.content;
    const ev0 = content[0]! as { slurs: { target: string }[]; id?: string };
    const ev1 = content[1]! as { id?: string };
    expect(ev0.slurs[0]!.target).toBe(ev1.id);
  });

  it("cross-measure slur pairs correctly", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>T</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type>
        <notations><slur type="start" number="1"/></notations>
      </note>
    </measure>
    <measure number="2">
      <note>
        <pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>whole</type>
        <notations><slur type="stop" number="1"/></notations>
      </note>
    </measure>
  </part>
</score-partwise>`;
    const mnx = convertMusicXmlToMnx(xml);
    const m0content = mnx.parts[0]!.measures[0]!.sequences![0]!.content;
    const m1content = mnx.parts[0]!.measures[1]!.sequences![0]!.content;
    const startEv = m0content[0]! as { slurs: { target: string }[] };
    const stopEv = m1content[0]! as { id?: string };
    expect(startEv.slurs[0]!.target).toBe(stopEv.id);
  });

  it("slur starting on a grace note targets the following principal note", () => {
    const xml = wrapScore(`
      <note>
        <grace slash="yes"/>
        <pitch><step>B</step><octave>4</octave></pitch><type>eighth</type>
        <notations><slur type="start" number="1"/></notations>
      </note>
      <note>
        <pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>whole</type>
        <notations><slur type="stop" number="1"/></notations>
      </note>
    `);
    const content = convertMusicXmlToMnx(xml).parts[0]!.measures[0]!.sequences![0]!.content;
    const grace = content[0]! as { type: string; content: { slurs?: { target: string }[] }[] };
    const principal = content[1]! as { id?: string };
    expect(grace.type).toBe("grace");
    expect(grace.content[0]!.slurs?.[0]!.target).toBe(principal.id);
  });

  it("slur stopping on a grace note resolves to the grace event ID", () => {
    const xml = wrapScore(`
      <note>
        <pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>whole</type>
        <notations><slur type="start" number="1"/></notations>
      </note>
      <note>
        <grace slash="yes"/>
        <pitch><step>B</step><octave>4</octave></pitch><type>eighth</type>
        <notations><slur type="stop" number="1"/></notations>
      </note>
    `);
    const content = convertMusicXmlToMnx(xml).parts[0]!.measures[0]!.sequences![0]!.content;
    const principal = content[0]! as { slurs: { target: string }[] };
    const grace = content[1]! as { type: string; content: { id?: string }[] };
    expect(grace.type).toBe("grace");
    expect(principal.slurs[0]!.target).toBe(grace.content[0]!.id);
  });
});

describe("convertMusicXmlToMnx — metadata", () => {
  it("extracts composer and title", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <identification><creator type="composer">J.S. Bach</creator></identification>
  <part-list><score-part id="P1"><part-name>T</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`;
    const ext = (
      convertMusicXmlToMnx(xml, { includeVendorExtensions: true }) as unknown as {
        _x: { viritura: { metadata: Record<string, string> } };
      }
    )._x;
    expect(ext.viritura.metadata.composer).toBe("J.S. Bach");
  });
});

describe("convertMusicXmlToMnx — chord symbols", () => {
  it("converts a positioned major-seventh slash chord", () => {
    const xml = wrapScore(
      `
      <harmony>
        <root><root-step>F</root-step><root-alter>1</root-alter></root>
        <kind>major-seventh</kind>
        <bass><bass-step>A</bass-step><bass-alter>1</bass-alter></bass>
        <offset>2</offset>
      </harmony>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration><type>whole</type></note>
    `,
      { divisions: 2 },
    );

    const measure = convertMusicXmlToMnx(xml, { includeVendorExtensions: true }).parts[0]!.measures[0]!;

    expect(measure._x?.viritura.chordSymbols).toEqual([
      {
        position: { fraction: [1, 4] },
        root: { step: "F", alter: 1 },
        quality: "major",
        extension: 7,
        bass: { step: "A", alter: 1 },
      },
    ]);
  });

  it("reports MusicXML chord kinds outside the Viritura quality model", () => {
    const xml = wrapScore(`
      <harmony><root><root-step>C</root-step></root><kind>Neapolitan</kind></harmony>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    `);
    const diagnostics = new DiagnosticCollector();

    convertMusicXmlToMnx(xml, { includeVendorExtensions: true, diagnostics });

    expect(diagnostics.all().map((diagnostic) => diagnostic.code)).toContain("musicxml-harmony-kind");
  });
});

describe("convertMusicXmlToMnx — color", () => {
  it("preserves color on keys, clefs, segnos, and grace groups", () => {
    const xml = wrapScore(`
      <direction><direction-type><segno color="#3333AA"/></direction-type></direction>
      <note color="#AA6600">
        <grace slash="yes"/>
        <pitch><step>D</step><octave>5</octave></pitch><type>eighth</type>
      </note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>whole</type></note>
    `)
      .replace("<key>", '<key color="#228844">')
      .replace("<clef>", '<clef color="#AA2222">');

    const result = convertMusicXmlToMnx(xml);
    const grace = result.parts[0]!.measures[0]!.sequences![0]!.content[0] as { color?: string };

    expect(result.global.measures[0]!.key?.color).toBe("#228844");
    expect(result.global.measures[0]!.segno?.color).toBe("#3333aa");
    expect(result.parts[0]!.measures[0]!.clefs?.[0]?.clef.color).toBe("#aa2222");
    expect(grace.color).toBe("#aa6600");
  });

  it("preserves color on volta endings", () => {
    const xml = wrapScore(`
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
      <barline location="right"><ending number="1" type="start" color="#2244AA"/></barline>
    `);

    expect(convertMusicXmlToMnx(xml).global.measures[0]!.ending?.color).toBe("#2244aa");
  });
});

describe("convertMusicXmlToMnx — lossy diagnostics", () => {
  it("reports features with no implemented conversion target", () => {
    const xml = wrapScore(`
      <harmony><root><root-step>C</root-step></root><kind>major</kind></harmony>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
        <notations>
          <ornaments><shake/></ornaments>
          <glissando type="start" number="1"/>
          <slide type="start" number="1"/>
          <non-arpeggiate type="top"/>
        </notations>
      </note>
    `);
    const diagnostics = new DiagnosticCollector();

    convertMusicXmlToMnx(xml, { includeVendorExtensions: true, diagnostics });

    expect(diagnostics.all().map((diagnostic) => diagnostic.code)).toEqual(["musicxml-shake"]);
  });

  it("only recommends extensions for details they actually preserve", () => {
    const xml = wrapScore(`
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
        <notations>
          <ornaments><trill-mark/><shake/></ornaments>
          <articulations><caesura/></articulations>
        </notations>
      </note>
    `);
    const diagnostics = new DiagnosticCollector();

    convertMusicXmlToMnx(xml, { diagnostics });

    expect(diagnostics.all().map((diagnostic) => diagnostic.code)).toEqual([
      "musicxml-shake",
      "musicxml-trill",
      "musicxml-caesura",
    ]);
  });
});

describe("convertMusicXmlToMnx — time display", () => {
  it("handles common time symbol", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>T</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions><key><fifths>0</fifths></key>
        <time symbol="common"><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`;
    expect(convertMusicXmlToMnx(xml).global.measures[0]!.time).toEqual({ count: 4, unit: 4, display: "common" });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Layout grouping
// ═══════════════════════════════════════════════════════════════════════

describe("convertMusicXmlToMnx — layout", () => {
  it("builds layout with bracket groups", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <part-group type="start" number="1"><group-symbol>bracket</group-symbol></part-group>
    <score-part id="P1"><part-name>Flute</part-name></score-part>
    <score-part id="P2"><part-name>Oboe</part-name></score-part>
    <part-group type="stop" number="1"/>
    <score-part id="P3"><part-name>Violin I</part-name></score-part>
  </part-list>
  <part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><rest/><duration>4</duration><type>whole</type></note></measure></part>
  <part id="P2"><measure number="1"><attributes><divisions>1</divisions><clef><sign>G</sign><line>2</line></clef></attributes><note><rest/><duration>4</duration><type>whole</type></note></measure></part>
  <part id="P3"><measure number="1"><attributes><divisions>1</divisions><clef><sign>G</sign><line>2</line></clef></attributes><note><rest/><duration>4</duration><type>whole</type></note></measure></part>
</score-partwise>`;
    const layout = convertMusicXmlToMnx(xml).layouts![0]!;
    expect(layout.content).toHaveLength(2);
    expect(layout.content[0]!.type).toBe("group");
    expect((layout.content[0]! as { symbol: string }).symbol).toBe("bracket");
    expect(layout.content[1]!.type).toBe("staff");
  });

  it("auto-groups by instrument family", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Flute</part-name></score-part>
    <score-part id="P2"><part-name>Oboe</part-name></score-part>
    <score-part id="P3"><part-name>Violin I</part-name></score-part>
  </part-list>
  <part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><rest/><duration>4</duration><type>whole</type></note></measure></part>
  <part id="P2"><measure number="1"><attributes><divisions>1</divisions><clef><sign>G</sign><line>2</line></clef></attributes><note><rest/><duration>4</duration><type>whole</type></note></measure></part>
  <part id="P3"><measure number="1"><attributes><divisions>1</divisions><clef><sign>G</sign><line>2</line></clef></attributes><note><rest/><duration>4</duration><type>whole</type></note></measure></part>
</score-partwise>`;
    const layout = convertMusicXmlToMnx(xml).layouts![0]!;
    expect(layout.content).toHaveLength(2);
    expect(layout.content[0]!.type).toBe("group");
    expect(layout.content[1]!.type).toBe("staff");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Unpitched percussion → drum-kit
// ═══════════════════════════════════════════════════════════════════════

describe("convertMusicXmlToMnx — percussion", () => {
  /** Build a single percussion part (percussion clef) with the given notes. */
  function percussionScore(notes: string, instrumentSound?: string, partName = "Percussion"): string {
    const soundEl = instrumentSound
      ? `<score-instrument id="i1"><instrument-name>${partName}</instrument-name><instrument-sound>${instrumentSound}</instrument-sound></score-instrument>`
      : "";
    return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>${partName}</part-name>${soundEl}</score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>percussion</sign></clef></attributes>
      ${notes}
    </measure>
  </part>
</score-partwise>`;
  }

  it("converts pitched notes on a percussion clef into kit notes", () => {
    const xml = percussionScore(`
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><type>half</type></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><type>half</type></note>
    `);
    const result = convertMusicXmlToMnx(xml);
    const part = result.parts[0]!;
    expect(part.kit).toBeDefined();
    const content = part.measures[0]!.sequences![0]!.content;
    const ev0 = content[0]! as { notes?: unknown; kitNotes?: { kitComponent: string }[] };
    expect(ev0.notes).toBeUndefined();
    expect(ev0.kitNotes).toHaveLength(1);
    const compId = ev0.kitNotes![0]!.kitComponent;
    expect(part.kit![compId]).toBeDefined();
  });

  it("registers a global GM sound for each kit component", () => {
    const xml = percussionScore(
      `<note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>`,
      "wood.wood-block",
    );
    const result = convertMusicXmlToMnx(xml);
    const part = result.parts[0]!;
    const compId = Object.keys(part.kit!)[0]!;
    const soundId = part.kit![compId]!.sound!;
    expect(result.global.sounds).toBeDefined();
    // wood.wood-block → GM Hi Wood Block (76)
    expect(result.global.sounds![soundId]!.midiNumber).toBe(76);
  });

  it("requests review when percussion sounds are inferred only from staff position", () => {
    const reviews: import("../convert").PercussionImportReview[] = [];
    const xml = percussionScore(
      `<note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>`,
    );
    convertMusicXmlToMnx(xml, { percussionReviews: reviews });
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ partId: "P1", partName: "Percussion", confidence: "low" });
  });

  it("does not request review for a recognized MusicXML instrument sound", () => {
    const reviews: import("../convert").PercussionImportReview[] = [];
    const xml = percussionScore(
      `<note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>`,
      "wood.wood-block",
    );
    convertMusicXmlToMnx(xml, { percussionReviews: reviews });
    expect(reviews).toEqual([]);
  });

  it("derives staff position to match the engine's pitch placement (G4 → 0)", () => {
    const xml = percussionScore(
      `<note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>`,
    );
    const result = convertMusicXmlToMnx(xml);
    const part = result.parts[0]!;
    const comp = Object.values(part.kit!)[0]!;
    expect(comp.staffPosition).toBe(0);
  });

  it("creates one kit component per distinct staff position", () => {
    const xml = percussionScore(`
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration><type>half</type></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>2</duration><type>half</type></note>
    `);
    const result = convertMusicXmlToMnx(xml);
    const part = result.parts[0]!;
    expect(Object.keys(part.kit!)).toHaveLength(2);
  });

  it("does not touch pitched parts (no percussion clef)", () => {
    const xml = wrapScore(
      `<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>`,
    );
    const result = convertMusicXmlToMnx(xml);
    expect(result.parts[0]!.kit).toBeUndefined();
    expect(result.global.sounds).toBeUndefined();
    const ev0 = result.parts[0]!.measures[0]!.sequences![0]!.content[0]! as { notes?: unknown[] };
    expect(ev0.notes).toHaveLength(1);
  });

  it("maps a MusicXML <notehead> onto the kit-component vendor extension", () => {
    const xml = percussionScore(`
      <note><pitch><step>G</step><octave>5</octave></pitch><duration>4</duration><type>whole</type><notehead>x</notehead></note>
    `);
    const result = convertMusicXmlToMnx(xml);
    const comp = Object.values(result.parts[0]!.kit!)[0]!;
    expect(comp._x?.viritura.notehead).toBe("x");
  });

  it("separates same-line hits with different noteheads into distinct components", () => {
    const xml = percussionScore(`
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration><type>half</type></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration><type>half</type><notehead>x</notehead></note>
    `);
    const result = convertMusicXmlToMnx(xml);
    expect(Object.keys(result.parts[0]!.kit!)).toHaveLength(2);
  });

  it("preserves the written staff row when an octave <transpose> is present", () => {
    // Sibelius-style drum export: written F5 with a +2-octave transpose for
    // playback. The notehead must stay on F5's row, not jump to F7 (14 rows up).
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Percussion</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <clef><sign>percussion</sign></clef>
        <transpose><diatonic>0</diatonic><chromatic>0</chromatic><octave-change>2</octave-change></transpose>
      </attributes>
      <note><pitch><step>F</step><octave>5</octave></pitch><duration>4</duration><type>whole</type><notehead>x</notehead></note>
    </measure>
  </part>
</score-partwise>`;
    const result = convertMusicXmlToMnx(xml);
    const part = result.parts[0]!;
    const comp = Object.values(part.kit!)[0]!;
    // diatonic(F5) − G4_DIATONIC = 38 − 32 = 6 (would be 20 if transposed).
    expect(comp.staffPosition).toBe(6);
    // The kit part is not a transposing instrument once converted.
    expect(part.transposition).toBeUndefined();
  });
});
