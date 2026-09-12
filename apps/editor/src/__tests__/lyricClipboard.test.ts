import { describe, expect, it } from "vitest";
import type { NoteEvent, Score } from "@viritura/core";
import { buildClipboardSelection } from "../clipboard/buildClipboardSelection";
import { deserializeFragment } from "../clipboard/deserialize";
import { serializeFragment } from "../clipboard/serialize";
import { applyPaste, pasteResultFromFragment } from "../commands/clipboardCommands";
import { pasteTextIntoSelectedLyric, selectedLyricText } from "../commands/lyricCommands";
import { lyricElementId } from "../score/ElementPath";

function scoreWithLyrics(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [{ time: { count: 4, unit: 4 }, key: { fifths: 0 } }],
      lyrics: {
        lineMetadata: { original: { label: "Lead", lang: "en-GB" } },
        lineOrder: ["original"],
      },
    },
    parts: [
      {
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
                    lyrics: { lines: { original: { text: "Sing", type: "start" } } },
                  },
                  {
                    type: "event",
                    id: "target",
                    duration: { base: "quarter" },
                    notes: [{ pitch: { step: "D", octave: 4 } }],
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

describe("lyric clipboard behavior", () => {
  it("treats a selected syllable as text rather than copying its parent event", () => {
    const score = scoreWithLyrics();
    const selection = {
      kind: "single" as const,
      elementId: lyricElementId("p0/m0/s0/source", "original"),
      elementType: "lyric" as const,
    };

    expect(selectedLyricText(score, selection)).toBe("Sing");
    expect(buildClipboardSelection(score, selection)).toBeNull();

    const pasted = pasteTextIntoSelectedLyric(score, selection, "Song");
    const event = pasted?.parts[0]!.measures[0]!.sequences[0]!.content[0] as NoteEvent;
    expect(event.lyrics?.lines?.original?.text).toBe("Song");
    expect(event.notes).toHaveLength(1);
  });

  it("preserves lyric line metadata when copying and pasting notation", () => {
    const source = scoreWithLyrics();
    const copied = buildClipboardSelection(source, {
      kind: "single",
      elementId: "p0/m0/s0/source",
      elementType: "event",
    })!;
    expect(copied.lyrics).toEqual(source.global.lyrics);

    const serialized = serializeFragment(
      copied.events,
      copied.timeSignature,
      copied.keySignature,
      copied.tracks,
      copied.clef,
      copied.transposition,
      copied.dynamics,
      copied.measureRepeats,
      copied.lyrics,
    );
    const fragment = deserializeFragment(serialized)!;
    const target = scoreWithLyrics();
    delete target.global.lyrics;
    const pasted = applyPaste(target, pasteResultFromFragment(fragment), 0, 0, 0, 1);

    expect(pasted.global.lyrics).toEqual(source.global.lyrics);
    const event = pasted.parts[0]!.measures[0]!.sequences[0]!.content[1] as NoteEvent;
    expect(event.lyrics?.lines?.original).toEqual({ text: "Sing", type: "start" });
  });

  it("keeps existing target metadata when a pasted line ID already exists", () => {
    const target = scoreWithLyrics();
    target.global.lyrics = {
      lineMetadata: { original: { label: "Target verse", lang: "de" } },
      lineOrder: ["original"],
    };
    const pasted = applyPaste(
      target,
      {
        content: [
          {
            type: "event",
            duration: { base: "quarter" },
            notes: [{ pitch: { step: "E", octave: 4 } }],
            lyrics: { lines: { original: { text: "Source" } } },
          },
        ],
        sourceTimeSignature: { count: 4, unit: 4 },
        sourceKeySignature: { fifths: 0 },
        lyrics: {
          lineMetadata: { original: { label: "Source verse", lang: "en" } },
          lineOrder: ["original"],
        },
      },
      0,
      0,
      0,
      1,
    );

    expect(pasted.global.lyrics?.lineMetadata?.original).toEqual({ label: "Target verse", lang: "de" });
  });

  it("rejects malformed lyric metadata in clipboard fragments", () => {
    const malformed = JSON.stringify({
      type: "viritura/fragment",
      version: 4,
      timeSignature: { count: 4, unit: 4 },
      keySignature: { fifths: 0 },
      content: [],
      lyrics: { lineMetadata: [] },
    });

    expect(deserializeFragment(malformed)).toBeNull();
  });
});
