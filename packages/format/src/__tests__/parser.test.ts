import { describe, it, expect } from "vitest";
import { parseMnx, parseMnxWithDiagnostics } from "../mnx/parser";
import { serializeMnx } from "../mnx/serializer";
import { loadMnxFromString } from "../mnx/loader";

/** hello-world.mnx content — a single whole-note C4 in 4/4 with treble clef */
const helloWorldMnx = {
  mnx: { version: 1 },
  global: {
    measures: [
      {
        barline: { type: "regular" },
        time: { count: 4, unit: 4 },
      },
    ],
  },
  parts: [
    {
      measures: [
        {
          clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
          sequences: [
            {
              content: [
                {
                  duration: { base: "whole" },
                  notes: [{ pitch: { step: "C", octave: 4 } }],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe("parseMnx", () => {
  it("should parse hello-world MNX into a typed Score", () => {
    const score = parseMnx(helloWorldMnx);

    expect(score.mnx.version).toBe(1);
    expect(score.global.measures).toHaveLength(1);
    expect(score.parts).toHaveLength(1);
  });

  it("should parse time signature correctly", () => {
    const score = parseMnx(helloWorldMnx);
    const measure = score.global.measures[0];

    expect(measure?.time?.count).toBe(4);
    expect(measure?.time?.unit).toBe(4);
  });

  it("round-trips open meter through the measure extension", () => {
    const mnx = structuredClone(helloWorldMnx) as typeof helloWorldMnx & {
      global: { measures: Array<Record<string, unknown>> };
    };
    mnx.global.measures[0] = {
      time: { count: 4, unit: 4 },
      _x: { viritura: { senzaMisura: true } },
    };

    const score = parseMnx(mnx);
    expect(score.global.measures[0]?.time?.display).toBe("senzaMisura");
    expect(serializeMnx(score).global.measures[0]).toMatchObject({
      time: { count: 4, unit: 4 },
      _x: { viritura: { senzaMisura: true } },
    });
  });

  it("should parse barline correctly", () => {
    const score = parseMnx(helloWorldMnx);
    const measure = score.global.measures[0];

    expect(measure?.barline?.type).toBe("regular");
  });

  it("should parse treble clef correctly", () => {
    const score = parseMnx(helloWorldMnx);
    const clefs = score.parts[0]?.measures[0]?.clefs;

    expect(clefs).toHaveLength(1);
    expect(clefs?.[0]?.clef.sign).toBe("G");
    expect(clefs?.[0]?.clef.staffPosition).toBe(-2);
  });

  it("should parse the whole-note C4 event", () => {
    const score = parseMnx(helloWorldMnx);
    const item = score.parts[0]?.measures[0]?.sequences[0]?.content[0];

    expect(item?.type).toBe("event");
    if (item?.type === "event") {
      expect(item.duration.base).toBe("whole");
      expect(item.notes).toHaveLength(1);
      expect(item.notes?.[0]?.pitch.step).toBe("C");
      expect(item.notes?.[0]?.pitch.octave).toBe(4);
    }
  });

  it("should handle empty input gracefully", () => {
    // Empty input doesn't satisfy the MNX schema (mnx/global/parts all
    // required), so we go through the lenient diagnostics path here.
    const { score } = parseMnxWithDiagnostics({});

    expect(score.mnx.version).toBe(1);
    expect(score.global.measures).toEqual([]);
    expect(score.parts).toEqual([]);
  });

  it("should throw on non-object input", () => {
    expect(() => parseMnx(null)).toThrow();
  });

  it("should parse staccatissimo marking", () => {
    const mnx = {
      mnx: { version: 1 },
      global: {
        measures: [{ time: { count: 4, unit: 4 } }],
      },
      parts: [
        {
          measures: [
            {
              clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
              sequences: [
                {
                  content: [
                    {
                      duration: { base: "quarter" },
                      notes: [{ pitch: { step: "E", octave: 5 } }],
                      markings: { staccatissimo: {} },
                    },
                    {
                      duration: { base: "quarter" },
                      notes: [{ pitch: { step: "C", octave: 4 } }],
                      markings: { staccatissimo: {}, accent: {} },
                    },
                    {
                      duration: { base: "half" },
                      notes: [{ pitch: { step: "D", octave: 5 } }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const score = parseMnx(mnx);
    const content = score.parts[0]?.measures[0]?.sequences[0]?.content;

    // Event 0: staccatissimo only
    expect(content?.[0]?.type).toBe("event");
    if (content?.[0]?.type === "event") {
      expect(content[0].markings?.staccatissimo).toEqual({});
      expect(content[0].markings?.staccato).toBeUndefined();
    }

    // Event 1: staccatissimo + accent
    if (content?.[1]?.type === "event") {
      expect(content[1].markings?.staccatissimo).toEqual({});
      expect(content[1].markings?.accent).toEqual({});
    }

    // Event 2: no markings
    if (content?.[2]?.type === "event") {
      expect(content[2].markings).toBeUndefined();
    }
  });

  it("should parse fermata marking with default shape", () => {
    const mnx = {
      mnx: { version: 1 },
      global: {
        measures: [{ time: { count: 4, unit: 4 } }],
      },
      parts: [
        {
          measures: [
            {
              clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
              sequences: [
                {
                  content: [
                    {
                      duration: { base: "quarter" },
                      notes: [{ pitch: { step: "E", octave: 5 } }],
                      fermata: {},
                    },
                    {
                      duration: { base: "dotted-half" },
                      notes: [{ pitch: { step: "D", octave: 5 } }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    // `dotted-half` isn't a real MNX note-value-base; this fixture probes
    // lenient handling, so go through the diagnostics path.
    const { score } = parseMnxWithDiagnostics(mnx);
    const content = score.parts[0]?.measures[0]?.sequences[0]?.content;

    if (content?.[0]?.type === "event") {
      expect(content[0].fermata).toEqual({});
    }

    if (content?.[1]?.type === "event") {
      expect(content[1].fermata).toBeUndefined();
    }
  });

  it("should parse fermata marking with symbol and duration", () => {
    const mnx = {
      mnx: { version: 1 },
      global: {
        measures: [{ time: { count: 4, unit: 4 } }],
      },
      parts: [
        {
          measures: [
            {
              clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
              sequences: [
                {
                  content: [
                    {
                      duration: { base: "quarter" },
                      notes: [{ pitch: { step: "C", octave: 5 } }],
                      fermata: { symbol: "angled" },
                    },
                    {
                      duration: { base: "quarter" },
                      notes: [{ pitch: { step: "D", octave: 5 } }],
                      fermata: { symbol: "square", orient: "below" },
                    },
                    {
                      duration: { base: "half" },
                      notes: [{ pitch: { step: "E", octave: 5 } }],
                      fermata: { duration: "veryLong" },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const score = parseMnx(mnx);
    const content = score.parts[0]?.measures[0]?.sequences[0]?.content;

    if (content?.[0]?.type === "event") {
      expect(content[0].fermata).toEqual({ symbol: "angled" });
    }
    if (content?.[1]?.type === "event") {
      expect(content[1].fermata).toEqual({ symbol: "square", orient: "below" });
    }
    if (content?.[2]?.type === "event") {
      expect(content[2].fermata).toEqual({ duration: "veryLong" });
    }
  });
  it("should parse spiccato marking", () => {
    const mnx = {
      mnx: { version: 1 },
      global: {
        measures: [{ time: { count: 4, unit: 4 } }],
      },
      parts: [
        {
          measures: [
            {
              clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
              sequences: [
                {
                  content: [
                    {
                      duration: { base: "quarter" },
                      notes: [{ pitch: { step: "C", octave: 4 } }],
                      markings: { spiccato: {} },
                    },
                    {
                      duration: { base: "quarter" },
                      notes: [{ pitch: { step: "D", octave: 4 } }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const score = parseMnx(mnx);
    const content = score.parts[0]?.measures[0]?.sequences[0]?.content;

    // Event 0: spiccato
    expect(content?.[0]?.type).toBe("event");
    if (content?.[0]?.type === "event") {
      expect(content[0].markings?.spiccato).toEqual({});
      expect(content[0].markings?.staccato).toBeUndefined();
    }

    // Event 1: no markings
    if (content?.[1]?.type === "event") {
      expect(content[1].markings).toBeUndefined();
    }
  });

  it("should parse stress and unstress markings", () => {
    const mnx = {
      mnx: { version: 1 },
      global: {
        measures: [{ time: { count: 4, unit: 4 } }],
      },
      parts: [
        {
          measures: [
            {
              clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
              sequences: [
                {
                  content: [
                    {
                      duration: { base: "quarter" },
                      notes: [{ pitch: { step: "C", octave: 5 } }],
                      markings: { stress: {} },
                    },
                    {
                      duration: { base: "quarter" },
                      notes: [{ pitch: { step: "D", octave: 5 } }],
                      markings: { unstress: {} },
                    },
                    {
                      duration: { base: "half" },
                      notes: [{ pitch: { step: "E", octave: 5 } }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const score = parseMnx(mnx);
    const content = score.parts[0]?.measures[0]?.sequences[0]?.content;

    // Event 0: stress
    expect(content?.[0]?.type).toBe("event");
    if (content?.[0]?.type === "event") {
      expect(content[0].markings?.stress).toEqual({});
      expect(content[0].markings?.unstress).toBeUndefined();
    }

    // Event 1: unstress
    expect(content?.[1]?.type).toBe("event");
    if (content?.[1]?.type === "event") {
      expect(content[1].markings?.unstress).toEqual({});
      expect(content[1].markings?.stress).toBeUndefined();
    }

    // Event 2: no markings
    if (content?.[2]?.type === "event") {
      expect(content[2].markings).toBeUndefined();
    }
  });

  it("should parse trill marking without accidental", () => {
    const mnx = {
      mnx: { version: 1 },
      global: {
        measures: [{ time: { count: 4, unit: 4 } }],
      },
      parts: [
        {
          measures: [
            {
              clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
              sequences: [
                {
                  content: [
                    {
                      duration: { base: "half" },
                      notes: [{ pitch: { step: "E", octave: 5 } }],
                      markings: { _x: { viritura: { trill: {} } } },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const score = parseMnx(mnx);
    const ev = score.parts[0]?.measures[0]?.sequences[0]?.content[0];
    if (ev?.type === "event") {
      expect(ev.markings?.trill).toEqual({});
      expect(ev.markings?.trill?.accidental).toBeUndefined();
    }
  });

  it("should parse trill marking with accidental", () => {
    const mnx = {
      mnx: { version: 1 },
      global: {
        measures: [{ time: { count: 4, unit: 4 } }],
      },
      parts: [
        {
          measures: [
            {
              clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
              sequences: [
                {
                  content: [
                    {
                      duration: { base: "half" },
                      notes: [{ pitch: { step: "E", octave: 5 } }],
                      markings: { _x: { viritura: { trill: { accidental: 1 } } } },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const score = parseMnx(mnx);
    const ev = score.parts[0]?.measures[0]?.sequences[0]?.content[0];
    if (ev?.type === "event") {
      expect(ev.markings?.trill).toEqual({ accidental: 1 });
    }
  });

  it("should parse ornaments array", () => {
    const mnx = {
      mnx: { version: 1 },
      global: {
        measures: [{ time: { count: 4, unit: 4 } }],
      },
      parts: [
        {
          measures: [
            {
              clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
              sequences: [
                {
                  content: [
                    {
                      duration: { base: "quarter" },
                      notes: [{ pitch: { step: "C", octave: 5 } }],
                      markings: { _x: { viritura: { ornaments: ["turn"] } } },
                    },
                    {
                      duration: { base: "quarter" },
                      notes: [{ pitch: { step: "D", octave: 5 } }],
                      markings: { _x: { viritura: { ornaments: ["mordent"] } } },
                    },
                    {
                      duration: { base: "quarter" },
                      notes: [{ pitch: { step: "E", octave: 5 } }],
                      markings: { _x: { viritura: { ornaments: ["invertedMordent"] } } },
                    },
                    {
                      duration: { base: "quarter" },
                      notes: [{ pitch: { step: "F", octave: 5 } }],
                      markings: { _x: { viritura: { ornaments: ["invertedTurn"] } } },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const score = parseMnx(mnx);
    const content = score.parts[0]?.measures[0]?.sequences[0]?.content;

    if (content?.[0]?.type === "event") {
      expect(content[0].markings?.ornaments).toEqual(["turn"]);
    }
    if (content?.[1]?.type === "event") {
      expect(content[1].markings?.ornaments).toEqual(["mordent"]);
    }
    if (content?.[2]?.type === "event") {
      expect(content[2].markings?.ornaments).toEqual(["invertedMordent"]);
    }
    if (content?.[3]?.type === "event") {
      expect(content[3].markings?.ornaments).toEqual(["invertedTurn"]);
    }
  });

  it("should parse all ornament types", () => {
    const allOrnaments = [
      "turn",
      "invertedTurn",
      "mordent",
      "invertedMordent",
      "shortTrill",
      "trillMordent",
      "delayedTurn",
      "schleifer",
    ];
    const mnx = {
      mnx: { version: 1 },
      global: {
        measures: [{ time: { count: 4, unit: 4 } }],
      },
      parts: [
        {
          measures: [
            {
              clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
              sequences: [
                {
                  content: [
                    {
                      duration: { base: "whole" },
                      notes: [{ pitch: { step: "C", octave: 5 } }],
                      markings: { _x: { viritura: { ornaments: allOrnaments } } },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const score = parseMnx(mnx);
    const ev = score.parts[0]?.measures[0]?.sequences[0]?.content[0];
    if (ev?.type === "event") {
      expect(ev.markings?.ornaments).toEqual(allOrnaments);
    }
  });

  it("should parse ornaments combined with other markings", () => {
    const mnx = {
      mnx: { version: 1 },
      global: {
        measures: [{ time: { count: 4, unit: 4 } }],
      },
      parts: [
        {
          measures: [
            {
              clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
              sequences: [
                {
                  content: [
                    {
                      duration: { base: "quarter" },
                      notes: [{ pitch: { step: "C", octave: 5 } }],
                      markings: { staccato: {}, _x: { viritura: { ornaments: ["turn"] } } },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const score = parseMnx(mnx);
    const ev = score.parts[0]?.measures[0]?.sequences[0]?.content[0];
    if (ev?.type === "event") {
      expect(ev.markings?.staccato).toEqual({});
      expect(ev.markings?.ornaments).toEqual(["turn"]);
    }
  });

  it("should parse hairpin dynamics (crescendo/decrescendo)", () => {
    const mnx = {
      mnx: { version: 1 },
      global: {
        measures: [{ id: "m1", time: { count: 4, unit: 4 } }, { id: "m2" }],
      },
      parts: [
        {
          measures: [
            {
              clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
              dynamics: [
                {
                  id: "hairpin-1",
                  type: "gradual",
                  position: { fraction: [0, 1] },
                  end: { measure: "m1", position: { fraction: [3, 4] } },
                  wedgeType: "increasing",
                },
              ],
              sequences: [
                {
                  content: [
                    {
                      duration: { base: "whole" },
                      notes: [{ pitch: { step: "C", octave: 4 } }],
                    },
                  ],
                },
              ],
            },
            {
              dynamics: [
                {
                  id: "hairpin-2",
                  type: "gradual",
                  position: { fraction: [0, 1] },
                  end: { measure: "m2", position: { fraction: [3, 4] } },
                  wedgeType: "decreasing",
                  staff: 1,
                  voice: "voice1",
                },
              ],
              sequences: [
                {
                  content: [
                    {
                      duration: { base: "whole" },
                      notes: [{ pitch: { step: "G", octave: 4 } }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const score = parseMnx(mnx);

    // First measure: crescendo
    const hp1 = score.parts[0]?.measures[0]?.dynamics;
    expect(hp1).toHaveLength(1);
    expect(hp1?.[0]?.type).toBe("gradual");
    expect(hp1?.[0]?.wedgeType).toBe("increasing");
    expect(hp1?.[0]?.position.fraction).toEqual([0, 1]);
    expect(hp1?.[0]?.end.measure).toBe("m1");
    expect(hp1?.[0]?.end.position.fraction).toEqual([3, 4]);
    expect(hp1?.[0]?.staff).toBeUndefined();
    expect(hp1?.[0]?.voice).toBeUndefined();

    // Second measure: decrescendo with staff/voice
    const hp2 = score.parts[0]?.measures[1]?.dynamics;
    expect(hp2).toHaveLength(1);
    expect(hp2?.[0]?.type).toBe("gradual");
    expect(hp2?.[0]?.wedgeType).toBe("decreasing");
    expect(hp2?.[0]?.staff).toBe(1);
    expect(hp2?.[0]?.voice).toBe("voice1");
  });
});

describe("loadMnxFromString", () => {
  it("should parse a JSON string into a Score", () => {
    const jsonStr = JSON.stringify(helloWorldMnx);
    const score = loadMnxFromString(jsonStr);

    expect(score.mnx.version).toBe(1);
    expect(score.parts).toHaveLength(1);
  });

  it("should throw on invalid JSON", () => {
    expect(() => loadMnxFromString("not json")).toThrow();
  });
});

describe("parseMnx coda marker", () => {
  it("should parse coda marker on a global measure", () => {
    const mnx = {
      mnx: { version: 1 },
      global: {
        measures: [
          { time: { count: 4, unit: 4 } },
          {
            _x: {
              viritura: {
                coda: {
                  location: { fraction: [0, 1] },
                },
              },
            },
          },
        ],
      },
      parts: [
        {
          measures: [
            {
              clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
              sequences: [{ content: [{ duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 4 } }] }] }],
            },
            {
              sequences: [{ content: [{ duration: { base: "whole" }, notes: [{ pitch: { step: "D", octave: 4 } }] }] }],
            },
          ],
        },
      ],
    };

    const score = parseMnx(mnx);
    expect(score.global.measures[1].coda).toBeDefined();
    expect(score.global.measures[1].coda?.location.fraction).toEqual([0, 1]);
    expect(score.global.measures[0].coda).toBeUndefined();
  });

  it("should parse coda marker with optional glyph and color", () => {
    const mnx = {
      mnx: { version: 1 },
      global: {
        measures: [
          {
            time: { count: 4, unit: 4 },
            _x: {
              viritura: {
                coda: {
                  location: { fraction: [0, 1] },
                  glyph: "codaSquare",
                  color: "#FF0000",
                },
              },
            },
          },
        ],
      },
      parts: [
        {
          measures: [
            {
              clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
              sequences: [{ content: [{ duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 4 } }] }] }],
            },
          ],
        },
      ],
    };

    const score = parseMnx(mnx);
    const coda = score.global.measures[0].coda;
    expect(coda).toBeDefined();
    expect(coda?.glyph).toBe("codaSquare");
    expect(coda?.color).toBe("#FF0000");
  });

  it("should parse dsalcoda and dcalcoda jump types", () => {
    const mnx = {
      mnx: { version: 1 },
      global: {
        measures: [
          { time: { count: 4, unit: 4 }, jump: { type: "dsalcoda", location: { fraction: [1, 1] } } },
          { jump: { type: "dcalcoda", location: { fraction: [1, 1] } } },
        ],
      },
      parts: [
        {
          measures: [
            {
              clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
              sequences: [{ content: [{ duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 4 } }] }] }],
            },
            {
              sequences: [{ content: [{ duration: { base: "whole" }, notes: [{ pitch: { step: "D", octave: 4 } }] }] }],
            },
          ],
        },
      ],
    };

    // `dsalcoda` and `dcalcoda` extend the MNX jump-type enum, so this
    // fixture goes through the lenient diagnostics path.
    const { score } = parseMnxWithDiagnostics(mnx);
    expect(score.global.measures[0].jump?.type).toBe("dsalcoda");
    expect(score.global.measures[1].jump?.type).toBe("dcalcoda");
  });
});

describe("parseMnx _x.viritura extensions", () => {
  it("round-trips extended jump types with a coda through the vendor extension", () => {
    const mnx = {
      mnx: { version: 1 },
      global: {
        measures: [
          {
            time: { count: 4, unit: 4 },
            _x: {
              viritura: {
                jump: { type: "dcalcoda", location: { fraction: [0, 1] } },
                coda: { location: { fraction: [0, 1] } },
              },
            },
          },
        ],
      },
      parts: [
        {
          measures: [
            {
              clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
              sequences: [{ content: [{ duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 4 } }] }] }],
            },
          ],
        },
      ],
    };

    const score = parseMnx(mnx);
    expect(score.global.measures[0]?.jump?.type).toBe("dcalcoda");
    expect(score.global.measures[0]?.coda).toBeDefined();

    const serialized = serializeMnx(score);
    const measure = serialized.global.measures[0]!;
    expect(measure.jump).toBeUndefined();
    expect(measure._x?.viritura?.jump?.type).toBe("dcalcoda");
    expect(measure._x?.viritura?.coda).toBeDefined();
    expect(() => parseMnx(serialized)).not.toThrow();
  });

  it("round-trips part spatial position from _x.viritura", () => {
    const mnx = {
      mnx: { version: 1 },
      global: { measures: [{ id: "m1" }] },
      parts: [
        {
          id: "P1",
          name: "Violin",
          _x: { viritura: { spatial: { x: -3.5, y: 2.25 } } },
          measures: [{ sequences: [] }],
        },
      ],
    };
    const score = parseMnx(mnx);
    expect(score.parts[0]?._x?.viritura?.spatial).toEqual({ x: -3.5, y: 2.25 });

    const out = serializeMnx(score) as { parts: { _x?: { viritura?: { spatial?: unknown } } }[] };
    expect(out.parts[0]?._x?.viritura?.spatial).toEqual({ x: -3.5, y: 2.25 });
  });

  it("should parse pedal markings from _x.viritura", () => {
    const mnx = {
      mnx: { version: 1 },
      global: {
        measures: [{ id: "m1", time: { count: 4, unit: 4 } }, { id: "m2" }],
      },
      parts: [
        {
          measures: [
            {
              clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
              _x: {
                viritura: {
                  pedals: [
                    {
                      type: "sustain",
                      position: { fraction: [0, 1] },
                      end: { measure: "m2", position: { fraction: [2, 4] } },
                      style: "text",
                    },
                  ],
                },
              },
              sequences: [
                {
                  content: [
                    {
                      duration: { base: "whole" },
                      notes: [{ pitch: { step: "C", octave: 4 } }],
                    },
                  ],
                },
              ],
            },
            {
              sequences: [
                {
                  content: [
                    {
                      duration: { base: "whole" },
                      notes: [{ pitch: { step: "D", octave: 4 } }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const score = parseMnx(mnx);
    const pedals = score.parts[0]?.measures[0]?.pedals;
    expect(pedals).toHaveLength(1);
    expect(pedals?.[0]?.type).toBe("sustain");
    expect(pedals?.[0]?.style).toBe("text");
    expect(pedals?.[0]?.position.fraction).toEqual([0, 1]);
    expect(pedals?.[0]?.end.measure).toBe("m2");
  });

  it("should parse glissandos from event._x.viritura", () => {
    const mnx = {
      mnx: { version: 1 },
      global: {
        measures: [{ time: { count: 4, unit: 4 } }],
      },
      parts: [
        {
          measures: [
            {
              clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
              sequences: [
                {
                  content: [
                    {
                      id: "ev1",
                      duration: { base: "half" },
                      notes: [{ pitch: { step: "C", octave: 4 } }],
                      _x: {
                        viritura: {
                          glissandos: [{ target: "ev2", style: "straight", text: "gliss." }],
                        },
                      },
                    },
                    {
                      id: "ev2",
                      duration: { base: "half" },
                      notes: [{ pitch: { step: "E", octave: 5 } }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const score = parseMnx(mnx);
    const ev = score.parts[0]?.measures[0]?.sequences[0]?.content[0];
    if (ev?.type === "event") {
      expect(ev.glissandos).toHaveLength(1);
      expect(ev.glissandos?.[0]?.target).toBe("ev2");
      expect(ev.glissandos?.[0]?.style).toBe("straight");
      expect(ev.glissandos?.[0]?.text).toBe("gliss.");
    }
  });

  it("should parse arpeggio from markings._x.viritura", () => {
    const mnx = {
      mnx: { version: 1 },
      global: {
        measures: [{ time: { count: 4, unit: 4 } }],
      },
      parts: [
        {
          measures: [
            {
              clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
              sequences: [
                {
                  content: [
                    {
                      duration: { base: "half" },
                      notes: [
                        { pitch: { step: "C", octave: 4 } },
                        { pitch: { step: "E", octave: 4 } },
                        { pitch: { step: "G", octave: 4 } },
                      ],
                      markings: {
                        _x: { viritura: { arpeggio: { direction: "up" } } },
                      },
                    },
                    {
                      duration: { base: "half" },
                      notes: [{ pitch: { step: "D", octave: 4 } }, { pitch: { step: "F", octave: 4 } }],
                      markings: {
                        _x: { viritura: { arpeggio: {} } },
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const score = parseMnx(mnx);
    const content = score.parts[0]?.measures[0]?.sequences[0]?.content;
    if (content?.[0]?.type === "event") {
      expect(content[0].markings?.arpeggio).toEqual({ direction: "up" });
    }
    if (content?.[1]?.type === "event") {
      expect(content[1].markings?.arpeggio).toEqual({});
    }
  });

  it("should parse standard part-measure arpeggios and non-arpeggios", () => {
    const mnx = {
      mnx: { version: 1 },
      global: {
        measures: [{ time: { count: 4, unit: 4 } }],
      },
      parts: [
        {
          measures: [
            {
              clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
              arpeggios: [
                {
                  position: { fraction: [0, 1] },
                  span: { start: "n1", end: "n3" },
                  direction: "up",
                  arrow: true,
                  id: "arp1",
                },
              ],
              nonArpeggios: [
                {
                  position: { fraction: [1, 2] },
                  span: { start: "n4", end: "n5" },
                  id: "non1",
                },
              ],
              sequences: [
                {
                  content: [
                    {
                      duration: { base: "half" },
                      notes: [
                        { id: "n1", pitch: { step: "C", octave: 4 } },
                        { id: "n2", pitch: { step: "E", octave: 4 } },
                        { id: "n3", pitch: { step: "G", octave: 4 } },
                      ],
                    },
                    {
                      duration: { base: "half" },
                      notes: [
                        { id: "n4", pitch: { step: "D", octave: 4 } },
                        { id: "n5", pitch: { step: "F", octave: 4 } },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const score = parseMnx(mnx);
    const measure = score.parts[0]?.measures[0];
    expect(measure?.arpeggios).toEqual([
      {
        position: { fraction: [0, 1] },
        span: { start: "n1", end: "n3" },
        direction: "up",
        arrow: true,
        id: "arp1",
      },
    ]);
    expect(measure?.nonArpeggios).toEqual([
      {
        position: { fraction: [1, 2] },
        span: { start: "n4", end: "n5" },
        id: "non1",
      },
    ]);
  });

  it("should parse fingerings from markings._x.viritura", () => {
    const mnx = {
      mnx: { version: 1 },
      global: {
        measures: [{ time: { count: 4, unit: 4 } }],
      },
      parts: [
        {
          measures: [
            {
              clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
              sequences: [
                {
                  content: [
                    {
                      duration: { base: "quarter" },
                      notes: [{ pitch: { step: "C", octave: 4 } }],
                      markings: {
                        _x: { viritura: { fingerings: [{ finger: 1 }] } },
                      },
                    },
                    {
                      duration: { base: "quarter" },
                      notes: [{ pitch: { step: "D", octave: 4 } }],
                      markings: {
                        _x: { viritura: { fingerings: [{ finger: 2 }, { finger: 4 }] } },
                      },
                    },
                    {
                      duration: { base: "half" },
                      notes: [{ pitch: { step: "E", octave: 4 } }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const score = parseMnx(mnx);
    const content = score.parts[0]?.measures[0]?.sequences[0]?.content;
    if (content?.[0]?.type === "event") {
      expect(content[0].markings?.fingerings).toEqual([{ finger: 1 }]);
    }
    if (content?.[1]?.type === "event") {
      expect(content[1].markings?.fingerings).toEqual([{ finger: 2 }, { finger: 4 }]);
    }
    if (content?.[2]?.type === "event") {
      expect(content[2].markings?.fingerings).toBeUndefined();
    }
  });

  it("should parse rehearsal mark from _x.viritura", () => {
    const mnx = {
      mnx: { version: 1 },
      global: {
        measures: [
          {
            time: { count: 4, unit: 4 },
            _x: { viritura: { rehearsalMark: { text: "A", style: "boxed" } } },
          },
        ],
      },
      parts: [
        {
          measures: [
            {
              clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
              sequences: [{ content: [{ duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 4 } }] }] }],
            },
          ],
        },
      ],
    };
    const score = parseMnx(mnx);
    expect(score.global.measures[0].rehearsalMark?.text).toBe("A");
    expect(score.global.measures[0].rehearsalMark?.style).toBe("boxed");
  });

  it("should parse and round-trip gradualTempo from _x.viritura", () => {
    const mnx = {
      mnx: { version: 1 },
      global: {
        measures: [
          { id: "m0", time: { count: 4, unit: 4 } },
          {
            id: "m1",
            _x: {
              viritura: {
                gradualTempo: {
                  position: { fraction: [0, 1] },
                  end: { measure: "m2", position: { fraction: [0, 1] } },
                  endBpm: 60,
                  startBpm: 120,
                  kind: "rit",
                },
              },
            },
          },
          { id: "m2" },
        ],
      },
      parts: [
        {
          measures: [
            {
              sequences: [{ content: [{ duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 4 } }] }] }],
            },
            {
              sequences: [{ content: [{ duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 4 } }] }] }],
            },
            {
              sequences: [{ content: [{ duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 4 } }] }] }],
            },
          ],
        },
      ],
    };
    const score = parseMnx(mnx);
    const gt = score.global.measures[1].gradualTempo;
    expect(gt?.endBpm).toBe(60);
    expect(gt?.startBpm).toBe(120);
    expect(gt?.kind).toBe("rit");
    expect(gt?.end.measure).toBe("m2");
    expect(gt?.end.position.fraction).toEqual([0, 1]);

    // Round-trip: serialize → re-parse, gradualTempo survives.
    const reparsed = parseMnx(serializeMnx(score));
    const gt2 = reparsed.global.measures[1].gradualTempo;
    expect(gt2?.endBpm).toBe(60);
    expect(gt2?.startBpm).toBe(120);
    expect(gt2?.kind).toBe("rit");
    expect(gt2?.end.measure).toBe("m2");
  });

  it("should parse caesura from event markings _x.viritura", () => {
    const mnx = {
      mnx: { version: 1 },
      global: {
        measures: [
          {
            time: { count: 4, unit: 4 },
          },
        ],
      },
      parts: [
        {
          measures: [
            {
              clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
              sequences: [
                {
                  content: [
                    {
                      duration: { base: "whole" },
                      notes: [{ pitch: { step: "C", octave: 4 } }],
                      markings: { _x: { viritura: { caesura: { style: "thick" } } } },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const score = parseMnx(mnx);
    const ev = score.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    expect(ev.type).toBe("event");
    if (ev.type === "event") {
      expect(ev.markings?.caesura?.style).toBe("thick");
    }
  });

  it("should parse chord symbols from _x.viritura", () => {
    const mnx = {
      mnx: { version: 1 },
      global: {
        measures: [{ time: { count: 4, unit: 4 } }],
      },
      parts: [
        {
          measures: [
            {
              clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
              _x: {
                viritura: {
                  chordSymbols: [
                    {
                      position: { fraction: [0, 1] },
                      root: { step: "C" },
                      quality: "major",
                    },
                  ],
                },
              },
              sequences: [{ content: [{ duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 4 } }] }] }],
            },
          ],
        },
      ],
    };
    const score = parseMnx(mnx);
    const cs = score.parts[0]?.measures[0]?.chordSymbols;
    expect(cs).toHaveLength(1);
    expect(cs?.[0]?.root.step).toBe("C");
    expect(cs?.[0]?.quality).toBe("major");
  });

  it("should parse text expressions from _x.viritura", () => {
    const mnx = {
      mnx: { version: 1 },
      global: {
        measures: [{ time: { count: 4, unit: 4 } }],
      },
      parts: [
        {
          measures: [
            {
              clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
              _x: {
                viritura: {
                  expressions: [
                    {
                      text: "dolce",
                      position: { fraction: [0, 1] },
                      placement: "below",
                    },
                  ],
                },
              },
              sequences: [{ content: [{ duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 4 } }] }] }],
            },
          ],
        },
      ],
    };
    const score = parseMnx(mnx);
    const expr = score.parts[0]?.measures[0]?.expressions;
    expect(expr).toHaveLength(1);
    expect(expr?.[0]?.text).toBe("dolce");
    expect(expr?.[0]?.placement).toBe("below");
  });

  it("should parse and round-trip dynamic suffix text", () => {
    const mnx = {
      mnx: { version: 1 },
      global: {
        measures: [{ time: { count: 4, unit: 4 } }],
      },
      parts: [
        {
          measures: [
            {
              clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
              dynamics: [
                {
                  id: "dynamic-with-suffix",
                  type: "immediate",
                  value: "p",
                  position: { fraction: [0, 1] },
                  suffix: "lovingly",
                },
              ],
              sequences: [{ content: [{ duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 4 } }] }] }],
            },
          ],
        },
      ],
    };

    const score = parseMnx(mnx);
    const dynamic = score.parts[0]?.measures[0]?.dynamics?.[0];
    expect(dynamic?.suffix).toBe("lovingly");

    const serialized = serializeMnx(score);
    const score2 = parseMnx(serialized);
    expect(score2.parts[0]?.measures[0]?.dynamics?.[0]?.suffix).toBe("lovingly");
  });

  it("should parse and round-trip text-expression manualOffset", () => {
    const mnx = {
      mnx: { version: 1 },
      global: {
        measures: [{ time: { count: 4, unit: 4 } }],
      },
      parts: [
        {
          measures: [
            {
              clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
              _x: {
                viritura: {
                  expressions: [
                    {
                      text: "dolce",
                      position: { fraction: [0, 1] },
                      manualOffset: [1.5, -0.75],
                    },
                  ],
                },
              },
              sequences: [{ content: [{ duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 4 } }] }] }],
            },
          ],
        },
      ],
    };

    const score = parseMnx(mnx);
    const expr = score.parts[0]?.measures[0]?.expressions;
    expect(expr?.[0]?.manualOffset).toEqual([1.5, -0.75]);

    const serialized = serializeMnx(score);
    const score2 = parseMnx(serialized);
    const expr2 = score2.parts[0]?.measures[0]?.expressions;
    expect(expr2?.[0]?.manualOffset).toEqual([1.5, -0.75]);
  });

  it("should not set inline when omitted", () => {
    const mnx = {
      mnx: { version: 1 },
      global: {
        measures: [{ time: { count: 4, unit: 4 } }],
      },
      parts: [
        {
          measures: [
            {
              clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
              _x: {
                viritura: {
                  expressions: [
                    {
                      text: "dolce",
                      position: { fraction: [0, 1] },
                    },
                  ],
                },
              },
              sequences: [{ content: [{ duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 4 } }] }] }],
            },
          ],
        },
      ],
    };
    const score = parseMnx(mnx);
    const expr = score.parts[0]?.measures[0]?.expressions;
    expect(expr?.[0]?.inline).toBeUndefined();
  });

  it("should round-trip root _x.viritura.textStyles", () => {
    const mnx = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        {
          measures: [
            {
              sequences: [{ content: [{ duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 4 } }] }] }],
            },
          ],
        },
      ],
      _x: {
        viritura: {
          textStyles: {
            tempo: { size: 3, italic: true, family: "sans-serif" },
            title: { color: "#FF0000" },
          },
        },
      },
    };
    const score = parseMnx(mnx);
    expect(score.textStyles).toEqual({
      tempo: { size: 3, italic: true, family: "sans-serif" },
      title: { color: "#FF0000" },
    });
    const out = serializeMnx(score) as { _x?: { viritura?: { textStyles?: unknown } } };
    expect(out._x?.viritura?.textStyles).toEqual(score.textStyles);
  });

  it("should migrate legacy time signature presets to orthogonal settings", () => {
    const mnx = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        {
          measures: [
            {
              sequences: [{ content: [{ duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 4 } }] }] }],
            },
          ],
        },
      ],
      _x: { viritura: { timeSignatures: { score: "large", parts: "singleNumber" } } },
    };
    const score = parseMnx(mnx);
    expect(score.timeSignatures).toEqual({
      score: { scale: 1.5 },
      parts: { renderStyle: "singleNumber", scale: 2 },
    });
    const out = serializeMnx(score) as { _x?: { viritura?: { timeSignatures?: unknown } } };
    expect(out._x?.viritura?.timeSignatures).toEqual({
      score: { scale: 1.5 },
      parts: { renderStyle: "singleNumber", scale: 2 },
    });
  });

  it("should restore the outside-staff digit cut when migrating spanning", () => {
    const mnx = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        {
          measures: [
            {
              sequences: [{ content: [{ duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 4 } }] }] }],
            },
          ],
        },
      ],
      _x: { viritura: { timeSignatures: { score: "spanning" } } },
    };
    const score = parseMnx(mnx);
    expect(score.timeSignatures?.score).toEqual({
      renderStyle: "outsideStaff",
      distribution: "perGroup",
      scale: 2,
    });
  });

  it("should round-trip decoupled time signature settings", () => {
    const mnx = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        {
          measures: [
            {
              sequences: [{ content: [{ duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 4 } }] }] }],
            },
          ],
        },
      ],
      _x: {
        viritura: {
          timeSignatures: {
            score: {
              renderStyle: "narrow",
              distribution: "perGroup",
              grandStaff: "exclude",
              position: "above",
              scale: 1.7,
              senzaMisura: "hidden",
            },
          },
        },
      },
    };
    const score = parseMnx(mnx);
    expect(score.timeSignatures?.score).toEqual({
      renderStyle: "narrow",
      distribution: "perGroup",
      grandStaff: "exclude",
      position: "above",
      scale: 1.7,
      senzaMisura: "hidden",
    });
    const out = serializeMnx(score) as { _x?: { viritura?: { timeSignatures?: unknown } } };
    expect(out._x?.viritura?.timeSignatures).toEqual(score.timeSignatures);
  });

  it("should reject a time signature style the schema does not define", () => {
    const mnx = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        {
          measures: [
            {
              sequences: [{ content: [{ duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 4 } }] }] }],
            },
          ],
        },
      ],
      _x: { viritura: { timeSignatures: { score: "enormous", parts: "narrow" } } },
    };
    expect(() => parseMnx(mnx)).toThrow(/timeSignatures/);
  });
});

describe("auto-ID assignment", () => {
  const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it("assigns IDs to global measures that lack them", () => {
    const score = parseMnx(helloWorldMnx);
    expect(score.global.measures[0]!.id).toBeDefined();
    expect(score.global.measures[0]!.id).toMatch(UUID_V7);
  });

  it("assigns IDs to parts that lack them", () => {
    const score = parseMnx(helloWorldMnx);
    expect(score.parts[0]!.id).toBeDefined();
    expect(score.parts[0]!.id).toMatch(UUID_V7);
  });

  it("assigns IDs to events that lack them", () => {
    const score = parseMnx(helloWorldMnx);
    const event = score.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    expect(event.type).toBe("event");
    if (event.type === "event") {
      expect(event.id).toBeDefined();
      expect(event.id).toMatch(UUID_V7);
    }
  });

  it("assigns IDs to notes that lack them", () => {
    const score = parseMnx(helloWorldMnx);
    const event = score.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    if (event.type === "event" && event.notes) {
      expect(event.notes[0]!.id).toBeDefined();
      expect(event.notes[0]!.id).toMatch(UUID_V7);
    }
  });

  it("assigns unique IDs across the score (no internal collisions)", () => {
    const score = parseMnx(helloWorldMnx);
    const seen = new Set<string>();
    function walk(content: (typeof score.parts)[0]["measures"][0]["sequences"][0]["content"]): void {
      for (const item of content) {
        if (item.type === "event") {
          if (item.id) {
            expect(seen.has(item.id)).toBe(false);
            seen.add(item.id);
          }
          if (item.notes) {
            for (const n of item.notes) {
              if (n.id) {
                expect(seen.has(n.id)).toBe(false);
                seen.add(n.id);
              }
            }
          }
        }
      }
    }
    for (const gm of score.global.measures) {
      if (gm.id) {
        expect(seen.has(gm.id)).toBe(false);
        seen.add(gm.id);
      }
    }
    for (const part of score.parts) {
      if (part.id) {
        expect(seen.has(part.id)).toBe(false);
        seen.add(part.id);
      }
      for (const pm of part.measures) {
        for (const seq of pm.sequences) walk(seq.content);
      }
    }
  });

  it("preserves existing IDs from the source file", () => {
    const mnx = {
      mnx: { version: 1 },
      global: { measures: [{ id: "my-custom-id", time: { count: 4, unit: 4 } }] },
      parts: [
        {
          id: "P1",
          measures: [
            {
              sequences: [
                {
                  content: [
                    {
                      id: "ev1",
                      duration: { base: "whole" },
                      notes: [{ id: "n1", pitch: { step: "C", octave: 4 } }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const score = parseMnx(mnx);
    expect(score.global.measures[0]!.id).toBe("my-custom-id");
    expect(score.parts[0]!.id).toBe("P1");
    const event = score.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    if (event.type === "event") {
      expect(event.id).toBe("ev1");
      expect(event.notes![0]!.id).toBe("n1");
    }
  });

  it("all assigned IDs are unique within a score", () => {
    const mnx = {
      mnx: { version: 1 },
      global: {
        measures: [{ time: { count: 4, unit: 4 } }, {}, {}],
      },
      parts: [
        {
          measures: [
            {
              sequences: [
                { content: [{ duration: { base: "quarter" }, notes: [{ pitch: { step: "C", octave: 4 } }] }] },
              ],
            },
            {
              sequences: [
                { content: [{ duration: { base: "quarter" }, notes: [{ pitch: { step: "D", octave: 4 } }] }] },
              ],
            },
            {
              sequences: [
                { content: [{ duration: { base: "quarter" }, notes: [{ pitch: { step: "E", octave: 4 } }] }] },
              ],
            },
          ],
        },
      ],
    };
    const score = parseMnx(mnx);
    const ids = new Set<string>();
    for (const gm of score.global.measures) {
      expect(ids.has(gm.id!)).toBe(false);
      ids.add(gm.id!);
    }
    expect(ids.has(score.parts[0]!.id!)).toBe(false);
    ids.add(score.parts[0]!.id!);
    for (const pm of score.parts[0]!.measures) {
      for (const seq of pm.sequences) {
        for (const item of seq.content) {
          if (item.type === "event") {
            expect(ids.has(item.id!)).toBe(false);
            ids.add(item.id!);
            if (item.notes) {
              for (const n of item.notes) {
                expect(ids.has(n.id!)).toBe(false);
                ids.add(n.id!);
              }
            }
          }
        }
      }
    }
  });
});

describe("dynamic-group semantic validation", () => {
  function scoreWithGlyph(glyph: string) {
    return {
      mnx: { version: 1 },
      global: { measures: [{ id: "m1", time: { count: 4, unit: 4 } }] },
      parts: [
        {
          measures: [
            {
              dynamics: [
                {
                  id: "01900000-0000-7000-8000-000000000001",
                  type: "accent",
                  position: { fraction: [0, 1] },
                  value: "f",
                  glyphs: [glyph],
                },
              ],
              sequences: [{ content: [{ duration: { base: "whole" }, rest: {} }] }],
            },
          ],
        },
      ],
    };
  }

  it("accepts supported SMuFL dynamic glyph names", () => {
    expect(() => parseMnx(scoreWithGlyph("dynamicSforzato"))).not.toThrow();
  });

  it("rejects unsupported SMuFL dynamic glyph names", () => {
    expect(() => parseMnx(scoreWithGlyph("gClef"))).toThrow(/unsupported SMuFL dynamic glyph/);
  });
});

describe("parseMnxWithDiagnostics scanUnknownFields", () => {
  // Re-import is unnecessary; module-level imports already include parseMnx,
  // but we need parseMnxWithDiagnostics for these tests.
  it("emits unknown-field info for an unrecognized root key", async () => {
    const { parseMnxWithDiagnostics } = await import("../mnx/parser");
    const mnx = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        {
          measures: [
            {
              sequences: [
                {
                  content: [{ duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 4 } }] }],
                },
              ],
            },
          ],
        },
      ],
      bogusRootKey: 42,
    };
    const { diagnostics } = parseMnxWithDiagnostics(mnx);
    const unknown = diagnostics.filter((d) => d.code === "unknown-field");
    expect(unknown.length).toBeGreaterThan(0);
    expect(unknown.some((d) => d.pointer === "/bogusRootKey")).toBe(true);
    expect(unknown.every((d) => d.severity === "info")).toBe(true);
  });

  it("does not emit unknown-field for _x vendor extensions", async () => {
    const { parseMnxWithDiagnostics } = await import("../mnx/parser");
    const mnx = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        {
          measures: [
            {
              sequences: [
                {
                  content: [{ duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 4 } }] }],
                },
              ],
            },
          ],
        },
      ],
      _x: { viritura: { anything: true } },
      _c: "free-form comment",
    };
    const { diagnostics } = parseMnxWithDiagnostics(mnx);
    const unknown = diagnostics.filter((d) => d.code === "unknown-field");
    expect(unknown.length).toBe(0);
  });

  it("emits unknown-field deep inside an event with a JSON pointer to the bad key", async () => {
    const { parseMnxWithDiagnostics } = await import("../mnx/parser");
    const mnx = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        {
          measures: [
            {
              sequences: [
                {
                  content: [
                    {
                      duration: { base: "whole" },
                      notes: [{ pitch: { step: "C", octave: 4 } }],
                      madeUpField: "ignored",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const { diagnostics } = parseMnxWithDiagnostics(mnx);
    const hit = diagnostics.find((d) => d.code === "unknown-field" && d.pointer.endsWith("/madeUpField"));
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe("info");
    expect(hit!.pointer).toBe("/parts/0/measures/0/sequences/0/content/0/madeUpField");
  });
});

describe("score name serialization", () => {
  // `name` is required by the MNX schema and the engine's `raw::Score` —
  // deserialization fails with "missing field `name`" if it's absent. Legacy
  // or externally-authored MNX files can carry scores without one, so the
  // serializer must always emit the field to keep the document loadable.
  const baseMnx = {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [
      {
        measures: [
          {
            clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
            sequences: [{ content: [{ duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 4 } }] }] }],
          },
        ],
      },
    ],
  };

  it("always emits a name for a score that lacks one", () => {
    const score = parseMnx(baseMnx);
    score.scores = [{ layout: "L1" }];
    const out = serializeMnx(score) as { scores?: Array<{ name?: unknown }> };
    expect(out.scores).toHaveLength(1);
    expect(out.scores![0]).toHaveProperty("name");
    expect(typeof out.scores![0]!.name).toBe("string");
  });

  it("preserves an explicit score name", () => {
    const score = parseMnx(baseMnx);
    score.scores = [{ name: "Full Score", layout: "L1" }];
    const out = serializeMnx(score) as { scores?: Array<{ name?: unknown }> };
    expect(out.scores![0]!.name).toBe("Full Score");
  });
});
