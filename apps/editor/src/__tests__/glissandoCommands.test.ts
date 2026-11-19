import { describe, expect, it } from "vitest";
import type { NoteEvent, Score } from "@viritura/core";
import { generateTimeline } from "@viritura/midi";
import {
  addGlissando,
  removeGlissandoByElementId,
  resolveGlissandoSelectionEvents,
  setGlissandoProperties,
} from "../commands/glissandoCommands";
import { eventEndBeatPosition } from "../app/timedAnnotationPosition";
import { getEventAtLocation } from "../score/ElementPath";
import { selectionReducer, type SelectionState } from "../store/selectionStore";

function buildScore(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ id: "m1" }] },
    parts: [
      {
        id: "keyboard.piano",
        name: "Piano",
        staves: 2,
        measures: [
          {
            sequences: [
              {
                staff: 1,
                content: [
                  {
                    type: "event",
                    id: "source",
                    duration: { base: "quarter" },
                    notes: [{ id: "source-note", pitch: { step: "C", octave: 4 } }],
                  },
                ],
              },
              {
                staff: 2,
                content: [
                  {
                    type: "event",
                    id: "target",
                    duration: { base: "quarter" },
                    notes: [{ id: "target-note", pitch: { step: "G", octave: 3 } }],
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

function sourceEvent(score: Score): NoteEvent {
  return score.parts[0]!.measures[0]!.sequences[0]!.content[0] as NoteEvent;
}

function sequentialScore(): Score {
  const score = buildScore();
  const measure = score.parts[0]!.measures[0]!;
  const target = measure.sequences.pop()!.content[0]!;
  measure.sequences[0]!.content.push(target);
  return score;
}

function selectedEventIds(score: Score, selection: SelectionState): (string | undefined)[] {
  return resolveGlissandoSelectionEvents(score, selection, 0).map(
    (location) => getEventAtLocation(score, location)?.id,
  );
}

describe("glissando commands", () => {
  it.each([
    ["glissando", "p0/m0/s0/source/n0", "p0/m0/s0/target/n0"],
    ["glissando", "p0/m0/s0/target/n0", "p0/m0/s0/source/n0"],
    ["portamento", "p0/m0/s0/source/n0", "p0/m0/s0/target/n0"],
    ["portamento", "p0/m0/s0/target/n0", "p0/m0/s0/source/n0"],
  ] as const)("orders ordinary %s selections forward regardless of click order", (kind, first, second) => {
    const score = sequentialScore();
    const endpoints = selectedEventIds(score, { kind: "multi", elementIds: [first, second] });

    expect(endpoints).toEqual(["source", "target"]);
    addGlissando(score, { sourceEventId: endpoints[0]!, targetEventId: endpoints[1]!, kind });
    expect(sourceEvent(score).glissandos?.[0]?.target).toBe("target");
    expect(generateTimeline(score).diagnostics).toEqual([]);
  });

  it("preserves source-first click order when adding a repeat return to a shared target", () => {
    const score = buildScore();
    const entry = sourceEvent(score);
    const targetSequence = score.parts[0]!.measures[0]!.sequences.splice(1)[0]!;
    score.global.measures.push({ repeatStart: {} }, { repeatEnd: {} });
    const returnSource: NoteEvent = { ...entry, id: "return-source" };
    score.parts[0]!.measures.push({ sequences: [targetSequence] }, { sequences: [{ content: [returnSource] }] });
    addGlissando(score, { sourceEventId: "source", targetEventId: "target" });
    const endpoints = selectedEventIds(score, {
      kind: "multi",
      elementIds: ["p0/m2/s0/return-source/n0", "p0/m1/s0/target/n0"],
    });
    expect(endpoints).toEqual(["return-source", "target"]);
    expect(
      selectedEventIds(score, {
        kind: "multi",
        elementIds: ["p0/m1/s0/target/n0", "p0/m2/s0/return-source/n0"],
      }),
    ).toEqual(["target", "return-source"]);
    expect(
      selectedEventIds(score, {
        kind: "multi",
        elementIds: ["p0/m1/s0/target/n0", "p0/m0/s0/source/n0"],
      }),
    ).toEqual(["source", "target"]);
    addGlissando(score, { sourceEventId: endpoints[0]!, targetEventId: endpoints[1]! });
    expect(entry.glissandos).toEqual([{ target: "target", kind: "glissando", style: "wavy" }]);
    expect(returnSource.glissandos).toEqual(entry.glissandos);
    const timeline = generateTimeline(score);
    expect(timeline.diagnostics).toEqual([]);
    expect(timeline.events.filter((event) => event.type === "noteOn" && event.scoreEventId === "target")).toHaveLength(
      2,
    );
    const removed = removeGlissandoByElementId(score, "gliss/return-source/target")!;
    expect(sourceEvent(removed).glissandos).toEqual(entry.glissandos);
    expect((removed.parts[0]!.measures[2]!.sequences[0]!.content[0] as NoteEvent).glissandos).toBeUndefined();
  });

  it("preserves selection order inside a repeat, even away from its boundaries", () => {
    const score = sequentialScore();
    const middle = score.parts[0]!.measures[0]!;
    score.global.measures = [{ repeatStart: {} }, {}, { repeatEnd: {} }];
    score.parts[0]!.measures = [{ sequences: [] }, middle, { sequences: [] }];

    expect(
      selectedEventIds(score, {
        kind: "multi",
        elementIds: ["p0/m1/s0/target/n0", "p0/m1/s0/source/n0"],
      }),
    ).toEqual(["target", "source"]);
  });

  it("uses the selection anchor for two-note ranges inside a repeat", () => {
    const score = sequentialScore();
    const selection: SelectionState = {
      kind: "range",
      startElementId: "p0/m0/s0/target/n0",
      endElementId: "p0/m0/s0/source/n0",
    };

    expect(selectedEventIds(score, selection)).toEqual(["source", "target"]);
    score.global.measures[0]!.repeatStart = {};
    score.global.measures[0]!.repeatEnd = {};
    expect(selectedEventIds(score, selection)).toEqual(["target", "source"]);
  });

  it("recognizes an implicit repeat start but not a repeat played only once", () => {
    const score = sequentialScore();
    const measure = score.parts[0]!.measures[0]!;
    const target = measure.sequences[0]!.content.pop()!;
    score.parts[0]!.measures.push({ sequences: [{ content: [target] }] });
    score.global.measures.push({ repeatEnd: {} });
    const selection: SelectionState = {
      kind: "multi",
      elementIds: ["p0/m1/s0/target/n0", "p0/m0/s0/source/n0"],
    };

    expect(selectedEventIds(score, selection)).toEqual(["target", "source"]);
    score.global.measures[1]!.repeatEnd = { times: 1 };
    expect(selectedEventIds(score, selection)).toEqual(["source", "target"]);
  });

  it("orders endpoints in different repeated sections forward", () => {
    const score = sequentialScore();
    const sequence = score.parts[0]!.measures[0]!.sequences[0]!;
    const target = sequence.content.pop()!;
    score.global.measures = [{ repeatStart: {} }, { repeatEnd: {} }, { repeatStart: {} }, { repeatEnd: {} }];
    score.parts[0]!.measures = [
      { sequences: [] },
      { sequences: [sequence] },
      { sequences: [{ content: [target] }] },
      { sequences: [] },
    ];

    expect(
      selectedEventIds(score, {
        kind: "multi",
        elementIds: ["p0/m2/s0/target/n0", "p0/m1/s0/source/n0"],
      }),
    ).toEqual(["source", "target"]);
  });

  it("orders cross-staff selections by beat rather than sequence", () => {
    const score = buildScore();
    const [upper, lower] = score.parts[0]!.measures[0]!.sequences;
    upper!.content.unshift({ type: "space", duration: [1, 2] });
    lower!.content.unshift({ type: "space", duration: [1, 4] });

    expect(
      selectedEventIds(score, {
        kind: "multi",
        elementIds: ["p0/m0/s0/source/n0", "p0/m0/s1/target/n0"],
      }),
    ).toEqual(["target", "source"]);
  });

  it.each(["tuplet", "tremolo"] as const)("orders cross-staff selections inside a %s by beat", (containerType) => {
    const score = buildScore();
    const source = sourceEvent(score);
    const [upper, lower] = score.parts[0]!.measures[0]!.sequences;
    if (containerType === "tuplet") {
      upper!.content = [
        {
          type: "tuplet",
          inner: { duration: { base: "quarter" }, multiple: 3 },
          outer: { duration: { base: "quarter" }, multiple: 2 },
          content: [{ ...source, id: "first" }, source, { ...source, id: "last" }],
        },
      ];
    } else {
      source.duration = { base: "half" };
      upper!.content = [
        {
          type: "tremolo",
          marks: 2,
          outer: { duration: { base: "half" }, multiple: 1 },
          content: [{ ...source, id: "first" }, source],
        },
      ];
      expect(eventEndBeatPosition(upper!, { tupletIndex: 0, eventIndex: 1 })).toBe(2);
    }
    lower!.content.unshift({ type: "space", duration: [1, 8] });

    expect(
      selectedEventIds(score, {
        kind: "multi",
        elementIds: ["p0/m0/s0/source/n0", "p0/m0/s1/target/n0"],
      }),
    ).toEqual(["target", "source"]);
  });

  it("keeps selections on an expanded condensed staff on their source part", () => {
    const score = sequentialScore();
    const first = score.parts[0]!;
    first.id = "one";
    const second = structuredClone(first);
    second.id = "two";
    for (const content of second.measures[0]!.sequences[0]!.content) {
      if (content.type === "event") content.id += "-two";
    }
    score.parts.push(second);
    score.layouts = [{ id: "condensed", content: [{ type: "staff", sources: [{ part: "one" }, { part: "two" }] }] }];
    score.scores = [{ name: "Condensed", layout: "condensed" }];
    const firstClick = selectionReducer(
      { kind: "none" },
      {
        type: "SELECT_ELEMENT",
        elementId: "p1/m0/s0/target-two/n0",
        measureAnchor: { partIndex: 1, staffIndex: 1, measureIndex: 0, isExpansion: true },
      },
    );
    const selection = selectionReducer(firstClick, {
      type: "TOGGLE_SELECTION",
      elementId: "p1/m0/s0/source-two/n0",
    });

    expect(selectedEventIds(score, selection)).toEqual(["source-two", "target-two"]);
    score.global.measures[0]!.repeatStart = {};
    score.global.measures[0]!.repeatEnd = {};
    expect(selectedEventIds(score, selection)).toEqual(["target-two", "source-two"]);
  });

  it("creates a semantic portamento across staves", () => {
    const score = buildScore();

    addGlissando(score, {
      sourceEventId: "source",
      targetEventId: "target",
      kind: "portamento",
      style: "straight",
      text: "port.",
    });

    expect(sourceEvent(score).glissandos).toEqual([
      { target: "target", kind: "portamento", style: "straight", text: "port." },
    ]);
  });

  it("defaults glissandos to wavy lines and portamento to straight lines", () => {
    const gliss = buildScore();
    addGlissando(gliss, { sourceEventId: "source", targetEventId: "target", kind: "glissando" });
    expect(sourceEvent(gliss).glissandos?.[0]?.style).toBe("wavy");

    const port = buildScore();
    addGlissando(port, { sourceEventId: "source", targetEventId: "target", kind: "portamento" });
    expect(sourceEvent(port).glissandos?.[0]?.style).toBe("straight");
  });

  it("rejects endpoints in different parts", () => {
    const score = buildScore();
    score.parts.push({
      id: "strings.violin",
      name: "Violin",
      measures: [
        {
          sequences: [
            {
              content: [
                {
                  type: "event",
                  id: "other-part",
                  duration: { base: "quarter" },
                  notes: [{ pitch: { step: "D", octave: 5 } }],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(() => addGlissando(score, { sourceEventId: "source", targetEventId: "other-part" })).toThrow("same part");
  });

  it("edits and removes a selected line without removing either endpoint", () => {
    const score = buildScore();
    addGlissando(score, { sourceEventId: "source", targetEventId: "target" });

    setGlissandoProperties(score, {
      partIndex: 0,
      measureIndex: 0,
      sequenceIndex: 0,
      eventIndex: 0,
      kind: "portamento",
      style: "wavy",
      text: null,
    });
    expect(sourceEvent(score).glissandos).toEqual([{ target: "target", kind: "portamento", style: "wavy" }]);

    const removed = removeGlissandoByElementId(score, "gliss/source/target");
    expect(removed).not.toBeNull();
    expect(sourceEvent(removed!).glissandos).toBeUndefined();
    expect(removed!.parts[0]!.measures[0]!.sequences[1]!.content[0]).toMatchObject({ id: "target" });
  });

  it("removes a rendered line whose model endpoint IDs contain slashes", () => {
    const score = buildScore();
    sourceEvent(score).id = "source/1";
    const target = score.parts[0]!.measures[0]!.sequences[1]!.content[0] as NoteEvent;
    target.id = "target/1";
    addGlissando(score, { sourceEventId: "source/1", targetEventId: "target/1" });

    const removed = removeGlissandoByElementId(score, "gliss/source_1/target_1");

    expect(removed).not.toBeNull();
    expect(sourceEvent(removed!).glissandos).toBeUndefined();
  });
});
