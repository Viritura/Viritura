import { describe, expect, it } from "vitest";
import type { HarpPedalSetting, Score } from "@viritura/core";
import { produce } from "../score/scoreClone";
import { isSelectionIdValid } from "../store/useSelectionPruner";
import { computeDeleteSelection } from "../commands/deletion";
import { applyHarpPedalEdit, beginHarpPedalEdit, harpPedalEditError, removeHarpPedalEdit } from "./harpPedalEdits";
import { resolveHarpPedalTarget } from "./harpPedalTarget";
import { formatHarpPedalText, NATURAL_PEDALS, parseHarpPedalText } from "./harpPedalText";

function fixture(): Score {
  const event = (id: string) => ({
    type: "event" as const,
    id,
    duration: { base: "quarter" as const },
    notes: [{ pitch: { step: "C" as const, octave: 4 } }],
  });
  return {
    mnx: { version: 1 },
    global: { measures: [{ id: "m1", time: { count: 4, unit: 4 } }, { id: "m2" }] },
    parts: [
      {
        id: "harp",
        name: "Harp",
        staves: 2,
        _x: { viritura: { instrumentId: "pluck.harp" } },
        measures: [
          {
            sequences: [
              { staff: 1, content: [event("upper-1"), event("upper-2")] },
              { staff: 2, content: [event("lower-1"), event("lower-2")] },
            ],
          },
          { sequences: [{ content: [event("next")] }] },
        ],
      },
      {
        id: "flute",
        name: "Harp-like name",
        _x: { viritura: { instrumentId: "wind.flutes.flute" } },
        measures: [{ sequences: [{ content: [event("flute-note")] }] }, { sequences: [] }],
      },
    ],
  };
}

function selected(id: string) {
  return { kind: "single", elementId: id, elementType: "event" } as const;
}

function setting(id: string, fraction: [number, number]): HarpPedalSetting {
  return { id, position: { fraction }, tuning: NATURAL_PEDALS };
}

describe("harp pedal text", () => {
  it("parses and formats the physical order, including the requested syntax", () => {
    const parsed = parseHarpPedalText("^--|--v^");
    expect(parsed).toEqual({ D: -1, C: 0, B: 0, E: 0, F: 0, G: 1, A: -1 });
    expect(formatHarpPedalText(parsed!)).toBe("^--|--v^");
    expect(parseHarpPedalText(" ^ -- -- V ^ ")).toEqual(parsed);
  });

  it.each(["", "---", "---|---", "--|-----", "---||----", "---|--x-", "^--|--v^^"])(
    "rejects malformed or partial settings: %s",
    (value) => expect(parseHarpPedalText(value)).toBeNull(),
  );
});

describe("harp pedal selection and edits", () => {
  it("targets either staff at the selected rhythmic position and rejects ambiguous parts", () => {
    const score = fixture();
    expect(resolveHarpPedalTarget(score, selected("p0/m0/s0/upper-2"))).toEqual({
      partIndex: 0,
      measureIndex: 0,
      position: { fraction: [1, 4] },
    });
    expect(resolveHarpPedalTarget(score, selected("p0/m0/s1/lower-2"))).toEqual({
      partIndex: 0,
      measureIndex: 0,
      position: { fraction: [1, 4] },
    });
    expect(resolveHarpPedalTarget(score, selected("p1/m0/s0/flute-note"))).toBeNull();
    expect(
      resolveHarpPedalTarget(score, { kind: "multi", elementIds: ["p0/m0/s0/upper-1", "p1/m0/s0/flute-note"] }),
    ).toBeNull();
  });

  it("gates the command on the instrument change at the selected onset", () => {
    const score = fixture();
    score.parts[0]!._x!.viritura = {
      initialInstrument: "harp",
      instruments: { harp: { instrumentId: "pluck.harp" }, flute: { instrumentId: "wind.flutes.flute" } },
    };
    score.parts[0]!.measures[0]!.instrumentChanges = [{ instrument: "flute", position: { fraction: [1, 4] } }];
    expect(resolveHarpPedalTarget(score, selected("p0/m0/s0/upper-1"))).not.toBeNull();
    expect(resolveHarpPedalTarget(score, selected("p0/m0/s0/upper-2"))).toBeNull();
  });

  it("targets a selected harp bar or positioned dynamic without defaulting to another part", () => {
    const score = fixture();
    score.parts[0]!.measures[0]!.dynamics = [
      { id: "dyn", type: "immediate", position: { fraction: [3, 4] }, value: "p" },
    ];
    expect(resolveHarpPedalTarget(score, selected("p0/m0/dyndyn"))).toEqual({
      partIndex: 0,
      measureIndex: 0,
      position: { fraction: [3, 4] },
    });
    expect(
      resolveHarpPedalTarget(score, {
        kind: "measure",
        startPartIndex: 0,
        endPartIndex: 0,
        startStaffIndex: 1,
        endStaffIndex: 1,
        startMeasure: 1,
        endMeasure: 1,
      }),
    ).toEqual({ partIndex: 0, measureIndex: 1, position: { fraction: [0, 1] } });
  });

  it("resolves a tuplet note to its actual rhythmic position", () => {
    const score = fixture();
    const content = score.parts[0]!.measures[0]!.sequences[0]!.content;
    const first = content[0]!;
    const second = content[1]!;
    if (first.type !== "event" || second.type !== "event") throw new Error("Expected note events");
    first.duration = { base: "eighth" };
    second.duration = { base: "eighth" };
    content.splice(0, content.length, {
      type: "tuplet",
      inner: { multiple: 3, duration: { base: "eighth" } },
      outer: { multiple: 2, duration: { base: "eighth" } },
      content: [first, second, { ...structuredClone(first), id: "third" }],
    });
    expect(resolveHarpPedalTarget(score, selected("p0/m0/s0/upper-2"))?.position.fraction).toEqual([1, 12]);
  });

  it("edits an existing setting at an equivalent fraction without losing presentation", () => {
    const score = fixture();
    score.parts[0]!.measures[0]!.harpPedals = [
      { ...setting("existing", [2, 8]), source: "calculated", manualOffset: [1, 2], avoidCollisions: false, staff: 2 },
    ];
    const target = resolveHarpPedalTarget(score, selected("p0/m0/s0/upper-2"))!;
    const edit = beginHarpPedalEdit(score, target);
    const tuning = parseHarpPedalText("^--|--v^")!;
    const next = applyHarpPedalEdit(score, edit, tuning);
    expect(next.parts[0]!.measures[0]!.harpPedals).toEqual([
      expect.objectContaining({
        id: "existing",
        tuning,
        source: "manual",
        manualOffset: [1, 2],
        avoidCollisions: false,
        staff: 2,
      }),
    ]);
    expect(score.parts[0]!.measures[0]!.harpPedals![0]!.source).toBe("calculated");
  });

  it("rejects a concurrent setting at an equivalent position instead of overwriting it", () => {
    const score = fixture();
    const edit = beginHarpPedalEdit(score, resolveHarpPedalTarget(score, selected("p0/m0/s0/upper-2"))!);
    const changed = produce(score, (draft) => {
      draft.parts[0]!.measures[0]!.harpPedals = [setting("remote", [2, 8])];
    });
    expect(harpPedalEditError(changed, edit)).toContain("changed");
    expect(() => applyHarpPedalEdit(changed, edit, NATURAL_PEDALS)).toThrow("changed");
  });

  it("keeps and deletes a selected score-wide pedal ID, including IDs containing slashes", () => {
    const score = fixture();
    score.parts[0]!.measures[0]!.harpPedals = [setting("one/two/three", [0, 1])];
    const id = "harpPedal/one/two/three";
    expect(isSelectionIdValid(id, score)).toBe(true);
    const target = resolveHarpPedalTarget(score, selected(id))!;
    const edited = removeHarpPedalEdit(score, beginHarpPedalEdit(score, target));
    expect(isSelectionIdValid(id, edited)).toBe(false);
    const deleted = computeDeleteSelection(score, { kind: "single", elementId: id, elementType: "harp-pedal" });
    expect(deleted.kind).toBe("single");
    if (deleted.kind !== "single") throw new Error("Expected pedal deletion");
    expect(deleted.score.parts[0]!.measures[0]!.harpPedals).toBeUndefined();
    expect(score.parts[0]!.measures[0]!.harpPedals).toHaveLength(1);
  });
});
