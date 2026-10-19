import { describe, expect, it } from "vitest";
import { applyPatchesToScore, walkSequenceEvents, type Score } from "@viritura/core";
import { applyBreathFermata } from "../radialMenu/radialMenuActions";
import { globalCaesuraMeasure, planCaesuraProperties, selectedCaesura } from "../commands/caesura";
import { removeCaesura } from "../commands/markingSelection";

function score(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [
      {
        id: "piano",
        staves: 2,
        measures: [
          {
            sequences: [
              {
                content: [
                  {
                    type: "event",
                    id: "note",
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
}

function passage(): Score {
  const result = score();
  result.parts[0]!.measures = Array.from({ length: 2 }, (_, measureIndex) => ({
    sequences: [
      { staff: 1, voice: "upper" },
      { staff: 1, voice: "second" },
      { staff: 2, voice: "lower" },
    ].map(({ staff, voice }, sequenceIndex) => ({
      staff,
      voice,
      content: Array.from({ length: 4 }, (_, eventIndex) => ({
        type: "event" as const,
        id: `note-${measureIndex}-${sequenceIndex}-${eventIndex}`,
        duration: { base: "quarter" as const },
        notes: [{ pitch: { step: "C" as const, octave: 4 } }],
      })),
    })),
  }));
  result.global.measures.push({});
  return result;
}

function localCaesuras(document: Score): string[] {
  return document.parts.flatMap((part) =>
    part.measures.flatMap((measure) =>
      measure.sequences.flatMap((sequence) =>
        [...walkSequenceEvents(sequence.content)].flatMap(({ event }) => (event.markings?.caesura ? [event.id!] : [])),
      ),
    ),
  );
}

describe("global caesura authoring", () => {
  it.each([
    { startLocalStaffIndex: 0, endLocalStaffIndex: 0, expected: ["note-1-0-3"] },
    { startLocalStaffIndex: 1, endLocalStaffIndex: 1, expected: ["note-1-2-3"] },
    { startLocalStaffIndex: 0, endLocalStaffIndex: 1, expected: ["note-1-0-3", "note-1-2-3"] },
    { startLocalStaffIndex: 1, endLocalStaffIndex: 0, expected: ["note-1-0-3", "note-1-2-3"] },
  ])("adds one ending caesura on the selected staff range $startLocalStaffIndex-$endLocalStaffIndex", (test) => {
    const original = passage();
    const edited = applyBreathFermata(
      original,
      {
        kind: "measure",
        startPartIndex: 0,
        endPartIndex: 0,
        startStaffIndex: test.startLocalStaffIndex,
        endStaffIndex: test.endLocalStaffIndex,
        startLocalStaffIndex: test.startLocalStaffIndex,
        endLocalStaffIndex: test.endLocalStaffIndex,
        startMeasure: 1,
        endMeasure: 0,
      },
      { kind: "caesura" },
    )!;
    expect(localCaesuras(edited)).toEqual(test.expected);
    expect(edited.global.measures.every((measure) => measure.caesura === undefined)).toBe(true);
    expect(localCaesuras(original)).toEqual([]);
  });

  it.each([false, true])("uses the selected endpoint, including reversed ranges (%s)", (reverse) => {
    const ids = ["p0/m0/s0/note-0-0-0", "p0/m0/s0/note-0-0-1"];
    if (reverse) ids.reverse();
    const edited = applyBreathFermata(
      passage(),
      { kind: "range", startElementId: ids[0]!, endElementId: ids[1]! },
      { kind: "caesura" },
    )!;
    expect(localCaesuras(edited)).toEqual(["note-0-0-1"]);
  });

  it("keeps local endpoints confined to the selected parts", () => {
    const original = passage();
    original.parts.push(structuredClone(original.parts[0]!), structuredClone(original.parts[0]!));
    original.parts[1]!.id = "second";
    original.parts[2]!.id = "unselected";
    const edited = applyBreathFermata(
      original,
      { kind: "multi", elementIds: ["p0/m0/s2/note-0-2-2", "p1/m0/s0/note-0-0-2"] },
      { kind: "caesura" },
    )!;
    expect(localCaesuras(edited)).toEqual(["note-0-2-2", "note-0-0-2"]);
  });

  it("retains tuplet locations and compares their scaled endpoint against other voices", () => {
    const original = passage();
    const sequence = original.parts[0]!.measures[0]!.sequences[0]!;
    sequence.content = [
      {
        type: "tuplet",
        outer: { multiple: 2, duration: { base: "eighth" } },
        inner: { multiple: 3, duration: { base: "eighth" } },
        content: Array.from({ length: 3 }, (_, index) => ({
          type: "event",
          id: `triplet-${index}`,
          duration: { base: "eighth" },
          notes: [{ pitch: { step: "C", octave: 4 } }],
        })),
      },
    ];
    const edited = applyBreathFermata(
      original,
      { kind: "multi", elementIds: ["p0/m0/s0/triplet-0", "p0/m0/s0/triplet-2", "p0/m0/s1/note-0-1-0"] },
      { kind: "caesura" },
    )!;
    expect(localCaesuras(edited)).toEqual(["triplet-2"]);
  });

  it("leaves earlier markings intact and does not change breath's per-event behavior", () => {
    const original = passage();
    const event = original.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    if (event.type === "event") event.markings = { caesura: { style: "short" } };
    const selection = { kind: "multi" as const, elementIds: ["p0/m0/s0/note-0-0-0", "p0/m0/s0/note-0-0-1"] };
    const edited = applyBreathFermata(original, selection, { kind: "caesura" })!;
    expect(localCaesuras(edited)).toEqual(["note-0-0-0", "note-0-0-1"]);
    const first = edited.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    expect(first.type === "event" && first.markings?.caesura).toEqual({ style: "short" });
    const breath = applyBreathFermata(original, selection, { kind: "breath", symbol: "comma" })!;
    const events = [...walkSequenceEvents(breath.parts[0]!.measures[0]!.sequences[0]!.content)];
    expect(events.filter(({ event: candidate }) => candidate.markings?.breath)).toHaveLength(2);
  });

  it("chooses the latest rhythmic endpoint across voices, not the last sequence", () => {
    const edited = applyBreathFermata(
      passage(),
      { kind: "multi", elementIds: ["p0/m0/s0/note-0-0-3", "p0/m0/s1/note-0-1-0"] },
      { kind: "caesura" },
    )!;
    expect(localCaesuras(edited)).toEqual(["note-0-0-3"]);
  });

  it("broadcasts a selected condensed staff's endpoint to its source parts", () => {
    const original = passage();
    original.parts[0]!.staves = 1;
    for (const measure of original.parts[0]!.measures) measure.sequences = [measure.sequences[0]!];
    const second = structuredClone(original.parts[0]!);
    second.id = "flute";
    original.parts.push(second);
    original.layouts = [
      { id: "condensed", content: [{ type: "staff", sources: [{ part: "piano" }, { part: "flute" }] }] },
    ];
    original.scores = [{ name: "Condensed", layout: "condensed" }];
    const edited = applyBreathFermata(
      original,
      { kind: "range", startElementId: "p0/m0/s0/note-0-0-0", endElementId: "p0/m0/s0/note-0-0-1" },
      { kind: "caesura" },
      0,
    )!;
    expect(localCaesuras(edited)).toEqual(["note-0-0-1", "note-0-0-1"]);
  });

  it("attaches a barline hold to the preceding global measure, not an event", () => {
    const edited = applyBreathFermata(score(), { kind: "single", elementId: "m1/barline" }, { kind: "caesura" })!;
    expect(edited.global.measures[0]!.caesura).toEqual({});
    expect(edited.parts[0]!.measures[0]!.sequences[0]!.content[0]).not.toHaveProperty("markings");
    expect(applyBreathFermata(score(), { kind: "single", elementId: "m0/barline" }, { kind: "caesura" })).toBeNull();
  });

  it("keeps note selection event-local", () => {
    const edited = applyBreathFermata(score(), { kind: "single", elementId: "p0/m0/s0/note" }, { kind: "caesura" })!;
    expect(edited.global.measures[0]!.caesura).toBeUndefined();
    expect(selectedCaesura(edited, "p0/m0/s0/note/caesura")).toEqual({});
    const eventEdited = applyPatchesToScore(
      edited,
      planCaesuraProperties(edited, "p0/m0/s0/note/caesura", { marks: 1 })!,
    );
    expect(selectedCaesura(eventEdited, "p0/m0/s0/note/caesura")).toEqual({ marks: 1 });
  });

  it("edits and removes the single shared identity while retaining marker metadata", () => {
    const original = score();
    original.global.measures[0]!.caesura = { id: "pause", _c: "keep", _x: { test: 7 } };
    const id = "m0/caesura";
    expect(globalCaesuraMeasure(id)).toBe(0);
    const edited = applyPatchesToScore(original, planCaesuraProperties(original, id, { style: "thick", marks: 1 })!);
    expect(edited.global.measures[0]!.caesura).toEqual({
      id: "pause",
      _c: "keep",
      _x: { test: 7 },
      style: "thick",
      marks: 1,
    });
    expect(original.global.measures[0]!.caesura).not.toHaveProperty("style");
    const removed = applyPatchesToScore(edited, planCaesuraProperties(edited, id, undefined)!);
    expect(removed.global.measures[0]!.caesura).toBeUndefined();
    expect(removeCaesura(structuredClone(edited), id)!.global.measures[0]!.caesura).toBeUndefined();
  });
});
