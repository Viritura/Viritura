import { describe, expect, it } from "vitest";
import type { NoteEvent, Score, Tuplet } from "@viritura/core";

import { assignFreshIds, deserializeFragment } from "../clipboard/deserialize";
import { buildClipboardSelection } from "../clipboard/buildClipboardSelection";
import { serializeFragment } from "../clipboard/serialize";
import { applyPaste, type PasteResult } from "../commands/clipboardCommands";
import { sequenceContentBeats } from "../commands/noteCommands";
import type { SelectionState } from "../store/selectionStore";

function note(id: string, step: "C" | "D" | "E" | "F"): NoteEvent {
  return {
    type: "event",
    id,
    duration: { base: "eighth" },
    notes: [{ id: `${id}-note`, pitch: { step, octave: 4 } }],
  };
}

function triplet(): Tuplet {
  return {
    type: "tuplet",
    outer: { duration: { base: "quarter" }, multiple: 1 },
    inner: { duration: { base: "eighth" }, multiple: 3 },
    content: [note("triplet-1", "C"), note("triplet-2", "D"), note("triplet-3", "E")],
  };
}

function makeScore(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [{ id: "m1", time: { count: 4, unit: 4 } }, { id: "m2" }],
    },
    parts: [
      {
        id: "part-1",
        name: "Flute",
        measures: [
          {
            sequences: [
              {
                content: [
                  { type: "event", id: "before", duration: { base: "quarter" }, rest: {} },
                  triplet(),
                  {
                    type: "event",
                    id: "after",
                    duration: { base: "quarter" },
                    notes: [{ pitch: { step: "F", octave: 4 } }],
                  },
                  { type: "event", id: "tail", duration: { base: "quarter" }, rest: {} },
                ],
              },
            ],
          },
          {
            sequences: [{ content: [{ type: "event", id: "target", duration: { base: "whole" }, rest: {} }] }],
          },
        ],
      },
    ],
  };
}

function range(start: string, end: string): SelectionState {
  return { kind: "range", startElementId: `p0/m0/s0/${start}`, endElementId: `p0/m0/s0/${end}` };
}

describe("clipboard ranges containing tuplets", () => {
  it("captures the tuplet container once instead of flattening inner events", () => {
    const copied = buildClipboardSelection(makeScore(), range("triplet-1", "after"));

    expect(copied?.events).toHaveLength(2);
    expect(copied?.events[0]?.type).toBe("tuplet");
    expect((copied?.events[0] as Tuplet).content.map((event) => event.id)).toEqual([
      "triplet-1",
      "triplet-2",
      "triplet-3",
    ]);
    expect((copied?.events[1] as NoteEvent).id).toBe("after");
    expect(copied?.events.reduce((sum, item) => sum + sequenceContentBeats(item), 0)).toBe(2);
  });

  it("treats a partially selected tuplet as one indivisible rhythmic unit", () => {
    const copied = buildClipboardSelection(makeScore(), range("triplet-2", "triplet-3"));

    expect(copied?.events).toHaveLength(1);
    expect(copied?.events[0]?.type).toBe("tuplet");
    expect((copied?.events[0] as Tuplet).content).toHaveLength(3);
    expect(sequenceContentBeats(copied!.events[0]!)).toBe(1);
  });

  it("pastes the preserved tuplet ratio and children into the target measure", () => {
    const score = makeScore();
    const copied = buildClipboardSelection(score, range("triplet-1", "after"))!;
    const serialized = serializeFragment(copied.events, copied.timeSignature, copied.keySignature);
    const deserialized = deserializeFragment(serialized)!;
    const paste: PasteResult = {
      content: assignFreshIds(deserialized.content),
      sourceTimeSignature: deserialized.timeSignature,
      sourceKeySignature: deserialized.keySignature,
    };

    const pasted = applyPaste(score, paste, 0, 1, 0, 0);
    const content = pasted.parts[0]!.measures[1]!.sequences[0]!.content;
    const pastedTuplet = content[0] as Tuplet;

    expect(pastedTuplet.type).toBe("tuplet");
    expect(pastedTuplet.outer).toEqual({ duration: { base: "quarter" }, multiple: 1 });
    expect(pastedTuplet.inner).toEqual({ duration: { base: "eighth" }, multiple: 3 });
    expect(pastedTuplet.content).toHaveLength(3);
    expect(new Set(pastedTuplet.content.map((event) => event.id)).size).toBe(3);
    expect(content.reduce((sum, item) => sum + sequenceContentBeats(item), 0)).toBe(4);
  });
});
