import { describe, expect, it } from "vitest";
import type { Note, NoteEvent } from "@viritura/core";
import {
  readNoteConnectors,
  resolveHairpinConnectors,
  resolveNoteConnectors,
  type LocatedDynamic,
} from "./connectorReading";
import { MuseScoreConversionError } from "./errors";
import { fraction } from "./fractions";
import { ReadPolicy } from "./readPolicy";
import {
  pairRelativeConnectors,
  readRelativeConnector,
  type ConnectorLocation,
  type RelativeConnector,
} from "./relativeConnectors";
import { readSlurConnectors, resolveSlurConnectors } from "./slurReading";
import { parseSafeXml } from "./xml";

function recoveryPolicy(skipUnsupported = true): { policy: ReadPolicy; diagnostics: ReadPolicy["diagnostics"] } {
  const policy = new ReadPolicy({ unsupported: skipUnsupported ? "skip" : "error" });
  return { policy, diagnostics: policy.diagnostics };
}

const length = fraction(1);
const location = (quarter: number, fields: Partial<ConnectorLocation> = {}): ConnectorLocation => ({
  staff: 0,
  voice: 0,
  note: 0,
  time: fraction(quarter, 4),
  ...fields,
});
const element = (xml: string) => parseSafeXml(xml).documentElement;
const container = (xml: string) => element(`<Chord>${xml}</Chord>`);
const note = (id: string): Note => ({ id, pitch: { step: "C", octave: 4 } });
const event = (id: string): NoteEvent => ({
  type: "event",
  id,
  duration: { base: "quarter" },
  notes: [note(`${id}-note`)],
});

function start(type = "Slur", properties = "", delta = "1/4", fields = ""): string {
  return (
    `<Spanner type="${type}"><${type}>${properties}</${type}>` +
    `<next><location><fractions>${delta}</fractions>${fields}</location></next></Spanner>`
  );
}

function end(type = "Slur", delta = "-1/4", fields = ""): string {
  return `<Spanner type="${type}"><prev><location><fractions>${delta}</fractions>${fields}</location></prev></Spanner>`;
}

function relative(xml: string, quarter: number, policy?: ReadPolicy): RelativeConnector {
  return readRelativeConnector(element(xml), location(quarter), "HairPin", `Staff/HairPin[${quarter}]`, policy)!;
}

describe("independent connector recovery", () => {
  it.each([
    "<partialSpannerDirection>outgoing</partialSpannerDirection>",
    "<lineType>3</lineType>",
    "<up>above</up>",
    '<SlurSegment no="0"><o1 x="1" y="0"/></SlurSegment>',
    '<SlurSegment no="0"/><SlurSegment no="1"/>',
    "<height>1</height>",
    '<offset x="1" y="0"/>',
  ])("retains notes and a supported shared-start slur beside %s", (properties) => {
    const { policy, diagnostics } = recoveryPolicy();
    const [a, b, c] = [event("a"), event("b"), event("c")];
    const endpoints = [
      ...readSlurConnectors(
        container(start("Slur", properties) + start("Slur", "", "1/2")),
        a!,
        location(0),
        false,
        "A",
        policy,
      ),
      ...readSlurConnectors(container(end()), b!, location(1), false, "B", policy),
      ...readSlurConnectors(container(end("Slur", "-1/2")), c!, location(2), false, "C", policy),
    ];
    resolveSlurConnectors(endpoints, length, 1, policy);
    expect(a!.slurs).toEqual([{ target: "c" }]);
    expect(b!.slurs).toBeUndefined();
    expect(c!.slurs).toBeUndefined();
    expect([a, b, c].map((item) => item!.notes)).toEqual([[note("a-note")], [note("b-note")], [note("c-note")]]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ code: "unsupported-content", path: "A/Spanner[0]" });
  });

  it.each(["<up>sideways</up>", "<partialSpannerDirection>outgoing</partialSpannerDirection>"])(
    "skips one tie pair, not neighboring ties or notes: %s",
    (properties) => {
      const { policy, diagnostics } = recoveryPolicy();
      const notes = ["a", "b", "c", "d"].map(note);
      const endpoints = notes.flatMap((item, index) =>
        readNoteConnectors(
          container(index % 2 ? end("Tie") : start("Tie", index === 0 ? properties : "")),
          item,
          location(index),
          false,
          `Note[${index}]`,
          policy,
        ),
      );
      resolveNoteConnectors(endpoints, length, 1, policy);
      expect(notes[0]!.ties).toBeUndefined();
      expect(notes[1]!.ties).toBeUndefined();
      expect(notes[2]!.ties).toEqual([{ target: "d" }]);
      expect(notes[3]!.ties).toBeUndefined();
      expect(notes.map((item) => item.pitch)).toEqual(Array.from({ length: 4 }, () => ({ step: "C", octave: 4 })));
      expect(diagnostics).toHaveLength(1);
    },
  );

  it.each([
    "<subtype>2</subtype>",
    "<partialSpannerDirection>outgoing</partialSpannerDirection>",
    "<height>2</height>",
  ])("does not absorb dynamics when a hairpin is skipped: %s", (properties) => {
    const { policy, diagnostics } = recoveryPolicy();
    const dynamic: LocatedDynamic = {
      location: location(0),
      captured: {
        measureOffset: 0,
        staffOffset: 0,
        offset: [0, 1],
        dynamic: { id: "mf", type: "immediate", value: "mf", position: { fraction: [0, 1] } },
      },
    };
    const endpoints = [
      relative(start("HairPin", properties), 0, policy),
      relative(end("HairPin"), 1, policy),
      relative(start("HairPin", "<subtype>1</subtype>"), 2, policy),
      relative(end("HairPin"), 3, policy),
    ];
    const result = resolveHairpinConnectors(endpoints, [dynamic], length, 1, policy);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(dynamic.captured);
    expect(result[1]).toMatchObject({
      offset: [1, 2],
      endOffset: [3, 4],
      dynamic: { type: "gradual", wedgeType: "decreasing" },
    });
    expect(diagnostics).toHaveLength(1);
  });

  it("discards known unsupported connector types without dropping valid slurs or ties", () => {
    const { policy, diagnostics } = recoveryPolicy();
    const a = event("a");
    const b = event("b");
    const slurs = [
      ...readSlurConnectors(container(start("Ottava") + start()), a, location(0), false, "A", policy),
      ...readSlurConnectors(container(end("Ottava") + end()), b, location(1), false, "B", policy),
    ];
    resolveSlurConnectors(slurs, length, 1, policy);
    const ties = [
      ...readNoteConnectors(
        container(start("Glissando") + start("Tie")),
        a.notes![0]!,
        location(0),
        false,
        "A/Note",
        policy,
      ),
      ...readNoteConnectors(
        container(end("Glissando") + end("Tie")),
        b.notes![0]!,
        location(1),
        false,
        "B/Note",
        policy,
      ),
    ];
    resolveNoteConnectors(ties, length, 1, policy);
    expect(a.slurs).toEqual([{ target: "b" }]);
    expect(a.notes![0]!.ties).toEqual([{ target: "b-note" }]);
    expect(diagnostics).toHaveLength(4);
    expect(
      readRelativeConnector(element(start("Pedal")), location(0), "HairPin", "Staff/Spanner", policy),
    ).toBeUndefined();
    expect(diagnostics).toHaveLength(5);
  });

  it.each([
    ["grace source", "", true],
    ["note-index target", "<notes>1</notes>", false],
    ["grace target", "<grace>0</grace>", false],
    ["measure target", "<measures>1</measures>", false],
    ["tick target", "<timeTick>1</timeTick>", false],
  ] as const)("skips %s without linking its counterpart", (_name, fields, grace) => {
    const { policy, diagnostics } = recoveryPolicy();
    const a = event("a");
    const b = event("b");
    const endpoints = [
      ...readSlurConnectors(container(start("Slur", "", "1/4", fields)), a, location(0), grace, "A", policy),
      ...readSlurConnectors(container(end()), b, location(1), false, "B", policy),
    ];
    resolveSlurConnectors(endpoints, length, 1, policy);
    expect(a.slurs).toBeUndefined();
    expect(b.slurs).toBeUndefined();
    expect(a.notes).toHaveLength(1);
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("skips partial self-slurs without attempting to turn them into zero-duration pairs", () => {
    const { policy, diagnostics } = recoveryPolicy();
    const a = event("a");
    const endpoints = readSlurConnectors(
      container(
        start("Slur", "<partialSpannerDirection>outgoing</partialSpannerDirection>", "0/1") + end("Slur", "0/1"),
      ),
      a,
      location(0),
      false,
      "A",
      policy,
    );
    resolveSlurConnectors(endpoints, length, 1, policy);
    expect(a.slurs).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
  });

  it("does not alias unsupported grace anchors with an independent ordinary slur", () => {
    const { policy, diagnostics } = recoveryPolicy();
    const a = event("a");
    const b = event("b");
    const grace = event("grace");
    const endpoints = [
      ...readSlurConnectors(
        container(start("Slur", "", "1/4", "<grace>0</grace>") + start()),
        a,
        location(0),
        false,
        "A",
        policy,
      ),
      ...readSlurConnectors(container(end()), grace, location(1), true, "Grace", policy),
      ...readSlurConnectors(container(end()), b, location(1), false, "B", policy),
    ];
    resolveSlurConnectors(endpoints, length, 1, policy);
    expect(a.slurs).toEqual([{ target: "b" }]);
    expect(grace.slurs).toBeUndefined();
    expect(diagnostics).toHaveLength(2);
  });

  it.each(["Tie", "HairPin"] as const)("skips partial self-%s connectors before ordinary timing checks", (type) => {
    const { policy, diagnostics } = recoveryPolicy();
    const source = readRelativeConnector(
      element(start(type, "<partialSpannerDirection>outgoing</partialSpannerDirection>", "0/1")),
      location(0),
      type,
      "A",
      policy,
    )!;
    const target = readRelativeConnector(element(end(type, "0/1")), location(0), type, "B", policy)!;
    expect(pairRelativeConnectors([source, target], length, 1, policy)).toEqual([]);
    expect(diagnostics).toHaveLength(1);
  });

  it("retains independent pairs beside missing, nonreciprocal and out-of-selection endpoints", () => {
    const { policy, diagnostics } = recoveryPolicy();
    const goodStart = relative(start("HairPin"), 0, policy);
    const goodEnd = relative(end("HairPin"), 1, policy);
    const orphan = relative(start("HairPin", "", "1/8"), 2, policy);
    const outside = relative(end("HairPin", "-2/1"), 3, policy);
    expect(pairRelativeConnectors([orphan, goodEnd, outside, goodStart], length, 1, policy)).toEqual([
      { start: goodStart, end: goodEnd },
    ]);
    expect(diagnostics.map((item) => item.message)).toEqual(
      expect.arrayContaining([
        "connector endpoint is outside the copied selection",
        "orphan or non-reciprocal connector endpoint",
      ]),
    );
    expect(diagnostics.every((item) => item.path && item.sourceTime)).toBe(true);
  });

  it.each(["<staves>1</staves>", "<voices>4</voices>", "<notes>-1</notes>"])(
    "diagnoses out-of-selection anchors %s",
    (fields) => {
      const { policy, diagnostics } = recoveryPolicy();
      const endpoint = relative(start("HairPin", "", "1/4", fields), 0, policy);
      expect(pairRelativeConnectors([endpoint], length, 1, policy)).toEqual([]);
      expect(diagnostics.some((item) => item.message.includes("outside"))).toBe(true);
    },
  );

  it("does not attach a nonreciprocal orphan to an otherwise valid start", () => {
    const { policy } = recoveryPolicy();
    const a = relative(start("HairPin"), 0, policy);
    const b = relative(end("HairPin", "-1/8"), 1, policy);
    expect(pairRelativeConnectors([a, b], length, 1, policy)).toEqual([]);
  });

  it.each(["Slur", "Tie", "HairPin"] as const)(
    "does not attach the orphan counterpart of a rejected %s end",
    (type) => {
      const { policy, diagnostics } = recoveryPolicy();
      const endpoints = [
        readRelativeConnector(element(start(type)), location(0), type, "A", policy)!,
        readRelativeConnector(element(end(type, "-1/4", "<grace>0</grace>")), location(1), type, "B", policy)!,
        readRelativeConnector(element(start(type)), location(2), type, "C", policy)!,
        readRelativeConnector(element(end(type)), location(3), type, "D", policy)!,
      ];
      expect(pairRelativeConnectors(endpoints, length, 1, policy)).toEqual([
        { start: endpoints[2], end: endpoints[3] },
      ]);
      expect(diagnostics).toHaveLength(2);
    },
  );

  it("rejects a grace tie without attaching either note", () => {
    const { policy, diagnostics } = recoveryPolicy();
    const a = note("a");
    const b = note("b");
    const endpoints = [
      ...readNoteConnectors(container(start("Tie")), a, location(0), true, "A", policy),
      ...readNoteConnectors(container(end("Tie")), b, location(1), false, "B", policy),
    ];
    resolveNoteConnectors(endpoints, length, 1, policy);
    expect(a.ties).toBeUndefined();
    expect(b.ties).toBeUndefined();
    expect(diagnostics.map((item) => item.message)).toEqual([
      "ties involving grace notes are not supported",
      "orphan or non-reciprocal connector endpoint",
    ]);
  });

  it("skips cross-voice hairpins and note-index anchors independently", () => {
    const { policy, diagnostics } = recoveryPolicy();
    const a = relative(start("HairPin", "", "1/4", "<voices>1</voices>"), 0, policy);
    const b = readRelativeConnector(
      element(end("HairPin", "-1/4", "<voices>-1</voices>")),
      location(1, { voice: 1 }),
      "HairPin",
      "B",
      policy,
    )!;
    const c = relative(start("HairPin", "", "1/4", "<notes>1</notes>"), 2, policy);
    expect(resolveHairpinConnectors([a, b, c], [], length, 1, policy)).toEqual([]);
    expect(diagnostics.some((item) => item.message.includes("cross-voice"))).toBe(true);
    expect(diagnostics.some((item) => item.message.includes("note-index"))).toBe(true);
  });

  it("continues ignoring source playback settings without recovery diagnostics", () => {
    const { policy, diagnostics } = recoveryPolicy();
    const properties =
      "<veloChange>unknown</veloChange><singleNoteDynamics>0</singleNoteDynamics>" +
      "<veloChangeMethod>unknown</veloChangeMethod><play>0</play>";
    expect(
      resolveHairpinConnectors(
        [relative(start("HairPin", properties), 0, policy), relative(end("HairPin"), 1, policy)],
        [],
        length,
        1,
        policy,
      )[0]!.dynamic,
    ).toMatchObject({ type: "gradual", wedgeType: "increasing" });
    expect(diagnostics).toEqual([]);
  });
});

describe("connector recovery preserves fatal validation", () => {
  const malformedEnvelopes = [
    start().replace("</Spanner>", "<unknownTiming/></Spanner>"),
    end().replace("</Spanner>", "<unknownTiming/></Spanner>"),
    start("Slur", "", "1/4", "<unknownTiming>1/4</unknownTiming>"),
    start().replace("</next>", "<Chord/></next>"),
    end().replace("</prev>", "<Chord/></prev>"),
    start().replace('<Spanner type="Slur">', '<Spanner type="Slur" ticks="bad">'),
    start().replace("<next>", '<next unknownTiming="1/4">'),
    end().replace("<prev>", '<prev unknownTiming="-1/4">'),
    start().replace("<location>", '<location unknownTiming="1/4">'),
    start().replace("<next>", "<next>unexpected"),
    end().replace("<prev>", "<prev><![CDATA[unexpected]]>"),
    start().replace("<location>", "<location>unexpected"),
    start().replace("</Spanner>", "unexpected</Spanner>"),
    start("Slur", "unexpected"),
    start("Slur", '<SlurSegment no="0"><Chord/></SlurSegment>'),
    start("Slur", '<SlurSegment no="0"><unknownTiming>1/4</unknownTiming></SlurSegment>'),
    start("Slur", '<SlurSegment no="0"><ticks_f>1/8</ticks_f></SlurSegment>'),
    start("Slur", '<SlurSegment no="0"><o1 x="1" y="0"><Chord/></o1></SlurSegment>'),
    start("Slur", "<height><unknownTiming>1/4</unknownTiming></height>"),
    start("Slur", "<lineType>3</lineType><Chord/>"),
    start("Slur", "<lineType>3</lineType><unknownTiming>1/4</unknownTiming>"),
    start("Slur", "<Chord/>").replace("<Slur>", '<Slur visible="0">'),
  ];

  it.each(malformedEnvelopes)("rejects unknown structure instead of recovering it: %s", (xml) => {
    const { policy } = recoveryPolicy();
    expect(() => readSlurConnectors(container(xml), event("a"), location(0), false, "A", policy)).toThrowError(
      expect.objectContaining({ code: "invalid-structure", path: "A/Spanner[0]" }),
    );
  });

  it.each(["Glissando", "Ottava", "Pedal", "UnknownConnector"])(
    "validates generic fields before discarding %s",
    (type) => {
      const cases = [
        [start(type, "", "bad"), "invalid-timing"],
        [end(type, "bad"), "invalid-timing"],
        [start(type, "<ticks_f>bad</ticks_f>"), "invalid-timing"],
        [start(type, "<ticks_f>1/8</ticks_f>"), "invalid-timing"],
        [start(type, "<lineType>bad</lineType>"), "invalid-structure"],
        [start(type, "<subtype><value>bad</value></subtype>"), "invalid-structure"],
        [start(type, "", "1/4", "<grace>bad</grace>"), "invalid-structure"],
        [start(type, "", "1/4", "<voices>bad</voices>"), "invalid-structure"],
        [start(type, "", "1/4", "<timeTick>bad</timeTick>"), "invalid-structure"],
        [start(type, "", "1/4", "<measures>bad</measures>"), "invalid-structure"],
        [start(type, "", "1/4", "<unknownTiming/>"), "invalid-structure"],
        [start(type).replace("</next>", "<Chord/></next>"), "invalid-structure"],
        [start(type).replace("</Spanner>", "<prev><location/></prev></Spanner>"), "invalid-structure"],
        [start(type).replace("<location>", '<location ticks="bad">'), "invalid-structure"],
        [start(type).replace("</next>", "unexpected</next>"), "invalid-structure"],
        [start(type, "", "0"), "invalid-timing"],
        [start(type, "", "-1/4"), "invalid-timing"],
        [end(type, "0"), "invalid-timing"],
        [end(type, "1/4"), "invalid-timing"],
      ] as const;
      for (const [xml, code] of cases) {
        const { policy } = recoveryPolicy();
        expect(() => readNoteConnectors(container(xml), note("a"), location(0), false, "A", policy), xml).toThrowError(
          expect.objectContaining({ code, path: "A/Spanner[0]" }),
        );
      }
    },
  );

  it.each([start("UnknownConnector"), end("UnknownConnector"), "<Spanner><next><location/></next></Spanner>"])(
    "cannot establish a recovery boundary for an unknown or missing type: %s",
    (xml) => {
      const { policy } = recoveryPolicy();
      expect(() => readNoteConnectors(container(xml), note("a"), location(0), false, "A", policy)).toThrowError(
        expect.objectContaining({ code: "invalid-structure" }),
      );
    },
  );

  it.each(["Tie", "Slur", "HairPin"] as const)("validates orphan %s timing in both directions", (type) => {
    for (const xml of [start(type, "", "-1/4"), start(type, "", "0"), end(type, "1/4"), end(type, "0")]) {
      const { policy } = recoveryPolicy();
      const endpoint = readRelativeConnector(element(xml), location(0), type, "A", policy)!;
      expect(() => pairRelativeConnectors([endpoint], length, 1, policy)).toThrowError(
        expect.objectContaining({ code: "invalid-timing", path: "A" }),
      );
    }
  });

  it.each(["Tie", "Slur", "HairPin"] as const)("retains safe unresolved orphan %s handling", (type) => {
    for (const fields of ["<grace>0</grace>", "<measures>1</measures>", "<timeTick>1</timeTick>"]) {
      const { policy, diagnostics } = recoveryPolicy();
      const endpoint = readRelativeConnector(element(end(type, "0", fields)), location(0), type, "A", policy)!;
      expect(pairRelativeConnectors([endpoint], length, 1, policy)).toEqual([]);
      expect(diagnostics).toHaveLength(1);
    }
  });

  it.each(["Tie", "HairPin"] as const)("does not let unrelated partial %s anchors exempt orphan timing", (type) => {
    for (const delta of ["1/4", "0"]) {
      const { policy } = recoveryPolicy();
      const orphan = readRelativeConnector(element(end(type, delta)), location(0), type, "Orphan", policy)!;
      const partial = readRelativeConnector(
        element(start(type, "<partialSpannerDirection>outgoing</partialSpannerDirection>")),
        orphan.target,
        type,
        "Partial",
        policy,
      )!;
      expect(() => pairRelativeConnectors([partial, orphan], length, 1, policy)).toThrowError(
        expect.objectContaining({ code: "invalid-timing", path: "Orphan" }),
      );
    }
  });

  it.each(["Tie", "Slur", "HairPin"] as const)(
    "does not exempt invented partial %s directions from timing checks",
    (type) => {
      const { policy } = recoveryPolicy();
      const endpoint = readRelativeConnector(
        element(start(type, "<partialSpannerDirection>unknown</partialSpannerDirection>", "0")),
        location(0),
        type,
        "A",
        policy,
      )!;
      expect(() => pairRelativeConnectors([endpoint], length, 1, policy)).toThrowError(
        expect.objectContaining({ code: "invalid-timing" }),
      );
    },
  );

  it("validates single-note connectors before the caller discards them", () => {
    for (const xml of [
      start("Tie", "<ticks_f>1/8</ticks_f>"),
      start("Tie", "", "0"),
      end("Tie", "1/4"),
      end("Tie", "0"),
      start("Glissando", "", "bad"),
      start("Glissando", "<ticks_f>1/8</ticks_f>"),
    ]) {
      const { policy } = recoveryPolicy();
      const parsedNote = note("single");
      expect(() => {
        const endpoints = readNoteConnectors(container(xml), parsedNote, location(0), false, "Note", policy);
        resolveNoteConnectors(endpoints, fraction(1, 4), 1, policy);
      }).toThrowError(expect.objectContaining({ code: "invalid-timing" }));
      expect(parsedNote.ties).toBeUndefined();
    }
    for (const xml of [start("Tie"), end("Tie"), start("Glissando"), end("Glissando")]) {
      const { policy, diagnostics } = recoveryPolicy();
      const parsedNote = note("single");
      const endpoints = readNoteConnectors(container(xml), parsedNote, location(0), false, "Note", policy);
      resolveNoteConnectors(endpoints, fraction(1, 4), 1, policy);
      expect(parsedNote.ties).toBeUndefined();
      expect(diagnostics.length).toBeGreaterThan(0);
    }
  });

  it.each([
    start("Slur", "", "bad"),
    start("Slur", "<ticks_f>1/0</ticks_f><lineType>3</lineType>"),
    start("Slur", "<unknown/><up><x/>up</up>"),
    start("Slur", "<unknown/><lineType>bad</lineType>"),
    start("Slur", "<up>up</up><up>down</up>"),
    start("Slur").replace("<location>", '<location><fractions value="1">1/4</fractions>'),
    start("Slur").replace("</Spanner>", "<prev><location/></prev></Spanner>"),
    start("Slur").replace(/<location>.*<\/location>/, ""),
    start("Slur").replace("<Slur></Slur>", ""),
    start("Slur", "", "1/4", "<voices>9007199254740992</voices>"),
  ])("does not recover malformed structure or timing: %s", (xml) => {
    const { policy } = recoveryPolicy();
    expect(() => readSlurConnectors(container(xml), event("a"), location(0), false, "A", policy)).toThrow(
      MuseScoreConversionError,
    );
  });

  it.each(["<ticks_f>1/8</ticks_f>", "<ticks_f>1/0</ticks_f>"])(
    "keeps invalid hairpin ticks fatal: %s",
    (properties) => {
      const { policy } = recoveryPolicy();
      expect(() =>
        resolveHairpinConnectors(
          [relative(start("HairPin", properties), 0, policy), relative(end("HairPin"), 1, policy)],
          [],
          length,
          1,
          policy,
        ),
      ).toThrow(/ticks_f|fraction/);
    },
  );

  it.each(["<lineType>3</lineType>", '<SlurSegment no="0"/>'])(
    "does not let unsupported appearance hide mismatched slur timing: %s",
    (properties) => {
      const { policy } = recoveryPolicy();
      const endpoints = [
        ...readSlurConnectors(
          container(start("Slur", properties + "<ticks_f>1/8</ticks_f>")),
          event("a"),
          location(0),
          false,
          "A",
          policy,
        ),
        ...readSlurConnectors(container(end()), event("b"), location(1), false, "B", policy),
      ];
      expect(() => resolveSlurConnectors(endpoints, length, 1, policy)).toThrow(/ticks_f/);
    },
  );

  it("keeps duplicate endpoints fatal rather than choosing a counterpart", () => {
    const { policy } = recoveryPolicy();
    const from = relative(start("HairPin"), 0, policy);
    const to = relative(end("HairPin"), 1, policy);
    expect(() => pairRelativeConnectors([from, from, to], length, 1, policy)).toThrow(/ambiguous duplicate/);
  });

  it("keeps reversed and zero-duration pairs fatal", () => {
    const { policy } = recoveryPolicy();
    for (const [from, to] of [
      [relative(start("HairPin", "", "-1/4"), 1, policy), relative(end("HairPin", "1/4"), 0, policy)],
      [relative(start("HairPin", "", "0/1"), 0, policy), relative(end("HairPin", "0/1"), 0, policy)],
    ]) {
      expect(() => pairRelativeConnectors([from!, to!], length, 1, policy)).toThrow(/strictly later/);
    }
  });

  it("keeps tie pitch mismatches fatal", () => {
    const { policy } = recoveryPolicy();
    const a = note("a");
    const b = note("b");
    b.pitch.step = "D";
    const endpoints = [
      ...readNoteConnectors(container(start("Tie")), a, location(0), false, "A", policy),
      ...readNoteConnectors(container(end("Tie")), b, location(1), false, "B", policy),
    ];
    expect(() => resolveNoteConnectors(endpoints, length, 1, policy)).toThrow(/same MIDI pitch/);
  });

  it("preserves strict rejection with no policy or an explicit strict policy", () => {
    for (const policy of [undefined, recoveryPolicy(false).policy]) {
      expect(() =>
        readSlurConnectors(
          container(start("Slur", "<lineType>3</lineType>")),
          event("a"),
          location(0),
          false,
          "A",
          policy,
        ),
      ).toThrow(/lineType/);
      expect(() => pairRelativeConnectors([relative(start("HairPin"), 0, policy)], length, 1, policy)).toThrow(
        /orphan/,
      );
    }
  });
});
