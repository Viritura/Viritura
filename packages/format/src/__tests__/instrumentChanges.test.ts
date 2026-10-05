import { describe, expect, it } from "vitest";
import { listInstrumentChanges, resolveActiveInstrument } from "@viritura/core";
import { parseMnx } from "../mnx/parser";
import { serializeMnx } from "../mnx/serializer";
import { validateRawScore } from "../mnx/validator";

const HORN_F = { interval: { halfSteps: 7, staffDistance: 4 } };
const HORN_EFLAT = { interval: { halfSteps: 9, staffDistance: 5 } };
const PICCOLO = { interval: { halfSteps: -12, staffDistance: -7 } };

interface ScoreOptions {
  transposition?: unknown;
  partExt?: Record<string, unknown>;
  changes?: unknown[][];
}

function scoreWithInstrumentChanges(options: ScoreOptions) {
  const changes = options.changes ?? [[], [], []];
  return {
    mnx: { version: 1 },
    global: { measures: changes.map(() => ({})) },
    parts: [
      {
        id: "P1",
        name: "Flute",
        ...(options.transposition !== undefined ? { transposition: options.transposition } : {}),
        measures: changes.map((measureChanges) => ({
          sequences: [{ content: [] }],
          ...(measureChanges.length > 0 ? { _x: { viritura: { instrumentChanges: measureChanges } } } : {}),
        })),
        ...(options.partExt ? { _x: { viritura: options.partExt } } : {}),
      },
    ],
  };
}

const doublingExt = {
  instrumentId: "wind.flutes.flute",
  initialInstrument: "fl",
  instruments: {
    fl: { instrumentId: "wind.flutes.flute", name: "Flute", shortName: "Fl." },
    picc: { instrumentId: "wind.flutes.flute.piccolo", name: "Piccolo", shortName: "Picc.", transposition: PICCOLO },
  },
};

describe("instrument-change extensions", () => {
  it("round-trips house-style defaults and explicit per-instance visibility", () => {
    const source = {
      ...scoreWithInstrumentChanges({
        changes: [
          [
            {
              transposition: HORN_F,
              instruction: { hidden: false, text: "Horn in F" },
              reminder: { hidden: true },
            },
          ],
        ],
      }),
      _x: { viritura: { instrumentChangeStyle: { showChangeLabel: false, showAdvanceReminder: true } } },
    };
    expect(validateRawScore(source).ok).toBe(true);
    const parsed = parseMnx(source);
    expect(parsed.instrumentChangeStyle).toEqual({ showChangeLabel: false, showAdvanceReminder: true });
    expect(serializeMnx(parsed)).toMatchObject(source);
    expect(
      validateRawScore({ ...source, _x: { viritura: { instrumentChangeStyle: { showChangeLabel: "yes" } } } }).ok,
    ).toBe(false);
  });

  it.each([undefined, {}, { text: "Prepare piccolo", hidden: false }, { hidden: true }])(
    "round-trips independent advance reminder %j",
    (reminder) => {
      const change = {
        instrument: "picc",
        instruction: { text: "At the change", hidden: true },
        ...(reminder === undefined ? {} : { reminder }),
      };
      const source = scoreWithInstrumentChanges({ partExt: doublingExt, changes: [[], [change], []] });
      expect(validateRawScore(source).ok).toBe(true);
      const parsed = parseMnx(source);
      expect(parsed.parts[0]!.measures[1]!.instrumentChanges?.[0]?.reminder).toEqual(reminder);
      expect(serializeMnx(parsed)).toMatchObject(source);
    },
  );

  it.each([{ text: 1 }, { hidden: "yes" }, { position: { fraction: [1, 4] } }])(
    "rejects malformed reminder %j",
    (reminder) => {
      expect(
        validateRawScore(
          scoreWithInstrumentChanges({ partExt: doublingExt, changes: [[{ instrument: "picc", reminder }]] }),
        ).ok,
      ).toBe(false);
    },
  );

  it("round-trips instruments and instrument, transposition, and combined changes", () => {
    const source = scoreWithInstrumentChanges({
      partExt: doublingExt,
      changes: [
        [],
        [{ instrument: "picc", instruction: { text: "muta in Picc." } }],
        [
          {
            position: { fraction: [1, 2] },
            instrument: "fl",
            transposition: { interval: { halfSteps: 0, staffDistance: 0 } },
          },
          { position: { fraction: [3, 4] }, transposition: PICCOLO, instruction: { hidden: true } },
        ],
      ],
    });
    expect(validateRawScore(source).ok).toBe(true);
    const parsed = parseMnx(source);
    expect(parsed.parts[0]!._x?.viritura?.instruments?.["picc"]?.transposition).toEqual(PICCOLO);
    expect(parsed.parts[0]!.measures[2]!.instrumentChanges).toHaveLength(2);
    expect(serializeMnx(parsed)).toMatchObject(source);
  });

  it("supports transposition-only changes without an instrument list", () => {
    const source = scoreWithInstrumentChanges({
      transposition: HORN_F,
      partExt: { instrumentId: "brass.french-horn" },
      changes: [[], [{ transposition: HORN_EFLAT }], []],
    });
    expect(validateRawScore(source).ok).toBe(true);
    expect(serializeMnx(parseMnx(source))).toMatchObject(source);
  });

  it("rejects a change that sets neither instrument nor transposition", () => {
    const result = validateRawScore(scoreWithInstrumentChanges({ changes: [[{ instruction: { text: "x" } }]] }));
    expect(result.ok).toBe(false);
  });

  it.each([
    [
      "missing initialInstrument",
      { ...doublingExt, initialInstrument: undefined },
      "/parts/0/_x/viritura/initialInstrument",
    ],
    [
      "unknown initialInstrument",
      { ...doublingExt, initialInstrument: "ob" },
      "/parts/0/_x/viritura/initialInstrument",
    ],
    [
      "mismatched instrumentId",
      { ...doublingExt, instrumentId: "wind.reed.oboe" },
      "/parts/0/_x/viritura/instrumentId",
    ],
  ])("rejects %s", (_label, partExt, pointer) => {
    const result = validateRawScore(scoreWithInstrumentChanges({ partExt }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.map((error) => error.pointer)).toContain(pointer);
  });

  it("rejects an initial instrument whose transposition differs from the part transposition", () => {
    const result = validateRawScore(
      scoreWithInstrumentChanges({
        partExt: { ...doublingExt, instrumentId: "wind.flutes.flute.piccolo", initialInstrument: "picc" },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]!.pointer).toBe("/parts/0/_x/viritura/instruments/picc/transposition");
    }
  });

  it("rejects unknown change targets and duplicate positions", () => {
    const result = validateRawScore(
      scoreWithInstrumentChanges({
        partExt: doublingExt,
        changes: [[{ instrument: "ob" }, { position: { fraction: [0, 4] }, instrument: "picc" }]],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((error) => error.pointer)).toEqual([
        "/parts/0/measures/0/_x/viritura/instrumentChanges/0/instrument",
        "/parts/0/measures/0/_x/viritura/instrumentChanges/1/position",
      ]);
    }
  });

  it("rejects inherited object properties as instrument references", () => {
    const result = validateRawScore(
      scoreWithInstrumentChanges({
        partExt: doublingExt,
        changes: [[{ instrument: "constructor" }]],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.keyword).toBe("reference");
  });
});

describe("resolveActiveInstrument", () => {
  const part = parseMnx(
    scoreWithInstrumentChanges({
      partExt: doublingExt,
      changes: [
        [],
        [{ instrument: "picc" }],
        [
          { position: { fraction: [3, 4] }, transposition: HORN_EFLAT },
          { position: { fraction: [1, 2] }, instrument: "fl" },
        ],
      ],
    }),
  ).parts[0]!;

  it("starts on the initial instrument and part transposition", () => {
    expect(resolveActiveInstrument(part, 0)).toEqual({
      instrumentKey: "fl",
      instrument: doublingExt.instruments.fl,
    });
  });

  it("applies an instrument change with its default transposition from its position", () => {
    expect(resolveActiveInstrument(part, 1)).toMatchObject({ instrumentKey: "picc", transposition: PICCOLO });
    expect(resolveActiveInstrument(part, 2, [1, 4])).toMatchObject({ instrumentKey: "picc" });
  });

  it("orders changes by position and resets the transposition on instrument changes", () => {
    const atHalf = resolveActiveInstrument(part, 2, [1, 2]);
    expect(atHalf.instrumentKey).toBe("fl");
    expect(atHalf.transposition).toBeUndefined();
    expect(resolveActiveInstrument(part, 2, [3, 4])).toMatchObject({ instrumentKey: "fl", transposition: HORN_EFLAT });
  });

  it("lists changes in musical order", () => {
    expect(listInstrumentChanges(part).map(({ measureIndex, position }) => [measureIndex, position])).toEqual([
      [1, [0, 1]],
      [2, [1, 2]],
      [2, [3, 4]],
    ]);
  });
});
