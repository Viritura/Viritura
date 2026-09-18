import { afterEach, describe, expect, it, vi } from "vitest";
import type { Note, NoteEvent } from "@viritura/core";
import { copyToClipboard, pasteFromClipboard, type ClipboardSelection } from "../../commands/clipboardCommands";
import { deserializeFragment } from "../deserialize";
import { readNotationClipboard, writeNotationClipboard } from "../notationClipboard";
import { writeMuseScoreStaffList } from ".";

vi.mock("../notationClipboard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../notationClipboard")>()),
  writeNotationClipboard: vi.fn(),
  readNotationClipboard: vi.fn(),
}));

function sharp(id: string, target?: string): Note {
  return { id, pitch: { step: "C", octave: 4, alter: 1 }, ...(target ? { ties: [{ target }] } : {}) };
}

function flat(id: string, target?: string): Note {
  return { ...sharp(id, target), pitch: { step: "D", octave: 4, alter: -1 } };
}

function selection(...chords: Note[][]): ClipboardSelection {
  return {
    events: chords.map((notes): NoteEvent => ({ type: "event", duration: { base: "quarter" }, notes })),
    timeSignature: { count: 4, unit: 4 },
    keySignature: { fifths: 0 },
    partIndex: 0,
    measureIndex: 0,
    sequenceIndex: 0,
    eventIndex: 0,
  };
}

function reviewRepro(): ClipboardSelection {
  return selection([sharp("A"), sharp("B", "D"), flat("C", "E")], [sharp("D"), flat("E")]);
}

function expectUnsupported(source: ClipboardSelection): void {
  const before = structuredClone(source);
  expect(writeMuseScoreStaffList(source)).toEqual({
    xml: null,
    warning: expect.stringMatching(/unison-chord ties.*cannot be exported to MuseScore/),
  });
  expect(source).toEqual(before);
}

afterEach(() => {
  vi.mocked(writeNotationClipboard).mockReset();
  vi.mocked(readNotationClipboard).mockReset();
});

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
    expectUnsupported(selection([sharp("source", "target")], [duplicate("other"), sharp("target")]));
  });

  it.each([
    { name: "same-spelling unison", duplicate: sharp },
    { name: "enharmonic unison", duplicate: flat },
  ])("rejects a $name source chord tied into a single note", ({ duplicate }) => {
    expectUnsupported(selection([duplicate("other"), sharp("source", "target")], [sharp("target")]));
  });

  it.each(["source", "target"] as const)(
    "conservatively rejects a unique tied pitch in a %s chord containing other unisons",
    (endpoint) => {
      const source: Note = { id: "source", pitch: { step: "G", octave: 4 }, ties: [{ target: "target" }] };
      const target: Note = { id: "target", pitch: { step: "G", octave: 4 } };
      const duplicates = [sharp("A"), flat("B")];
      expectUnsupported(
        endpoint === "source"
          ? selection([source, ...duplicates], [target])
          : selection([source], [target, ...duplicates]),
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
    const source = selection([sharp("source", "target")], [sharp("target")], [sharp("A"), sharp("B"), flat("C")]);
    const result = writeMuseScoreStaffList(source);
    expect(result.warning).toBeUndefined();
    expect(result.xml?.match(/<Note>/g)).toHaveLength(5);
    expect(result.xml?.match(/<Spanner type="Tie">/g)).toHaveLength(2);
  });

  it("copies unchanged Viritura JSON with a specific warning and pastes the original tie identities", async () => {
    const source = reviewRepro();
    const before = structuredClone(source);
    const warning = vi.fn();

    expect(await copyToClipboard(source, warning)).toBe(true);
    expect(warning).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/unison-chord ties/));
    expect(writeNotationClipboard).toHaveBeenCalledTimes(1);
    const written = vi.mocked(writeNotationClipboard).mock.calls[0]![0];
    expect(written.museScore).toBeNull();
    expect(deserializeFragment(written.text)!.content).toEqual(source.events);
    expect(source).toEqual(before);

    vi.mocked(readNotationClipboard).mockResolvedValue({ ...written, nativeFormatsSupported: true });
    const pasted = await pasteFromClipboard();
    const [from, to] = pasted!.content as NoteEvent[];
    expect(from!.notes!.map((note) => note.pitch)).toEqual(
      (source.events[0] as NoteEvent).notes!.map((note) => note.pitch),
    );
    expect(to!.notes!.map((note) => note.pitch)).toEqual(
      (source.events[1] as NoteEvent).notes!.map((note) => note.pitch),
    );
    expect(from!.notes![0]!.ties).toBeUndefined();
    expect(from!.notes![1]!.ties).toEqual([{ target: to!.notes![0]!.id }]);
    expect(from!.notes![2]!.ties).toEqual([{ target: to!.notes![1]!.id }]);
    expect(source).toEqual(before);
  });
});
