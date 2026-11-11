import { describe, expect, it } from "vitest";
import type { NoteEvent, Score } from "@viritura/core";
import { deleteLeafTarget, deletionOperations, resolveDeletionTarget } from "../commands/deletion";
import { computeDeleteSelection } from "../commands/computeDeleteSelection";

function fixture(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{}] },
    parts: [
      {
        measures: [
          {
            sequences: [
              {
                content: [
                  {
                    type: "event",
                    id: "a",
                    duration: { base: "whole" },
                    notes: [{ pitch: { step: "C", octave: 4, alter: 1 } }, { pitch: { step: "E", octave: 4 } }],
                    markings: { accent: {} },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("deletion operation contract", () => {
  it.each(["segno", "coda", "fine"] as const)("resolves and removes the %s navigation marker", (kind) => {
    const score = fixture();
    score.global.measures[0]![kind] = {};
    const target = resolveDeletionTarget(`m0/${kind}`);
    expect(target.kind).toBe(kind);
    const next = deleteLeafTarget(score, target, { scoreIndex: 0, forceDirect: false });
    expect(next?.global.measures[0]![kind]).toBeUndefined();
    expect(score.global.measures[0]![kind]).toEqual({});
  });

  it("recognizes grace targets without treating unknown grace leaves as events", () => {
    expect(resolveDeletionTarget("p0/m0/s0/a/grace/g1").kind).toBe("grace-note");
    expect(resolveDeletionTarget("p0/m0/s0/a/grace/g1/n0").kind).toBe("grace-note");
    expect(resolveDeletionTarget("p0/m0/s0/a/grace/g1/unknown").kind).toBe("unknown");
  });

  it.each([false, true])("routes merged articulations with expansion isolation=%s", (forceDirect) => {
    const score = fixture();
    score.parts[0]!.id = "one";
    score.parts.push(structuredClone(score.parts[0]!));
    score.parts[1]!.id = "two";
    score.layouts = [{ id: "condensed", content: [{ type: "staff", sources: [{ part: "one" }, { part: "two" }] }] }];
    score.scores = [{ name: "Condensed", layout: "condensed" }];
    const next = deleteLeafTarget(score, resolveDeletionTarget("p0/m0/s0/a/art-accent"), {
      scoreIndex: 0,
      forceDirect,
    });
    expect(next).not.toBeNull();
    for (const [index, part] of next!.parts.entries()) {
      const event = part.measures[0]!.sequences[0]!.content[0] as NoteEvent;
      expect(event.markings?.accent).toEqual(forceDirect && index === 1 ? {} : undefined);
    }
  });
  it("requires an operation or an explicit unsupported reason for every declared kind", () => {
    for (const operation of Object.values(deletionOperations)) {
      if (operation.kind === "unsupported") expect(operation.reason.trim().length).toBeGreaterThan(0);
      if (operation.kind === "leaf") expect(operation.remove).toBeTypeOf("function");
    }
  });

  it("fails closed for unknown subobjects despite presentation classification", () => {
    expect(resolveDeletionTarget("p0/m0/s0/a/unrecognized").kind).toBe("unknown");
    expect(
      deleteLeafTarget(fixture(), resolveDeletionTarget("p0/m0/s0/a/unrecognized"), {
        scoreIndex: 0,
        forceDirect: false,
      }),
    ).toBeNull();
  });

  it("isolates mutating leaf helpers from the input snapshot", () => {
    const score = fixture();
    const original = structuredClone(score);
    const next = deleteLeafTarget(score, resolveDeletionTarget("p0/m0/s0/a/art-accent"), {
      scoreIndex: 0,
      forceDirect: false,
    });
    expect(next).not.toBeNull();
    expect((next!.parts[0]!.measures[0]!.sequences[0]!.content[0] as NoteEvent).markings).toBeUndefined();
    expect(score).toEqual(original);
  });

  it.each(["p0/m0/s0/a", "p0/m0/s0/a/n0", "p0/m0/s0/a/acc0", "p0/m0/s0/a/art-accent"])(
    "keeps menu computation immutable for %s",
    (elementId) => {
      const score = fixture();
      const original = structuredClone(score);
      const result = computeDeleteSelection(score, { kind: "single", elementId });
      expect(result.kind).not.toBe("noop");
      expect(score).toEqual(original);
    },
  );
});
