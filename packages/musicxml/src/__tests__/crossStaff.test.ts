import { describe, expect, it } from "vitest";
import { convertMusicXmlToMnx } from "../convert/convertMusicXmlToMnx";
import type { MnxEvent } from "../types";

function pianoScore(measureBody: string): string {
  return `<?xml version="1.0"?>
  <score-partwise version="4.0">
    <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
    <part id="P1">
      <measure number="1">
        <attributes><divisions>1</divisions><staves>2</staves>
          <clef number="1"><sign>G</sign><line>2</line></clef>
          <clef number="2"><sign>F</sign><line>4</line></clef>
        </attributes>
        ${measureBody}
      </measure>
    </part>
  </score-partwise>`;
}

function note(step: string, staff: number): string {
  return `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type><voice>1</voice><staff>${staff}</staff></note>`;
}

function events(measureBody: string): MnxEvent[] {
  const mnx = convertMusicXmlToMnx(pianoScore(measureBody));
  const seq = mnx.parts[0]!.measures[0]!.sequences![0]!;
  return seq.content.filter((c): c is MnxEvent => !("type" in c && c.type)) as MnxEvent[];
}

describe("convertMusicXmlToMnx — cross-staff voices", () => {
  it("overrides staff only for notes that leave the voice's home staff", () => {
    // Voice 1 home staff = 1 (first note). One note dips to staff 2, then back.
    const [e0, e1, e2] = events(note("C", 1) + note("D", 2) + note("E", 1));
    expect(e0!.staff).toBeUndefined(); // home staff → no override
    expect(e1!.staff).toBe(2); // crosses down
    expect(e2!.staff).toBeUndefined(); // back to home staff
  });

  it("keeps staff-1 notes on staff 1 when the voice's home staff is 2", () => {
    // First note on staff 2 → sequence home staff is 2. A later staff-1 note
    // MUST carry an explicit staff override or it lands on staff 2.
    const [e0, e1] = events(note("C", 2) + note("D", 1));
    expect(e0!.staff).toBeUndefined(); // home staff 2 → no override
    expect(e1!.staff).toBe(1); // crosses up to staff 1 — override required
  });
});

describe("convertMusicXmlToMnx — direction staff assignment", () => {
  it("preserves identical simultaneous dynamics on different voices", () => {
    const xml = pianoScore(
      `<direction><direction-type><dynamics><f/></dynamics></direction-type><voice>1</voice></direction>` +
        `<direction><direction-type><dynamics><f/></dynamics></direction-type><voice>2</voice></direction>` +
        note("C", 1),
    );
    const dynamics = convertMusicXmlToMnx(xml).parts[0]!.measures[0]!.dynamics!;

    expect(dynamics).toHaveLength(2);
    expect(dynamics.map((dynamic) => dynamic.voice)).toEqual(["v1", "v2"]);
  });

  it("records the authored staff on a staff-2 dynamic", () => {
    const xml = pianoScore(
      `<direction placement="below"><direction-type><dynamics><p/></dynamics></direction-type><voice>2</voice><staff>2</staff></direction>` +
        note("C", 1) +
        note("E", 2),
    );
    const mnx = convertMusicXmlToMnx(xml);
    const dynamics = mnx.parts[0]!.measures[0]!.dynamics!;
    expect(dynamics).toHaveLength(1);
    expect(dynamics[0]!.value).toBe("p");
    expect(dynamics[0]!.staff).toBe(2);
    expect(dynamics[0]!.voice).toBe("v2");
  });

  it("preserves voice and staff on a gradual dynamic", () => {
    const xml = pianoScore(
      `<direction><direction-type><wedge type="crescendo"/></direction-type><voice>2</voice><staff>2</staff></direction>` +
        note("C", 2) +
        `<direction><direction-type><wedge type="stop"/></direction-type><voice>2</voice><staff>2</staff></direction>`,
    );
    const mnx = convertMusicXmlToMnx(xml);
    const hairpin = mnx.parts[0]!.measures[0]!.dynamics!.find((group) => group.type === "gradual");
    expect(hairpin?.voice).toBe("v2");
    expect(hairpin?.staff).toBe(2);
  });

  it("leaves staff undefined for a staff-1 dynamic (defaults to top staff)", () => {
    const xml = pianoScore(
      `<direction placement="below"><direction-type><dynamics><f/></dynamics></direction-type><staff>1</staff></direction>` +
        note("C", 1) +
        note("E", 2),
    );
    const mnx = convertMusicXmlToMnx(xml);
    const dynamics = mnx.parts[0]!.measures[0]!.dynamics!;
    expect(dynamics).toHaveLength(1);
    expect(dynamics[0]!.staff).toBeUndefined();
  });

  it("records the authored staff on a staff-2 text expression", () => {
    const xml = pianoScore(
      `<direction placement="below"><direction-type><words>dolce</words></direction-type><staff>2</staff></direction>` +
        note("C", 1) +
        note("E", 2),
    );
    const mnx = convertMusicXmlToMnx(xml, { includeVendorExtensions: true });
    const measure = mnx.parts[0]!.measures[0]! as unknown as Record<string, unknown>;
    const ext = measure["_x"] as { viritura: Record<string, unknown> };
    const exprs = ext.viritura["expressions"] as { text: string; staff?: number }[];
    expect(exprs).toHaveLength(1);
    expect(exprs[0]!.text).toBe("dolce");
    expect(exprs[0]!.staff).toBe(2);
  });
});
