import { describe, expect, it } from "vitest";
import {
  DURATION_BEATS,
  type Note,
  type NoteEvent,
  type PartMeasure,
  type Score,
  type Sequence,
  type SequenceContent,
} from "@viritura/core";
import { parseMnx, serializeMnx } from "@viritura/format";
import { normalizeWindPlayerVoices } from ".";

describe("normalizeWindPlayerVoices", () => {
  it("removes rest shells, resets automatic stems, deduplicates empty measures, and preserves polyphony", () => {
    const source = score([
      part("P2-1", [
        {
          sequences: [
            sequence(
              "v5",
              [event("pitched", [note("high", "C", 5)], { stemDirection: "down", orient: "below" })],
              "above",
            ),
            sequence("v2", [rest("shell")]),
          ],
        },
      ]),
      part("P2-2", [
        {
          sequences: [
            sequence("v5", [rest("first")]),
            { ...sequence("v2", []), fullMeasure: { visualDuration: { base: "whole" } }, orient: "below" },
          ],
        },
      ]),
      part("P3-1", [
        {
          sequences: [
            sequence("v5", [event("upper", [note("upper-note", "G", 5)])]),
            sequence("v2", [event("lower", [note("lower-note", "E", 4)])]),
            sequence("v9", [rest("duplicate-shell")]),
          ],
        },
      ]),
    ]);
    const snapshot = structuredClone(source);

    const { score: result, conflicts } = normalizeWindPlayerVoices(source);

    expect(source).toEqual(snapshot);
    expect(measure(result, "P2-1", 1).sequences).toHaveLength(1);
    expect(measure(result, "P2-1", 1).sequences[0]).toMatchObject({ voice: "v1" });
    expect(measure(result, "P2-1", 1).sequences[0]).not.toHaveProperty("orient");
    expect(firstEvent(result, "P2-1", 1)).not.toHaveProperty("stemDirection");
    expect(firstEvent(result, "P2-1", 1)).not.toHaveProperty("orient");
    expect(measure(result, "P2-2", 1).sequences).toEqual([
      expect.objectContaining({ voice: "v1", fullMeasure: { visualDuration: { base: "whole" } } }),
    ]);
    expect(measure(result, "P3-1", 1).sequences.map((candidate) => candidate.voice)).toEqual(["v1", "v2"]);
    expect(measure(result, "P3-1", 1).sequences.map((candidate) => firstId(candidate))).toEqual(["upper", "lower"]);
    expect(conflicts).toEqual([]);
  });

  it("moves the three opening dyad notes into their partner parts and leaves no wind conflicts", () => {
    const upperMeasures = emptyMeasures(99);
    const lowerMeasures = emptyMeasures(99);
    for (const measureNumber of [88, 92, 96]) {
      upperMeasures[measureNumber - 1] = {
        sequences: [
          sequence("v5", [
            rest(`upper-lead-${String(measureNumber)}`),
            event(`upper-dyad-${String(measureNumber)}`, [
              note(`lower-${String(measureNumber)}`, "F", 4),
              note(`higher-${String(measureNumber)}`, "A", 4),
            ]),
          ]),
        ],
      };
      lowerMeasures[measureNumber - 1] = {
        sequences: [
          sequence("v2", [rest(`lower-lead-${String(measureNumber)}`), rest(`destination-${String(measureNumber)}`)]),
          sequence("v5", [
            event(`existing-${String(measureNumber)}`, [note(`existing-note-${String(measureNumber)}`, "F", 5)]),
          ]),
        ],
      };
    }
    upperMeasures[16] = {
      sequences: [
        sequence("v5", [
          eighthEvent("oboe-conflict", [note("c-sharp", "C", 5, 1), note("a-sharp", "A", 5, 1)]),
          space([3, 8]),
        ]),
      ],
    };
    lowerMeasures[16] = {
      sequences: [
        sequence("v2", [
          space([3, 8]),
          sixteenthEvent("oboe-f-sharp", [note("oboe-f-sharp-note", "F", 4, 1)]),
          sixteenthEvent("oboe-g-sharp", [note("oboe-g-sharp-note", "G", 4, 1)]),
        ]),
      ],
    };
    upperMeasures[98] = {
      sequences: [
        sequence("v5", [
          event("oboe-duplicate", [note("duplicate-f-sharp", "F", 4, 1), note("kept-a-sharp", "A", 4, 1)]),
        ]),
      ],
    };
    lowerMeasures[98] = { sequences: [sequence("v2", [event("oboe-partner", [note("partner-f-sharp", "F", 4, 1)])])] };

    const trumpetMeasures = emptyMeasures(29);
    const secondTrumpetMeasures = emptyMeasures(29);
    for (const measureNumber of [21, 29]) {
      trumpetMeasures[measureNumber - 1] = conflictMeasure(
        `trumpet-conflict-${String(measureNumber)}`,
        `b-${String(measureNumber)}`,
        `d-sharp-${String(measureNumber)}`,
      );
      secondTrumpetMeasures[measureNumber - 1] = {
        sequences: [
          sequence("v2", [
            space([1, 4]),
            event(`trumpet-a-${String(measureNumber)}`, [note(`a-${String(measureNumber)}`, "A", 4)]),
          ]),
        ],
      };
    }
    const source = score([
      part("P2-1", upperMeasures),
      part("P2-2", lowerMeasures),
      part("P6-1", trumpetMeasures),
      part("P6-2", secondTrumpetMeasures),
    ]);

    const result = normalizeWindPlayerVoices(source);

    for (const measureNumber of [88, 92, 96]) {
      expect(eventById(result.score, "P2-1", measureNumber, `upper-dyad-${String(measureNumber)}`).notes).toEqual([
        expect.objectContaining({ id: `higher-${String(measureNumber)}` }),
      ]);
      expect(eventById(result.score, "P2-2", measureNumber, `destination-${String(measureNumber)}`)).toMatchObject({
        id: `destination-${String(measureNumber)}`,
        notes: [expect.objectContaining({ id: `lower-${String(measureNumber)}` })],
      });
      expect(eventById(result.score, "P2-2", measureNumber, `destination-${String(measureNumber)}`)).not.toHaveProperty(
        "rest",
      );
      expect(measure(result.score, "P2-2", measureNumber).sequences.map((candidate) => candidate.voice)).toEqual([
        "v1",
        "v2",
      ]);
    }
    expect(eventById(result.score, "P2-1", 99, "oboe-duplicate").notes).toEqual([
      expect.objectContaining({ id: "kept-a-sharp" }),
    ]);

    expect(eventById(result.score, "P2-1", 17, "oboe-conflict").notes).toEqual([
      expect.objectContaining({ id: "a-sharp", pitch: { step: "A", octave: 5, alter: 1 } }),
    ]);
    const oboeContent = measure(result.score, "P2-2", 17).sequences[0]!.content;
    expect(oboeContent.map(contentKind)).toEqual(["C#5", "rest", "rest", "F#4", "G#4"]);
    expect(oboeContent.map(contentDuration)).toEqual(["eighth", "eighth", "eighth", "16th", "16th"]);
    expect((oboeContent[0] as NoteEvent).notes?.[0]?.id).toBe("c-sharp");
    expect(measureBeats(result.score, "P2-2", 17)).toBe(2);

    for (const measureNumber of [21, 29]) {
      expect(eventById(result.score, "P6-1", measureNumber, `trumpet-conflict-${String(measureNumber)}`).notes).toEqual(
        [expect.objectContaining({ id: `d-sharp-${String(measureNumber)}` })],
      );
      const content = measure(result.score, "P6-2", measureNumber).sequences[0]!.content;
      expect(content.map(contentKind)).toEqual(["B4", "A4"]);
      expect(content.map(contentDuration)).toEqual(["quarter", "quarter"]);
      expect((content[0] as NoteEvent).notes?.[0]?.id).toBe(`b-${String(measureNumber)}`);
      expect(measureBeats(result.score, "P6-2", measureNumber)).toBe(2);
    }

    const insertedEvents = [
      ...oboeContent.slice(0, 3),
      ...[21, 29].map((measureNumber) => measure(result.score, "P6-2", measureNumber).sequences[0]!.content[0]!),
    ] as NoteEvent[];
    const insertedIds = insertedEvents.map((candidate) => candidate.id);
    expect(insertedIds.every(Boolean)).toBe(true);
    expect(new Set(insertedIds).size).toBe(insertedIds.length);
    expect(insertedIds).not.toContain("oboe-conflict");
    expect(result.conflicts).toEqual([]);

    const reparsed = parseMnx(serializeMnx(result.score));
    expect(normalizeWindPlayerVoices(reparsed)).toEqual({ score: reparsed, conflicts: [] });
  });

  it("is idempotent and survives an MNX schema roundtrip", () => {
    const source = score([
      part("P2-1", [
        { sequences: [sequence("v5", [event("note", [note("n1", "D", 5)])]), sequence("v2", [rest("r1")])] },
      ]),
      part("P2-2", [{ sequences: [sequence("v2", [rest("r2")])] }]),
    ]);

    const once = normalizeWindPlayerVoices(source);
    const reparsed = parseMnx(serializeMnx(once.score));
    const twice = normalizeWindPlayerVoices(reparsed);

    expect(twice).toEqual({ score: reparsed, conflicts: once.conflicts });
  });
});

function score(parts: Part[]): Score {
  const measureCount = Math.max(...parts.map((candidate) => candidate.measures.length));
  return { mnx: { version: 1 }, global: { measures: Array.from({ length: measureCount }, () => ({})) }, parts };
}

function part(id: string, measures: PartMeasure[]): Part {
  return { id, name: id, measures };
}

function sequence(voice: string, content: SequenceContent[], orient?: "above" | "below"): Sequence {
  return { voice, content, ...(orient ? { orient } : {}) };
}

function event(id: string, notes: Note[], overrides: Pick<NoteEvent, "stemDirection" | "orient"> = {}): NoteEvent {
  return { type: "event", id, duration: { base: "quarter" }, notes, ...overrides };
}

function rest(id: string): NoteEvent {
  return { type: "event", id, duration: { base: "quarter" }, rest: {} };
}

function eighthEvent(id: string, notes: Note[]): NoteEvent {
  return { type: "event", id, duration: { base: "eighth" }, notes };
}

function sixteenthEvent(id: string, notes: Note[]): NoteEvent {
  return { type: "event", id, duration: { base: "16th" }, notes };
}

function space(duration: [number, number]): SequenceContent {
  return { type: "space", duration };
}

function note(id: string, step: "A" | "B" | "C" | "D" | "E" | "F" | "G", octave: number, alter?: number): Note {
  return { id, pitch: { step, octave, ...(alter === undefined ? {} : { alter }) } };
}

function emptyMeasures(count: number): PartMeasure[] {
  return Array.from({ length: count }, (_, index) => ({
    sequences: [sequence("v5", [rest(`rest-${String(index + 1)}`)])],
  }));
}

function conflictMeasure(eventId: string, firstNoteId: string, secondNoteId: string): PartMeasure {
  return {
    sequences: [
      sequence("v5", [
        event(eventId, [note(firstNoteId, "B", 4), note(secondNoteId, "D", 5, 1)]),
        event(`${eventId}-tail`, [note(`${secondNoteId}-tail`, "E", 5)]),
      ]),
    ],
  };
}

function contentKind(content: SequenceContent): string {
  if (content.type === "space") return "space";
  if (content.type !== "event") return content.type;
  if (content.rest) return "rest";
  const pitch = content.notes?.[0]?.pitch;
  return pitch ? `${pitch.step}${pitch.alter === 1 ? "#" : ""}${String(pitch.octave)}` : "event";
}

function contentDuration(content: SequenceContent): string {
  return content.type === "event" ? content.duration.base : "space";
}

function measureBeats(scoreValue: Score, partId: string, measureNumber: number): number {
  return measure(scoreValue, partId, measureNumber).sequences[0]!.content.reduce((total, content) => {
    if (content.type === "space") return total + (content.duration[0] / content.duration[1]) * 4;
    if (content.type !== "event") throw new Error(`Unexpected ${content.type} in test fixture.`);
    return total + DURATION_BEATS[content.duration.base];
  }, 0);
}

function measure(scoreValue: Score, partId: string, measureNumber: number): PartMeasure {
  return scoreValue.parts.find((candidate) => candidate.id === partId)!.measures[measureNumber - 1]!;
}

function firstEvent(scoreValue: Score, partId: string, measureNumber: number): NoteEvent {
  return measure(scoreValue, partId, measureNumber).sequences[0]!.content[0] as NoteEvent;
}

function firstId(sequenceValue: Sequence): string | undefined {
  return (sequenceValue.content[0] as NoteEvent | undefined)?.id;
}

function eventById(scoreValue: Score, partId: string, measureNumber: number, eventId: string): NoteEvent {
  const found = measure(scoreValue, partId, measureNumber)
    .sequences.flatMap((candidate) => candidate.content)
    .find((item) => item.type === "event" && item.id === eventId);
  if (!found || found.type !== "event") throw new Error(`Missing event ${eventId}.`);
  return found;
}
