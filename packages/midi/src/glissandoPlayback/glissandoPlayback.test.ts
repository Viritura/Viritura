import { describe, expect, it } from "vitest";
import type { Glissando, NoteEvent, Score } from "@viritura/core";
import { generateTimeline } from "../timeline";

function scoreFor(glissando: Partial<Glissando> = {}, fifths = 0): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 }, key: { fifths } }] },
    parts: [
      {
        name: "Piano",
        measures: [
          {
            sequences: [
              {
                content: [
                  {
                    type: "event",
                    id: "source",
                    duration: { base: "quarter" },
                    notes: [{ pitch: { step: "C", octave: 4 } }],
                    glissandos: [{ target: "target", ...glissando }],
                  },
                  {
                    type: "event",
                    id: "target",
                    duration: { base: "quarter" },
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
}

function source(score: Score): NoteEvent {
  const event = score.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
  if (event.type !== "event") throw new Error("Expected event");
  return event;
}

describe("glissando playback", () => {
  it("defaults glissando to diatonic without duplicating the target attack", () => {
    const timeline = generateTimeline(scoreFor());
    expect(timeline.events.filter((event) => event.type === "noteOn").map((event) => event.midiNote)).toEqual([
      60, 62, 64, 65, 67,
    ]);
    const target = timeline.events.find((event) => event.type === "noteOn" && event.scoreEventId === "target")!;
    const offTimes = timeline.events
      .filter((event) => event.type === "noteOff" && event.time <= target.time)
      .map((event) => event.time);
    expect(offTimes).toHaveLength(4);
    offTimes.forEach((time, index) => expect(time).toBeCloseTo((target.time * (index + 1)) / 4));
    expect(timeline.diagnostics).toEqual([]);
  });

  it("plays every chromatic semitone regardless of kind or displayed text", () => {
    const timeline = generateTimeline(scoreFor({ kind: "portamento", playbackType: "chromatic", showText: false }));
    expect(timeline.events.filter((event) => event.type === "noteOn").map((event) => event.midiNote)).toEqual([
      60, 61, 62, 63, 64, 65, 66, 67,
    ]);
  });

  it("follows the active key signature in both directions", () => {
    const score = scoreFor({}, 1);
    expect(
      generateTimeline(score)
        .events.filter((event) => event.type === "noteOn")
        .map((event) => event.midiNote),
    ).toEqual([60, 62, 64, 66, 67]);
    source(score).notes = [{ pitch: { step: "B", octave: 4 } }];
    expect(
      generateTimeline(score)
        .events.filter((event) => event.type === "noteOn")
        .map((event) => event.midiNote),
    ).toEqual([71, 69, 67]);
  });

  it("defaults portamento to a wide bend on an isolated channel and resets before the target", () => {
    const timeline = generateTimeline(scoreFor({ kind: "portamento" }));
    const bends = timeline.events.filter((event) => event.type === "pitchBend");
    const target = timeline.events.find((event) => event.type === "noteOn" && event.scoreEventId === "target")!;
    expect(bends.length).toBe(Math.ceil(target.time * 200) + 1);
    expect(bends[0]?.value).toBe(8192);
    expect(bends.at(-2)?.value).toBeGreaterThan(16000);
    expect(bends.at(-1)).toMatchObject({ value: 8192, time: target.time });
    expect(bends[0]?.channel).not.toBe(target.channel);
    expect(timeline.events.find((event) => event.cc === 6)).toMatchObject({ value: 7 });
    const off = timeline.events.find((event) => event.type === "noteOff" && event.midiNote === 60)!;
    expect(off.time).toBe(target.time);
    expect(timeline.events.indexOf(off)).toBeLessThan(timeline.events.indexOf(bends.at(-1)!));
    const silence = timeline.events.find((event) => event.cc === 120)!;
    expect(silence).toMatchObject({ time: target.time, value: 0, channel: bends[0]?.channel });
    expect(timeline.events.indexOf(silence)).toBeLessThan(timeline.events.indexOf(bends.at(-1)!));
  });

  it("does not bend another voice or a second chord note", () => {
    const score = scoreFor({ playbackType: "pitch-bend" });
    source(score).notes?.push({ pitch: { step: "E", octave: 4 } });
    score.parts[0]!.measures[0]!.sequences.push({
      content: [
        { type: "event", id: "other", duration: { base: "whole" }, notes: [{ pitch: { step: "A", octave: 3 } }] },
      ],
    });
    const timeline = generateTimeline(score);
    const channels = new Set(
      timeline.events.filter((event) => event.type === "pitchBend").map((event) => event.channel),
    );
    expect(channels.size).toBe(2);
    const other = timeline.events.find((event) => event.scoreEventId === "other")!;
    expect(channels.has(other.channel)).toBe(false);
  });

  it("reports invalid endpoints explicitly and preserves their ordinary playback", () => {
    const timeline = generateTimeline(scoreFor({ target: "missing" }));
    expect(timeline.diagnostics?.[0]?.code).toBe("glissando-playback-unsupported");
    expect(timeline.events.filter((event) => event.type === "noteOn").map((event) => event.midiNote)).toEqual([60, 67]);
  });

  it("resolves slash-containing target IDs through their rendered alias", () => {
    const score = scoreFor({ target: "target_1" });
    const target = score.parts[0]!.measures[0]!.sequences[0]!.content[1]!;
    if (target.type !== "event") throw new Error("Expected event");
    target.id = "target/1";
    expect(generateTimeline(score).events.filter((event) => event.type === "noteOn")).toHaveLength(5);
  });

  it("handles unison endpoints without an infinite expansion", () => {
    const score = scoreFor();
    source(score).notes = [{ pitch: { step: "G", octave: 4 } }];
    expect(
      generateTimeline(score)
        .events.filter((event) => event.type === "noteOn")
        .map((event) => event.midiNote),
    ).toEqual([67, 67]);
  });

  it("replays a line once per repeat without sweeping over the repeat boundary", () => {
    const score = scoreFor({ kind: "portamento" });
    score.global.measures[0]!.repeatStart = {};
    score.global.measures[0]!.repeatEnd = { times: 2 };
    const timeline = generateTimeline(score);
    expect(timeline.events.filter((event) => event.type === "noteOn" && event.scoreEventId === "source")).toHaveLength(
      2,
    );
    expect(timeline.events.filter((event) => event.type === "pitchBend" && event.value === 8192)).toHaveLength(4);
    expect(timeline.diagnostics).toEqual([]);
  });

  it("supports cross-bar lines and key changes at the source", () => {
    const score = scoreFor({}, -1);
    source(score).notes = [{ pitch: { step: "A", octave: 4 } }];
    source(score).duration = { base: "whole" };
    score.parts[0]!.measures[0]!.sequences[0]!.content.splice(1);
    score.global.measures.push({});
    score.parts[0]!.measures.push({
      sequences: [
        {
          content: [
            {
              type: "event",
              id: "target",
              duration: { base: "quarter" },
              notes: [{ pitch: { step: "D", octave: 5 } }],
            },
          ],
        },
      ],
    });
    const timeline = generateTimeline(score);
    expect(timeline.events.filter((event) => event.type === "noteOn").map((event) => event.midiNote)).toEqual([
      69, 70, 72, 74,
    ]);
    expect(timeline.diagnostics).toEqual([]);
  });

  it("does not sweep to a target after a D.C. jump", () => {
    const score = scoreFor();
    const first = source(score);
    first.glissandos = undefined;
    first.id = "target";
    first.duration = { base: "whole" };
    score.parts[0]!.measures[0]!.sequences[0]!.content.splice(1);
    score.global.measures[0]!.fine = { location: { fraction: [1, 1] } };
    score.global.measures.push({ jump: { type: "dcAlFine", location: { fraction: [1, 1] } } });
    score.parts[0]!.measures.push({
      sequences: [
        {
          content: [
            {
              type: "event",
              id: "source",
              duration: { base: "whole" },
              notes: [{ pitch: { step: "C", octave: 5 } }],
              glissandos: [{ target: "target" }],
            },
          ],
        },
      ],
    });
    const diagnostics: string[] = [];
    const timeline = generateTimeline(score, { onDiagnostic: (diagnostic) => diagnostics.push(diagnostic.code) });
    expect(timeline.expandedMeasureToOriginal).toEqual([0, 1, 0]);
    expect(timeline.events.filter((event) => event.type === "noteOn")).toHaveLength(3);
    expect(diagnostics).toContain("glissando-playback-unsupported");
  });
});
