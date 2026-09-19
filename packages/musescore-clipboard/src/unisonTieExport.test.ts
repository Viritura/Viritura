import { describe, expect, it } from "vitest";
import type { Note, NoteEvent } from "@viritura/core";
import { writeMuseScoreStaffList, type MuseScoreClipboardWriteInput } from ".";

function sharp(id: string, target?: string): Note {
  return { id, pitch: { step: "C", octave: 4, alter: 1 }, ...(target ? { ties: [{ target }] } : {}) };
}

function flat(id: string, target?: string): Note {
  return { ...sharp(id, target), pitch: { step: "D", octave: 4, alter: -1 } };
}

function input(...chords: Note[][]): MuseScoreClipboardWriteInput {
  return {
    events: chords.map((notes): NoteEvent => ({ type: "event", duration: { base: "quarter" }, notes })),
  };
}

function reviewRepro(): MuseScoreClipboardWriteInput {
  return input([sharp("A"), sharp("B", "D"), flat("C", "E")], [sharp("D"), flat("E")]);
}

function expectUnsupported(source: MuseScoreClipboardWriteInput): void {
  const before = structuredClone(source);
  expect(writeMuseScoreStaffList(source)).toEqual({
    xml: null,
    warning: expect.stringMatching(/unison-chord ties.*cannot be exported to MuseScore/),
  });
  expect(source).toEqual(before);
}

describe("ambiguous unison-chord tie export", () => {
  it("rejects A:C#4,B:C#4,C:Db4 -> D:C#4,E:Db4 with B->D and C->E instead of silently swapping targets", () => {
    // Equal-pitch reconstruction can receive [A,C,B]; XML -1/+1 links would then
    // reciprocally match B->E and C->D. A self-codec roundtrip cannot detect this.
    expectUnsupported(reviewRepro());
  });

  it.each([
    { name: "same-spelling unison", duplicate: sharp },
    { name: "enharmonic unison", duplicate: flat },
  ])("rejects a single note tied into a $name target chord", ({ duplicate }) => {
    expectUnsupported(input([sharp("source", "target")], [duplicate("other"), sharp("target")]));
  });

  it.each([
    { name: "same-spelling unison", duplicate: sharp },
    { name: "enharmonic unison", duplicate: flat },
  ])("rejects a $name source chord tied into a single note", ({ duplicate }) => {
    expectUnsupported(input([duplicate("other"), sharp("source", "target")], [sharp("target")]));
  });

  it.each(["source", "target"] as const)(
    "conservatively rejects a unique tied pitch in a %s chord containing other unisons",
    (endpoint) => {
      const source: Note = { id: "source", pitch: { step: "G", octave: 4 }, ties: [{ target: "target" }] };
      const target: Note = { id: "target", pitch: { step: "G", octave: 4 } };
      const duplicates = [sharp("A"), flat("B")];
      expectUnsupported(
        endpoint === "source" ? input([source, ...duplicates], [target]) : input([source], [target, ...duplicates]),
      );
    },
  );

  it("exports duplicate MIDI pitches normally when no ties are involved", () => {
    const source = reviewRepro();
    for (const event of source.events as NoteEvent[]) {
      for (const note of event.notes!) note.ties = [];
    }
    const before = structuredClone(source);
    const result = writeMuseScoreStaffList(source);
    expect(result.warning).toBeUndefined();
    expect(result.xml?.match(/<Note>/g)).toHaveLength(5);
    expect(result.xml).not.toContain("<Spanner");
    expect(source).toEqual(before);
  });

  it("does not reject an untied unison chord elsewhere in a selection containing an ordinary tie", () => {
    const source = input([sharp("source", "target")], [sharp("target")], [sharp("A"), sharp("B"), flat("C")]);
    const result = writeMuseScoreStaffList(source);
    expect(result.warning).toBeUndefined();
    expect(result.xml?.match(/<Note>/g)).toHaveLength(5);
    expect(result.xml?.match(/<Spanner type="Tie">/g)).toHaveLength(2);
  });
});
