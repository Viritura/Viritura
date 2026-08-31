import { describe, expect, it } from "vitest";
import { DOMParser } from "@xmldom/xmldom";
import { getPartsInfo } from "../convert/partsInfo";
import { buildCondensedLayout, buildLayout, buildPartContent, numberedPartNames } from "../convert/layout";
import type { MnxLayoutContent, MnxLayoutStaff, PartInfo } from "../types";

/** Flatten a layout tree to its staves (skipping group nodes). */
function staves(content: MnxLayoutContent[]): MnxLayoutStaff[] {
  const out: MnxLayoutStaff[] = [];
  const walk = (n: MnxLayoutContent): void => {
    if (n.type === "staff") out.push(n);
    else n.content.forEach(walk);
  };
  content.forEach(walk);
  return out;
}

function part(id: string, name: string, stavesCount = 1): PartInfo {
  return { id, name, abbreviation: "", staves: stavesCount };
}

function staffOrder(content: MnxLayoutContent[]): string[] {
  const order: string[] = [];
  const walk = (n: MnxLayoutContent): void => {
    if (n.type === "staff") {
      order.push(n.sources[0]!.part);
    } else {
      n.content.forEach(walk);
    }
  };
  content.forEach(walk);
  return order;
}

function parse(xml: string): Element {
  return new DOMParser().parseFromString(xml, "application/xml").documentElement as unknown as Element;
}

describe("buildLayout — part-group ordering", () => {
  it("keeps parts in document order even when a nested subgroup sits mid-range", () => {
    // Outer bracket [P1..P5] with an inner square subgroup around [P3,P4].
    const xml = `<score-partwise><part-list>
      <part-group type="start" number="1"><group-symbol>bracket</group-symbol></part-group>
      <score-part id="P1"><part-name>A</part-name></score-part>
      <score-part id="P2"><part-name>B</part-name></score-part>
      <part-group type="start" number="2"><group-symbol>square</group-symbol></part-group>
      <score-part id="P3"><part-name>C</part-name></score-part>
      <score-part id="P4"><part-name>D</part-name></score-part>
      <part-group type="stop" number="2"/>
      <score-part id="P5"><part-name>E</part-name></score-part>
      <part-group type="stop" number="1"/>
    </part-list></score-partwise>`;
    const { parts, groups } = getPartsInfo(parse(xml));
    expect(staffOrder(buildLayout(parts, groups))).toEqual(["P1", "P2", "P3", "P4", "P5"]);
  });

  it("tolerates reused part-group numbers for sequential sibling groups", () => {
    // number="2" is reused for two sibling groups without an intervening stop —
    // a real-world orchestral export pattern. All parts must stay in order and
    // no group may be dropped.
    const xml = `<score-partwise><part-list>
      <part-group type="start" number="1"><group-symbol>bracket</group-symbol></part-group>
      <part-group type="start" number="2"><group-symbol>square</group-symbol></part-group>
      <score-part id="P1"><part-name>A</part-name></score-part>
      <score-part id="P2"><part-name>B</part-name></score-part>
      <part-group type="start" number="2"><group-symbol>square</group-symbol></part-group>
      <score-part id="P3"><part-name>C</part-name></score-part>
      <score-part id="P4"><part-name>D</part-name></score-part>
      <part-group type="stop" number="2"/>
      <score-part id="P5"><part-name>E</part-name></score-part>
      <part-group type="stop" number="1"/>
    </part-list></score-partwise>`;
    const { parts, groups } = getPartsInfo(parse(xml));
    expect(staffOrder(buildLayout(parts, groups))).toEqual(["P1", "P2", "P3", "P4", "P5"]);
    // First sibling [0,2), second sibling [2,4), outer bracket [0,5).
    expect(groups).toContainEqual(expect.objectContaining({ startIndex: 0, endIndex: 2 }));
    expect(groups).toContainEqual(expect.objectContaining({ startIndex: 2, endIndex: 4 }));
    expect(groups).toContainEqual(expect.objectContaining({ startIndex: 0, endIndex: 5 }));
  });
});

describe("buildCondensedLayout — winds/brass condensing", () => {
  it("merges same-instrument wind/brass pairs onto shared staves", () => {
    const parts = [
      part("P1", "Flute 1"),
      part("P2", "Flute 2"),
      part("P3", "Oboe 1"),
      part("P4", "Oboe 2"),
      part("P5", "Horn 1"),
      part("P6", "Horn 2"),
    ];
    const full = buildLayout(parts, []);
    const { content, changed } = buildCondensedLayout(full, parts);
    expect(changed).toBe(true);
    const merged = staves(content);
    // Three condensed staves, each carrying two sources.
    expect(merged).toHaveLength(3);
    expect(merged.map((s) => s.sources.map((src) => src.part))).toEqual([
      ["P1", "P2"],
      ["P3", "P4"],
      ["P5", "P6"],
    ]);
    expect(merged.map((s) => s.label)).toEqual(["Flute", "Oboe", "Horn"]);
  });

  it("leaves strings and percussion uncondensed", () => {
    const parts = [part("P1", "Violin I"), part("P2", "Violin II"), part("P3", "Viola")];
    const full = buildLayout(parts, []);
    const { content, changed } = buildCondensedLayout(full, parts);
    expect(changed).toBe(false);
    expect(staves(content).every((s) => s.sources.length === 1)).toBe(true);
  });

  it("keeps distinct base names separate (Piccolo not merged with Flutes)", () => {
    const parts = [part("P1", "Piccolo"), part("P2", "Flute 1"), part("P3", "Flute 2")];
    const full = buildLayout(parts, []);
    const merged = staves(buildCondensedLayout(full, parts).content);
    expect(merged.map((s) => s.sources.map((src) => src.part))).toEqual([["P1"], ["P2", "P3"]]);
  });

  it("pairs four horns into two condensed staves; odd trailing part stays solo", () => {
    const parts = [
      part("P1", "Horn 1"),
      part("P2", "Horn 2"),
      part("P3", "Horn 3"),
      part("P4", "Horn 4"),
      part("P5", "Trumpet 1"),
    ];
    const merged = staves(buildCondensedLayout(buildLayout(parts, []), parts).content);
    expect(merged.map((s) => s.sources.map((src) => src.part))).toEqual([["P1", "P2"], ["P3", "P4"], ["P5"]]);
  });
});

describe("buildPartContent / numberedPartNames", () => {
  it("emits a single staff for a one-staff part", () => {
    const content = buildPartContent(part("P1", "Flute 1"));
    expect(content).toHaveLength(1);
    expect(content[0]!.type).toBe("staff");
  });

  it("emits a braced group for a multi-staff part", () => {
    const content = buildPartContent(part("P1", "Piano", 2));
    expect(content[0]!.type).toBe("group");
    expect((content[0]! as { symbol: string }).symbol).toBe("brace");
    expect(staves(content)).toHaveLength(2);
  });

  it("numbers duplicate part names and leaves unique ones alone", () => {
    const parts = [part("P1", "Flute"), part("P2", "Flute"), part("P3", "Oboe")];
    expect(numberedPartNames(parts)).toEqual(["Flute 1", "Flute 2", "Oboe"]);
  });

  it("does not double-number already-numbered duplicates", () => {
    const parts = [part("P1", "Flute 1"), part("P2", "Flute 1")];
    expect(numberedPartNames(parts)).toEqual(["Flute 1", "Flute 1"]);
  });

  it("never yields an empty name: falls back to abbreviation then 'Part N'", () => {
    const parts: PartInfo[] = [
      { id: "P1", name: "", abbreviation: "Vln.", staves: 1 },
      { id: "P2", name: "   ", abbreviation: "", staves: 1 },
    ];
    expect(numberedPartNames(parts)).toEqual(["Vln.", "Part 2"]);
  });
});

describe("getPartsInfo — embedded transposition/number normalization", () => {
  const sp = (id: string, name: string, abbr: string): string =>
    `<score-part id="${id}"><part-name>${name}</part-name><part-abbreviation>${abbr}</part-abbreviation></score-part>`;

  it("strips parenthetical transposition keys and trailing player numbers", () => {
    const xml = `<score-partwise><part-list>
      ${sp("P1", "Flute 1", "Fl. 1")}
      ${sp("P2", "Flute 2", "Fl. 2")}
      ${sp("P3", "Clarinet (B Flat) 1", "Cl. (B Flat) 1")}
      ${sp("P4", "Clarinet (B Flat) 2", "Cl. (B Flat) 2")}
      ${sp("P5", "Horn (F) 3", "Hn (F) 3")}
    </part-list></score-partwise>`;
    const { parts } = getPartsInfo(parse(xml));
    expect(parts.map((p) => p.name)).toEqual(["Flute", "Flute", "Clarinet", "Clarinet", "Horn"]);
    expect(parts.map((p) => p.abbreviation)).toEqual(["Fl.", "Fl.", "Cl.", "Cl.", "Hn"]);
  });

  it("preserves Roman-numeral section markers and unqualified names", () => {
    const xml = `<score-partwise><part-list>
      ${sp("P1", "Violin I", "Vln. I")}
      ${sp("P2", "Violin II", "Vln. II")}
      ${sp("P3", "Viola", "Vla.")}
      ${sp("P4", "Soprano Saxophone", "S. Sax.")}
    </part-list></score-partwise>`;
    const { parts } = getPartsInfo(parse(xml));
    expect(parts.map((p) => p.name)).toEqual(["Violin I", "Violin II", "Viola", "Soprano Saxophone"]);
    expect(parts.map((p) => p.abbreviation)).toEqual(["Vln. I", "Vln. II", "Vla.", "S. Sax."]);
  });

  it("leaves non-key parentheticals untouched", () => {
    const xml = `<score-partwise><part-list>
      ${sp("P1", "Percussion (divisi)", "Perc.")}
    </part-list></score-partwise>`;
    const { parts } = getPartsInfo(parse(xml));
    expect(parts[0]!.name).toBe("Percussion (divisi)");
  });
});
