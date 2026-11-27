import { describe, expect, it } from "vitest";
import type { Pitch, Score } from "@viritura/core";
import { PatchReconstructor, type DisplayList, type DrawGlyph, type PatchFrame } from "@viritura/renderer";
import {
  EXTENDED_RANGE_NOTE_COLOR,
  highlightOutOfRangeNoteheads,
  OUT_OF_RANGE_NOTE_COLOR,
} from "./instrumentNoteRangeHighlights";

function makeScore(
  instrumentId: string,
  eventId = "event-1",
  pitches: Pitch[] = [
    { step: "C", octave: 3 },
    { step: "C", octave: 4 },
  ],
): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [
      {
        id: "flute",
        name: "Flute",
        _x: { viritura: { instrumentId } },
        measures: [
          {
            sequences: [
              {
                content: [
                  {
                    type: "event",
                    ...(eventId ? { id: eventId } : {}),
                    duration: { base: "whole" },
                    notes: pitches.map((pitch) => ({ pitch })),
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

function notehead(): DrawGlyph {
  return {
    type: "DrawGlyph",
    x: 10,
    y: 20,
    codepoint: 0xe0a4,
    font: "Bravura",
    size: 12,
    color: "#000000",
    rotation: 0,
  };
}

function displayList(noteCount = 2): DisplayList {
  return {
    commands: Array.from({ length: noteCount }, () => notehead()),
    elementIds: Array.from({ length: noteCount }, (_, index) => `p0/m0/s0/event-1/n${index}`),
    width: 100,
    height: 100,
  };
}

function changeFluteToBassoon(score: Score, fraction: [number, number]): void {
  const part = score.parts[0]!;
  part._x = {
    viritura: {
      instrumentId: "wind.flutes.flute",
      initialInstrument: "flute",
      instruments: {
        flute: { instrumentId: "wind.flutes.flute" },
        bassoon: { instrumentId: "wind.reed.bassoon" },
      },
    },
  };
  part.measures[0]!.instrumentChanges = [{ instrument: "bassoon", position: { fraction } }];
}

describe("instrument note-range highlights", () => {
  it("colors only noteheads outside the active catalog range, including retained layers", () => {
    const source = displayList();
    const retained = displayList();
    source.retainedRenderLayers = [{ displayList: retained, bounds: null, stateCommands: [] }];

    const highlighted = highlightOutOfRangeNoteheads(source, makeScore("wind.flutes.flute"));

    expect(highlighted).not.toBe(source);
    expect(highlighted.commands.map((command) => ("color" in command ? command.color : null))).toEqual([
      OUT_OF_RANGE_NOTE_COLOR,
      "#000000",
    ]);
    expect(
      highlighted.retainedRenderLayers?.[0]?.displayList.commands.map((command) =>
        "color" in command ? command.color : null,
      ),
    ).toEqual([OUT_OF_RANGE_NOTE_COLOR, "#000000"]);
    expect(source.commands[0]).toMatchObject({ color: "#000000" });
    expect(retained.commands[0]).toMatchObject({ color: "#000000" });
  });

  it("leaves notes unchanged when the part has no catalog instrument", () => {
    const source = displayList();

    expect(highlightOutOfRangeNoteheads(source, makeScore("custom.instrument"))).toBe(source);
  });

  it("accepts flute D7 and highlights the next semitone", () => {
    const score = makeScore("wind.flutes.flute", "event-1", [
      { step: "D", octave: 7 },
      { step: "D", octave: 7, alter: 1 },
    ]);

    expect(highlightOutOfRangeNoteheads(displayList(), score).commands).toMatchObject([
      { color: "#000000" },
      { color: OUT_OF_RANGE_NOTE_COLOR },
    ]);
  });

  it.each([
    {
      name: "flute",
      instrumentId: "wind.flutes.flute",
      pitches: [
        { step: "A", octave: 3, alter: 1 },
        { step: "B", octave: 3 },
        { step: "C", octave: 4 },
      ],
      colors: [OUT_OF_RANGE_NOTE_COLOR, EXTENDED_RANGE_NOTE_COLOR, "#000000"],
    },
    {
      name: "English horn",
      instrumentId: "wind.reed.english-horn",
      pitches: [
        { step: "D", octave: 3 },
        { step: "E", octave: 3, alter: -1 },
        { step: "E", octave: 3 },
      ],
      colors: [OUT_OF_RANGE_NOTE_COLOR, EXTENDED_RANGE_NOTE_COLOR, "#000000"],
    },
    {
      name: "bass clarinet",
      instrumentId: "wind.reed.clarinet.bass",
      pitches: [
        { step: "A", octave: 1 },
        { step: "B", octave: 1, alter: -1 },
        { step: "C", octave: 2 },
        { step: "D", octave: 2, alter: -1 },
      ],
      colors: [OUT_OF_RANGE_NOTE_COLOR, EXTENDED_RANGE_NOTE_COLOR, EXTENDED_RANGE_NOTE_COLOR, "#000000"],
    },
    {
      name: "bassoon",
      instrumentId: "wind.reed.bassoon",
      pitches: [
        { step: "A", octave: 1, alter: -1 },
        { step: "A", octave: 1 },
        { step: "B", octave: 1, alter: -1 },
      ],
      colors: [OUT_OF_RANGE_NOTE_COLOR, EXTENDED_RANGE_NOTE_COLOR, "#000000"],
    },
    {
      name: "baritone saxophone",
      instrumentId: "wind.reed.saxophone.baritone",
      pitches: [
        { step: "B", octave: 1 },
        { step: "C", octave: 2 },
        { step: "D", octave: 2, alter: -1 },
      ],
      colors: [OUT_OF_RANGE_NOTE_COLOR, EXTENDED_RANGE_NOTE_COLOR, "#000000"],
    },
    {
      name: "tenor trombone",
      instrumentId: "brass.trombone",
      pitches: [
        { step: "E", octave: 1, alter: -1 },
        { step: "E", octave: 1 },
        { step: "F", octave: 1 },
        { step: "F", octave: 1, alter: 1 },
        { step: "G", octave: 1 },
        { step: "G", octave: 1, alter: 1 },
        { step: "A", octave: 1 },
        { step: "B", octave: 1, alter: -1 },
        { step: "B", octave: 1 },
        { step: "C", octave: 2, alter: -1 },
        { step: "C", octave: 2 },
        { step: "D", octave: 2, alter: -1 },
        { step: "D", octave: 2 },
        { step: "E", octave: 2, alter: -1 },
        { step: "E", octave: 2 },
        { step: "F", octave: 5 },
        { step: "F", octave: 5, alter: 1 },
      ],
      colors: [
        OUT_OF_RANGE_NOTE_COLOR,
        EXTENDED_RANGE_NOTE_COLOR,
        EXTENDED_RANGE_NOTE_COLOR,
        EXTENDED_RANGE_NOTE_COLOR,
        EXTENDED_RANGE_NOTE_COLOR,
        EXTENDED_RANGE_NOTE_COLOR,
        EXTENDED_RANGE_NOTE_COLOR,
        EXTENDED_RANGE_NOTE_COLOR,
        OUT_OF_RANGE_NOTE_COLOR,
        OUT_OF_RANGE_NOTE_COLOR,
        EXTENDED_RANGE_NOTE_COLOR,
        EXTENDED_RANGE_NOTE_COLOR,
        EXTENDED_RANGE_NOTE_COLOR,
        EXTENDED_RANGE_NOTE_COLOR,
        "#000000",
        "#000000",
        OUT_OF_RANGE_NOTE_COLOR,
      ],
    },
    {
      name: "bass trombone",
      instrumentId: "brass.trombone.bass",
      pitches: [
        { step: "E", octave: 1, alter: -1 },
        { step: "E", octave: 1 },
        { step: "A", octave: 1 },
        { step: "B", octave: 1, alter: -1 },
        { step: "B", octave: 1 },
        { step: "B", octave: 4, alter: -1 },
        { step: "B", octave: 4 },
      ],
      colors: [
        OUT_OF_RANGE_NOTE_COLOR,
        EXTENDED_RANGE_NOTE_COLOR,
        EXTENDED_RANGE_NOTE_COLOR,
        "#000000",
        "#000000",
        "#000000",
        OUT_OF_RANGE_NOTE_COLOR,
      ],
    },
    {
      name: "euphonium",
      instrumentId: "brass.euphonium",
      pitches: [
        { step: "A", octave: 1 },
        { step: "B", octave: 1, alter: -1 },
        { step: "B", octave: 1 },
      ],
      colors: [OUT_OF_RANGE_NOTE_COLOR, EXTENDED_RANGE_NOTE_COLOR, "#000000"],
    },
    {
      name: "tuba",
      instrumentId: "brass.tuba",
      pitches: [
        { step: "B", octave: 0, alter: -1 },
        { step: "B", octave: 0 },
        { step: "C", octave: 1 },
        { step: "C", octave: 1, alter: 1 },
        { step: "D", octave: 1 },
        { step: "E", octave: 1, alter: -1 },
        { step: "E", octave: 1 },
        { step: "F", octave: 4 },
        { step: "F", octave: 4, alter: 1 },
      ],
      colors: [
        OUT_OF_RANGE_NOTE_COLOR,
        EXTENDED_RANGE_NOTE_COLOR,
        EXTENDED_RANGE_NOTE_COLOR,
        EXTENDED_RANGE_NOTE_COLOR,
        EXTENDED_RANGE_NOTE_COLOR,
        EXTENDED_RANGE_NOTE_COLOR,
        "#000000",
        "#000000",
        OUT_OF_RANGE_NOTE_COLOR,
      ],
    },
    {
      name: "violin upper register",
      instrumentId: "strings.violin",
      pitches: [
        { step: "A", octave: 6 },
        { step: "A", octave: 6, alter: 1 },
        { step: "E", octave: 7 },
        { step: "F", octave: 7 },
      ],
      colors: ["#000000", EXTENDED_RANGE_NOTE_COLOR, EXTENDED_RANGE_NOTE_COLOR, OUT_OF_RANGE_NOTE_COLOR],
    },
    {
      name: "viola upper register",
      instrumentId: "strings.viola",
      pitches: [
        { step: "A", octave: 5 },
        { step: "B", octave: 5, alter: -1 },
        { step: "E", octave: 6 },
        { step: "F", octave: 6 },
      ],
      colors: ["#000000", EXTENDED_RANGE_NOTE_COLOR, EXTENDED_RANGE_NOTE_COLOR, OUT_OF_RANGE_NOTE_COLOR],
    },
    {
      name: "cello upper register",
      instrumentId: "strings.cello",
      pitches: [
        { step: "E", octave: 5 },
        { step: "F", octave: 5 },
        { step: "A", octave: 5 },
        { step: "B", octave: 5, alter: -1 },
      ],
      colors: ["#000000", EXTENDED_RANGE_NOTE_COLOR, EXTENDED_RANGE_NOTE_COLOR, OUT_OF_RANGE_NOTE_COLOR],
    },
    {
      name: "five-string double bass",
      instrumentId: "strings.contrabass",
      pitches: [
        { step: "A", octave: 0 },
        { step: "B", octave: 0 },
        { step: "C", octave: 1 },
        { step: "D", octave: 1, alter: 1 },
        { step: "E", octave: 1 },
        { step: "G", octave: 3 },
        { step: "G", octave: 3, alter: 1 },
        { step: "D", octave: 4 },
        { step: "E", octave: 4, alter: -1 },
      ],
      colors: [
        OUT_OF_RANGE_NOTE_COLOR,
        EXTENDED_RANGE_NOTE_COLOR,
        EXTENDED_RANGE_NOTE_COLOR,
        EXTENDED_RANGE_NOTE_COLOR,
        "#000000",
        "#000000",
        EXTENDED_RANGE_NOTE_COLOR,
        EXTENDED_RANGE_NOTE_COLOR,
        OUT_OF_RANGE_NOTE_COLOR,
      ],
    },
    ...["brass.trumpet.bflat", "brass.cornet", "brass.flugelhorn"].map((instrumentId) => ({
      name: instrumentId,
      instrumentId,
      pitches: [
        { step: "E", octave: 3, alter: -1 },
        { step: "E", octave: 3 },
      ],
      colors: [OUT_OF_RANGE_NOTE_COLOR, "#000000"],
    })),
    {
      name: "C trumpet",
      instrumentId: "brass.trumpet.c",
      pitches: [
        { step: "F", octave: 3 },
        { step: "F", octave: 3, alter: 1 },
        { step: "D", octave: 6 },
        { step: "E", octave: 6, alter: -1 },
      ],
      colors: [OUT_OF_RANGE_NOTE_COLOR, "#000000", "#000000", OUT_OF_RANGE_NOTE_COLOR],
    },
  ] satisfies { name: string; instrumentId: string; pitches: Pitch[]; colors: string[] }[])(
    "distinguishes standard, extension, and out-of-range notes for $name",
    ({ instrumentId, pitches, colors }) => {
      const source = displayList(pitches.length);
      source.retainedRenderLayers = [{ displayList: displayList(pitches.length), bounds: null, stateCommands: [] }];
      const highlighted = highlightOutOfRangeNoteheads(source, makeScore(instrumentId, "event-1", pitches));

      expect(highlighted.commands.map((command) => ("color" in command ? command.color : null))).toEqual(colors);
      expect(
        highlighted.retainedRenderLayers?.[0]?.displayList.commands.map((command) =>
          "color" in command ? command.color : null,
        ),
      ).toEqual(colors);
    },
  );

  it("uses sounding pitches for horn pedal warnings on a transposing part", () => {
    const pitches: Pitch[] = [
      { step: "E", octave: 1 },
      { step: "F", octave: 1 },
      { step: "F", octave: 1, alter: 1 },
      { step: "G", octave: 1 },
      { step: "A", octave: 1, alter: -1 },
      { step: "A", octave: 1 },
      { step: "B", octave: 1, alter: -1 },
      { step: "B", octave: 1 },
      { step: "F", octave: 5 },
      { step: "F", octave: 5, alter: 1 },
    ];
    const score = makeScore("brass.french-horn", "event-1", pitches);
    score.parts[0]!.transposition = { interval: { halfSteps: 7, staffDistance: 4 } };
    const source = displayList(pitches.length);
    source.retainedRenderLayers = [{ displayList: displayList(pitches.length), bounds: null, stateCommands: [] }];
    const highlighted = highlightOutOfRangeNoteheads(source, score);
    const colors = [
      OUT_OF_RANGE_NOTE_COLOR,
      EXTENDED_RANGE_NOTE_COLOR,
      EXTENDED_RANGE_NOTE_COLOR,
      EXTENDED_RANGE_NOTE_COLOR,
      EXTENDED_RANGE_NOTE_COLOR,
      EXTENDED_RANGE_NOTE_COLOR,
      EXTENDED_RANGE_NOTE_COLOR,
      "#000000",
      "#000000",
      OUT_OF_RANGE_NOTE_COLOR,
    ];

    expect(highlighted.commands.map((command) => ("color" in command ? command.color : null))).toEqual(colors);
    expect(
      highlighted.retainedRenderLayers?.[0]?.displayList.commands.map((command) =>
        "color" in command ? command.color : null,
      ),
    ).toEqual(colors);
  });

  it("matches the layout engine's generated event IDs when an event has no ID", () => {
    const source = {
      ...displayList(),
      commands: [notehead()],
      elementIds: ["p0/m0/s0/__auto_m0_v0_e0/n0"],
    };

    expect(highlightOutOfRangeNoteheads(source, makeScore("wind.flutes.flute", "")).commands[0]?.color).toBe(
      OUT_OF_RANGE_NOTE_COLOR,
    );
  });

  it("uses the active instrument at each onset, including after a change within a measure", () => {
    const score = makeScore("wind.flutes.flute");
    changeFluteToBassoon(score, [1, 2]);
    score.parts[0]!.measures[0]!.sequences[0]!.content = [
      { type: "event", id: "before", duration: { base: "half" }, notes: [{ pitch: { step: "A", octave: 1 } }] },
      { type: "event", id: "after", duration: { base: "half" }, notes: [{ pitch: { step: "A", octave: 1 } }] },
    ];
    score.global.measures.push({});
    score.parts[0]!.measures.push({
      sequences: [
        {
          content: [
            { type: "event", id: "next", duration: { base: "whole" }, notes: [{ pitch: { step: "A", octave: 1 } }] },
          ],
        },
      ],
    });
    const source = displayList(3);
    source.elementIds = ["p0/m0/s0/before/n0", "p0/m0/s0/after/n0", "p0/m1/s0/next/n0"];

    expect(
      highlightOutOfRangeNoteheads(source, score).commands.map((command) =>
        "color" in command ? command.color : null,
      ),
    ).toEqual([OUT_OF_RANGE_NOTE_COLOR, EXTENDED_RANGE_NOTE_COLOR, EXTENDED_RANGE_NOTE_COLOR]);
  });

  it("uses scaled tuplet onsets for instrument changes", () => {
    const score = makeScore("wind.flutes.flute");
    changeFluteToBassoon(score, [1, 6]);
    score.parts[0]!.measures[0]!.sequences[0]!.content = [
      {
        type: "tuplet",
        inner: { duration: { base: "eighth" }, multiple: 3 },
        outer: { duration: { base: "quarter" }, multiple: 1 },
        content: ["first", "second", "third"].map((id) => ({
          type: "event",
          id,
          duration: { base: "eighth" },
          notes: [{ pitch: { step: "A", octave: 1 } }],
        })),
      },
    ];
    const source = displayList(3);
    source.elementIds = ["p0/m0/s0/first/n0", "p0/m0/s0/second/n0", "p0/m0/s0/third/n0"];

    expect(
      highlightOutOfRangeNoteheads(source, score).commands.map((command) =>
        "color" in command ? command.color : null,
      ),
    ).toEqual([OUT_OF_RANGE_NOTE_COLOR, OUT_OF_RANGE_NOTE_COLOR, EXTENDED_RANGE_NOTE_COLOR]);
  });

  it("does not count grace events when matching generated principal-event IDs", () => {
    const score = makeScore("wind.flutes.flute", "");
    const content = score.parts[0]!.measures[0]!.sequences[0]!.content;
    content.unshift({
      type: "grace",
      content: [{ type: "event", duration: { base: "eighth" }, notes: [{ pitch: { step: "C", octave: 4 } }] }],
    });
    const source = displayList(1);
    source.elementIds = ["p0/m0/s0/__auto_m0_v0_e0/n0"];

    expect(highlightOutOfRangeNoteheads(source, score).commands[0]).toMatchObject({ color: OUT_OF_RANGE_NOTE_COLOR });
  });

  it("applies highlights after a retained frame is finalized", () => {
    const source: DisplayList = {
      commands: [],
      width: 100,
      height: 100,
    };
    source.finalizeRetainedFrame = () => {
      source.commands = [notehead()];
      source.elementIds = ["p0/m0/s0/event-1/n0"];
    };

    const highlighted = highlightOutOfRangeNoteheads(source, makeScore("wind.flutes.flute"));
    highlighted.finalizeRetainedFrame?.();

    expect(highlighted.commands[0]).toMatchObject({ color: OUT_OF_RANGE_NOTE_COLOR });
    expect(source.commands[0]).toMatchObject({ color: "#000000" });
  });

  it("does not leave warning colors in retained frames when the instrument changes", () => {
    const reconstructor = new PatchReconstructor();
    const empty: DisplayList = { commands: [], width: 100, height: 100 };
    const patch: PatchFrame = {
      width: 100,
      height: 100,
      galleyOffsetY: 0,
      pages: [],
      prefix: empty,
      overlay: empty,
      placements: [{ kind: "fresh", segment: displayList() }],
    };
    const first = reconstructor.apply({ kind: "patch", patch });

    expect(highlightOutOfRangeNoteheads(first, makeScore("wind.flutes.flute")).commands[0]).toMatchObject({
      color: OUT_OF_RANGE_NOTE_COLOR,
    });

    const reused = reconstructor.apply({
      kind: "patch",
      patch: { ...patch, placements: [{ kind: "reuse", prevIndex: 0, dx: 0, dy: 0 }] },
    });
    expect(highlightOutOfRangeNoteheads(reused, makeScore("strings.cello")).commands[0]).toMatchObject({
      color: "#000000",
    });
  });
});
