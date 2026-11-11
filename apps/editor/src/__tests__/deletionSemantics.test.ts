import { describe, expect, it } from "vitest";
import { walkSequenceEvents, type NoteEvent, type Score } from "@viritura/core";
import { computeDeleteSelection } from "../commands/deletion";
import type { Selection } from "../store/selectionStore";
import { getEventAtLocation, resolveEventLocation } from "../score/ElementPath";

function note(id: string): NoteEvent {
  return {
    type: "event",
    id,
    duration: { base: "half" },
    notes: [{ id: `${id}-note`, pitch: { step: "C", octave: 4 } }],
  };
}

function fixture(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [{ id: "one", measures: [{ sequences: [{ content: [note("a"), note("b")] }] }] }],
  };
}

function events(score: Score): NoteEvent[] {
  return [...walkSequenceEvents(score.parts[0]!.measures[0]!.sequences[0]!.content)].map(({ event }) => event);
}

describe("shared deletion semantics", () => {
  it("selects a surviving replacement rest inside the original tuplet", () => {
    const score = fixture();
    score.parts[0]!.measures[0]!.sequences[0]!.content = [
      {
        type: "tuplet",
        inner: { duration: { base: "half" }, multiple: 3 },
        outer: { duration: { base: "half" }, multiple: 2 },
        content: [note("a"), note("b"), note("c")],
      },
      note("outside"),
    ];
    const result = computeDeleteSelection(score, { kind: "single", elementId: "p0/m0/s0/b" });
    if (result.kind !== "single") throw new Error("Expected event deletion");
    expect(result.nextSelection.kind).toBe("select");
    if (result.nextSelection.kind !== "select") throw new Error("Expected rest selection");
    const location = resolveEventLocation(result.nextSelection.elementId, result.score);
    if (!location) throw new Error("Selection must resolve in the new score");
    expect(location.tupletIndex).toBe(0);
    expect(getEventAtLocation(result.score, location)).toMatchObject({ type: "event", rest: {} });
  });

  it("keeps rectangular condensed-staff clearing canonical instead of broadcasting to other sources", () => {
    const score = fixture();
    score.parts.push({ ...structuredClone(score.parts[0]!), id: "two" });
    score.layouts = [{ id: "condensed", content: [{ type: "staff", sources: [{ part: "one" }, { part: "two" }] }] }];
    score.scores = [{ layout: "condensed" }];
    const result = computeDeleteSelection(score, {
      kind: "measure",
      startPartIndex: 0,
      endPartIndex: 0,
      startStaffIndex: 0,
      endStaffIndex: 0,
      startMeasure: 0,
      endMeasure: 0,
    });
    if (result.kind !== "measure") throw new Error("Expected bar clearing");
    expect(result.score.parts[0]!.measures[0]!.sequences[0]!.content).toEqual([]);
    expect(result.score.parts[1]).toEqual(score.parts[1]);
  });
  it.each([false, true])("routes condensed bar-rest fermatas with source isolation=%s", (expanded) => {
    const score = fixture();
    score.parts[0]!.measures[0]!.sequences = [{ content: [], fullMeasure: { fermata: {} } }];
    score.parts.push(structuredClone(score.parts[0]!));
    score.parts[1]!.id = "two";
    score.layouts = [{ id: "condensed", content: [{ type: "staff", sources: [{ part: "one" }, { part: "two" }] }] }];
    score.scores = [{ name: "Condensed", layout: "condensed" }];
    const result = computeDeleteSelection(score, {
      kind: "single",
      elementId: "p0/m0/s0/__auto_m0_v0_e0/ferm",
      ...(expanded && { measureAnchor: { partIndex: 0, staffIndex: 1, measureIndex: 0, isExpansion: true } }),
    });
    if (result.kind !== "single") throw new Error("Expected fermata deletion");
    for (const [index, part] of result.score.parts.entries()) {
      expect(part.measures[0]!.sequences[0]!.fullMeasure?.fermata).toEqual(expanded && index === 1 ? {} : undefined);
    }
  });
  it.each(["note", "rest", "tuplet", "grace", "bar-rest"] as const)(
    "removes a %s fermata without removing its owner",
    (attachment) => {
      for (const multi of [false, true]) {
        const score = fixture();
        const sequence = score.parts[0]!.measures[0]!.sequences[0]!;
        events(score)[0]!.fermata = {};
        let id = "p0/m0/s0/a/ferm";
        if (attachment === "rest") {
          delete events(score)[0]!.notes;
          events(score)[0]!.rest = {};
        } else if (attachment === "tuplet") {
          sequence.content = [
            {
              type: "tuplet",
              inner: { duration: { base: "half" }, multiple: 3 },
              outer: { duration: { base: "half" }, multiple: 2 },
              content: [note("a"), note("b"), note("c")],
            },
          ];
          events(score)[0]!.fermata = {};
        } else if (attachment === "grace") {
          delete events(score)[0]!.fermata;
          sequence.content.unshift({ type: "grace", content: [{ ...note("g"), fermata: {} }] });
          id = "p0/m0/s0/a/grace/g/ferm";
        } else if (attachment === "bar-rest") {
          sequence.content = [];
          sequence.fullMeasure = { visualDuration: { base: "whole" }, fermata: {} };
          id = "p0/m0/s0/__auto_m0_v0_e0/ferm";
        }
        const original = structuredClone(score);
        const selection: Selection = multi
          ? { kind: "multi", elementIds: [id, id] }
          : { kind: "single", elementId: id };
        const result = computeDeleteSelection(score, selection);
        if (result.kind === "noop") throw new Error(`Expected ${attachment} fermata removal`);
        const expected = structuredClone(original);
        const expectedSequence = expected.parts[0]!.measures[0]!.sequences[0]!;
        if (attachment === "bar-rest") delete expectedSequence.fullMeasure!.fermata;
        else delete events(expected)[0]!.fermata;
        expect(result.score).toEqual(expected);
        expect(score).toEqual(original);
        expect(computeDeleteSelection(result.score, selection)).toEqual({ kind: "noop" });
      }
    },
  );

  it("removes mixed fermatas and noteheads before note indices change", () => {
    const score = fixture();
    events(score)[0]!.fermata = {};
    events(score)[0]!.notes!.push({ pitch: { step: "E", octave: 4 } });
    const result = computeDeleteSelection(score, {
      kind: "multi",
      elementIds: ["p0/m0/s0/a/ferm", "p0/m0/s0/a/n0", "p0/m0/s0/b"],
    });
    if (result.kind !== "multi") throw new Error("Expected mixed deletion");
    expect(events(result.score)[0]!.fermata).toBeUndefined();
    expect(events(result.score)[0]!.notes?.[0]?.pitch.step).toBe("E");
    expect(events(result.score)[1]!.rest).toBeDefined();
  });

  it("coalesces multiple ordinal annotations before indices shift", () => {
    const score = fixture();
    score.parts[0]!.measures[0]!.expressions = [
      { position: { fraction: [0, 1] }, value: "one" },
      { position: { fraction: [1, 4] }, value: "two" },
      { position: { fraction: [1, 2] }, value: "keep" },
    ];
    const result = computeDeleteSelection(score, {
      kind: "multi",
      elementIds: ["p0/m0/expr0", "p0/m0/expr1", "p0/m0/expr0"],
    });
    if (result.kind !== "multi") throw new Error("Expected annotation deletion");
    expect(result.score.parts[0]!.measures[0]!.expressions?.map((value) => value.value)).toEqual(["keep"]);
    expect(events(result.score)).toEqual(events(score));
  });

  it.each(["slur", "tie"] as const)("removes selected %s connectors without removing endpoints", (kind) => {
    const score = fixture();
    const source = events(score)[0]!;
    if (kind === "slur") source.slurs = [{ target: "b" }];
    else source.notes![0]!.ties = [{ target: "b-note" }];
    const id = kind === "slur" ? "slur/a/b" : "tie/a-note/b-note";
    for (const multi of [false, true]) {
      const selection: Selection = multi ? { kind: "multi", elementIds: [id] } : { kind: "single", elementId: id };
      const result = computeDeleteSelection(score, selection);
      if (result.kind === "noop") throw new Error("Expected connector removal");
      expect(events(result.score)[0]!.notes).toHaveLength(1);
      expect(events(result.score)[1]!.notes).toHaveLength(1);
      expect(events(result.score)[0]!.slurs).toBeUndefined();
      expect(events(result.score)[0]!.notes![0]!.ties).toBeUndefined();
    }
  });

  it("does not publish an already-empty bar clearing", () => {
    const score = fixture();
    score.parts[0]!.measures[0]!.sequences[0] = { content: [], fullMeasure: { visualDuration: { base: "whole" } } };
    expect(
      computeDeleteSelection(score, {
        kind: "measure",
        startPartIndex: 0,
        endPartIndex: 0,
        startMeasure: 0,
        endMeasure: 0,
        startStaffIndex: 0,
        endStaffIndex: 0,
      }),
    ).toEqual({ kind: "noop" });
  });
});
