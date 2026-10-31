import { expect, it } from "vitest";
import { isDraft } from "immer";
import type { NoteEvent } from "@viritura/core";
import { produce } from "../scoreClone";
import { splitEventDurations } from "./index";

it("clones the current draft state and draft durations into detached fragments without losing hidden metadata", () => {
  const original: NoteEvent = {
    type: "event",
    id: "source",
    duration: { base: "quarter" },
    notes: [{ id: "source-note", pitch: { step: "C", octave: 4 } }],
    lyrics: {
      lines: {
        verse: { text: "Ah", extender: { target: "source", id: "span", _c: "retain" } },
        hidden: { text: "Hidden", extender: { target: "source", show: false, id: "hidden-span", _x: { test: {} } } },
      },
    },
  };
  let fragments: NoteEvent[] = [];
  const edited = produce(original, (draft) => {
    draft.lyrics!.lines!.verse!.text = "Edited";
    draft.lyrics!.lines!.hidden!.extender!.target = "edited-endpoint";
    draft.duration.dots = 1;
    expect(isDraft(draft)).toBe(true);
    expect(isDraft(draft.duration)).toBe(true);
    fragments = splitEventDurations(draft, [draft.duration, { base: "quarter" }]);
    draft.notes![0]!.pitch.step = "E";
  });

  expect(() => structuredClone(fragments)).not.toThrow();
  expect(isDraft(fragments[0])).toBe(false);
  expect(isDraft(fragments[0]!.duration)).toBe(false);
  expect(fragments[0]!.duration).toEqual({ base: "quarter", dots: 1 });
  expect(fragments[0]!.lyrics?.lines?.verse?.text).toBe("Edited");
  expect(fragments[0]!.lyrics?.lines?.hidden?.extender).toEqual({
    target: "edited-endpoint",
    show: false,
    id: "hidden-span",
    _x: { test: {} },
  });
  expect(fragments[1]!.lyrics).toBeUndefined();
  expect(fragments[0]!.notes![0]!.ties).toEqual([{ target: fragments[1]!.notes![0]!.id }]);
  expect(fragments[0]!.notes![0]!.pitch.step).toBe("C");
  expect(edited.notes![0]!.pitch.step).toBe("E");
  expect(original.lyrics!.lines!.verse!.text).toBe("Ah");
  expect(original.lyrics!.lines!.hidden!.extender!.target).toBe("source");
  expect(original.duration.dots).toBeUndefined();
});
