import { describe, expect, it } from "vitest";
import type { NoteEvent, SequenceContent, Tuplet } from "@viritura/core";
import type { MuseScoreClipboardWriteInput } from ".";
import { MUSESCORE_STAFF_LIST_MIME, readMuseScoreClipboard, writeMuseScoreStaffList } from ".";

function quarterNote(): NoteEvent {
  return {
    type: "event",
    duration: { base: "quarter" },
    notes: [{ pitch: { step: "C", octave: 4 } }],
  };
}

function quarterTriplet(): Tuplet {
  return {
    type: "tuplet",
    inner: { duration: { base: "quarter" }, multiple: 3 },
    outer: { duration: { base: "quarter" }, multiple: 2 },
    content: [quarterNote(), quarterNote(), quarterNote()],
  };
}

function nestedTriplet(): Tuplet {
  const tuplet = quarterTriplet();
  tuplet.content[1] = {
    type: "tuplet",
    inner: { duration: { base: "eighth" }, multiple: 3 },
    outer: { duration: { base: "eighth" }, multiple: 2 },
    content: [quarterNote(), quarterNote(), quarterNote()].map((note) => ({
      ...note,
      duration: { base: "eighth" },
    })),
  };
  return tuplet;
}

function exportXml(events: SequenceContent[]): string {
  const selection: MuseScoreClipboardWriteInput = { events };
  const result = writeMuseScoreStaffList(selection);
  expect(result.warning).toBeUndefined();
  expect(result.xml).not.toBeNull();
  return result.xml!;
}

describe("MuseScore reader tuplet gaps", () => {
  it.each([
    { name: "quarter-note triplet", tuplet: quarterTriplet() },
    { name: "nested triplet", tuplet: nestedTriplet() },
  ])("round-trips a quarter note and quarter-note space before a complete $name", ({ tuplet }) => {
    const content: SequenceContent[] = [quarterNote(), { type: "space", duration: [1, 4] }, tuplet];
    const xml = exportXml(content);
    expect(xml).toContain('len="1/1"');
    expect(xml).toContain("<location><fractions>1/4</fractions></location><Tuplet>");

    const parsed = readMuseScoreClipboard(xml, MUSESCORE_STAFF_LIST_MIME);
    expect(parsed.content).toHaveLength(3);
    expect(parsed.content).toMatchObject(content);
    expect(exportXml(parsed.content)).toBe(xml);
  });

  it.each([
    { name: "before the first note", tuplet: quarterTriplet(), index: 0 },
    { name: "between notes", tuplet: quarterTriplet(), index: 1 },
    { name: "before a nested tuplet", tuplet: nestedTriplet(), index: 1 },
  ])("rejects a genuine internal gap $name", ({ tuplet, index }) => {
    tuplet.content.splice(index, 0, { type: "space", duration: [1, 4] });
    const xml = exportXml([tuplet]);

    expect(() => readMuseScoreClipboard(xml, MUSESCORE_STAFF_LIST_MIME)).toThrow(
      "gaps inside tuplets are not supported",
    );
  });
});
