import { describe, expect, it } from "vitest";
import { walkSequenceEvents, type NoteEvent, type Score, type Tuplet } from "@viritura/core";
import { applyPaste, type PasteResult } from "../../commands/clipboardCommands";
import { computePasteResult } from "../computePasteResult";

function directedEvent(id = "copied"): NoteEvent {
  return {
    type: "event",
    id,
    duration: { base: "quarter" },
    stemDirection: "up",
    notes: [
      {
        id: `${id}-note`,
        pitch: { step: "C", octave: 4 },
        ties: [
          { target: "target-note", side: "down", targetType: "crossVoice" },
          { lv: true, side: "up" },
        ],
        markings: { slideOut: { type: "falloff" } },
      },
    ],
    kitNotes: [{ id: `${id}-kit`, kitComponent: "snare", ties: [{ lv: true, side: "down" }] }],
    slurs: [
      {
        target: "target",
        side: "down",
        sideEnd: "up",
        lineType: "dashed",
        shape: { p1: [1, 2] },
      },
    ],
    fermata: { placement: "below", pointing: "down", symbol: "angled", duration: "long" },
    markings: {
      staccato: { placement: "above", color: "#ff0000" },
      staccatissimo: { placement: "below" },
      staccatissimoWedge: { placement: "above" },
      spiccato: { placement: "below" },
      tenuto: { placement: "above" },
      accent: { placement: "below" },
      strongAccent: { placement: "above", pointing: "down" },
      softAccent: { placement: "below" },
      stress: { placement: "above" },
      unstress: { placement: "below" },
      tremolo: { marks: 3, placement: "above" },
      breath: { symbol: "comma", placement: "below" },
      bowDirection: { direction: "up", placement: "above" },
      arpeggio: { direction: "down" },
    },
  };
}

function destination(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ id: "m0", time: { count: 4, unit: 4 } }, { id: "m1" }] },
    parts: [
      {
        measures: [0, 1].map(() => ({
          clefs: [{ clef: { sign: "F" as const, staffPosition: 2 } }],
          sequences: [{ staff: 1, directionHint: "lower" as const, content: [] }],
        })),
      },
    ],
  };
}

function placedEvents(score: Score): NoteEvent[] {
  return score.parts.flatMap((part) =>
    part.measures.flatMap((measure) =>
      measure.sequences.flatMap((sequence) => [...walkSequenceEvents(sequence.content)].map(({ event }) => event)),
    ),
  );
}

function expectAutomatic(event: NoteEvent): void {
  expect(event).not.toHaveProperty("stemDirection");
  for (const marking of Object.values(event.markings ?? {})) {
    expect(marking).not.toHaveProperty("placement");
    expect(marking).not.toHaveProperty("pointing");
  }
  if (event.fermata) {
    expect(event.fermata).not.toHaveProperty("placement");
    expect(event.fermata).not.toHaveProperty("pointing");
  }
  for (const slur of event.slurs ?? []) {
    expect(slur).not.toHaveProperty("side");
    expect(slur).not.toHaveProperty("sideEnd");
    expect(slur).not.toHaveProperty("shape");
  }
  for (const note of [...(event.notes ?? []), ...(event.kitNotes ?? [])]) {
    for (const tie of note.ties ?? []) expect(tie).not.toHaveProperty("side");
  }
}

describe("automatic directions on paste", () => {
  it.each(["single", "physical", "legacy"] as const)(
    "resets visual overrides but preserves musical directions and source data (%s)",
    (mode) => {
      const event = directedEvent();
      const score = destination();
      const untouched = directedEvent("untouched");
      untouched.duration = { base: "half" };
      score.parts[0]!.measures[0]!.sequences[0]!.content = [
        { type: "event", duration: { base: "half" }, rest: {} },
        untouched,
      ];
      const paste: PasteResult = {
        content: [event],
        ...(mode === "single"
          ? {}
          : {
              tracks: [
                { partOffset: 0, voiceIndex: 0, content: [event], ...(mode === "physical" ? { staffOffset: 0 } : {}) },
              ],
            }),
      };
      const before = structuredClone({ score, paste });
      const result = applyPaste(score, paste, 0, 0, 0, 0);
      const placed = placedEvents(result)[0]!;
      expectAutomatic(placed);
      expect(placed.markings?.bowDirection).toEqual({ direction: "up" });
      expect(placed.markings?.arpeggio).toEqual({ direction: "down" });
      expect(placed.markings?.tremolo).toEqual({ marks: 3 });
      expect(placed.markings?.staccato).toEqual({ color: "#ff0000" });
      expect(placed.fermata).toEqual({ symbol: "angled", duration: "long" });
      expect(placed.notes?.[0]?.pitch).toEqual(event.notes![0]!.pitch);
      expect(placed.notes?.[0]?.markings).toEqual(event.notes![0]!.markings);
      expect(placed.notes?.[0]?.ties).toEqual([{ target: "target-note", targetType: "crossVoice" }, { lv: true }]);
      expect(placed.slurs).toEqual([{ target: "target", lineType: "dashed" }]);
      expect(result.parts[0]!.measures[0]!.sequences[0]!.directionHint).toBe("lower");
      expect(placedEvents(result).at(-1)).toEqual(untouched);
      expect({ score, paste }).toEqual(before);
    },
  );

  it("resets directions inside nested tuplets, grace groups, and tremolos", () => {
    const nested: Tuplet = {
      type: "tuplet",
      placement: "below",
      bracket: "yes",
      inner: { multiple: 3, duration: { base: "eighth" } },
      outer: { multiple: 2, duration: { base: "eighth" } },
      content: [0, 1, 2].map((index) => ({ ...directedEvent(`nested${index}`), duration: { base: "eighth" } })),
    };
    const tuplet: Tuplet = {
      type: "tuplet",
      placement: "above",
      showNumber: "both",
      inner: { multiple: 3, duration: { base: "quarter" } },
      outer: { multiple: 2, duration: { base: "quarter" } },
      content: [
        { type: "grace", slash: true, content: [directedEvent("grace")] },
        directedEvent(),
        nested,
        {
          type: "tremolo",
          marks: 2,
          outer: { multiple: 1, duration: { base: "quarter" } },
          content: [directedEvent("tremolo1"), directedEvent("tremolo2")],
        },
      ],
    };
    const before = structuredClone(tuplet);
    const result = applyPaste(destination(), { content: [tuplet] }, 0, 0, 0, 0);
    for (const event of placedEvents(result)) expectAutomatic(event);
    const placed = result.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    expect(placed).not.toHaveProperty("placement");
    expect(placed).toMatchObject({
      showNumber: "both",
      content: [{ type: "grace", slash: true }, {}, { type: "tuplet", bracket: "yes" }, { type: "tremolo", marks: 2 }],
    });
    if (placed.type === "tuplet") expect(placed.content[2]).not.toHaveProperty("placement");
    expect(tuplet).toEqual(before);
  });

  it("normalizes every fragment when a note crosses a destination barline", () => {
    const score = destination();
    score.global.measures[0]!.time = { count: 3, unit: 4 };
    const event = directedEvent();
    event.duration = { base: "whole" };
    const result = applyPaste(score, { content: [event] }, 0, 0, 0, 0);
    const placed = placedEvents(result);
    expect(placed).toHaveLength(2);
    for (const fragment of placed) expectAutomatic(fragment);
    expect(placed[0]!.notes![0]!.ties).toEqual([{ target: placed[1]!.notes![0]!.id }]);
  });

  it.each([false, true])("resets dynamic placement without changing its meaning (absolute offsets: %s)", (absolute) => {
    const paste: PasteResult = {
      content: [directedEvent()],
      dynamics: [
        {
          measureOffset: 0,
          ...(absolute ? { offset: [0, 1] } : {}),
          dynamic: { id: "dynamic", type: "immediate", position: { fraction: [0, 1] }, value: "p", placement: "above" },
        },
      ],
    };
    const before = structuredClone(paste);
    const result = applyPaste(destination(), paste, 0, 0, 0, 0);
    const dynamic = result.parts[0]!.measures[0]!.dynamics![0]!;
    expect(dynamic).toMatchObject({ type: "immediate", value: "p" });
    expect(dynamic).not.toHaveProperty("placement");
    expect(paste).toEqual(before);
  });

  it("keeps merged chords automatic after incorporating destination articulations", () => {
    const score = destination();
    const existing = directedEvent("destination");
    existing.markings = { accent: { placement: "below" } };
    existing.notes = [{ pitch: { step: "E", octave: 4 } }];
    score.parts[0]!.measures[0]!.sequences[0]!.content = [existing];
    const copied = directedEvent();
    copied.markings = { staccato: { placement: "above" } };
    const result = computePasteResult(
      score,
      {
        kind: "single",
        elementType: "event",
        elementId: "p0/m0/s0/destination",
      },
      { content: [copied] },
      undefined,
      { merge: true },
    );
    expect(result).not.toBeNull();
    const placed = placedEvents(result!.newScore)[0]!;
    expectAutomatic(placed);
    expect(placed.notes).toHaveLength(2);
    expect(placed.markings).toEqual({ staccato: {}, accent: {} });
    expect(existing.markings).toEqual({ accent: { placement: "below" } });
  });
});
