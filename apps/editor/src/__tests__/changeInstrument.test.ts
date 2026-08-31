import { describe, expect, it } from "vitest";
import { parseMnx } from "@viritura/format";
import type { Score } from "@viritura/core";
import { buildBlankScore, DEFAULT_NEW_SCORE_SETTINGS } from "../score/ScoreBuilder";
import { createPlayer } from "../score/InstrumentCatalog";
import { analyzeInstrumentChange, changeInstrumentInScore } from "../score/changeInstrument";

function makeScore(instrumentId: string): Score {
  return parseMnx(
    JSON.parse(
      buildBlankScore({
        ...DEFAULT_NEW_SCORE_SETTINGS,
        players: [createPlayer(instrumentId)],
        measureCount: 1,
      }),
    ),
  );
}

function addPitchedNote(score: Score): void {
  score.parts[0]!.measures[0]!.sequences[0]!.content = [
    {
      type: "event",
      duration: { base: "quarter" },
      notes: [{ pitch: { step: "C", octave: 4 } }],
    },
  ];
}

function addKitNote(score: Score, component: string): void {
  score.parts[0]!.measures[0]!.sequences[0]!.content = [
    {
      type: "event",
      duration: { base: "quarter" },
      kitNotes: [{ kitComponent: component }],
    },
  ];
}

describe("changeInstrumentInScore", () => {
  it("changes a same-staff melodic instrument without altering music", () => {
    const score = makeScore("flute");
    addPitchedNote(score);
    const partId = score.parts[0]!.id!;
    const changed = changeInstrumentInScore(score, partId, "oboe")!;

    expect(changed.parts[0]!.name).toBe("Oboe");
    expect(changed.parts[0]!._x?.viritura?.instrumentId).toBe("oboe");
    expect(changed.parts[0]!.measures[0]!.sequences[0]!.content).toEqual(
      score.parts[0]!.measures[0]!.sequences[0]!.content,
    );
    expect(changed.scores?.[1]?.name).toBe("Oboe");
  });

  it("expands one staff safely while preserving music on staff 1", () => {
    const score = makeScore("flute");
    addPitchedNote(score);
    const partId = score.parts[0]!.id!;
    const analysis = analyzeInstrumentChange(score, partId, "piano");
    expect(analysis.allowed).toBe(true);
    expect(analysis.warning).toContain("staff 1");

    const changed = changeInstrumentInScore(score, partId, "piano")!;
    expect(changed.parts[0]!.staves).toBe(2);
    expect(changed.parts[0]!.measures[0]!.sequences).toHaveLength(2);
    expect(changed.parts[0]!.measures[0]!.sequences[0]!.staff).toBe(1);
    expect(changed.parts[0]!.measures[0]!.sequences[0]!.content).toHaveLength(1);
    expect(changed.parts[0]!.measures[0]!.sequences[1]).toMatchObject({ staff: 2, content: [] });
    const perPartLayout = changed.layouts?.find((layout) => layout.id === `L-${partId}`);
    expect(perPartLayout?.content[0]?.type).toBe("group");
  });

  it("blocks staff-count reduction instead of risking music loss", () => {
    const score = makeScore("piano");
    const analysis = analyzeInstrumentChange(score, score.parts[0]!.id!, "flute");
    expect(analysis.allowed).toBe(false);
    expect(changeInstrumentInScore(score, score.parts[0]!.id!, "flute")).toBeNull();
  });

  it("blocks pitched-to-percussion changes when music exists", () => {
    const score = makeScore("flute");
    addPitchedNote(score);
    const analysis = analyzeInstrumentChange(score, score.parts[0]!.id!, "snare-drum");
    expect(analysis.allowed).toBe(false);
  });

  it("allows pitched-to-percussion changes for an empty part", () => {
    const score = makeScore("flute");
    const changed = changeInstrumentInScore(score, score.parts[0]!.id!, "snare-drum")!;
    expect(Object.keys(changed.parts[0]!.kit ?? {})).toEqual(["hit"]);
    expect(changed.global.sounds?.[changed.parts[0]!.kit!.hit!.sound!]?.midiNumber).toBe(38);
  });

  it("rebinds percussion notes to the nearest component in a replacement map", () => {
    const score = makeScore("drum-kit");
    const oldComponent = Object.entries(score.parts[0]!.kit!).find(
      ([, component]) => component.staffPosition === 6,
    )![0];
    addKitNote(score, oldComponent);
    const analysis = analyzeInstrumentChange(score, score.parts[0]!.id!, "orchestral-percussion");
    expect(analysis.allowed).toBe(true);
    expect(analysis.warning).toBeTruthy();

    const changed = changeInstrumentInScore(score, score.parts[0]!.id!, "orchestral-percussion")!;
    const event = changed.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    expect(event.type).toBe("event");
    if (event.type !== "event") throw new Error("expected event");
    expect(changed.parts[0]!.kit?.[event.kitNotes![0]!.kitComponent]).toBeDefined();
  });
});
